import { b64urlDecode } from '@labpass/contracts/tap';
import { isP256Spki } from '@labpass/contracts/tap-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TokenSigner } from '../../src/platform/crypto/crypto';
import { adminSession, bootTestApp, cookieFrom, type TestApp } from '../helpers/app';
import { enrollAndroid, fakePhone, lastOtp, makeStudent, SoftAuthenticator } from '../helpers/identity';

describe('student identity (ARCH §5 F7, S05)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const post = (url: string, payload: unknown, extra: { bearer?: string; cookie?: string } = {}) =>
    t.request({ method: 'POST', url, origin: null, payload: payload as Record<string, unknown>, ...extra });

  const start = (s: { matricule: string }, over: Record<string, string> = {}) =>
    post('/enroll/start', {
      matricule: s.matricule,
      firstName: 'Awa',
      lastName: 'Ngo Bassa',
      dateOfBirth: '2004-03-02',
      platform: 'ANDROID_APP',
      ...over,
    });

  async function reviewEnrollment() {
    const s = await makeStudent(t, { firstName: 'Thérèse', lastName: 'Mballa' });
    const st = await start(s, { firstName: 'Therese', lastName: 'Mballa' });
    expect(st.json()).toMatchObject({ next: 'CREDENTIAL', otp: null });
    const sessionId = st.json().sessionId as string;
    const { popNonce } = (await post('/enroll/pop-nonce', { sessionId })).json();
    const phone = fakePhone();
    const res = await post('/enroll/key', {
      sessionId,
      spki: phone.spki,
      popSignature: phone.pop(sessionId, popNonce),
      capabilities: { hce: true, scan: true },
    });
    return { s, sessionId, res };
  }

  describe('enrollment', () => {
    it('auto-approves an exact match (case and spacing ignored) after OTP and device-key proof', async () => {
      const s = await makeStudent(t);
      const st = await start(s, {
        matricule: ` ${s.matricule.toLowerCase()} `.trim(),
        firstName: '  awa ',
        lastName: 'NGO   BASSA',
      });
      expect(st.statusCode).toBe(200);
      expect(st.json()).toMatchObject({ next: 'OTP', otp: { channel: 'EMAIL' } });
      expect(st.json().otp.destination).not.toBe(s.email); // masked
      const sessionId = st.json().sessionId as string;

      const otp = await post('/enroll/otp/verify', { sessionId, code: lastOtp(t) });
      expect(otp.statusCode).toBe(200);
      const phone = fakePhone();
      const key = await post('/enroll/key', {
        sessionId,
        spki: phone.spki,
        popSignature: phone.pop(sessionId, otp.json().popNonce),
        capabilities: { hce: true, scan: true },
        deviceLabel: 'Tecno Spark 10',
      });
      expect(key.statusCode).toBe(200);
      expect(key.json()).toMatchObject({ status: 'ACTIVE', pollToken: null });
      expect(typeof key.json().tokens.refreshToken).toBe('string');
      expect((await t.prisma.credentialRequest.findFirstOrThrow()).decision).toBe('AUTO_APPROVED');

      const me = await t.request({ method: 'GET', url: '/me', origin: null, bearer: key.json().tokens.accessToken });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        student: { matricule: s.matricule },
        credential: { status: 'ACTIVE', kind: 'DEVICE_KEY', capabilities: { hce: true } },
        hasPin: false,
      });
    });

    it('sends mismatches (Therese ≠ Thérèse) to review; approval needs in-person verification', async () => {
      const { cookie: adminCookie } = await adminSession(t, 'LAB_ADMIN');
      const { sessionId, res } = await reviewEnrollment();
      expect(res.json()).toMatchObject({ status: 'PENDING', tokens: null });
      const pollToken = res.json().pollToken as string;
      expect(t.notifications.sentForTest.filter((m) => m.template === 'otp')).toHaveLength(0);
      expect((await post('/enroll/claim', { sessionId, pollToken })).json()).toMatchObject({
        status: 'PENDING',
        tokens: null,
      });

      await t.relay();
      expect(t.notifications.sentForTest.some((m) => m.template === 'credential_pending')).toBe(true);

      const list = await t.request({
        method: 'GET',
        url: '/credential-requests?decision=PENDING',
        cookie: adminCookie,
      });
      expect(list.json()).toHaveLength(1);
      const reqDto = list.json()[0];
      expect(reqDto.matchResult).toMatchObject({ firstName: false, lastName: true, dateOfBirth: true });
      expect(reqDto.submitted.firstName).toBe('Therese');

      const { cookie: assistant } = await adminSession(t, 'LAB_ASSISTANT');
      expect(
        (
          await t.request({
            method: 'POST',
            url: `/credential-requests/${reqDto.id}/approve`,
            cookie: assistant,
            payload: { verifiedInPerson: true },
          })
        ).statusCode,
      ).toBe(403);
      const blind = await t.request({
        method: 'POST',
        url: `/credential-requests/${reqDto.id}/approve`,
        cookie: adminCookie,
        payload: {},
      });
      expect(blind.json().code).toBe('IN_PERSON_REQUIRED');
      const ok = await t.request({
        method: 'POST',
        url: `/credential-requests/${reqDto.id}/approve`,
        cookie: adminCookie,
        payload: { verifiedInPerson: true },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ decision: 'APPROVED' });
      expect(ok.json().reviewerName).toBeTruthy();
      const twice = await t.request({
        method: 'POST',
        url: `/credential-requests/${reqDto.id}/approve`,
        cookie: adminCookie,
        payload: { verifiedInPerson: true },
      });
      expect(twice.json().code).toBe('ALREADY_DECIDED');

      const claimed = await post('/enroll/claim', { sessionId, pollToken });
      expect(claimed.json().status).toBe('ACTIVE');
      expect(typeof claimed.json().tokens.refreshToken).toBe('string');
      expect((await post('/enroll/claim', { sessionId, pollToken })).statusCode).toBe(404); // tokens are released once
    });

    it('tells the app why a request was rejected', async () => {
      const { cookie } = await adminSession(t, 'LAB_ADMIN');
      const { sessionId, res } = await reviewEnrollment();
      const id = (await t.prisma.credentialRequest.findFirstOrThrow()).id;
      await t.request({
        method: 'POST',
        url: `/credential-requests/${id}/reject`,
        cookie,
        payload: { reason: 'Name does not match the ID card' },
      });
      const claimed = (await post('/enroll/claim', { sessionId, pollToken: res.json().pollToken })).json();
      expect(claimed).toEqual({ status: 'REJECTED', reason: 'Name does not match the ID card', tokens: null });
    });

    it('refuses a wrong proof of possession and a reused session', async () => {
      const s = await makeStudent(t);
      const sessionId = (await start(s)).json().sessionId as string;
      const { popNonce } = (await post('/enroll/otp/verify', { sessionId, code: lastOtp(t) })).json();
      const phone = fakePhone();
      const other = fakePhone();
      const bad = await post('/enroll/key', {
        sessionId,
        spki: phone.spki,
        popSignature: other.pop(sessionId, popNonce),
        capabilities: { hce: true, scan: true },
      });
      expect(bad.json().code).toBe('INVALID_PROOF');
      const good = await post('/enroll/key', {
        sessionId,
        spki: phone.spki,
        popSignature: phone.pop(sessionId, popNonce),
        capabilities: { hce: true, scan: true },
      });
      expect(good.statusCode).toBe(200);
      const again = await post('/enroll/key', {
        sessionId,
        spki: other.spki,
        popSignature: other.pop(sessionId, popNonce),
        capabilities: { hce: true, scan: true },
      });
      expect(again.json().code).toBe('ENROLLMENT_USED');
    });

    it('lets only one of two concurrent completions win', async () => {
      const s = await makeStudent(t);
      const sessionId = (await start(s)).json().sessionId as string;
      const { popNonce } = (await post('/enroll/otp/verify', { sessionId, code: lastOtp(t) })).json();
      const [a, b] = [fakePhone(), fakePhone()];
      const results = await Promise.all(
        [a, b].map((p) =>
          post('/enroll/key', {
            sessionId,
            spki: p.spki,
            popSignature: p.pop(sessionId, popNonce),
            capabilities: { hce: true, scan: true },
          }),
        ),
      );
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(await t.prisma.mobileCredential.count({ where: { studentId: s.id, status: 'ACTIVE' } })).toBe(1);
    });

    it('replaces the previous device and revokes its tokens', async () => {
      const s = await makeStudent(t);
      const first = await enrollAndroid(t, s);
      const second = await enrollAndroid(t, s);
      expect((await t.prisma.mobileCredential.findUniqueOrThrow({ where: { id: first.credentialId } })).status).toBe(
        'REVOKED',
      );
      expect(
        (await t.request({ method: 'GET', url: '/me', origin: null, bearer: first.tokens.accessToken })).statusCode,
      ).toBe(401);
      expect((await post('/auth/student/refresh', { refreshToken: first.tokens.refreshToken })).statusCode).toBe(401);
      expect(
        (await t.request({ method: 'GET', url: '/me', origin: null, bearer: second.tokens.accessToken })).statusCode,
      ).toBe(200);
      expect(await t.prisma.outboxEvent.count({ where: { type: 'CredentialRevoked' } })).toBe(1);
    });

    it('locks the code after five wrong attempts', async () => {
      const s = await makeStudent(t);
      const sessionId = (await start(s)).json().sessionId as string;
      const code = lastOtp(t);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++)
        expect((await post('/enroll/otp/verify', { sessionId, code: wrong })).json().code).toBe('INVALID_CODE');
      expect((await post('/enroll/otp/verify', { sessionId, code })).json().code).toBe('CODE_EXPIRED');
    });

    it('refuses an expired enrollment session', async () => {
      const s = await makeStudent(t);
      const sessionId = (await start(s)).json().sessionId as string;
      await t.prisma.enrollmentSession.update({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await post('/enroll/otp/verify', { sessionId, code: lastOtp(t) })).json().code).toBe(
        'ENROLLMENT_EXPIRED',
      );
    });

    it('rejects unknown matricules; inactive or contact-less students go to review', async () => {
      expect((await start({ matricule: 'ICTU20999999' })).json().code).toBe('UNKNOWN_MATRICULE');
      const inactive = await makeStudent(t, { status: 'INACTIVE' });
      expect((await start(inactive)).json().next).toBe('CREDENTIAL');
      const noContact = await makeStudent(t, { email: null, phone: null });
      expect((await start(noContact)).json().next).toBe('CREDENTIAL');
      // OTP-less review sessions cannot skip to the OTP-verified path.
      const withContact = await makeStudent(t);
      const sessionId = (await start(withContact)).json().sessionId as string;
      expect((await post('/enroll/pop-nonce', { sessionId })).json().code).toBe('OTP_REQUIRED');
    });
  });

  describe('student tokens', () => {
    it('rotates refresh tokens and revokes the whole family when a used token comes back', async () => {
      const e = await enrollAndroid(t, await makeStudent(t));
      const r1 = await post('/auth/student/refresh', { refreshToken: e.tokens.refreshToken });
      expect(r1.statusCode).toBe(200);
      expect(r1.json().refreshToken).not.toBe(e.tokens.refreshToken);
      expect((await post('/auth/student/refresh', { refreshToken: e.tokens.refreshToken })).statusCode).toBe(401);
      expect((await post('/auth/student/refresh', { refreshToken: r1.json().refreshToken })).statusCode).toBe(401);
    });

    it('needs a recent sign-in to set a PIN', async () => {
      const s = await makeStudent(t);
      const e = await enrollAndroid(t, s);
      expect(
        (
          await t.request({
            method: 'PUT',
            url: '/me/pin',
            origin: null,
            bearer: e.tokens.accessToken,
            payload: { pin: '482915' },
          })
        ).statusCode,
      ).toBe(200);
      expect((await t.prisma.student.findUniqueOrThrow({ where: { id: s.id } })).manualPinHash).toMatch(
        /^\$argon2id\$/,
      );

      const fam = (await t.prisma.studentRefreshToken.findFirstOrThrow({ where: { credentialId: e.credentialId } }))
        .familyId;
      const stale = t.app
        .get(TokenSigner)
        .sign('sat', { sub: s.id, cid: e.credentialId, fam, iat: Math.floor(Date.now() / 1000) - 600 }, 600).token;
      const res = await t.request({
        method: 'PUT',
        url: '/me/pin',
        origin: null,
        bearer: stale,
        payload: { pin: '482915' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('registers push tokens once, and lets a student revoke a lost phone or sign out', async () => {
      const s = await makeStudent(t);
      const e = await enrollAndroid(t, s);
      const push = { kind: 'EXPO', token: 'ExponentPushToken[abcdefghijklmnop]', platform: 'android' };
      await post('/me/push-token', push, { bearer: e.tokens.accessToken });
      await post('/me/push-token', push, { bearer: e.tokens.accessToken });
      expect(await t.prisma.pushToken.count()).toBe(1);

      const logout = await post('/auth/student/logout', {}, { bearer: e.tokens.accessToken });
      expect(logout.statusCode).toBe(204);
      expect((await post('/auth/student/refresh', { refreshToken: e.tokens.refreshToken })).statusCode).toBe(401);

      const lost = await enrollAndroid(t, s);
      expect((await post('/me/credential/revoke', {}, { bearer: lost.tokens.accessToken })).statusCode).toBe(200);
      expect(
        (await t.request({ method: 'GET', url: '/me', origin: null, bearer: lost.tokens.accessToken })).statusCode,
      ).toBe(401);
    });

    it('lets an admin revoke a credential; the kiosk-facing event is emitted', async () => {
      const { cookie } = await adminSession(t, 'LAB_ADMIN');
      const e = await enrollAndroid(t, await makeStudent(t));
      const res = await t.request({
        method: 'POST',
        url: `/credentials/${e.credentialId}/revoke`,
        cookie,
        payload: { reason: 'Phone reported stolen' },
      });
      expect(res.statusCode).toBe(200);
      expect((await t.prisma.mobileCredential.findUniqueOrThrow({ where: { id: e.credentialId } })).revokedReason).toBe(
        'Phone reported stolen',
      );
      expect(await t.prisma.outboxEvent.count({ where: { type: 'CredentialRevoked' } })).toBe(1);
      expect(await t.prisma.auditLog.count({ where: { action: 'credentials.revoke' } })).toBe(1);
    });
  });

  describe('passkeys (web app)', () => {
    async function webSession() {
      const s = await makeStudent(t);
      const sessionId = (await start(s, { platform: 'WEB' })).json().sessionId as string;
      const { popNonce } = (await post('/enroll/otp/verify', { sessionId, code: lastOtp(t) })).json();
      const { options } = (await post('/enroll/passkey/options', { sessionId })).json();
      return { s, sessionId, popNonce, options };
    }

    it('enrolls with a passkey, keeps the refresh token in a cookie, and signs back in', async () => {
      const { s, sessionId, popNonce, options } = await webSession();
      expect(options).toMatchObject({
        challenge: popNonce,
        rp: { id: 'localhost' },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      });
      expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });

      const authenticator = new SoftAuthenticator();
      const res = await post('/enroll/passkey', {
        sessionId,
        registration: authenticator.register(options),
        deviceLabel: 'Chrome on Android',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ACTIVE', tokens: { refreshToken: null } });
      const cookie = cookieFrom(res, 'lp_srt');
      expect(cookie).toBeTruthy();
      expect(res.cookies.find((c) => c.name === 'lp_srt')).toMatchObject({ httpOnly: true, sameSite: 'Strict' });

      const cred = await t.prisma.mobileCredential.findFirstOrThrow({ where: { studentId: s.id } });
      expect(cred).toMatchObject({ kind: 'PASSKEY', platform: 'WEB', webauthnCredentialId: authenticator.id });
      expect(isP256Spki(new Uint8Array(cred.publicKeySpki!))).toBe(true);

      const refreshed = await post('/auth/student/refresh', {}, { cookie });
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json().refreshToken).toBeNull();

      const login = (await post('/auth/student/passkey/options', {})).json().options;
      const assertion = authenticator.assert(login);
      const signedIn = await post('/auth/student/passkey', { assertion });
      expect(signedIn.statusCode).toBe(200);
      expect(
        (await t.request({ method: 'GET', url: '/me', origin: null, bearer: signedIn.json().accessToken })).statusCode,
      ).toBe(200);
      expect((await post('/auth/student/passkey', { assertion })).statusCode).toBe(401); // challenge is single-use
    });

    it('rejects a passkey created for another origin', async () => {
      const { sessionId, options } = await webSession();
      const reg = new SoftAuthenticator().register(options, { origin: 'https://evil.example' });
      expect((await post('/enroll/passkey', { sessionId, registration: reg })).json().code).toBe('INVALID_PASSKEY');
    });

    it('only signs in registered, active passkeys', async () => {
      const login = (await post('/auth/student/passkey/options', {})).json().options;
      const stranger = new SoftAuthenticator().assert(login);
      expect((await post('/auth/student/passkey', { assertion: stranger })).statusCode).toBe(401);
      expect(b64urlDecode(String(login.challenge)).length).toBeGreaterThanOrEqual(16);
    });
  });
});
