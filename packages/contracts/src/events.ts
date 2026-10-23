import { z } from 'zod';
import { IsoDateTime, StockHealth, Uuid } from './common';
import { IdentifiedResult } from './schemas/kiosk';
import { ActivityItem, AlertOccurrenceDto } from './schemas/notifications';
import { KioskConfig } from './schemas/settings';

/** Socket.IO namespace `/admin` (session cookie). */
export const adminEvents = {
  'stock.changed': z.object({ equipmentId: Uuid, available: z.int(), total: z.int(), health: StockHealth }),
  activity: ActivityItem,
  'credentialRequest.created': z.object({ id: Uuid, decision: z.enum(['AUTO_APPROVED', 'PENDING']) }),
  'kiosk.status': z.object({
    kioskId: Uuid,
    online: z.boolean(),
    readerStatus: z.string().nullable(),
    lastSeenAt: IsoDateTime.nullable(),
  }),
  'alert.fired': AlertOccurrenceDto,
  'offlineConflict.created': z.object({ id: Uuid, kioskId: Uuid }),
} as const;

/** Socket.IO namespace `/kiosk` (device token). */
export const kioskEvents = {
  'availability.changed': z.object({ equipmentId: Uuid, available: z.int(), health: StockHealth }),
  'config.changed': KioskConfig,
  /** Pushed when a student scans this kiosk's challenge QR with the LabPass app (ARCH §5 F3). */
  identified: IdentifiedResult,
  'credential.revoked': z.object({ credentialId: Uuid }),
  'kiosk.revoked': z.object({}),
} as const;

export type AdminEventName = keyof typeof adminEvents;
export type KioskEventName = keyof typeof kioskEvents;
export type AdminEventPayload<E extends AdminEventName> = z.infer<(typeof adminEvents)[E]>;
export type KioskEventPayload<E extends KioskEventName> = z.infer<(typeof kioskEvents)[E]>;
