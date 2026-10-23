import { z } from 'zod';

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const Bilingual = z.object({ en: z.string().min(1).max(40), fr: z.string().min(1).max(40) });

/** Typed system settings (ARCH §4 `Setting`). Defaults encode the Phase 0 decisions. */
export const Settings = z
  .object({
    labels: z
      .object({
        signIn: Bilingual.default({ en: 'Sign In', fr: 'Emprunter' }),
        signOut: Bilingual.default({ en: 'Sign Out', fr: 'Rendre' }),
      })
      .default({ signIn: { en: 'Sign In', fr: 'Emprunter' }, signOut: { en: 'Sign Out', fr: 'Rendre' } }),
    /** Decision Q9 / D1. OPEN may only be set by a SUPER_ADMIN. */
    manualEntryPolicy: z.enum(['PIN_OR_ASSISTANT', 'OTP', 'ASSISTANT', 'OPEN']).default('PIN_OR_ASSISTANT'),
    /** Decision Q4: due by lab closing time. */
    loanDue: z
      .object({
        mode: z.enum(['LAB_CLOSING', 'HOURS']).default('LAB_CLOSING'),
        labClosingTime: HHMM.default('18:00'),
        hours: z.int().min(1).max(720).default(4),
        timezone: z.string().default('Africa/Douala'),
      })
      .default({ mode: 'LAB_CLOSING', labClosingTime: '18:00', hours: 4, timezone: 'Africa/Douala' }),
    /** Decision Q4: no limit (null). */
    maxItemsPerStudent: z.int().min(1).max(1000).nullable().default(null),
    /** Decision Q4: overdue students are blocked. */
    blockWhenOverdue: z.boolean().default(true),
    globalLowStockThreshold: z.int().min(0).max(100000).default(2),
    quietHours: z
      .object({ enabled: z.boolean().default(false), start: HHMM.default('21:00'), end: HHMM.default('07:00') })
      .default({ enabled: false, start: '21:00', end: '07:00' }),
    alertDigestMinutes: z.int().min(0).max(120).default(0),
    overdueReminders: z.enum(['OFF', 'EMAIL', 'SMS', 'PUSH']).default('PUSH'),
    kiosk: z
      .object({
        inactivityTimeoutSec: z.int().min(15).max(600).default(45),
        successResetSec: z.int().min(3).max(60).default(8),
        motionLevel: z.enum(['full', 'reduced', 'minimal']).default('full'),
        soundCues: z.boolean().default(true),
      })
      .default({ inactivityTimeoutSec: 45, successResetSec: 8, motionLevel: 'full', soundCues: true }),
    /** Decision Q1: DESFire once cards are personalised; UID until then. */
    cardAuthMode: z.enum(['UID', 'DESFIRE_PREFERRED', 'DESFIRE_REQUIRED']).default('UID'),
    /** Decision Q6: offline loans allowed for this many hours, then read-only. 0 disables offline mode. */
    offlineMaxHours: z.int().min(0).max(72).default(8),
    retentionMonths: z.int().min(6).max(120).default(36),
    minSupportedAppVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .default('0.1.0'),
    androidApk: z
      .object({ version: z.string(), url: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .nullable()
      .default(null),
  })
  .meta({ id: 'Settings' });
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = Settings.partial();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

/** What a kiosk needs from settings. */
export const KioskConfig = Settings.pick({
  labels: true,
  manualEntryPolicy: true,
  kiosk: true,
  cardAuthMode: true,
  offlineMaxHours: true,
  maxItemsPerStudent: true,
}).meta({ id: 'KioskConfig' });
export type KioskConfig = z.infer<typeof KioskConfig>;

export const AppConfig = z
  .object({
    minSupportedVersion: z.string(),
    androidApk: Settings.shape.androidApk,
    webauthnRpId: z.string(),
    labels: Settings.shape.labels,
  })
  .meta({ id: 'AppConfig' });

export function defaultSettings(): Settings {
  return Settings.parse({});
}
