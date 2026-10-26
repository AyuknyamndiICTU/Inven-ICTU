import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lockEquipment } from '../inventory/inventory.module';
import { toSafeCsv } from '../platform/http/csv';
import { Errors } from '../platform/http/problem';
import { IdempotencyService } from '../platform/idempotency/idempotency.service';
import { JobsService } from '../platform/jobs/jobs';
import { OutboxService } from '../platform/outbox/outbox';
import { PrismaService, type Tx } from '../platform/prisma/prisma.service';
import { SettingsService } from '../settings/settings';
import { dueAtFor } from './due';
import { IdentifyService } from './identify.service';

export type Condition = 'OK' | 'DAMAGED' | 'LOST';
type Actor = { type: 'KIOSK' | 'ADMIN' | 'SYSTEM'; id: string | null; kioskId: string | null };
type SettleLine = { loanLineId: string; quantity: number; condition: Condition };
type ReplayOptions = {
  occurredAt?: Date;
  offline?: boolean;
  /** Admin accepted an offline conflict for an inactive student. */
  allowInactive?: boolean;
  /** Admin accepted an offline stock conflict: correct the stock before recording the loan. */
  correction?: { adminId: string; reason: string };
};

const OVERDUE_JOB = 'loans-overdue';
const COLUMN: Record<Condition, Prisma.Sql> = {
  OK: Prisma.raw('"qtyReturned"'),
  DAMAGED: Prisma.raw('"qtyDamaged"'),
  LOST: Prisma.raw('"qtyLost"'),
};
const MOVEMENT: Record<Condition, 'RETURN' | 'DAMAGED' | 'LOST'> = { OK: 'RETURN', DAMAGED: 'DAMAGED', LOST: 'LOST' };

