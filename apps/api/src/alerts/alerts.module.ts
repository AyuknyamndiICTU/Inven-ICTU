import { AuthSchemas } from '@labpass/contracts';
import { Controller, Injectable, Module, type OnModuleInit, Req, Res } from '@nestjs/common';
import type { AlertOccurrence, Equipment } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { createHmac, randomUUID } from 'node:crypto';
import { CredentialsModule } from '../credentials/credentials.module';
import { PushService } from '../credentials/push.service';
import { assertSafeUrl } from '../directory/directory.module';
import { localShort, quietDelayMs } from '../lending/due';
import { type Delivery, DeliveryService } from '../notifications/core/delivery';
import { NotificationService } from '../notifications/core/notification.service';
import { ProviderConfigService } from '../notifications/core/providers';
import { safeEqual } from '../platform/crypto/crypto';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { EventBus, OutboxService } from '../platform/outbox/outbox';
import { PrismaService, type Tx } from '../platform/prisma/prisma.service';
import { RealtimeService } from '../platform/realtime/realtime';
import { SettingsModule, SettingsService } from '../settings/settings';

export function occurrenceDto(o: AlertOccurrence & { equipment: Pick<Equipment, 'name'> }) {
  return {
    id: o.id,
    equipmentId: o.equipmentId,
    equipmentName: o.equipment.name,
    severity: o.severity,
    threshold: o.threshold,
    availableAtFire: o.availableAtFire,
    firedAt: o.firedAt.toISOString(),
    resolvedAt: o.resolvedAt?.toISOString() ?? null,
  };
}

/**
 * Low-stock alerts (ARCH §5 F8). The evaluator is a durable, inbox-deduplicated consumer of `StockChanged` that locks the
 * equipment row (one evaluation at a time per item) and reads the **current** stock, so duplicate or reordered events
 * are harmless. An open occurrence means "disarmed"; recovering above the threshold resolves it (re-arms).
 */
@Injectable()
export class AlertEvaluator implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.bus.register('alert-evaluator', ['StockChanged'], (e, tx) =>
      this.evaluate(tx, (e.payload as { equipmentId: string }).equipmentId),
    );
    this.bus.register('alert-notifier', ['AlertFired'], (e) =>
      this.notify((e.payload as { occurrenceId: string }).occurrenceId),
    );
    this.bus.onDirect(['AlertFired'], async (e) => {
      const o = await this.prisma.alertOccurrence.findUnique({
        where: { id: (e.payload as { occurrenceId: string }).occurrenceId },
        include: { equipment: { select: { name: true } } },
      });
      if (o) await this.realtime.toAdmins('alert.fired', occurrenceDto(o));
    });
  }

  async evaluate(tx: Tx, equipmentId: string) {
    const [eq] = await tx.$queryRaw<
      Array<{ availableQuantity: number; lowStockThreshold: number | null; active: boolean }>
    >`
      SELECT "availableQuantity", "lowStockThreshold", active FROM equipment WHERE id = ${equipmentId}::uuid FOR UPDATE`;
    if (!eq) return;
    const threshold = eq.lowStockThreshold ?? (await this.settings.get()).globalLowStockThreshold;
    const open = await tx.alertOccurrence.findFirst({ where: { equipmentId, resolvedAt: null } });
    if (!eq.active || eq.availableQuantity > threshold) {
      if (open) await tx.alertOccurrence.update({ where: { id: open.id }, data: { resolvedAt: new Date() } });
      return;
    }
    const severity = eq.availableQuantity <= 0 ? 'OUT' : 'LOW';
    // Already alerted at this level (or worse): staying below the threshold never repeats the alert.
    if (open && (open.severity === 'OUT' || severity === 'LOW')) return;
    // LOW → OUT escalates: the low alert is closed and an out-of-stock alert fires.
    if (open) await tx.alertOccurrence.update({ where: { id: open.id }, data: { resolvedAt: new Date() } });
    const occ = await tx.alertOccurrence.create({
      data: { equipmentId, severity, threshold, availableAtFire: eq.availableQuantity },
    });
    await this.outbox.add(tx, 'AlertFired', { occurrenceId: occ.id, equipmentId, severity });
  }

  /** One delivery per channel × admin, keyed `occurrenceId:channel:adminId`. OUT bypasses quiet hours and the digest delay. */
  async notify(occurrenceId: string) {
    const occ = await this.prisma.alertOccurrence.findUnique({
      where: { id: occurrenceId },
      include: { equipment: { select: { name: true } } },
    });
    if (!occ || occ.resolvedAt) return;
    const s = await this.settings.get();
    const delayMs =
      occ.severity === 'OUT'
        ? 0
        : Math.max(quietDelayMs(new Date(), s.quietHours, s.loanDue.timezone), s.alertDigestMinutes * 60_000);
    const admins = await this.prisma.adminUser.findMany({ where: { active: true } });
    for (const a of admins) {
      const prefs = AuthSchemas.NotificationPrefs.parse(a.notificationPrefs ?? {});
      if (occ.severity === 'LOW' ? !prefs.lowStock : !prefs.outOfStock) continue;
      const targets: Array<[Delivery['channel'], string | null]> = [
        ['EMAIL', prefs.email ? a.email : null],
        ['SMS', prefs.sms && a.phoneVerifiedAt ? a.phoneE164 : null],
        ['WHATSAPP', prefs.whatsapp && a.whatsappVerifiedAt ? a.whatsappE164 : null],
      ];
      for (const [channel, to] of targets) {
        if (!to) continue;
        await this.delivery.enqueue({
          channel,
          to,
          template: occ.severity === 'OUT' ? 'out_of_stock' : 'low_stock',
          locale: prefs.locale,
          data: { item: occ.equipment.name, available: occ.availableAtFire, threshold: occ.threshold },
          dedupeKey: `${occ.id}:${channel}:${a.id}`,
          occurrenceId: occ.id,
          delayMs,
        });
      }
    }
  }
}

