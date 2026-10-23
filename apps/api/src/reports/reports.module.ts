import { Controller, Injectable, Module, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { healthOf } from '../inventory/inventory.module';
import { toKioskDto } from '../kiosks/kiosks.module';
import { localDate, startOfLocalDay, zonedTime } from '../lending/due';
import { toSafeCsv } from '../platform/http/csv';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import { PrismaService } from '../platform/prisma/prisma.service';
import { SettingsModule, SettingsService } from '../settings/settings';

const MAX_RANGE_DAYS = 366;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async summary() {
    const s = await this.settings.get();
    const now = new Date();
    const [equipment, openLoans, overdueLoans, today, kiosks, pendingCredentialRequests, openSyncConflicts] =
      await Promise.all([
        this.prisma.equipment.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
        this.prisma.loan.count({ where: { status: 'OPEN' } }),
        this.prisma.loan.count({ where: { status: 'OPEN', dueAt: { lt: now } } }),
        this.prisma.loan.findMany({
          where: { openedAt: { gte: startOfLocalDay(now, s.loanDue.timezone) } },
          distinct: ['studentId'],
          select: { studentId: true },
        }),
        this.prisma.kiosk.findMany({ where: { status: 'ACTIVE' } }),
        this.prisma.credentialRequest.count({ where: { decision: 'PENDING' } }),
        this.prisma.offlineSyncConflict.count({ where: { resolution: null } }),
      ]);
    const skyline = equipment.map((e) => ({
      equipmentId: e.id,
      name: e.name,
      available: e.availableQuantity,
      total: e.totalQuantity,
      health: healthOf(e.availableQuantity, e.lowStockThreshold ?? s.globalLowStockThreshold),
    }));
    return {
      itemsOut: equipment.reduce((n, e) => n + e.totalQuantity - e.availableQuantity, 0),
      openLoans,
      overdueLoans,
      lowStockItems: skyline.filter((x) => x.health === 'LOW').length,
      outOfStockItems: skyline.filter((x) => x.health === 'OUT').length,
      studentsToday: today.length,
      kiosksOnline: kiosks.filter((k) => toKioskDto(k).online).length,
      kiosksTotal: kiosks.length,
      pendingCredentialRequests,
      openSyncConflicts,
      skyline: skyline.slice(0, 60),
    };
  }

  async activity() {
    const [moves, alerts] = await Promise.all([
      this.prisma.stockMovement.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { equipment: { select: { name: true } } },
      }),
      this.prisma.alertOccurrence.findMany({
        orderBy: { firedAt: 'desc' },
        take: 10,
        include: { equipment: { select: { name: true } } },
      }),
    ]);
    const kioskNames = new Map(
      (
        await this.prisma.kiosk.findMany({
          where: { id: { in: moves.map((m) => m.kioskId).filter((x): x is string => Boolean(x)) } },
          select: { id: true, name: true },
        })
      ).map((k) => [k.id, k.name]),
    );
    const verb: Record<string, string> = {
      ISSUE: 'borrowed',
      RETURN: 'returned',
      DAMAGED: 'returned damaged',
      LOST: 'marked lost',
      RESTOCK: 'restocked',
      WRITE_OFF: 'written off',
      CORRECTION: 'corrected',
    };
    const items = [
      ...moves.map((m) => {
        const qty = Math.abs(m.delta || m.totalDelta);
        const where = m.kioskId ? ` at ${kioskNames.get(m.kioskId) ?? 'a kiosk'}` : '';
        const kind = m.type === 'ISSUE' ? 'BORROW' : m.type === 'RETURN' || m.type === 'DAMAGED' ? 'RETURN' : 'ADJUST';
        return {
          id: m.id,
          at: m.createdAt.toISOString(),
          kind: kind as 'BORROW' | 'RETURN' | 'ADJUST',
          text: `${qty} × ${m.equipment.name} ${verb[m.type]}${where}`,
          equipmentName: m.equipment.name,
          quantity: qty,
        };
      }),
      ...alerts.map((a) => ({
        id: a.id,
        at: a.firedAt.toISOString(),
        kind: 'ALERT' as const,
        text:
          a.severity === 'OUT'
            ? `${a.equipment.name} is out of stock`
            : `${a.equipment.name} is low (${a.availableAtFire} left)`,
        equipmentName: a.equipment.name,
        quantity: a.availableAtFire,
      })),
    ];
    return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30);
  }

  private async range(from: string, to: string) {
    if (from > to) throw Errors.badRequest('INVALID_RANGE', '"from" must be on or before "to".');
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    if (days > MAX_RANGE_DAYS)
      throw Errors.badRequest('INVALID_RANGE', `Reports cover at most ${MAX_RANGE_DAYS} days.`);
    const tz = (await this.settings.get()).loanDue.timezone;
    const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
    const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
    return { tz, start: zonedTime(fy, fm, fd, 0, 0, tz), end: zonedTime(ty, tm, td + 1, 0, 0, tz), days };
  }

  async usage(from: string, to: string) {
    const { tz, start, end, days } = await this.range(from, to);
    const at = Prisma.sql`(COALESCE(l."occurredAt", l."openedAt") AT TIME ZONE 'UTC') AT TIME ZONE ${tz}`;
    const inRange = Prisma.sql`COALESCE(l."occurredAt", l."openedAt") >= ${start} AND COALESCE(l."occurredAt", l."openedAt") < ${end}`;
    const [byItem, byDayRows, byHourRows, [unique]] = await Promise.all([
      this.prisma.$queryRaw<Array<{ equipmentId: string; name: string; loans: number; quantity: number }>>`
        SELECT ll."equipmentId", e.name, count(DISTINCT l.id)::int AS loans, sum(ll."qtyIssued")::int AS quantity
        FROM loans l JOIN loan_lines ll ON ll."loanId" = l.id JOIN equipment e ON e.id = ll."equipmentId"
        WHERE ${inRange} GROUP BY ll."equipmentId", e.name ORDER BY quantity DESC, e.name`,
      this.prisma.$queryRaw<Array<{ date: string; loans: number }>>`
        SELECT to_char(${at}, 'YYYY-MM-DD') AS date, count(*)::int AS loans FROM loans l WHERE ${inRange} GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ hour: number; loans: number }>>`
        SELECT extract(hour FROM ${at})::int AS hour, count(*)::int AS loans FROM loans l WHERE ${inRange} GROUP BY 1`,
      this.prisma.$queryRaw<
        Array<{ n: number }>
      >`SELECT count(DISTINCT l."studentId")::int AS n FROM loans l WHERE ${inRange}`,
    ]);
    const perDay = new Map(byDayRows.map((r) => [r.date, r.loans]));
    const perHour = new Map(byHourRows.map((r) => [r.hour, r.loans]));
    const byDay = Array.from({ length: days }, (_, i) => {
      const date = localDate(new Date(Date.parse(`${from}T12:00:00Z`) + i * 86_400_000), 'UTC');
      return { date, loans: perDay.get(date) ?? 0 };
    });
    return {
      from,
      to,
      byItem,
      byDay,
      byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, loans: perHour.get(hour) ?? 0 })),
      uniqueStudents: unique?.n ?? 0,
    };
  }

  async usageCsv(from: string, to: string) {
    const r = await this.usage(from, to);
    return toSafeCsv(
      ['section', 'key', 'name', 'loans', 'quantity'],
      [
        ...r.byItem.map((i) => ['item', i.equipmentId, i.name, i.loans, i.quantity]),
        ...r.byDay.map((d) => ['day', d.date, '', d.loans, '']),
        ...r.byHour.map((h) => ['hour', String(h.hour).padStart(2, '0'), '', h.loans, '']),
        ['total', 'unique_students', '', r.uniqueStudents, ''],
      ],
    );
  }

  async audit(q: In<'audit.list'>['query']) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { at: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const ids = (t: string) => [...new Set(rows.filter((r) => r.actorType === t && r.actorId).map((r) => r.actorId!))];
    const admins = new Map(
      (
        await this.prisma.adminUser.findMany({ where: { id: { in: ids('ADMIN') } }, select: { id: true, name: true } })
      ).map((a) => [a.id, a.name]),
    );
    const kiosks = new Map(
      (await this.prisma.kiosk.findMany({ where: { id: { in: ids('KIOSK') } }, select: { id: true, name: true } })).map(
        (k) => [k.id, k.name],
      ),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        actorType: r.actorType,
        actorId: r.actorId,
        actorLabel:
          r.actorType === 'ADMIN'
            ? (admins.get(r.actorId ?? '') ?? null)
            : r.actorType === 'KIOSK'
              ? (kiosks.get(r.actorId ?? '') ?? null)
              : null,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        diff: r.diff,
        at: r.at.toISOString(),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Contract('dashboard.summary')
  summary() {
    return this.reports.summary();
  }

  @Contract('dashboard.activity')
  activity() {
    return this.reports.activity();
  }

  @Contract('reports.usage')
  usage(@ContractInput() input: In<'reports.usage'>) {
    return this.reports.usage(input.query.from, input.query.to);
  }

  @Contract('reports.export')
  async export(@ContractInput() input: In<'reports.export'>, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="labpass-usage-${input.query.from}-${input.query.to}.csv"`);
    return this.reports.usageCsv(input.query.from, input.query.to);
  }

  @Contract('audit.list')
  audit(@ContractInput() input: In<'audit.list'>) {
    return this.reports.audit(input.query);
  }
}

@Module({ imports: [SettingsModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
