import { z } from 'zod';
import { ActorType, IsoDate, IsoDateTime, NotificationChannel, PageQuery, Uuid } from '../common';

export const NotificationLogDto = z.object({
  id: Uuid,
  channel: NotificationChannel,
  recipientMasked: z.string(),
  template: z.string(),
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'DEAD']),
  attempts: z.int(),
  error: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const AlertOccurrenceDto = z.object({
  id: Uuid,
  equipmentId: Uuid,
  equipmentName: z.string(),
  severity: z.enum(['LOW', 'OUT']),
  threshold: z.int(),
  availableAtFire: z.int(),
  firedAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
});

export const TestNotificationBody = z.object({ channel: NotificationChannel });
export const TestNotificationResponse = z.object({ status: z.enum(['QUEUED', 'SKIPPED']), detail: z.string() });

export const ChannelStatus = z.object({
  channel: NotificationChannel,
  enabled: z.boolean(),
  configured: z.boolean(),
  provider: z.string().nullable(),
});

export const NotificationProvidersBody = z.object({
  sms: z
    .object({
      provider: z.enum(['MOCK', 'HTTP']),
      endpoint: z.url().optional(),
      sender: z.string().max(20).optional(),
      apiKey: z.string().optional(),
    })
    .optional(),
  whatsapp: z
    .object({
      enabled: z.boolean(),
      phoneNumberId: z.string().optional(),
      accessToken: z.string().optional(),
      appSecret: z.string().optional(),
      verifyToken: z.string().optional(),
      templateName: z.string().default('labpass_low_stock'),
    })
    .optional(),
});

// ───────────── Dashboard, reports, audit ─────────────

export const DashboardSummary = z
  .object({
    itemsOut: z.int(),
    openLoans: z.int(),
    overdueLoans: z.int(),
    lowStockItems: z.int(),
    outOfStockItems: z.int(),
    studentsToday: z.int(),
    kiosksOnline: z.int(),
    kiosksTotal: z.int(),
    pendingCredentialRequests: z.int(),
    openSyncConflicts: z.int(),
    skyline: z.array(
      z.object({
        equipmentId: Uuid,
        name: z.string(),
        available: z.int(),
        total: z.int(),
        health: z.enum(['OK', 'LOW', 'OUT']),
      }),
    ),
  })
  .meta({ id: 'DashboardSummary' });

export const ActivityItem = z.object({
  id: Uuid,
  at: IsoDateTime,
  kind: z.enum(['BORROW', 'RETURN', 'ADJUST', 'ALERT']),
  text: z.string(),
  equipmentName: z.string().nullable(),
  quantity: z.int().nullable(),
});

export const UsageQuery = z.object({ from: IsoDate, to: IsoDate });
export const UsageReport = z.object({
  from: IsoDate,
  to: IsoDate,
  byItem: z.array(z.object({ equipmentId: Uuid, name: z.string(), loans: z.int(), quantity: z.int() })),
  byDay: z.array(z.object({ date: IsoDate, loans: z.int() })),
  byHour: z.array(z.object({ hour: z.int(), loans: z.int() })),
  uniqueStudents: z.int(),
});

export const AuditEntry = z.object({
  id: Uuid,
  actorType: ActorType,
  actorId: z.string().nullable(),
  actorLabel: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  diff: z.unknown().nullable(),
  at: IsoDateTime,
});
export const AuditQuery = PageQuery.extend({
  entity: z.string().max(40).optional(),
  actorId: z.string().max(64).optional(),
});