/** Student notices (S07 task 6): overdue reminders and "your previous device was revoked". */
@Injectable()
export class StudentNotices implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    this.bus.register('overdue-reminders', ['LoanOverdue'], (e) =>
      this.overdue((e.payload as { loanId: string }).loanId),
    );
    this.bus.register('device-revoked-notice', ['CredentialRevoked'], (e) =>
      this.revoked(e.payload as { credentialId: string; studentId: string }),
    );
  }

  private async contact(
    studentId: string,
    template: 'overdue' | 'device_revoked',
    data: Record<string, string>,
    key: string,
    prefer: 'EMAIL' | 'SMS',
  ) {
    const s = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!s) return;
    const order: Array<[Delivery['channel'], string | null]> =
      prefer === 'SMS'
        ? [
            ['SMS', s.phone],
            ['EMAIL', s.email],
          ]
        : [
            ['EMAIL', s.email],
            ['SMS', s.phone],
          ];
    for (const [channel, to] of order) {
      if (!to) continue;
      const r = await this.delivery.enqueue({
        channel,
        to,
        template,
        locale: 'en',
        data,
        dedupeKey: `${key}:${channel}`,
      });
      if (r !== 'UNAVAILABLE') return;
    }
  }

  async overdue(loanId: string) {
    const mode = (await this.settings.get()).overdueReminders;
    if (mode === 'OFF') return;
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: { lines: { include: { equipment: { select: { name: true } } } } },
    });
    if (!loan || loan.status !== 'OPEN') return;
    const s = await this.settings.get();
    const items = loan.lines
      .filter((l) => l.qtyIssued - l.qtyReturned - l.qtyDamaged - l.qtyLost > 0)
      .map((l) => `${l.qtyIssued - l.qtyReturned - l.qtyDamaged - l.qtyLost} × ${l.equipment.name}`)
      .join(', ');
    const data = { items, due: localShort(loan.dueAt, s.loanDue.timezone) };
    if (mode === 'PUSH' && (await this.push.toStudent(loan.studentId, 'overdue', 'en', data)) > 0) return;
    await this.contact(loan.studentId, 'overdue', data, `overdue:${loanId}`, mode === 'SMS' ? 'SMS' : 'EMAIL');
  }

  async revoked(p: { credentialId: string; studentId: string }) {
    await this.contact(p.studentId, 'device_revoked', {}, `revoked:${p.credentialId}`, 'EMAIL');
  }
}

