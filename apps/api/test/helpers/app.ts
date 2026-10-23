import 'reflect-metadata';
import type { AdminRole } from '@labpass/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Writable } from 'node:stream';
import { createApp } from '../../src/app';
import { loadApiEnv, type ApiEnv } from '../../src/config/env';
import { NotificationService } from '../../src/notifications/core/notification.service';
import { AdminSessionService, ADMIN_COOKIE } from '../../src/platform/auth/admin-session.service';
import { hashSecret } from '../../src/platform/crypto/crypto';
import { OutboxRelay } from '../../src/platform/outbox/outbox';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { RedisService } from '../../src/platform/redis/redis.service';
import { resetDb } from './db';

export const ADMIN_ORIGIN = 'http://localhost:3100';

/** Types taken from Nest's own inject() (it bundles its own light-my-request). */
type InjectOptions = Exclude<Parameters<NestFastifyApplication['inject']>[0], string | undefined>;
export type LightMyRequestResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

export interface TestApp {
  app: NestFastifyApplication;
  env: ApiEnv;
  prisma: PrismaService;
  redis: RedisService;
  logs: string[];
  /** Runs the outbox relay once (WORKER_MODE=off in tests). */
  relay(): Promise<number>;
  notifications: NotificationService;
  request(
    opts: InjectOptions & { cookie?: string; bearer?: string; origin?: string | null },
  ): Promise<LightMyRequestResponse>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function bootTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(String(chunk));
      cb();
    },
  });
  const env = loadApiEnv({
    ...process.env,
    NODE_ENV: 'test',
    WORKER_MODE: 'off',
    LOG_LEVEL: 'info',
    STORAGE_DIR: './.test-storage',
    ...overrides,
  });
  const app = await createApp(env, { logStream: stream });
  await app.getHttpAdapter().getInstance().ready();
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  return {
    app,
    env,
    prisma,
    redis,
    logs,
    notifications: app.get(NotificationService),
    relay: () => app.get(OutboxRelay).tick(),
    request: ({ cookie, bearer, origin, headers, ...rest }) =>
      app.inject({
        ...rest,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(origin === null ? {} : { origin: origin ?? ADMIN_ORIGIN }),
          ...headers,
        },
      }),
    reset: async () => {
      await resetDb(prisma);
      await redis.client.flushdb();
      app.get(NotificationService).sentForTest.length = 0;
    },
    close: () => app.close(),
  };
}

let counter = 0;

/** Creates an admin and an authenticated session; returns the cookie header value. */
export async function adminSession(t: TestApp, role: AdminRole, overrides: { email?: string; password?: string } = {}) {
  counter += 1;
  const user = await t.prisma.adminUser.create({
    data: {
      email: overrides.email ?? `admin${counter}-${role.toLowerCase()}@labpass.test`,
      name: `${role} ${counter}`,
      role,
      passwordHash: await hashSecret(overrides.password ?? 'correct horse battery staple'),
    },
  });
  const sid = await t.app.get(AdminSessionService).create({ userId: user.id, stage: 'AUTH' });
  return { user, cookie: `${ADMIN_COOKIE}=${sid}` };
}

export function cookieFrom(res: LightMyRequestResponse, name = ADMIN_COOKIE): string | undefined {
  const c = res.cookies.find((x) => x.name === name);
  return c ? `${name}=${c.value}` : undefined;
}

/** Registers a kiosk through the real API and returns its device token. */
export async function registerKiosk(t: TestApp, name = 'Cisco Lab Kiosk') {
  const { cookie } = await adminSession(t, 'SUPER_ADMIN');
  const created = await t.request({ method: 'POST', url: '/kiosks', cookie, payload: { name } });
  if (created.statusCode !== 201) throw new Error(`kiosk create failed: ${created.statusCode} ${created.body}`);
  const { registrationCode, kiosk } = created.json() as { registrationCode: string; kiosk: { id: string } };
  const reg = await t.request({
    method: 'POST',
    url: '/kiosk/register',
    origin: null,
    payload: { code: registrationCode, appVersion: '0.1.0' },
  });
  if (reg.statusCode !== 200) throw new Error(`kiosk register failed: ${reg.statusCode} ${reg.body}`);
  return { kioskId: kiosk.id, token: (reg.json() as { token: string }).token };
}
