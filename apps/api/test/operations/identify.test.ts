import { b64urlDecode, b64urlEncode, formatDeviceKeyResponseQr, formatPasskeyResponseQr } from '@labpass/contracts/tap';
import { passkeyChallenge } from '@labpass/contracts/tap-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSecret } from '../../src/platform/crypto/crypto';
import { RealtimeService } from '../../src/platform/realtime/realtime';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { enrollAndroid, lastOtp, makeStudent, SoftAuthenticator } from '../helpers/identity';
import { cardSession, challenge, hceTap, makeEquipment, scanSignature, setSettings, signIn } from '../helpers/lending';

describe('identify at the kiosk (ARCH §5 F1–F4, S06)', () => {
  let t: TestApp;
  let kiosk: { kioskId: string; token: string };
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    kiosk = await registerKiosk(t);
  });

  const identify = (payload: Record<string, unknown>, token = kiosk.token) =>
    t.request({ method: 'POST', url: '/kiosk/identify', bearer: token, origin: null, payload });

  describe('card (F1)', () => {
    it('identifies a bound card and returns state plus a 2-minute session', async () => {
      const s = await makeStudent(t);
      const { result } = await cardSession(t, kiosk.token, s.id);
      expect(result).toMatchObject({
        status: 'IDENTIFIED',
        method: 'CARD',
        student: { id: s.id, matricule: s.matricule },
        eligibility: { canBorrow: true, canReturn: false, reasons: [] },
        openLines: [],
        flags: [],
      });
      const ttl = Date.parse(result.session.expiresAt) - Date.now();
      expect(ttl).toBeGreaterThan(100_000);
      expect(ttl).toBeLessThanOrEqual(120_000);
    });

    it('reports unknown cards with only the UID suffix', async () => {
      const res = await identify({ method: 'CARD', uid: '04a1b2c3d4e5f6' });
      expect(res.json()).toEqual({ status: 'UNKNOWN_CARD', uidSuffix: 'E5F6' });
    });

    it('requires secure authentication for DESFire cards when the mode demands it', async () => {
      const s = await makeStudent(t);
      const { uid } = await cardSession(t, kiosk.token, s.id);
      await t.prisma.cardBinding.updateMany({ data: { cardTech: 'DESFIRE_EV3' } });
      await setSettings(t, { cardAuthMode: 'DESFIRE_PREFERRED' });
      expect((await identify({ method: 'CARD', uid })).json().flags).toEqual(['UID_ONLY']);
      await setSettings(t, { cardAuthMode: 'DESFIRE_REQUIRED' });
      expect((await identify({ method: 'CARD', uid })).json().code).toBe('CARD_AUTH_REQUIRED');
    });
  });

  describe('phone tap (F2) and response QR', () => {
    it('accepts a fresh HCE signature once, bound to this kiosk', async () => {
      const s = await makeStudent(t);
      const e = await enrollAndroid(t, s);
      const nonce = await challenge(t, kiosk.token);
      const tap = hceTap(e.phone, e.credentialId, kiosk.kioskId, nonce);
      const ok = await identify(tap);
      expect(ok.json()).toMatchObject({ status: 'IDENTIFIED', method: 'HCE', student: { id: s.id } });
      expect((await identify(tap)).json().code).toBe('NOT_RECOGNISED'); // replay

      const stale = hceTap(
        e.phone,
        e.credentialId,
        kiosk.kioskId,
        await challenge(t, kiosk.token),
        Date.now() - 60_000,
      );
      expect((await identify(stale)).json().code).toBe('NOT_RECOGNISED');

      const other = await registerKiosk(t, 'Second Kiosk');
      const foreign = hceTap(e.phone, e.credentialId, kiosk.kioskId, await challenge(t, other.token));
      expect((await identify(foreign)).json().code).toBe('NOT_RECOGNISED');
    });

    it('rejects revoked credentials and signatures from another key', async () => {
      const s = await makeStudent(t);
      const e = await enrollAndroid(t, s);
      const thief = await enrollAndroid(t, await makeStudent(t));
      const forged = hceTap(thief.phone, e.credentialId, kiosk.kioskId, await challenge(t, kiosk.token));
      expect((await identify(forged)).json().code).toBe('NOT_RECOGNISED');
      await t.prisma.mobileCredential.update({ where: { id: e.credentialId }, data: { status: 'REVOKED' } });
      const revoked = hceTap(e.phone, e.credentialId, kiosk.kioskId, await challenge(t, kiosk.token));
      expect((await identify(revoked)).json().code).toBe('NOT_RECOGNISED');
    });

    it('reads an LPR1 response QR shown by the phone (offline fallback)', async () => {
      const s = await makeStudent(t);
      const e = await enrollAndroid(t, s);
      const nonce = await challenge(t, kiosk.token);
      const ts = Date.now();
      const payload = formatDeviceKeyResponseQr({
        credentialId: e.credentialId,
        nonce: b64urlDecode(nonce),
        ts,
        signature: b64urlDecode(scanSignature(e.phone, e.credentialId, kiosk.kioskId, nonce, ts)),
      });
      expect((await identify({ method: 'SCAN', payload })).json()).toMatchObject({
        status: 'IDENTIFIED',
        method: 'SCAN',
      });
      expect((await identify({ method: 'SCAN', payload: 'LPR9.garbage.payload' })).json().code).toBe('NOT_RECOGNISED');
    });
  });

  describe('Scan-the-Kiosk from the app (F3)', () => {
    it('Android app: signs the kiosk challenge and the kiosk receives `identified`', async () => {
      const s = await makeStudent(t);
      const e = await enrollAndroid(t, s);
      const spy = vi.spyOn(t.app.get(RealtimeService), 'toKiosk');
      const nonce = await challenge(t, kiosk.token);
      const ts = Date.now();
      const res = await t.request({
        method: 'POST',
        url: '/me/scan',
        origin: null,
        bearer: e.tokens.accessToken,
        payload: {
          kind: 'DEVICE_KEY',
          kioskId: kiosk.kioskId,
          nonce,
          ts,
          signature: scanSignature(e.phone, e.credentialId, kiosk.kioskId, nonce, ts),
        },
      });
      expect(res.json()).toEqual({ status: 'IDENTIFIED', kioskName: 'Cisco Lab Kiosk' });
      expect(spy).toHaveBeenCalledWith(
        kiosk.kioskId,
        'identified',
        expect.objectContaining({ method: 'SCAN', student: expect.objectContaining({ id: s.id }) }),
      );
      spy.mockRestore();
    });

    it('web app: passkey assertion over a kiosk-bound challenge, online and as an LPR2 QR', async () => {
      const s = await makeStudent(t);
      const start = await t.request({
        method: 'POST',
        url: '/enroll/start',
        origin: null,
        payload: {
          matricule: s.matricule,
          firstName: s.firstName,
          lastName: s.lastName,
          dateOfBirth: '2004-03-02',
          platform: 'WEB',
        },
      });
      const sessionId = start.json().sessionId as string;
      await t.request({
        method: 'POST',
        url: '/enroll/otp/verify',
        origin: null,
        payload: { sessionId, code: lastOtp(t) },
      });
      const regOptions = (
        await t.request({ method: 'POST', url: '/enroll/passkey/options', origin: null, payload: { sessionId } })
      ).json().options;
      const authn = new SoftAuthenticator();
      const enrolled = (
        await t.request({
          method: 'POST',
          url: '/enroll/passkey',
          origin: null,
          payload: { sessionId, registration: authn.register(regOptions) },
        })
      ).json();
      const bearer = enrolled.tokens.accessToken as string;

      const nonce = await challenge(t, kiosk.token);
      const opt = await t.request({
        method: 'POST',
        url: '/me/scan/options',
        origin: null,
        bearer,
        payload: { kioskId: kiosk.kioskId, nonce },
      });
      expect(opt.json().options.challenge).toBe(b64urlEncode(passkeyChallenge(kiosk.kioskId, b64urlDecode(nonce))));
      const scan = await t.request({
        method: 'POST',
        url: '/me/scan',
        origin: null,
        bearer,
        payload: { kind: 'PASSKEY', kioskId: kiosk.kioskId, nonce, assertion: authn.assert(opt.json().options) },
      });
      expect(scan.json().status).toBe('IDENTIFIED');

      // Offline fallback: the same assertion format carried in a response QR.
      const nonce2 = await challenge(t, kiosk.token);
      const a = authn.assert({ challenge: b64urlEncode(passkeyChallenge(kiosk.kioskId, b64urlDecode(nonce2))) });
      const payload = formatPasskeyResponseQr({
        credentialId: enrolled.credentialId,
        nonce: b64urlDecode(nonce2),
        authenticatorData: b64urlDecode(a.response.authenticatorData),
        clientDataJSON: b64urlDecode(a.response.clientDataJSON),
        signature: b64urlDecode(a.response.signature),
      });
      expect((await identify({ method: 'SCAN', payload })).json()).toMatchObject({
        status: 'IDENTIFIED',
        student: { id: s.id },
      });
      expect((await identify({ method: 'SCAN', payload })).json().code).toBe('NOT_RECOGNISED'); // single use
    });
  });

  describe('manual matricule (F4)', () => {
    const verify = (payload: Record<string, unknown>, token = kiosk.token) =>
      t.request({ method: 'POST', url: '/kiosk/manual/verify', bearer: token, origin: null, payload });

    it('shows name and photo, then requires the student PIN or an assistant', async () => {
      const noPin = await makeStudent(t);
      const first = (await identify({ method: 'MANUAL', matricule: noPin.matricule.toLowerCase() })).json();
      expect(first).toMatchObject({
        status: 'VERIFICATION_REQUIRED',
        student: { firstName: noPin.firstName },
        options: ['ASSISTANT'],
      });
      expect(first.student).not.toHaveProperty('matricule');

      const s = await makeStudent(t);
      await t.prisma.student.update({ where: { id: s.id }, data: { manualPinHash: await hashSecret('482915') } });
      const l = (await identify({ method: 'MANUAL', matricule: s.matricule })).json();
      expect(l.options).toEqual(['PIN', 'ASSISTANT']);
      expect((await verify({ lookupId: l.lookupId, method: 'PIN', pin: '000000' })).json().code).toBe(
        'VERIFICATION_FAILED',
      );
      const ok = await verify({ lookupId: l.lookupId, method: 'PIN', pin: '482915' });
      expect(ok.json()).toMatchObject({ status: 'IDENTIFIED', method: 'MANUAL', flags: ['MANUAL'] });
      expect((await verify({ lookupId: l.lookupId, method: 'PIN', pin: '482915' })).json().code).toBe('LOOKUP_EXPIRED'); // single use
    });

    it('locks the PIN after five failures', async () => {
      const s = await makeStudent(t);
      await t.prisma.student.update({ where: { id: s.id }, data: { manualPinHash: await hashSecret('482915') } });
      for (let i = 0; i < 5; i++) {
        const l = (await identify({ method: 'MANUAL', matricule: s.matricule })).json();
        await verify({ lookupId: l.lookupId, method: 'PIN', pin: '111111' });
      }
      const l = (await identify({ method: 'MANUAL', matricule: s.matricule })).json();
      const locked = await verify({ lookupId: l.lookupId, method: 'PIN', pin: '482915' });
      expect(locked.statusCode).toBe(423);
    });

    it('accepts a lab-assistant PIN and binds the lookup to the kiosk', async () => {
      const { user } = await adminSession(t, 'LAB_ASSISTANT');
      await t.prisma.adminUser.update({ where: { id: user.id }, data: { assistantPinHash: await hashSecret('2468') } });
      const s = await makeStudent(t);
      const l = (await identify({ method: 'MANUAL', matricule: s.matricule })).json();
      const other = await registerKiosk(t, 'Second Kiosk');
      expect(
        (await verify({ lookupId: l.lookupId, method: 'ASSISTANT', assistantPin: '2468' }, other.token)).json().code,
      ).toBe('LOOKUP_EXPIRED');
      expect((await verify({ lookupId: l.lookupId, method: 'ASSISTANT', assistantPin: '1357' })).json().code).toBe(
        'VERIFICATION_FAILED',
      );
      expect((await verify({ lookupId: l.lookupId, method: 'ASSISTANT', assistantPin: '2468' })).json()).toMatchObject({
        status: 'IDENTIFIED',
        method: 'MANUAL',
      });
    });

    it('supports the OTP policy and the OPEN policy (flagged loans)', async () => {
      const s = await makeStudent(t);
      await setSettings(t, { manualEntryPolicy: 'OTP' });
      const l = (await identify({ method: 'MANUAL', matricule: s.matricule })).json();
      expect(l.options).toEqual(['OTP', 'ASSISTANT']);
      expect((await verify({ lookupId: l.lookupId, method: 'PIN', pin: '1234' })).json().code).toBe(
        'METHOD_NOT_ALLOWED',
      );
      const sent = await t.request({
        method: 'POST',
        url: '/kiosk/manual/otp',
        bearer: kiosk.token,
        origin: null,
        payload: { lookupId: l.lookupId },
      });
      expect(sent.json().destination).toMatch(/\*/);
      expect((await verify({ lookupId: l.lookupId, method: 'OTP', code: lastOtp(t) })).json().status).toBe(
        'IDENTIFIED',
      );

      await setSettings(t, { manualEntryPolicy: 'OPEN' });
      const open = (await identify({ method: 'MANUAL', matricule: s.matricule })).json();
      expect(open).toMatchObject({ status: 'IDENTIFIED', flags: ['MANUAL'] });
      const eq = await makeEquipment(t);
      const borrowed = await signIn(t, kiosk.token, open.session.token, [{ equipmentId: eq.id, quantity: 1 }]);
      expect(borrowed.statusCode).toBe(201);
      expect((await t.prisma.loan.findFirstOrThrow()).manualVerification).toBe('OPEN');
    });

    it('gives one generic answer for unknown matricules, and no session without verification', async () => {
      expect((await identify({ method: 'MANUAL', matricule: 'ICTU20999999' })).json().code).toBe('NOT_RECOGNISED');
      const eq = await makeEquipment(t);
      const forged = await signIn(t, kiosk.token, 'ksess.eyJmYWtlIjp0cnVlfQ.bad-signature', [
        { equipmentId: eq.id, quantity: 1 },
      ]);
      expect(forged.statusCode).toBe(401);
    });
  });
});
