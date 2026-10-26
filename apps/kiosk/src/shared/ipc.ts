import { z } from 'zod';
import type {
  IdentifiedResult,
  IdentifyResponse,
  KioskConfig,
  OpenLoanLine,
  Receipt,
  StudentSummary,
} from '@labpass/contracts';

/**
 * Kiosk IPC contract (ARCH §7, S11 task 4): business operations only.
 * The device token and the student's kiosk-session JWT stay in the main process; the renderer never sees tokens,
 * URLs it can fetch, or a generic request channel. Every command payload is validated with zod in main.
 */

export { commandChannel, EVENT_CHANNEL } from './channels';

const Uuid = z.uuid();
const Matricule = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9/-]+$/);
const Pin = z.string().regex(/^\d{4,6}$/);
const Otp = z.string().regex(/^\d{6}$/);

export const commandSchemas = {
  status: z.undefined(),
  register: z.object({
    code: z
      .string()
      .trim()
      .min(6)
      .max(80)
      .transform((c) => c.replace(/^LPKR1\./, '')),
    apiUrl: z.url().max(200).optional(),
    servicePin: Pin,
  }),
  identifyManual: z.object({ matricule: Matricule }),
  verifyManual: z.discriminatedUnion('method', [
    z.object({ lookupId: Uuid, method: z.literal('PIN'), pin: Pin }),
    z.object({ lookupId: Uuid, method: z.literal('ASSISTANT'), assistantPin: Pin }),
    z.object({ lookupId: Uuid, method: z.literal('OTP'), code: Otp }),
  ]),
  requestOtp: z.object({ lookupId: Uuid }),
  cardLink: z.object({ matricule: Matricule }),
  cardLinkConfirm: z.object({ requestId: Uuid, code: Otp }),
  submitScanResponse: z.object({ text: z.string().min(10).max(4000) }),
  equipment: z.undefined(),
  ticker: z.undefined(),
  signIn: z.object({
    /** One key per cart confirmation, reused on retry, so a lost response never borrows twice (ARCH §5 F5). */
    idempotencyKey: Uuid,
    lines: z
      .array(z.object({ equipmentId: Uuid, quantity: z.int().min(1).max(500) }))
      .min(1)
      .max(50),
  }),
  signOut: z.object({
    idempotencyKey: Uuid,
    lines: z
      .array(z.object({ loanLineId: Uuid, quantity: z.int().min(1).max(500), condition: z.enum(['OK', 'DAMAGED']) }))
      .min(1)
      .max(50),
  }),
  endSession: z.undefined(),
  assistantUnlock: z.object({ pin: Pin }),
  assistantAction: z.object({ action: z.enum(['retryReader', 'unregister', 'quit', 'reload']) }),
  devSimulate: z.object({
    scenario: z.enum(['card', 'unknownCard', 'phone', 'lockedPhone', 'foreignPhone', 'unplug', 'plug']),
  }),
} as const;

export type CommandName = keyof typeof commandSchemas;
export type CommandInput<C extends CommandName> = z.input<(typeof commandSchemas)[C]>;

export type ReaderStatus = 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'FAKE';

/** A student as the renderer sees them: no session token, only its expiry. */
export type IdentifiedView = Omit<IdentifiedResult, 'session'> & { sessionExpiresAt: string };
export type IdentifyView = IdentifiedView | Exclude<IdentifyResponse, { status: 'IDENTIFIED' }>;

export interface KioskStatus {
  registered: boolean;
  kioskId: string | null;
  appVersion: string;
  reader: { status: ReaderStatus; name: string | null; kind: 'pcsc' | 'fake' };
  online: boolean;
  config: KioskConfig | null;
  /** True when the kiosk was built for development (FakeReader shortcuts, devtools). */
  dev: boolean;
}

export interface KioskEquipment {
  id: string;
  code: string;
  name: string;
  categoryName: string;
  imageUrl: string | null;
  available: number;
  health: 'OK' | 'LOW' | 'OUT';
}

export interface TickerEntry {
  at: string;
  kind: 'BORROW' | 'RETURN';
  equipmentName: string;
  quantity: number;
}

/** Serializable error (Electron flattens thrown errors, so commands return a result union instead). */
export interface KioskError {
  code: string;
  status: number;
  message: string;
  details?: Record<string, unknown>;
}

export type CommandResult<T> = { ok: true; data: T } | { ok: false; error: KioskError };

export type TapErrorCode = 'PHONE_LOCKED' | 'FOREIGN_PHONE' | 'READ_FAILED' | 'NO_CHALLENGE';

export type KioskEvent =
  | { type: 'status'; status: KioskStatus }
  /** Fired on the reader event itself so A2 starts before the API answers (≤ 100 ms budget). */
  | { type: 'reader.present' }
  | { type: 'reader.removed' }
  | { type: 'tap.error'; code: TapErrorCode }
  | { type: 'identify.result'; result: IdentifyView; via: 'CARD' | 'HCE' | 'SCAN' }
  | { type: 'identify.error'; error: KioskError }
  | { type: 'challenge'; qr: string; issuedAt: number; expiresAt: number }
  | { type: 'availability'; equipmentId: string; available: number; health: 'OK' | 'LOW' | 'OUT' }
  | { type: 'revoked' };

export interface CommandOutputs {
  status: KioskStatus;
  register: KioskStatus;
  identifyManual: IdentifyView;
  verifyManual: IdentifiedView;
  requestOtp: { destination: string };
  cardLink: { requestId: string; verification: 'OTP' | 'REVIEW'; destination: string | null };
  cardLinkConfirm: { status: 'LINKED' };
  submitScanResponse: IdentifyView;
  equipment: KioskEquipment[];
  ticker: TickerEntry[];
  signIn: Receipt;
  signOut: Receipt;
  endSession: null;
  assistantUnlock: { unlocked: boolean };
  assistantAction: null;
  devSimulate: null;
}

/** The API exposed on `window.labpass` by the preload script. */
export interface KioskBridge {
  appInfo(): { name: string; version: string };
  invoke<C extends CommandName>(
    command: C,
    ...input: CommandInput<C> extends undefined ? [] : [CommandInput<C>]
  ): Promise<CommandResult<CommandOutputs[C]>>;
  subscribe(listener: (event: KioskEvent) => void): () => void;
}

export type { OpenLoanLine, Receipt, StudentSummary };

/** Strips the kiosk-session token before a result crosses into the renderer. */
export function toView(result: IdentifyResponse): IdentifyView {
  if (result.status !== 'IDENTIFIED') return result;
  const { session, ...rest } = result;
  return { ...rest, sessionExpiresAt: session.expiresAt };
}
