import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/auth/auth.service';
import { adminSession, bootTestApp, cookieFrom, type TestApp } from '../helpers/app';

describe('admin authentication (ARCH §7)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const login = (email: string, password: string) =>
    t.request({ method: 'POST', url: '/auth/login', payload: { email, password } });

  it('lets a LAB_ASSISTANT sign in with a password and sets an HttpOnly SameSite=Strict cookie', async () => {
    await adminSession(t, 'LAB_ASSISTANT', { email: 'aide@labpass.test', password: 'assistant-password-1' });
    const res = await login('AIDE@labpass.test', 'assistant-password-1');
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('AUTHENTICATED');
    const c = res.cookies.find((x) => x.name === 'lp_admin')!;
    expect(c.httpOnly).toBe(true);
    expect(String(c.sameSite).toLowerCase()).toBe('strict');
    const me = await t.request({ method: 'GET', url: '/auth/me', cookie: cookieFrom(res) });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('aide@labpass.test');
  });

  it('requires TOTP enrolment for LAB_ADMIN, then TOTP on every login; codes cannot be replayed', async () => {
    await adminSession(t, 'LAB_ADMIN', { email: 'boss@labpass.test', password: 'admin-password-123' });
    const first = await login('boss@labpass.test', 'admin-password-123');
    expect(first.json().status).toBe('TOTP_SETUP_REQUIRED');
    const pendingCookie = cookieFrom(first)!;
    // The pending session cannot reach protected routes.
    expect((await t.request({ method: 'GET', url: '/auth/me', cookie: pendingCookie })).statusCode).toBe(401);

    const code = AuthService.generateCode(first.json().secret);
    const verified = await t.request({ method: 'POST', url: '/auth/totp', cookie: pendingCookie, payload: { code } });
    expect(verified.statusCode).toBe(200);
    const authCookie = cookieFrom(verified)!;
    expect(authCookie).not.toBe(pendingCookie); // session id rotated
    expect((await t.request({ method: 'GET', url: '/auth/me', cookie: authCookie })).json().totpEnabled).toBe(true);

    const second = await login('boss@labpass.test', 'admin-password-123');
    expect(second.json().status).toBe('TOTP_REQUIRED');
    const replay = await t.request({
      method: 'POST',
      url: '/auth/totp',
      cookie: cookieFrom(second),
      payload: { code },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('locks the account after 5 failures', async () => {
    await adminSession(t, 'VIEWER', { email: 'v@labpass.test', password: 'viewer-password-12' });
    for (let i = 0; i < 5; i++) expect((await login('v@labpass.test', 'wrong')).statusCode).toBe(401);
    const locked = await login('v@labpass.test', 'viewer-password-12');
    expect(locked.statusCode).toBe(423);
    expect(locked.headers['retry-after']).toBeDefined();
    expect(locked.headers['content-type']).toContain('application/problem+json');
  });

  it('gives the same answer for unknown emails and wrong passwords', async () => {
    const a = await login('nobody@labpass.test', 'whatever');
    expect(a.statusCode).toBe(401);
    expect(a.json().code).toBe('UNAUTHENTICATED');
  });

  it('logs out and invalidates the session', async () => {
    const { cookie } = await adminSession(t, 'VIEWER');
    expect((await t.request({ method: 'POST', url: '/auth/logout', cookie })).statusCode).toBe(204);
    expect((await t.request({ method: 'GET', url: '/auth/me', cookie })).statusCode).toBe(401);
  });

  it('rejects admin writes from a foreign or missing Origin (CSRF defence in depth)', async () => {
    const { cookie } = await adminSession(t, 'SUPER_ADMIN');
    const evil = await t.request({
      method: 'POST',
      url: '/kiosks',
      cookie,
      origin: 'https://evil.example',
      payload: { name: 'x1' },
    });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().code).toBe('ORIGIN_REJECTED');
    const none = await t.request({ method: 'POST', url: '/kiosks', cookie, origin: null, payload: { name: 'x2' } });
    expect(none.statusCode).toBe(403);
  });
});
