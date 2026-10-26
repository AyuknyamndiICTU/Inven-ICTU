import { b64urlDecode, b64urlEncode, formatDeviceKeyResponseQr, hceMessage } from '@labpass/contracts/tap';
import { signDer } from '@labpass/contracts/tap-node';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uidHmac } from '../../src/platform/crypto/crypto';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { fakePhone, makeStudent } from '../helpers/identity';
import { challenge, makeEquipment, scanSignature } from '../helpers/lending';

/**
 * S13 attack tests for threats not already covered elsewhere (docs/security/threat-model.md maps every threat
 * to its test). Each test is named after the threat ID.
 */
describe('attacks (S13 STRIDE)', () => {
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

  async function phoneStudent() {
    const s = await makeStudent(t);
    const phone = fakePhone();
    const cred = await t.prisma.mobileCredential.create({
      data: {
        studentId: s.id,
        kind: 'DEVICE_KEY',
        platform: 'ANDROID_APP',
        status: 'ACTIVE',
        capabilities: { hce: true, scan: true },
        publicKeySpki: Buffer.from(phone.key.spki),
        activatedAt: new Date(),
      },
    });
    return { s, phone, cred };
  }

  const identify = (payload: Record<string, unknown>, token = kiosk.token) =>
    t.request({ method: 'POST', url: '/kiosk/identify', bearer: token, origin: null, payload });

  it('T-S2 response-QR screenshot replay: an LPR1 code works once, at one kiosk', async () => {
    const { phone, cred } = await phoneStudent();
    const nonce = await challenge(t, kiosk.token);
    const ts = Date.now();
    const qr = formatDeviceKeyResponseQr({
      credentialId: cred.id,
      nonce: b64urlDecode(nonce),
      ts,
      signature: b64urlDecode(scanSignature(phone, cred.id, kiosk.kioskId, nonce, ts)),
    });
    expect((await identify({ method: 'SCAN', payload: qr })).json().status).toBe('IDENTIFIED');
    expect((await identify({ method: 'SCAN', payload: qr })).statusCode).toBe(422);
    const other = await registerKiosk(t, 'Second kiosk');
    expect((await identify({ method: 'SCAN', payload: qr }, other.token)).statusCode).toBe(422);
  });

  it('T-S1 foreign-kiosk HCE: a signature over kiosk A never identifies at kiosk B', async () => {
    const { phone, cred } = await phoneStudent();
    const other = await registerKiosk(t, 'Second kiosk');
    const nonce = await challenge(t, other.token);
    const ts = Date.now();
    const sig = signDer(phone.key.pkcs8, hceMessage(cred.id, b64urlDecode(nonce), kiosk.kioskId, ts));
    const res = await identify(
      { method: 'HCE', credentialId: cred.id, nonce, ts, signature: b64urlEncode(sig) },
      other.token,
    );
    expect(res.statusCode).toBe(422);
  });

  const sync = async (token: string, transactions: unknown[]) =>
    t.request({
      method: 'POST',
      url: '/kiosk/offline-sync',
      bearer: token,
      origin: null,
      payload: {
        offlineFrom: new Date(Date.now() - 60_000).toISOString(),
        offlineTo: new Date().toISOString(),
        bundleVersion:
          (await t.request({ method: 'GET', url: '/kiosk/offline-bundle', bearer: token, origin: null })).json()
            .version ?? 0,
        transactions,
      },
    });

  async function cardFor(studentId: string) {
    const uid = randomBytes(7).toString('hex').toUpperCase();
    await t.prisma.cardBinding.create({
      data: { studentId, uidHmac: uidHmac(t.env.UID_PEPPER, uid), uidSuffix: uid.slice(-4), createdVia: 'ADMIN' },
    });
    return uid;
  }

  it('T-O2 tampered offline journal: card evidence for one student cannot charge another', async () => {
    const victim = await makeStudent(t);
    const attacker = await makeStudent(t);
    const uid = await cardFor(attacker.id);
    const eq = await makeEquipment(t, { qty: 4 });
    const res = await sync(kiosk.token, [
      {
        txId: randomUUID(),
        seq: 1,
        occurredAt: new Date(Date.now() - 1000).toISOString(),
        kind: 'BORROW',
        studentId: victim.id,
        method: 'CARD',
        evidence: { type: 'CARD', uidLookup: 'AAAA', uid },
        borrowLines: [{ equipmentId: eq.id, quantity: 2 }],
      },
    ]);
    expect(res.json().conflicts).toEqual([expect.objectContaining({ reason: 'INVALID_EVIDENCE' })]);
    expect(await t.prisma.loan.count({ where: { studentId: victim.id } })).toBe(0);
    expect((await t.prisma.equipment.findUniqueOrThrow({ where: { id: eq.id } })).availableQuantity).toBe(4);
  });

  it('T-O3 a revoked kiosk can neither download the bundle nor sync', async () => {
    const { cookie } = await adminSession(t, 'SUPER_ADMIN');
    const revoked = await t.request({ method: 'POST', url: `/kiosks/${kiosk.kioskId}/revoke`, cookie, payload: {} });
    expect(revoked.statusCode).toBe(200);
    const bundle = await t.request({ method: 'GET', url: '/kiosk/offline-bundle', bearer: kiosk.token, origin: null });
    expect(bundle.statusCode).toBe(401);
    expect((await sync(kiosk.token, [])).statusCode).toBe(401);
  });

  it('T-O4 the same txId is applied once per kiosk scope and I2 holds', async () => {
    const s = await makeStudent(t);
    const uid = await cardFor(s.id);
    const eq = await makeEquipment(t, { qty: 5 });
    const tx = {
      txId: randomUUID(),
      seq: 1,
      occurredAt: new Date(Date.now() - 1000).toISOString(),
      kind: 'BORROW',
      studentId: s.id,
      method: 'CARD',
      evidence: { type: 'CARD', uidLookup: 'AAAA', uid },
      borrowLines: [{ equipmentId: eq.id, quantity: 1 }],
    };
    expect((await sync(kiosk.token, [tx])).json().applied).toEqual([tx.txId]);
    expect((await sync(kiosk.token, [tx])).json().duplicates).toEqual([tx.txId]);
    const e = await t.prisma.equipment.findUniqueOrThrow({ where: { id: eq.id } });
    const out = await t.prisma.loanLine.aggregate({ where: { equipmentId: eq.id }, _sum: { qtyIssued: true } });
    expect(e.availableQuantity).toBe(4);
    expect(e.availableQuantity + (out._sum.qtyIssued ?? 0)).toBe(e.totalQuantity);
  });

  it('T-E1 kiosks and viewers cannot reach the conflict-review routes', async () => {
    const asKiosk = await t.request({ method: 'GET', url: '/offline-conflicts', bearer: kiosk.token, origin: null });
    expect([401, 403]).toContain(asKiosk.statusCode);
    const { cookie } = await adminSession(t, 'VIEWER');
    expect((await t.request({ method: 'GET', url: '/offline-conflicts', cookie })).statusCode).toBe(403);
  });
});
