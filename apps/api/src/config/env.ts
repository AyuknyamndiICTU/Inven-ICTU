import { DEV_PORTS, envBoolean, loadEnv } from '@labpass/config';
import { z } from 'zod';

const DEV_PREFIX = 'dev-only-';
const devSecret = (name: string) => `${DEV_PREFIX}${name}-0123456789abcdef0123456789abcdef`;
/** 32 bytes, base64. Development/test only — production must set DATA_KEY. */
const DEV_DATA_KEY = Buffer.alloc(32, 7).toString('base64');

const csv = z.string().transform((s) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
);

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(DEV_PORTS.api),
    REDIS_URL: z.string().default(`redis://127.0.0.1:${DEV_PORTS.redis}`),
    /** HMAC key for session tokens, OTP hashing and signed URLs. */
    APP_SECRET: z.string().min(32).default(devSecret('app')),
    /** Pepper for card UID HMACs (raw UIDs are never stored). */
    UID_PEPPER: z.string().min(32).default(devSecret('uid')),
    /** AES-256-GCM key (base64, 32 bytes) for secrets at rest (TOTP, provider tokens). */
    DATA_KEY: z
      .string()
      .default(DEV_DATA_KEY)
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_KEY must be 32 bytes, base64-encoded'),
    ADMIN_ORIGINS: csv.default(['http://localhost:3100', 'http://127.0.0.1:3100']),
    STUDENT_ORIGINS: csv.default(['http://localhost:3102', 'http://localhost:8081']),
    WEBAUTHN_RP_ID: z.string().default('localhost'),
    WEBAUTHN_RP_NAME: z.string().default('ICTU LabPass'),
    COOKIE_SECURE: envBoolean.default(false),
    SMTP_HOST: z.string().default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().default(DEV_PORTS.smtp),
    SMTP_SECURE: envBoolean.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default('ICTU LabPass <labpass@ictuniversity.example>'),
    STORAGE_DIR: z.string().default('./storage'),
    /** Public base URL of the API as seen by browsers (signed file URLs). */
    PUBLIC_API_URL: z.string().default('/api'),
    /** inline: relay + consumers run in the API process; separate: run `pnpm worker`; off: tests that drive the relay manually. */
    WORKER_MODE: z.enum(['inline', 'separate', 'off']).default('inline'),
    TRUST_PROXY: envBoolean.default(true),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    CONTRACT_VALIDATE_RESPONSES: envBoolean.optional(),
    /** Hosts allowed in imported photo_url values (ARCH §9). */
    PHOTO_HOSTS: csv.default([]),
    /** Web Push (student web app). Generate with: npx web-push generate-vapid-keys */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default('mailto:labpass@ictuniversity.example'),
    /** Optional Expo push access token (Android app notifications). */
    EXPO_ACCESS_TOKEN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['APP_SECRET', 'UID_PEPPER'] as const) {
      if (env[key].startsWith(DEV_PREFIX))
        ctx.addIssue({ code: 'custom', path: [key], message: 'must be set in production' });
    }
    if (env.DATA_KEY === DEV_DATA_KEY)
      ctx.addIssue({ code: 'custom', path: ['DATA_KEY'], message: 'must be set in production' });
    if (!env.COOKIE_SECURE)
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  return loadEnv(apiEnvSchema, source);
}

export const API_ENV = Symbol('API_ENV');

export function validateResponses(env: ApiEnv): boolean {
  return env.CONTRACT_VALIDATE_RESPONSES ?? env.NODE_ENV !== 'production';
}