@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly providers: ProviderConfigService,
    private readonly delivery: DeliveryService,
    private readonly prisma: PrismaService,
  ) {}

  @Contract('notifications.channels')
  channels() {
    return this.notifications.status();
  }

  @Contract('notifications.providers')
  async updateProviders(@ContractInput() input: In<'notifications.providers'>, @Req() req: LpRequest) {
    if (input.body.sms?.provider === 'HTTP') {
      if (!input.body.sms.endpoint) throw Errors.badRequest('ENDPOINT_REQUIRED', 'Enter the SMS gateway URL.');
      await assertSafeUrl(input.body.sms.endpoint, process.env.NODE_ENV === 'production');
    }
    await this.providers.update(input.body, req.admin!.id);
    return this.notifications.status();
  }

  @Contract('notifications.test')
  async test(@ContractInput() input: In<'notifications.test'>, @Req() req: LpRequest) {
    const me = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: req.admin!.id } });
    const prefs = AuthSchemas.NotificationPrefs.parse(me.notificationPrefs ?? {});
    const channel = input.body.channel;
    if (channel === 'PUSH')
      return { status: 'SKIPPED' as const, detail: 'Push notifications go to students’ phones only.' };
    const to =
      channel === 'EMAIL'
        ? me.email
        : channel === 'SMS'
          ? me.phoneVerifiedAt
            ? me.phoneE164
            : null
          : me.whatsappVerifiedAt
            ? me.whatsappE164
            : null;
    if (!to)
      return {
        status: 'SKIPPED' as const,
        detail: `Verify your ${channel === 'SMS' ? 'phone' : 'WhatsApp'} number first.`,
      };
    const r = await this.delivery.enqueue({
      channel,
      to,
      template: 'test',
      locale: prefs.locale,
      data: {},
      dedupeKey: `test:${me.id}:${channel}:${randomUUID()}`,
    });
    if (r === 'UNAVAILABLE')
      return { status: 'SKIPPED' as const, detail: `The ${channel} channel is not configured yet.` };
    return { status: 'QUEUED' as const, detail: 'Test sent. Check the delivery log.' };
  }

  @Contract('notifications.log')
  async log(@ContractInput() input: In<'notifications.log'>) {
    const { page, pageSize } = input.query;
    const [rows, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificationLog.count(),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        recipientMasked: r.recipientMasked,
        template: r.template,
        status: r.status,
        attempts: r.attempts,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  @Contract('alerts.occurrences')
  async occurrences(@ContractInput() input: In<'alerts.occurrences'>) {
    const open = input.query.open;
    const rows = await this.prisma.alertOccurrence.findMany({
      where: open === 'true' ? { resolvedAt: null } : open === 'false' ? { resolvedAt: { not: null } } : {},
      orderBy: { firedAt: 'desc' },
      take: 200,
      include: { equipment: { select: { name: true } } },
    });
    return rows.map(occurrenceDto);
  }
}

const WA_STATUS: Record<string, 'SENT' | 'DELIVERED' | 'FAILED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'DELIVERED',
  failed: 'FAILED',
};

/** Meta WhatsApp webhook: GET handshake with the verify token, POST callbacks signed with the app secret. */
@Controller()
export class WhatsAppWebhookController {
  constructor(
    private readonly providers: ProviderConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Contract('webhooks.whatsappVerify')
  async verify(@ContractInput() input: In<'webhooks.whatsappVerify'>, @Res({ passthrough: true }) reply: FastifyReply) {
    const expected = this.providers.open((await this.providers.get()).whatsapp.verifyTokenSealed);
    if (input.query['hub.mode'] !== 'subscribe' || !expected || !safeEqual(input.query['hub.verify_token'], expected)) {
      throw Errors.forbidden('INVALID_VERIFY_TOKEN', 'Verification failed.');
    }
    void reply.header('Content-Type', 'text/plain; charset=utf-8');
    return input.query['hub.challenge'];
  }

  @Contract('webhooks.whatsapp')
  async receive(@Req() req: LpRequest & { rawBody?: Buffer }) {
    const secret = this.providers.open((await this.providers.get()).whatsapp.appSecretSealed);
    const header = req.headers['x-hub-signature-256'];
    const sig = Array.isArray(header) ? header[0] : header;
    if (!secret || !sig || !req.rawBody) throw Errors.forbidden('INVALID_SIGNATURE', 'Invalid webhook signature.');
    const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
    if (!safeEqual(sig, expected)) throw Errors.forbidden('INVALID_SIGNATURE', 'Invalid webhook signature.');
    const body = req.body as {
      entry?: Array<{
        changes?: Array<{
          value?: { statuses?: Array<{ id: string; status: string; errors?: Array<{ title?: string }> }> };
        }>;
      }>;
    };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const st of change.value?.statuses ?? []) {
          const status = WA_STATUS[st.status];
          if (!status) continue;
          await this.prisma.notificationLog.updateMany({
            // Never move a DELIVERED message back to SENT when callbacks arrive out of order.
            where: {
              providerMessageId: st.id,
              channel: 'WHATSAPP',
              ...(status === 'SENT' ? { status: { notIn: ['DELIVERED'] } } : {}),
            },
            data: {
              status,
              ...(status === 'FAILED' ? { error: (st.errors?.[0]?.title ?? 'Delivery failed').slice(0, 300) } : {}),
            },
          });
        }
      }
    }
    return { ok: true as const };
  }
}

@Module({
  imports: [SettingsModule, CredentialsModule],
  controllers: [NotificationsController, WhatsAppWebhookController],
  providers: [AlertEvaluator, StudentNotices],
})
export class AlertsModule {}
