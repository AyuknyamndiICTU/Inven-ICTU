import type { OfflineTransaction } from '@labpass/contracts';
import { b64urlEncode } from '@labpass/contracts/tap';
import { Controller, Inject, Injectable, Logger, Module, Req } from '@nestjs/common';
import type { OfflineSyncConflict, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { API_ENV, type ApiEnv } from '../config/env';
import { LendingModule } from '../lending/lending.module';
import { LendingService } from '../lending/lending.service';
import { SecretBox, uidHmac } from '../platform/crypto/crypto';
import { assistantMacKey, splitArgon2, txMac, wrapMacKey } from './assistant-key';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { AppError, Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RealtimeService } from '../platform/realtime/realtime';
import { SettingsModule, SettingsService } from '../settings/settings';
import { checkEvidence, type ConflictReason, conflictFromError, type EvidenceLookups } from './evidence';

/** Bundles are valid for twice the longest allowed outage so a kiosk that went offline just before a refresh is covered. */
const BUNDLE_TTL_HOURS_MIN = 1;
const KEEP_KEY_VERSIONS = 3;

/** Conflict payloads are shown to lab assistants: never keep a raw card UID there (S13 finding 5, ADR-0009). */
function redactEvidence(t: OfflineTransaction): OfflineTransaction {
  if (t.evidence.type !== 'CARD' || !t.evidence.uid) return t;
  const { uid, ...rest } = t.evidence;
  return { ...t, evidence: { ...rest, uidSuffix: uid.slice(-4) } as OfflineTransaction['evidence'] };
}

function conflictDto(c: OfflineSyncConflict & { batch: { kioskId: string } }) {
  return {
    id: c.id,
    batchId: c.batchId,
    kioskId: c.batch.kioskId,
    txId: c.offlineTxId,
    reason: c.reason,
    payload: c.payload,
    resolution: c.resolution,
    note: c.note,
    createdAt: c.createdAt.toISOString(),
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
  };
}

/** Offline lending (decision Q6, ARCH §5 F9): the cached bundle, journal sync, and admin conflict review. */
@Injectable()
export class OfflineService {
  private readonly logger = new Logger('Offline');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly lending: LendingService,
    private readonly box: SecretBox,
    private readonly realtime: RealtimeService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ───────────── Bundle ─────────────

  /** Rotates the kiosk's offline key and returns the data needed to keep lending offline (≤ 5 MB for 10k students). */
  async bundle(kioskId: string) {
    const settings = await this.settings.get();
    const last = await this.prisma.kioskOfflineKey.findFirst({ where: { kioskId }, orderBy: { keyVersion: 'desc' } });
    const keyVersion = (last?.keyVersion ?? 0) + 1;
    const lookupKey = randomBytes(32);
    await this.prisma.kioskOfflineKey.create({
      data: { kioskId, keyVersion, keyEnc: this.box.seal(lookupKey.toString('base64url')) },
    });
    await this.prisma.kioskOfflineKey.deleteMany({
      where: { kioskId, keyVersion: { lte: keyVersion - KEEP_KEY_VERSIONS } },
    });

    const now = Date.now();
    const [equipment, students, credentials, assistants] = await Promise.all([
      this.prisma.equipment.findMany({
        where: { active: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, availableQuantity: true, category: { select: { name: true } } },
      }),
      this.prisma.student.findMany({
        where: { OR: [{ status: 'ACTIVE' }, { loans: { some: { status: 'OPEN' } } }] },
        select: {
          id: true,
          matricule: true,
          firstName: true,
          lastName: true,
          status: true,
          loans: {
            where: { status: 'OPEN' },
            select: {
              dueAt: true,
              lines: {
                select: {
                  id: true,
                  equipmentId: true,
                  qtyIssued: true,
                  qtyReturned: true,
                  qtyDamaged: true,
                  qtyLost: true,
                  needsReview: true,
                  equipment: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.mobileCredential.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          studentId: true,
          kind: true,
          publicKeySpki: true,
          cosePublicKey: true,
          webauthnCredentialId: true,
        },
      }),
      this.prisma.adminUser.findMany({
        where: { active: true, assistantPinHash: { not: null }, role: { not: 'VIEWER' } },
        select: { id: true, name: true, assistantPinHash: true },
      }),
    ]);

    const hours = Math.max(BUNDLE_TTL_HOURS_MIN, settings.offlineMaxHours * 2);
    return {
      version: keyVersion,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + hours * 3600_000).toISOString(),
      kioskId,
      keyVersion,
      lookupKey: lookupKey.toString('base64url'),
      equipment: equipment.map((e) => ({
        id: e.id,
        code: e.code,
        name: e.name,
        categoryName: e.category.name,
        available: e.availableQuantity,
      })),
      // UIDs are stored peppered; the kiosk learns card → student lookups from its own online taps (ADR-0009).
      cards: [],
      students: students.map((s) => ({
        id: s.id,
        matricule: s.matricule,
        firstName: s.firstName,
        lastName: s.lastName,
        status: s.status,
        overdue: s.loans.some((l) => l.dueAt.getTime() < now),
        openLines: s.loans.flatMap((l) =>
          l.lines
            .map((ln) => ({ ln, outstanding: ln.qtyIssued - ln.qtyReturned - ln.qtyDamaged - ln.qtyLost }))
            .filter((x) => x.outstanding > 0 && !x.ln.needsReview)
            .map(({ ln, outstanding }) => ({
              loanLineId: ln.id,
              equipmentId: ln.equipmentId,
              equipmentName: ln.equipment.name,
              outstanding,
            })),
        ),
      })),
      credentials: credentials
        .filter((c) => (c.kind === 'DEVICE_KEY' ? c.publicKeySpki : c.cosePublicKey))
        .map((c) => ({
          credentialId: c.id,
          studentId: c.studentId,
          kind: c.kind,
          publicKey: b64urlEncode(new Uint8Array((c.kind === 'DEVICE_KEY' ? c.publicKeySpki : c.cosePublicKey)!)),
          webauthnCredentialId: c.webauthnCredentialId,
        })),
      // No PIN hashes leave the server: each assistant gets a MAC key that only their PIN unwraps (S13 findings 1, 4).
      assistants: assistants.flatMap((a) => {
        const split = splitArgon2(a.assistantPinHash!);
        if (!split) return [];
        const macKey = assistantMacKey(this.env.APP_SECRET, a.id, kioskId, keyVersion);
        return [{ id: a.id, name: a.name, pinParams: split.pinParams, wrappedKey: wrapMacKey(split.digest, macKey) }];
      }),
      settings: {
        blockWhenOverdue: settings.blockWhenOverdue,
        maxItemsPerStudent: settings.maxItemsPerStudent,
        offlineMaxHours: settings.offlineMaxHours,
        cardAuthMode: settings.cardAuthMode,
      },
    };
  }

  // ───────────── Sync ─────────────

  private lookups(kioskId: string, keyVersion: number): EvidenceLookups {
    return {
      card: async (uid) =>
        this.prisma.cardBinding.findFirst({
          where: { uidHmac: uidHmac(this.env.UID_PEPPER, uid), status: 'ACTIVE' },
          select: { studentId: true, cardTech: true },
        }),
      credential: async (id) => {
        const c = await this.prisma.mobileCredential.findUnique({
          where: { id },
          select: { studentId: true, status: true, kind: true, publicKeySpki: true },
        });
        return c ? { ...c, spki: c.publicKeySpki ? new Uint8Array(c.publicKeySpki) : null } : null;
      },
      assistantKey: async (id) => {
        const ok = await this.prisma.adminUser.count({
          where: { id, active: true, assistantPinHash: { not: null }, role: { not: 'VIEWER' } },
        });
        return ok ? assistantMacKey(this.env.APP_SECRET, id, kioskId, keyVersion) : null;
      },
      useNonce: async (credentialId, nonce) => {
        const r = await this.prisma.usedEvidenceNonce.createMany({
          data: [{ credentialId, nonce }],
          skipDuplicates: true,
        });
        return r.count === 1;
      },
      computeMac: txMac,
    };
  }

  /** Applies one transaction; returns 'applied' | 'duplicate' or a conflict reason. Never forces stock (I2). */
  private async apply(kioskId: string, t: OfflineTransaction): Promise<'applied' | 'duplicate' | ConflictReason> {
    const base = { txId: t.txId, studentId: t.studentId, occurredAt: new Date(t.occurredAt) };
    try {
      if (t.kind === 'BORROW') {
        if (!t.borrowLines.length) return 'UNKNOWN_LINE';
        const r = await this.lending.replayBorrow(kioskId, { ...base, method: t.method }, t.borrowLines);
        return r.replayed ? 'duplicate' : 'applied';
      }
      if (!t.returnLines.length) return 'UNKNOWN_LINE';
      const r = await this.lending.replayReturn(kioskId, base, t.returnLines);
      return r.replayed ? 'duplicate' : 'applied';
    } catch (e) {
      if (e instanceof AppError) {
        const reason = conflictFromError(e.code);
        if (reason) return reason;
      }
      throw e;
    }
  }

  async sync(kioskId: string, body: In<'kiosk.offlineSync'>['body']) {
    const ctx = { kioskId, offlineFrom: Date.parse(body.offlineFrom), offlineTo: Date.parse(body.offlineTo) };
    if (!(ctx.offlineFrom <= ctx.offlineTo))
      throw Errors.badRequest('BAD_WINDOW', 'offlineFrom must be before offlineTo.');
    const batch = await this.prisma.offlineSyncBatch.create({
      data: {
        kioskId,
        offlineFrom: new Date(ctx.offlineFrom),
        offlineTo: new Date(ctx.offlineTo),
        txCount: body.transactions.length,
      },
    });
    const key = await this.prisma.kioskOfflineKey.findUnique({
      where: { kioskId_keyVersion: { kioskId, keyVersion: body.bundleVersion } },
    });
    const settings = await this.settings.get();
    // The kiosk cannot widen the window: it starts no earlier than the bundle it lent from and ends now (finding 2).
    const bounded = {
      ...ctx,
      offlineFrom: Math.max(ctx.offlineFrom, key ? key.createdAt.getTime() : Date.now()),
      offlineTo: Math.min(ctx.offlineTo, Date.now()),
      cardAuthMode: settings.cardAuthMode,
    };
    const look = this.lookups(kioskId, body.bundleVersion);
    const applied: string[] = [];
    const duplicates: string[] = [];
    const conflicts: Array<{ txId: string; reason: string }> = [];

    // Ordered replay: a return later in the outage may depend on an earlier borrow's stock.
    for (const t of [...body.transactions].sort((a, b) => a.seq - b.seq)) {
      const prior = await this.prisma.offlineSyncConflict.findUnique({ where: { offlineTxId: t.txId } });
      const done = await this.prisma.idempotencyKey.findUnique({
        where: { scope_key: { scope: `kiosk.offline:${kioskId}`, key: t.txId } },
        select: { status: true },
      });
      if (prior || done?.status === 'DONE') {
        duplicates.push(t.txId);
        continue;
      }
      let outcome: 'applied' | 'duplicate' | ConflictReason;
      if (!key) outcome = 'BUNDLE_EXPIRED';
      else {
        const ev = await checkEvidence(t, bounded, look);
        outcome = ev.ok ? await this.apply(kioskId, t) : ev.reason;
      }
      if (outcome === 'applied') applied.push(t.txId);
      else if (outcome === 'duplicate') duplicates.push(t.txId);
      else {
        await this.prisma.offlineSyncConflict.create({
          data: {
            batchId: batch.id,
            offlineTxId: t.txId,
            reason: outcome,
            payload: { ...redactEvidence(t), kioskId } as unknown as Prisma.InputJsonValue,
          },
        });
        conflicts.push({ txId: t.txId, reason: outcome });
      }
    }

    await this.prisma.offlineSyncBatch.update({
      where: { id: batch.id },
      data: { applied: applied.length, conflicts: conflicts.length },
    });
    if (conflicts.length) {
      this.logger.warn(`kiosk ${kioskId}: ${conflicts.length} offline conflict(s) need review`);
      const first = await this.prisma.offlineSyncConflict.findUniqueOrThrow({
        where: { offlineTxId: conflicts[0]!.txId },
      });
      await this.realtime.toAdmins('offlineConflict.created', { id: first.id, kioskId });
    }
    return { batchId: batch.id, applied, duplicates, conflicts };
  }

  // ───────────── Admin review ─────────────

  async list(open?: 'true' | 'false') {
    const rows = await this.prisma.offlineSyncConflict.findMany({
      where: open === undefined ? {} : open === 'true' ? { resolution: null } : { resolution: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { batch: { select: { kioskId: true } } },
    });
    return rows.map(conflictDto);
  }

  /**
   * ACCEPTED records what physically happened: stock conflicts get a stock correction first, inactive students are
   * allowed, and evidence conflicts are vouched for by the admin. VOIDED records nothing. Both are audited (route).
   */
  async resolve(id: string, body: In<'offlineConflicts.resolve'>['body'], adminId: string) {
    const c = await this.prisma.offlineSyncConflict.findUnique({ where: { id }, include: { batch: true } });
    if (!c) throw Errors.notFound('Conflict');
    if (c.resolution) throw Errors.conflict('ALREADY_RESOLVED', 'This conflict was already resolved.');

    if (body.resolution === 'ACCEPTED' && c.reason !== 'UNKNOWN_LINE') {
      const t = c.payload as unknown as OfflineTransaction;
      const base = { txId: t.txId, studentId: t.studentId, occurredAt: new Date(t.occurredAt) };
      try {
        if (t.kind === 'BORROW') {
          await this.lending.replayBorrow(c.batch.kioskId, { ...base, method: t.method }, t.borrowLines, {
            allowInactive: true,
            correction: { adminId, reason: `Offline conflict ${c.id}: ${body.note}` },
          });
        } else {
          await this.lending.replayReturn(c.batch.kioskId, base, t.returnLines);
        }
      } catch (e) {
        if (e instanceof AppError)
          throw Errors.conflict(
            'CANNOT_APPLY',
            `This transaction still cannot be applied (${e.code}). Void it instead.`,
          );
        throw e;
      }
    }
    const updated = await this.prisma.offlineSyncConflict.update({
      where: { id },
      data: { resolution: body.resolution, note: body.note, resolverId: adminId, resolvedAt: new Date() },
      include: { batch: { select: { kioskId: true } } },
    });
    return conflictDto(updated);
  }
}

@Controller()
export class KioskOfflineController {
  constructor(private readonly offline: OfflineService) {}

  @Contract('kiosk.offlineBundle')
  bundle(@Req() req: LpRequest) {
    return this.offline.bundle(req.kiosk!.id);
  }

  @Contract('kiosk.offlineSync')
  sync(@ContractInput() input: In<'kiosk.offlineSync'>, @Req() req: LpRequest) {
    return this.offline.sync(req.kiosk!.id, input.body);
  }
}

@Controller()
export class OfflineConflictsController {
  constructor(private readonly offline: OfflineService) {}

  @Contract('offlineConflicts.list')
  list(@ContractInput() input: In<'offlineConflicts.list'>) {
    return this.offline.list(input.query.open);
  }

  @Contract('offlineConflicts.resolve')
  resolve(@ContractInput() input: In<'offlineConflicts.resolve'>, @Req() req: LpRequest) {
    return this.offline.resolve(input.params.id, input.body, req.admin!.id);
  }
}

@Module({
  imports: [SettingsModule, LendingModule],
  controllers: [KioskOfflineController, OfflineConflictsController],
  providers: [OfflineService],
})
export class OfflineModule {}
