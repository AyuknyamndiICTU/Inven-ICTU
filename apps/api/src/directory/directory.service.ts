import type { DirectoryImportDto } from '@labpass/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { DirectoryImport, ImportChangeType, Prisma, Student } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { API_ENV, type ApiEnv } from '../config/env';
import { uidHmac } from '../platform/crypto/crypto';
import { toSafeCsv } from '../platform/http/csv';
import { Errors } from '../platform/http/problem';
import { OutboxService } from '../platform/outbox/outbox';
import { PrismaService, type Tx } from '../platform/prisma/prisma.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../platform/storage/storage';
import {
  autoMap,
  type CardRecord,
  type ImportKind,
  type Issue,
  missingRequired,
  parseTable,
  type StudentRecord,
  type Table,
  validateCards,
  validateStudents,
} from './parse';

const BATCH = 2000;
const STORED_ISSUES = 500;

type Counts = { total: number; new: number; changed: number; unchanged: number; invalid: number; missing: number };
interface Plan {
  counts: Counts;
  issues: Issue[];
  students?: StudentRecord[];
  cards?: CardRecord[];
}

const chunk = <T>(xs: T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const snapshot = (s: Student) => ({
  matricule: s.matricule,
  firstName: s.firstName,
  lastName: s.lastName,
  email: s.email,
  phone: s.phone,
  dateOfBirth: s.dateOfBirth.toISOString().slice(0, 10),
  program: s.program,
  level: s.level,
  status: s.status,
  sourceHash: s.sourceHash,
});

/** Student directory imports (ARCH §9): upload → map → dry-run diff → commit → (rollback). */
@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private photoHosts(): string[] {
    return this.env.PHOTO_HOSTS;
  }

  private hmac(uid: string) {
    return uidHmac(this.env.UID_PEPPER, uid);
  }

  // ───────────── Upload & preview ─────────────

  async upload(
    kind: ImportKind,
    fileName: string,
    data: Buffer,
    actorId: string | null,
    source: 'FILE' | 'REST' = 'FILE',
  ): Promise<DirectoryImportDto> {
    const table = await parseTable(data);
    const isZip = data.readUInt32LE(0) === 0x04034b50;
    const storageKey = `imp_${randomUUID()}.${isZip ? 'xlsx' : 'csv'}`;
    await this.storage.put(
      storageKey,
      data,
      isZip ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
    );
    const mapping = autoMap(table.headers, kind);
    const plan = await this.plan(kind, table, mapping);
    const imp = await this.prisma.directoryImport.create({
      data: {
        kind,
        source,
        fileName,
        storageKey,
        mapping: { headers: table.headers, mapping },
        counts: plan.counts,
        actorId,
      },
    });
    await this.saveIssues(imp.id, plan.issues);
    return this.dto(imp.id);
  }

  async remap(id: string, mapping: Record<string, string | null>): Promise<DirectoryImportDto> {
    const imp = await this.mustGet(id);
    if (imp.status !== 'PREVIEW') throw Errors.conflict('IMPORT_NOT_EDITABLE', 'Only previews can be re-mapped.');
    const table = await this.loadTable(imp);
    const clean = Object.fromEntries(table.headers.map((h) => [h, mapping[h] ?? null]));
    const plan = await this.plan(imp.kind, table, clean);
    await this.prisma.directoryImport.update({
      where: { id },
      data: { mapping: { headers: table.headers, mapping: clean }, counts: plan.counts },
    });
    await this.saveIssues(id, plan.issues);
    return this.dto(id);
  }

  private async loadTable(imp: DirectoryImport): Promise<Table> {
    const file = imp.storageKey ? await this.storage.get(imp.storageKey) : null;
    if (!file)
      throw Errors.conflict('IMPORT_FILE_MISSING', 'The uploaded file is no longer available. Upload it again.');
    return parseTable(file.data);
  }

  private mappingOf(imp: DirectoryImport): Record<string, string | null> {
    return ((imp.mapping as { mapping?: Record<string, string | null> } | null)?.mapping ?? {}) as Record<
      string,
      string | null
    >;
  }

  private async saveIssues(importId: string, issues: Issue[]) {
    await this.prisma.directoryImportIssue.deleteMany({ where: { importId } });
    if (issues.length) {
      await this.prisma.directoryImportIssue.createMany({
        data: issues.slice(0, STORED_ISSUES).map((i) => ({ importId, row: i.row, field: i.field, message: i.message })),
      });
    }
  }

  async plan(kind: ImportKind, table: Table, mapping: Record<string, string | null>): Promise<Plan> {
    const total = table.rows.length;
    const missing = missingRequired(kind, mapping);
    if (missing.length) {
      return {
        counts: { total, new: 0, changed: 0, unchanged: 0, invalid: total, missing: 0 },
        issues: [{ row: 1, field: null, message: `Map the required column(s): ${missing.join(', ')}` }],
      };
    }
    if (kind === 'STUDENTS') {
      const { records, issues } = validateStudents(table, mapping, { photoHosts: this.photoHosts() });
      const existing = await this.studentsByMatricule(records.map((r) => r.matricule));
      let added = 0;
      let changed = 0;
      for (const r of records) {
        const s = existing.get(r.matricule);
        if (!s) added++;
        else if (s.sourceHash !== r.sourceHash) changed++;
      }
      const activeTotal = await this.prisma.student.count({ where: { status: 'ACTIVE' } });
      const activeInFile = [...existing.values()].filter((s) => s.status === 'ACTIVE').length;
      return {
        counts: {
          total,
          new: added,
          changed,
          unchanged: records.length - added - changed,
          invalid: new Set(issues.map((i) => i.row)).size,
          missing: activeTotal - activeInFile,
        },
        issues,
        students: records,
      };
    }
    const { records, issues } = validateCards(table, mapping);
    const students = await this.studentsByMatricule(records.map((r) => r.matricule));
    const bindings = await this.prisma.cardBinding.findMany({
      where: { status: 'ACTIVE', uidHmac: { in: records.map((r) => this.hmac(r.cardUid)) } },
    });
    const byHmac = new Map(bindings.map((b) => [b.uidHmac, b]));
    const valid: CardRecord[] = [];
    let added = 0;
    let changed = 0;
    let unchanged = 0;
    for (const r of records) {
      const s = students.get(r.matricule);
      if (!s) {
        issues.push({ row: r.row, field: 'matricule', message: 'No student with this matricule' });
        continue;
      }
      const b = byHmac.get(this.hmac(r.cardUid));
      if (b && b.studentId !== s.id) {
        issues.push({ row: r.row, field: 'card_uid', message: 'This card is already linked to another student' });
        continue;
      }
      valid.push(r);
      if (b) unchanged++;
      else if (await this.prisma.cardBinding.count({ where: { studentId: s.id, status: 'ACTIVE' } })) changed++;
      else added++;
    }
    return {
      counts: { total, new: added, changed, unchanged, invalid: new Set(issues.map((i) => i.row)).size, missing: 0 },
      issues,
      cards: valid,
    };
  }

  private async studentsByMatricule(matricules: string[]): Promise<Map<string, Student>> {
    const map = new Map<string, Student>();
    for (const part of chunk(matricules, 1000)) {
      for (const s of await this.prisma.student.findMany({ where: { matricule: { in: part } } }))
        map.set(s.matricule, s);
    }
    return map;
  }

  // ───────────── Commit ─────────────

  async commit(id: string, deactivateMissing: boolean): Promise<DirectoryImportDto> {
    const locked = await this.prisma.directoryImport.updateMany({
      where: { id, status: 'PREVIEW' },
      data: { status: 'COMMITTING', deactivateMissing },
    });
    if (locked.count === 0) {
      await this.mustGet(id);
      throw Errors.conflict('IMPORT_NOT_COMMITTABLE', 'This import was already committed or is being committed.');
    }
    const imp = await this.mustGet(id);
    try {
      const table = await this.loadTable(imp);
      const plan = await this.plan(imp.kind, table, this.mappingOf(imp));
      if (imp.kind === 'STUDENTS') await this.applyStudents(id, plan.students ?? [], deactivateMissing);
      else await this.applyCards(id, plan.cards ?? []);
      await this.prisma.directoryImport.update({
        where: { id },
        data: { status: 'COMMITTED', committedAt: new Date(), counts: plan.counts },
      });
    } catch (e) {
      await this.prisma.directoryImport.update({
        where: { id },
        data: { status: 'FAILED', error: (e as Error).message.slice(0, 500) },
      });
      throw e;
    }
    return this.dto(id);
  }

  private async change(
    tx: Tx,
    importId: string,
    changeType: ImportChangeType,
    data: { studentId?: string; cardBindingId?: string; before?: unknown; after?: unknown },
  ) {
    await tx.directoryImportChange.create({
      data: {
        importId,
        changeType,
        studentId: data.studentId ?? null,
        cardBindingId: data.cardBindingId ?? null,
        before: (data.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (data.after ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async bindCard(tx: Tx, importId: string, studentId: string, uid: string, via: 'SIS' | 'SUPPLIER_FILE') {
    const hmac = this.hmac(uid);
    const sameActive = await tx.cardBinding.findFirst({ where: { uidHmac: hmac, status: 'ACTIVE' } });
    if (sameActive?.studentId === studentId) return;
    if (sameActive) return; // linked to someone else: reported as an issue in the plan, never silently moved
    const current = await tx.cardBinding.findFirst({ where: { studentId, status: 'ACTIVE' } });
    if (current) {
      await tx.cardBinding.update({ where: { id: current.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
      await this.change(tx, importId, 'REVOKE_CARD', { studentId, cardBindingId: current.id });
    }
    const b = await tx.cardBinding.create({
      data: {
        studentId,
        uidHmac: hmac,
        uidSuffix: uid.slice(-4),
        createdVia: via,
        cardTech: via === 'SUPPLIER_FILE' ? 'DESFIRE_EV3' : 'OTHER',
      },
    });
    await this.change(tx, importId, 'BIND_CARD', { studentId, cardBindingId: b.id });
  }

  private async applyStudents(importId: string, records: StudentRecord[], deactivateMissing: boolean) {
    const now = new Date();
    const fields = (r: StudentRecord) => ({
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      phone: r.phone,
      dateOfBirth: new Date(`${r.dateOfBirth}T00:00:00Z`),
      program: r.program,
      level: r.level,
      sourceHash: r.sourceHash,
      syncedAt: now,
    });
    for (const part of chunk(records, BATCH)) {
      await this.prisma.tx(
        async (tx) => {
          const existing = new Map(
            (await tx.student.findMany({ where: { matricule: { in: part.map((r) => r.matricule) } } })).map((s) => [
              s.matricule,
              s,
            ]),
          );
          const ids = new Map<string, string>();
          // New students and their change records are written in bulk (50k-row imports must stay under a minute).
          const created = part
            .filter((r) => !existing.has(r.matricule))
            .map((r) => ({
              id: randomUUID(),
              matricule: r.matricule,
              status: r.status ?? ('ACTIVE' as const),
              ...fields(r),
            }));
          if (created.length) {
            await tx.student.createMany({ data: created });
            await tx.directoryImportChange.createMany({
              data: created.map((s) => ({
                importId,
                changeType: 'CREATE' as const,
                studentId: s.id,
                after: snapshot(s as unknown as Student),
              })),
            });
            for (const s of created) ids.set(s.matricule, s.id);
          }
          for (const r of part) {
            const s = existing.get(r.matricule);
            if (s) {
              ids.set(r.matricule, s.id);
              if (s.sourceHash !== r.sourceHash) {
                const updated = await tx.student.update({
                  where: { id: s.id },
                  data: { ...fields(r), ...(r.status ? { status: r.status } : {}) },
                });
                await this.change(tx, importId, 'UPDATE', {
                  studentId: s.id,
                  before: snapshot(s),
                  after: snapshot(updated),
                });
              }
            }
            if (r.cardUid) await this.bindCard(tx, importId, ids.get(r.matricule)!, r.cardUid, 'SIS');
          }
        },
        { timeoutMs: 120_000 },
      );
    }
    if (deactivateMissing) {
      const inFile = new Set(records.map((r) => r.matricule));
      const active = await this.prisma.student.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, matricule: true },
      });
      const gone = active.filter((s) => !inFile.has(s.matricule));
      for (const part of chunk(gone, BATCH)) {
        await this.prisma.tx(async (tx) => {
          await tx.student.updateMany({ where: { id: { in: part.map((s) => s.id) } }, data: { status: 'INACTIVE' } });
          await tx.directoryImportChange.createMany({
            data: part.map((s) => ({
              importId,
              changeType: 'DEACTIVATE' as const,
              studentId: s.id,
              before: { status: 'ACTIVE' },
              after: { status: 'INACTIVE' },
            })),
          });
        });
      }
    }
  }

  private async applyCards(importId: string, records: CardRecord[]) {
    for (const part of chunk(records, BATCH)) {
      await this.prisma.tx(
        async (tx) => {
          const students = new Map(
            (await tx.student.findMany({ where: { matricule: { in: part.map((r) => r.matricule) } } })).map((s) => [
              s.matricule,
              s,
            ]),
          );
          for (const r of part) {
            const s = students.get(r.matricule);
            if (s) await this.bindCard(tx, importId, s.id, r.cardUid, 'SUPPLIER_FILE');
          }
        },
        { timeoutMs: 120_000 },
      );
    }
  }

  // ───────────── Rollback (compensation) ─────────────

  async rollback(id: string): Promise<DirectoryImportDto> {
    const imp = await this.mustGet(id);
    if (imp.status !== 'COMMITTED')
      throw Errors.conflict('IMPORT_NOT_ROLLBACKABLE', 'Only committed imports can be rolled back.');
    const changes = await this.prisma.directoryImportChange.findMany({
      where: { importId: id },
      orderBy: { seq: 'desc' },
    });
    await this.prisma.tx(
      async (tx) => {
        for (const c of changes) {
          switch (c.changeType) {
            case 'BIND_CARD':
              await tx.cardBinding.updateMany({
                where: { id: c.cardBindingId!, status: 'ACTIVE' },
                data: { status: 'REVOKED', revokedAt: new Date() },
              });
              break;
            case 'REVOKE_CARD': {
              const b = await tx.cardBinding.findUnique({ where: { id: c.cardBindingId! } });
              const conflict =
                b &&
                (await tx.cardBinding.count({
                  where: { status: 'ACTIVE', OR: [{ uidHmac: b.uidHmac }, { studentId: b.studentId }] },
                }));
              if (b && !conflict)
                await tx.cardBinding.update({ where: { id: b.id }, data: { status: 'ACTIVE', revokedAt: null } });
              break;
            }
            case 'UPDATE': {
              const before = c.before as ReturnType<typeof snapshot>;
              await tx.student.update({
                where: { id: c.studentId! },
                data: {
                  firstName: before.firstName,
                  lastName: before.lastName,
                  email: before.email,
                  phone: before.phone,
                  dateOfBirth: new Date(`${before.dateOfBirth}T00:00:00Z`),
                  program: before.program,
                  level: before.level,
                  status: before.status,
                  sourceHash: before.sourceHash,
                },
              });
              break;
            }
            case 'DEACTIVATE':
              await tx.student.update({ where: { id: c.studentId! }, data: { status: 'ACTIVE' } });
              break;
            case 'CREATE': {
              const used =
                (await tx.loan.count({ where: { studentId: c.studentId! } })) +
                (await tx.mobileCredential.count({ where: { studentId: c.studentId! } })) +
                (await tx.cardBinding.count({ where: { studentId: c.studentId!, status: 'ACTIVE' } }));
              if (used === 0) {
                await tx.cardBinding.deleteMany({ where: { studentId: c.studentId! } });
                await tx.student.delete({ where: { id: c.studentId! } });
              } else {
                await tx.student.update({ where: { id: c.studentId! }, data: { status: 'INACTIVE' } });
              }
              break;
            }
          }
        }
        await tx.directoryImport.update({ where: { id }, data: { status: 'ROLLED_BACK', rolledBackAt: new Date() } });
      },
      { timeoutMs: 300_000 },
    );
    return this.dto(id);
  }

  // ───────────── Read models ─────────────

  private async mustGet(id: string) {
    const imp = await this.prisma.directoryImport.findUnique({ where: { id } });
    if (!imp) throw Errors.notFound('Import');
    return imp;
  }

  async dto(id: string): Promise<DirectoryImportDto> {
    const imp = await this.mustGet(id);
    const issues = await this.prisma.directoryImportIssue.findMany({
      where: { importId: id },
      orderBy: { row: 'asc' },
      take: 50,
    });
    const issueCount = await this.prisma.directoryImportIssue.count({ where: { importId: id } });
    const m = (imp.mapping as { headers?: string[]; mapping?: Record<string, string | null> } | null) ?? {};
    return {
      id: imp.id,
      kind: imp.kind,
      source: imp.source,
      fileName: imp.fileName,
      status: imp.status,
      counts: imp.counts as Counts,
      detectedHeaders: m.headers ?? [],
      mapping: m.mapping ?? {},
      deactivateMissing: imp.deactivateMissing,
      issues: issues.map((i) => ({ row: i.row, field: i.field, message: i.message })),
      issueCount,
      createdAt: imp.createdAt.toISOString(),
      committedAt: imp.committedAt?.toISOString() ?? null,
      rolledBackAt: imp.rolledBackAt?.toISOString() ?? null,
      error: imp.error,
    };
  }

  async list(): Promise<DirectoryImportDto[]> {
    const rows = await this.prisma.directoryImport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.dto(r.id)));
  }

  async errorsCsv(id: string): Promise<string> {
    await this.mustGet(id);
    const issues = await this.prisma.directoryImportIssue.findMany({
      where: { importId: id },
      orderBy: { row: 'asc' },
    });
    return toSafeCsv(
      ['row', 'field', 'message'],
      issues.map((i) => [i.row, i.field ?? '', i.message]),
    );
  }

  template(kind: ImportKind): string {
    if (kind === 'CARD_BATCH') {
      return toSafeCsv(
        ['card_uid', 'matricule', 'batch_id', 'printed_at'],
        [['04A1B2C3D4E580', 'ICTU20240001', 'B2026-11-01', '2026-11-03']],
      );
    }
    return toSafeCsv(
      [
        'matricule',
        'first_name',
        'last_name',
        'date_of_birth',
        'email',
        'phone',
        'program',
        'level',
        'status',
        'card_uid',
      ],
      [
        [
          'ICTU20240001',
          'Awa',
          'Ngo Bassa',
          '02/03/2004',
          'awa@example.edu',
          '+237 699 12 34 12',
          'Networks & Telecoms',
          'L2',
          'active',
          '',
        ],
      ],
    );
  }

  /** REST connector rows → the same pipeline (headers are canonical field names). */
  async uploadRows(rows: Array<Record<string, unknown>>, actorId: string | null): Promise<DirectoryImportDto> {
    const headers = [
      'matricule',
      'first_name',
      'last_name',
      'date_of_birth',
      'email',
      'phone',
      'program',
      'level',
      'status',
      'card_uid',
    ];
    const csv = toSafeCsv(
      headers,
      rows.map((r) => headers.map((h) => (r[h] === undefined || r[h] === null ? '' : String(r[h])))),
    );
    return this.upload(
      'STUDENTS',
      `sis-sync-${new Date().toISOString().slice(0, 16)}.csv`,
      Buffer.from(csv, 'utf8'),
      actorId,
      'REST',
    );
  }
}
