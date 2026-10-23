import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';

/** Invariant I4: no PII, OTPs, PINs, tokens or secrets in logs. */
describe('log redaction (I4)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    t.logs.length = 0;
  });

  it('never writes passwords, cookies, device tokens, codes or emails to the log', async () => {
    const secretPassword = 'Sup3r-Secret-Passw0rd!';
    const email = 'redaction.check@labpass.test';
    await adminSession(t, 'LAB_ASSISTANT', { email, password: secretPassword });
    const login = await t.request({ method: 'POST', url: '/auth/login', payload: { email, password: secretPassword } });
    const cookieValue = login.cookies.find((c) => c.name === 'lp_admin')!.value;
    await t.request({ method: 'POST', url: '/auth/login', payload: { email, password: 'wrong-password-xyz' } });
    const { token } = await registerKiosk(t);
    await t.request({
      method: 'POST',
      url: '/kiosk/heartbeat',
      bearer: token,
      origin: null,
      payload: { appVersion: '0.1.0', readerStatus: 'FAKE' },
    });
    await t.request({ method: 'GET', url: `/files/abcdefgh123?exp=1&sig=${'s'.repeat(40)}` });

    const all = t.logs.join('\n');
    expect(all.length).toBeGreaterThan(0); // requests were logged…
    for (const secret of [secretPassword, 'wrong-password-xyz', cookieValue, token, email, 'ssssssssssssssss']) {
      expect(all, `log leaked ${secret.slice(0, 6)}…`).not.toContain(secret);
    }
  });

  it('never leaks internal error details to clients', async () => {
    const res = await t.request({ method: 'GET', url: '/no-such-route' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).not.toMatch(/stack|prisma|at \w+ \(/i);
  });
});
