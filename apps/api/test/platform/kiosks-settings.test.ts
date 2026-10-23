import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChallengeService } from '../../src/kiosks/kiosks.module';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';

describe('kiosk devices & challenges (ARCH §5, §7)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it('registers with a one-time code and authenticates with the device token', async () => {
    const { token, kioskId } = await registerKiosk(t);
    const hb = await t.request({
      method: 'POST',
      url: '/kiosk/heartbeat',
      bearer: token,
      origin: null,
      payload: { appVersion: '0.1.0', readerStatus: 'FAKE' },
    });
    expect(hb.statusCode).toBe(200);
    expect(hb.json().config.manualEntryPolicy).toBe('PIN_OR_ASSISTANT');
    const k = await t.prisma.kiosk.findUniqueOrThrow({ where: { id: kioskId } });
    expect(k.status).toBe('ACTIVE');
    expect(k.tokenHash).not.toContain(token); // only a hash is stored
  });

  it('refuses to reuse a registration code', async () => {
    const { cookie } = await adminSession(t, 'SUPER_ADMIN');
    const { registrationCode } = (
      await t.request({ method: 'POST', url: '/kiosks', cookie, payload: { name: 'K2' } })
    ).json();
    const ok = await t.request({
      method: 'POST',
      url: '/kiosk/register',
      origin: null,
      payload: { code: registrationCode, appVersion: '1' },
    });
    expect(ok.statusCode).toBe(200);
    const again = await t.request({
      method: 'POST',
      url: '/kiosk/register',
      origin: null,
      payload: { code: registrationCode, appVersion: '1' },
    });
    expect(again.statusCode).toBe(401);
  });

  it('issues single-use challenges bound to one kiosk', async () => {
    const a = await registerKiosk(t, 'Kiosk A');
    const b = await registerKiosk(t, 'Kiosk B');
    const res = await t.request({ method: 'POST', url: '/kiosk/challenges', bearer: a.token, origin: null });
    expect(res.statusCode).toBe(200);
    const { challenges } = res.json() as { challenges: Array<{ nonce: string }> };
    expect(challenges).toHaveLength(3);
    const svc = t.app.get(ChallengeService);
    const nonce = challenges[0]!.nonce;
    expect(await svc.consume(b.kioskId, nonce)).toBe(false); // foreign kiosk
    expect(await svc.consume(a.kioskId, nonce)).toBe(true);
    expect(await svc.consume(a.kioskId, nonce)).toBe(false); // replay
  });

  it('rejects a revoked kiosk immediately', async () => {
    const { token, kioskId } = await registerKiosk(t);
    const { cookie } = await adminSession(t, 'SUPER_ADMIN');
    expect((await t.request({ method: 'POST', url: `/kiosks/${kioskId}/revoke`, cookie })).statusCode).toBe(200);
    const hb = await t.request({
      method: 'POST',
      url: '/kiosk/heartbeat',
      bearer: token,
      origin: null,
      payload: { appVersion: '0.1.0', readerStatus: 'FAKE' },
    });
    expect(hb.statusCode).toBe(401);
  });

  it('rate-limits kiosk registration attempts per IP', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (
        await t.request({
          method: 'POST',
          url: '/kiosk/register',
          origin: null,
          payload: { code: 'WRONG-CODE', appVersion: '1' },
        })
      ).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('settings (decisions Q3, Q4, Q9)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it('returns the Phase 0 defaults', async () => {
    const { cookie } = await adminSession(t, 'VIEWER');
    const s = (await t.request({ method: 'GET', url: '/settings', cookie })).json();
    expect(s).toMatchObject({
      maxItemsPerStudent: null,
      blockWhenOverdue: true,
      manualEntryPolicy: 'PIN_OR_ASSISTANT',
      offlineMaxHours: 8,
    });
  });

  it('merges partial nested updates without resetting sibling values', async () => {
    const { cookie } = await adminSession(t, 'LAB_ADMIN');
    await t.request({ method: 'PATCH', url: '/settings', cookie, payload: { kiosk: { inactivityTimeoutSec: 60 } } });
    const res = await t.request({
      method: 'PATCH',
      url: '/settings',
      cookie,
      payload: { kiosk: { motionLevel: 'minimal' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kiosk).toMatchObject({ inactivityTimeoutSec: 60, motionLevel: 'minimal', successResetSec: 8 });
  });

  it('only lets a SUPER_ADMIN allow unverified matricule entry (OPEN)', async () => {
    const admin = await adminSession(t, 'LAB_ADMIN');
    const denied = await t.request({
      method: 'PATCH',
      url: '/settings',
      cookie: admin.cookie,
      payload: { manualEntryPolicy: 'OPEN' },
    });
    expect(denied.statusCode).toBe(403);
    const sup = await adminSession(t, 'SUPER_ADMIN');
    const ok = await t.request({
      method: 'PATCH',
      url: '/settings',
      cookie: sup.cookie,
      payload: { manualEntryPolicy: 'OPEN' },
    });
    expect(ok.json().manualEntryPolicy).toBe('OPEN');
  });

  it('rejects invalid values with problem+json', async () => {
    const { cookie } = await adminSession(t, 'LAB_ADMIN');
    const bad = await t.request({
      method: 'PATCH',
      url: '/settings',
      cookie,
      payload: { loanDue: { labClosingTime: '25:99' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('VALIDATION_FAILED');
  });

  it('pushes config changes to connected kiosks in real time', async () => {
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const address = t.app.getHttpServer().address() as { port: number };
    const { token } = await registerKiosk(t);
    const socket: Socket = io(`http://127.0.0.1:${address.port}/kiosk`, { auth: { token }, transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      socket.once('ready', () => resolve());
      socket.once('connect_error', reject);
    });
    const received = new Promise<{ kiosk: { motionLevel: string } }>((resolve) =>
      socket.once('config.changed', resolve),
    );
    const { cookie } = await adminSession(t, 'LAB_ADMIN');
    await t.request({ method: 'PATCH', url: '/settings', cookie, payload: { kiosk: { motionLevel: 'reduced' } } });
    await t.relay();
    expect((await received).kiosk.motionLevel).toBe('reduced');
    socket.disconnect();
  });
});