const loanInclude = {
  student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
  lines: { include: { equipment: { select: { code: true, name: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.LoanInclude;
type LoanRow = Prisma.LoanGetPayload<{ include: typeof loanInclude }>;

export function loanDto(l: LoanRow, now = Date.now()) {
  return {
    id: l.id,
    student: l.student,
    kioskId: l.kioskId,
    identifyMethod: l.identifyMethod,
    manualVerification: l.manualVerification,
    offline: l.offline,
    openedAt: (l.occurredAt ?? l.openedAt).toISOString(),
    dueAt: l.dueAt.toISOString(),
    closedAt: l.closedAt?.toISOString() ?? null,
    status: l.status,
    overdue: l.status === 'OPEN' && l.dueAt.getTime() < now,
    lines: l.lines.map((ln) => ({
      id: ln.id,
      equipmentId: ln.equipmentId,
      equipmentCode: ln.equipment.code,
      equipmentName: ln.equipment.name,
      qtyIssued: ln.qtyIssued,
      qtyReturned: ln.qtyReturned,
      qtyDamaged: ln.qtyDamaged,
      qtyLost: ln.qtyLost,
      outstanding: ln.qtyIssued - ln.qtyReturned - ln.qtyDamaged - ln.qtyLost,
      needsReview: ln.needsReview,
    })),
  };
}

/** Borrow and return (ARCH §5 F5/F6): one transaction each, idempotent, conditional updates in a fixed lock order. */
@Injectable()
export class LendingService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identify: IdentifyService,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
  ) {}

  // ───────────── F5 Sign In (borrow) ─────────────

  async signIn(
    kioskId: string,
    body: { session: string; lines: Array<{ equipmentId: string; quantity: number }> },
    idemKey: string,
    opts: { occurredAt?: Date; offline?: boolean } = {},
  ) {
    const sess = this.identify.session(kioskId, body.session);
    const lines = [...body.lines].sort((a, b) => (a.equipmentId < b.equipmentId ? -1 : 1));
    const { body: receipt } = await this.idempotency.execute({
      scope: `kiosk.signIn:${kioskId}`,
      key: idemKey,
      request: { studentId: sess.s, lines },
      work: (tx) => this.borrow(tx, kioskId, sess, lines, opts),
    });
    return receipt;
  }

  private async borrow(
    tx: Tx,
    kioskId: string,
    sess: { s: string; m: 'CARD' | 'HCE' | 'SCAN' | 'MANUAL'; v: 'PIN' | 'OTP' | 'ASSISTANT' | 'OPEN' | null },
    lines: Array<{ equipmentId: string; quantity: number }>,
    opts: ReplayOptions,
  ) {
    // Serialises policy checks per student (item limit) without blocking other students.
    await tx.$queryRaw`SELECT id FROM students WHERE id = ${sess.s}::uuid FOR UPDATE`;
    const student = await tx.student.findUniqueOrThrow({ where: { id: sess.s } });
    if (student.status !== 'ACTIVE' && !opts.allowInactive) {
      throw Errors.forbidden(
        student.status === 'SUSPENDED' ? 'STUDENT_SUSPENDED' : 'STUDENT_INACTIVE',
        'Your student account cannot borrow equipment. See a lab assistant.',
      );
    }
    const open = await this.identify.openLines(student.id, tx);
    const settings = await this.settings.get();
    // Offline replays: the equipment already left the lab, and the kiosk applied the policy with its cached data.
    if (!opts.offline && settings.blockWhenOverdue && open.some((l) => l.overdue))
      throw Errors.forbidden('OVERDUE_BLOCKED', 'Please return your overdue equipment first.');
    if (!opts.offline && settings.maxItemsPerStudent !== null) {
      const outstanding = open.reduce((n, l) => n + l.outstanding, 0);
      const requested = lines.reduce((n, l) => n + l.quantity, 0);
      if (outstanding + requested > settings.maxItemsPerStudent) {
        const remaining = Math.max(0, settings.maxItemsPerStudent - outstanding);
        throw Errors.conflict('LIMIT_REACHED', `You can borrow ${remaining} more item(s).`, { remaining });
      }
    }
    for (const l of lines) {
      if (opts.correction) {
        // Admin accepted an offline conflict: units that physically left are recorded by first correcting the stock.
        const e = await tx.equipment.findUniqueOrThrow({
          where: { id: l.equipmentId },
          select: { availableQuantity: true },
        });
        const shortfall = l.quantity - e.availableQuantity;
        if (shortfall > 0) {
          await tx.equipment.update({
            where: { id: l.equipmentId },
            data: { totalQuantity: { increment: shortfall }, availableQuantity: { increment: shortfall } },
          });
          await tx.stockMovement.create({
            data: {
              equipmentId: l.equipmentId,
              type: 'CORRECTION',
              delta: shortfall,
              totalDelta: shortfall,
              actorType: 'ADMIN',
              actorId: opts.correction.adminId,
              reason: opts.correction.reason,
            },
          });
        }
      }
      const n = await tx.$executeRaw`
        UPDATE equipment SET "availableQuantity" = "availableQuantity" - ${l.quantity}, "updatedAt" = now()
        WHERE id = ${l.equipmentId}::uuid AND active AND "availableQuantity" >= ${l.quantity}`;
      if (n === 0) {
        const e = await tx.equipment.findUnique({
          where: { id: l.equipmentId },
          select: { name: true, availableQuantity: true, active: true },
        });
        if (!e || !e.active)
          throw Errors.conflict('EQUIPMENT_UNAVAILABLE', 'This equipment is not available for borrowing.', {
            equipmentId: l.equipmentId,
            available: 0,
          });
        throw Errors.conflict('INSUFFICIENT_STOCK', `Only ${e.availableQuantity} × ${e.name} left.`, {
          equipmentId: l.equipmentId,
          available: e.availableQuantity,
        });
      }
    }
    const occurredAt = opts.occurredAt ?? new Date();
    const loan = await tx.loan.create({
      data: {
        studentId: student.id,
        kioskId,
        identifyMethod: sess.m,
        manualVerification: sess.v,
        offline: Boolean(opts.offline),
        occurredAt: opts.occurredAt ?? null,
        dueAt: dueAtFor(occurredAt, settings.loanDue),
        lines: { create: lines.map((l) => ({ equipmentId: l.equipmentId, qtyIssued: l.quantity })) },
      },
      include: { lines: { include: { equipment: { select: { name: true } } } } },
    });
    await tx.stockMovement.createMany({
      data: loan.lines.map((ln) => ({
        equipmentId: ln.equipmentId,
        type: 'ISSUE' as const,
        delta: -ln.qtyIssued,
        totalDelta: 0,
        actorType: 'KIOSK' as const,
        actorId: kioskId,
        kioskId,
        loanLineId: ln.id,
      })),
    });
    await this.outbox.add(tx, 'LoanOpened', { loanId: loan.id, studentId: student.id, kioskId });
    for (const l of lines) await this.outbox.add(tx, 'StockChanged', { equipmentId: l.equipmentId });
    const byEquipment = new Map(loan.lines.map((ln) => [ln.equipmentId, ln.equipment.name]));
    return {
      kind: 'BORROW' as const,
      loanIds: [loan.id],
      occurredAt: occurredAt.toISOString(),
      dueAt: loan.dueAt.toISOString(),
      studentFirstName: student.firstName,
      lines: lines.map((l) => ({
        equipmentId: l.equipmentId,
        equipmentName: byEquipment.get(l.equipmentId)!,
        quantity: l.quantity,
        condition: null,
      })),
      offline: Boolean(opts.offline),
    };
  }

  // ───────────── F6 Sign Out (return) ─────────────

  async signOut(
    kioskId: string,
    body: { session: string; lines: Array<{ loanLineId: string; quantity: number; condition: 'OK' | 'DAMAGED' }> },
    idemKey: string,
  ) {
    const sess = this.identify.session(kioskId, body.session);
    const lines = [...body.lines].sort((a, b) =>
      a.loanLineId < b.loanLineId ? -1 : a.loanLineId > b.loanLineId ? 1 : a.condition < b.condition ? -1 : 1,
    );
    const { body: receipt } = await this.idempotency.execute({
      scope: `kiosk.signOut:${kioskId}`,
      key: idemKey,
      request: { studentId: sess.s, lines },
      work: async (tx) => {
        const r = await this.settle(tx, { studentId: sess.s }, lines, { type: 'KIOSK', id: kioskId, kioskId });
        const student = await tx.student.findUniqueOrThrow({ where: { id: sess.s }, select: { firstName: true } });
        return {
          kind: 'RETURN' as const,
          loanIds: r.loanIds,
          occurredAt: new Date().toISOString(),
          dueAt: null,
          studentFirstName: student.firstName,
          lines: r.lines.map((l) => ({
            equipmentId: l.equipmentId,
            equipmentName: l.equipmentName,
            quantity: l.quantity,
            condition: l.condition as 'OK' | 'DAMAGED',
          })),
          offline: false,
        };
      },
    });
    return receipt;
  }

  // ───────────── Offline replay (S11.5, ARCH §5 F9) ─────────────

  /**
   * Replays an offline borrow with the kiosk's txId as the idempotency key (scope per kiosk), so a sync can be
   * repeated any number of times. Evidence was already re-verified by the caller.
   */
  async replayBorrow(
    kioskId: string,
    tx: { txId: string; studentId: string; method: 'CARD' | 'HCE' | 'SCAN' | 'MANUAL'; occurredAt: Date },
    rawLines: Array<{ equipmentId: string; quantity: number }>,
    opts: Pick<ReplayOptions, 'allowInactive' | 'correction'> = {},
  ) {
    const lines = [...rawLines].sort((a, b) => (a.equipmentId < b.equipmentId ? -1 : 1));
    const sess = { s: tx.studentId, m: tx.method, v: tx.method === 'MANUAL' ? ('ASSISTANT' as const) : null };
    return this.idempotency.execute({
      scope: `kiosk.offline:${kioskId}`,
      key: tx.txId,
      request: { studentId: tx.studentId, kind: 'BORROW', lines },
      work: (t) => this.borrow(t, kioskId, sess, lines, { ...opts, offline: true, occurredAt: tx.occurredAt }),
    });
  }

  async replayReturn(
    kioskId: string,
    tx: { txId: string; studentId: string; occurredAt: Date },
    rawLines: Array<{ loanLineId: string; quantity: number; condition: 'OK' | 'DAMAGED' }>,
  ) {
    const lines = [...rawLines].sort((a, b) =>
      a.loanLineId < b.loanLineId ? -1 : a.loanLineId > b.loanLineId ? 1 : a.condition < b.condition ? -1 : 1,
    );
    return this.idempotency.execute({
      scope: `kiosk.offline:${kioskId}`,
      key: tx.txId,
      request: { studentId: tx.studentId, kind: 'RETURN', lines },
      work: async (t) => {
        const r = await this.settle(
          t,
          { studentId: tx.studentId },
          lines,
          { type: 'KIOSK', id: kioskId, kioskId },
          `offline return at ${tx.occurredAt.toISOString()}`,
        );
        return { loanIds: r.loanIds };
      },
    });
  }

  /** Admin force-return: same transaction pattern, scoped to one loan, reason required (audited by the route). */
  async forceReturn(loanId: string, body: { lines: SettleLine[]; reason: string }, adminId: string, idemKey: string) {
    const lines = [...body.lines].sort((a, b) =>
      a.loanLineId < b.loanLineId ? -1 : a.loanLineId > b.loanLineId ? 1 : a.condition < b.condition ? -1 : 1,
    );
    await this.idempotency.execute({
      scope: `loans.forceReturn:${adminId}`,
      key: idemKey,
      request: { loanId, lines, reason: body.reason },
      work: (tx) => this.settle(tx, { loanId }, lines, { type: 'ADMIN', id: adminId, kioskId: null }, body.reason),
    });
    return this.get(loanId);
  }

  /**
   * Settles loan lines. Lock order: loan lines by id, then equipment by id (ARCH §5 F6). The conditional UPDATE makes
   * duplicate or concurrent returns of the same units impossible (0 rows → 409).
   */
  private async settle(
    tx: Tx,
    owner: { studentId?: string; loanId?: string },
    lines: SettleLine[],
    actor: Actor,
    reason?: string,
  ) {
    const ids = [...new Set(lines.map((l) => l.loanLineId))].sort();
    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        loanId: string;
        equipmentId: string;
        needsReview: boolean;
        studentId: string;
        status: string;
        name: string;
      }>
    >`
      SELECT ll.id, ll."loanId", ll."equipmentId", ll."needsReview", l."studentId", l.status::text AS status, e.name
      FROM loan_lines ll JOIN loans l ON l.id = ll."loanId" JOIN equipment e ON e.id = ll."equipmentId"
      WHERE ll.id = ANY(${ids}::uuid[]) ORDER BY ll.id FOR UPDATE OF ll`;
    const byId = new Map(locked.map((r) => [r.id, r]));
    for (const id of ids) {
      const r = byId.get(id);
      const mine = r && (owner.studentId ? r.studentId === owner.studentId : r.loanId === owner.loanId);
      if (!r || !mine) throw Errors.notFound('Loan line');
      if (r.status !== 'OPEN')
        throw Errors.conflict('ALREADY_RETURNED', 'This loan is already closed.', { loanLineId: id, outstanding: 0 });
      if (r.needsReview)
        throw Errors.conflict('NEEDS_REVIEW', 'This loan line is waiting for an admin review.', { loanLineId: id });
    }
    for (const l of lines) {
      const updated = await tx.$executeRaw`
        UPDATE loan_lines SET ${COLUMN[l.condition]} = ${COLUMN[l.condition]} + ${l.quantity}
        WHERE id = ${l.loanLineId}::uuid AND ("qtyIssued" - "qtyReturned" - "qtyDamaged" - "qtyLost") >= ${l.quantity}`;
      if (updated === 0) {
        const cur = await tx.loanLine.findUniqueOrThrow({ where: { id: l.loanLineId } });
        const outstanding = cur.qtyIssued - cur.qtyReturned - cur.qtyDamaged - cur.qtyLost;
        throw Errors.conflict(
          'ALREADY_RETURNED',
          outstanding ? `Only ${outstanding} unit(s) are still out on this line.` : 'This item was already returned.',
          { loanLineId: l.loanLineId, outstanding },
        );
      }
    }
    const perEquipment = new Map<string, { ok: number; gone: number }>();
    for (const l of lines) {
      const eq = byId.get(l.loanLineId)!.equipmentId;
      const agg = perEquipment.get(eq) ?? { ok: 0, gone: 0 };
      if (l.condition === 'OK') agg.ok += l.quantity;
      else agg.gone += l.quantity;
      perEquipment.set(eq, agg);
    }
    await lockEquipment(tx, [...perEquipment.keys()]);
    for (const [equipmentId, agg] of [...perEquipment.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      // OK units go back on the shelf; damaged or lost units leave the stock (write-off of the total).
      await tx.equipment.update({
        where: { id: equipmentId },
        data: { availableQuantity: { increment: agg.ok }, totalQuantity: { decrement: agg.gone } },
      });
    }
    await tx.stockMovement.createMany({
      data: lines.map((l) => ({
        equipmentId: byId.get(l.loanLineId)!.equipmentId,
        type: MOVEMENT[l.condition],
        delta: l.condition === 'OK' ? l.quantity : 0,
        totalDelta: l.condition === 'OK' ? 0 : -l.quantity,
        actorType: actor.type,
        actorId: actor.id,
        kioskId: actor.kioskId,
        loanLineId: l.loanLineId,
        reason: reason ?? null,
      })),
    });
    const loanIds = [...new Set(locked.map((r) => r.loanId))];
    await tx.$executeRaw`
      UPDATE loans SET status = 'CLOSED', "closedAt" = now()
      WHERE id = ANY(${loanIds}::uuid[]) AND status = 'OPEN'
        AND NOT EXISTS (SELECT 1 FROM loan_lines ll WHERE ll."loanId" = loans.id AND ll."qtyIssued" - ll."qtyReturned" - ll."qtyDamaged" - ll."qtyLost" > 0)`;
    await this.outbox.add(tx, 'LoanReturned', { loanIds, actorType: actor.type });
    for (const equipmentId of perEquipment.keys()) await this.outbox.add(tx, 'StockChanged', { equipmentId });
    return {
      loanIds,
      lines: lines.map((l) => ({
        equipmentId: byId.get(l.loanLineId)!.equipmentId,
        equipmentName: byId.get(l.loanLineId)!.name,
        quantity: l.quantity,
        condition: l.condition,
      })),
    };
  }

  // ───────────── Queries ─────────────

  private where(q: {
    status?: 'OPEN' | 'CLOSED' | 'OVERDUE';
    studentId?: string;
    equipmentId?: string;
    search?: string;
  }): Prisma.LoanWhereInput {
    return {
      ...(q.status === 'OVERDUE'
        ? { status: 'OPEN', dueAt: { lt: new Date() } }
        : q.status
          ? { status: q.status }
          : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.equipmentId ? { lines: { some: { equipmentId: q.equipmentId } } } : {}),
      ...(q.search
        ? {
            student: {
              OR: [
                { matricule: { contains: q.search, mode: 'insensitive' } },
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
  }

  async list(q: {
    status?: 'OPEN' | 'CLOSED' | 'OVERDUE';
    studentId?: string;
    equipmentId?: string;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    const where = this.where(q);
    const [rows, total] = await Promise.all([
      this.prisma.loan.findMany({
        where,
        include: loanInclude,
        orderBy: { openedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.loan.count({ where }),
    ]);
    return { items: rows.map((r) => loanDto(r)), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string) {
    const l = await this.prisma.loan.findUnique({ where: { id }, include: loanInclude });
    if (!l) throw Errors.notFound('Loan');
    return loanDto(l);
  }

  async exportCsv(q: {
    status?: 'OPEN' | 'CLOSED' | 'OVERDUE';
    studentId?: string;
    equipmentId?: string;
    search?: string;
  }) {
    const rows = await this.prisma.loan.findMany({
      where: this.where(q),
      include: loanInclude,
      orderBy: { openedAt: 'desc' },
      take: 50_000,
    });
    const out: Array<Array<string | number>> = [];
    for (const r of rows.map((x) => loanDto(x))) {
      for (const ln of r.lines) {
        out.push([
          r.id,
          r.student.matricule,
          r.student.lastName,
          r.student.firstName,
          r.openedAt,
          r.dueAt,
          r.closedAt ?? '',
          r.overdue ? 'OVERDUE' : r.status,
          r.identifyMethod,
          r.manualVerification ?? '',
          ln.equipmentCode,
          ln.equipmentName,
          ln.qtyIssued,
          ln.qtyReturned,
          ln.qtyDamaged,
          ln.qtyLost,
        ]);
      }
    }
    return toSafeCsv(
      [
        'loan_id',
        'matricule',
        'last_name',
        'first_name',
        'opened_at',
        'due_at',
        'closed_at',
        'status',
        'identify_method',
        'manual_verification',
        'equipment_code',
        'equipment_name',
        'issued',
        'returned',
        'damaged',
        'lost',
      ],
      out,
    );
  }

  async myLoans(studentId: string) {
    const loans = await this.prisma.loan.findMany({
      where: { studentId, status: 'OPEN' },
      include: loanInclude,
      orderBy: { dueAt: 'asc' },
    });
    return loans.map((l) => {
      const d = loanDto(l);
      return {
        loanId: d.id,
        openedAt: d.openedAt,
        dueAt: d.dueAt,
        overdue: d.overdue,
        lines: d.lines
          .filter((x) => x.outstanding > 0)
          .map((x) => ({ equipmentName: x.equipmentName, outstanding: x.outstanding })),
      };
    });
  }

  // ───────────── Overdue sweep ─────────────

  /** Emits `LoanOverdue` once per loan (S07 turns it into reminders). */
  async sweepOverdue() {
    const due = await this.prisma.loan.findMany({
      where: { status: 'OPEN', dueAt: { lt: new Date() }, overdueNotifiedAt: null },
      select: { id: true, studentId: true, dueAt: true },
      take: 1000,
    });
    let n = 0;
    for (const l of due) {
      await this.prisma.tx(async (tx) => {
        const marked = await tx.loan.updateMany({
          where: { id: l.id, overdueNotifiedAt: null },
          data: { overdueNotifiedAt: new Date() },
        });
        if (marked.count) {
          await this.outbox.add(tx, 'LoanOverdue', {
            loanId: l.id,
            studentId: l.studentId,
            dueAt: l.dueAt.toISOString(),
          });
          n++;
        }
      });
    }
    return n;
  }

  async onApplicationBootstrap() {
    this.jobs.define(OVERDUE_JOB, () => this.sweepOverdue());
    await this.jobs.schedule(OVERDUE_JOB, '*/15 * * * *').catch(() => undefined);
  }
}
