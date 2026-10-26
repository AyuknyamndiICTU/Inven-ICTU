import { offlineTxMacInput } from '@labpass/contracts';
import { b64urlDecode, b64urlEncode, hceMessage } from '@labpass/contracts/tap';
import { signDer } from '@labpass/contracts/tap-node';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assistantMacKey, txMac } from '../../src/offline/assistant-key';
import { hashSecret, uidHmac } from '../../src/platform/crypto/crypto';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { fakePhone, makeStudent } from '../helpers/identity';
import { challenge, makeEquipment, setSettings, signIn } from '../helpers/lending';

/** S11.5 Verify: offline bundle, ordered replay, idempotent re-sync, conflicts in admin review, I2 preserved. */
describe('Kiosk offline mode (S11.5)', () => {
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

  const kioskCall = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    t.request({ method, url, bearer: kiosk.token, origin: null, ...(payload ? { payload } : {}) });

  async function world() {
    const router = await makeEquipment(t, { qty: 3 });
    const cable = await makeEquipment(t, { qty: 10, name: 'Console cable' });
    const ama = await makeStudent(t);
    const brice = await makeStudent(t);
    const uid = randomBytes(7).toString('hex').toUpperCase();
    await t.prisma.cardBinding.create({
      data: {
        studentId: ama.id,
        uidHmac: uidHmac(t.env.UID_PEPPER, uid),
        uidSuffix: uid.slice(-4),
        createdVia: 'ADMIN',
      },
    });
    const phone = fakePhone();
    const cred = await t.prisma.mobileCredential.create({
      data: {
        studentId: brice.id,
        kind: 'DEVICE_KEY',
        platform: 'ANDROID_APP',
        status: 'ACTIVE',
        capabilities: { hce: true, scan: true },
        publicKeySpki: Buffer.from(phone.key.spki),
        activatedAt: new Date(),
      },
    });
    const { user: assistant } = await adminSession(t, 'LAB_ASSISTANT');
    await t.prisma.adminUser.update({
      where: { id: assistant.id },
      data: { assistantPinHash: await hashSecret('1357') },
    });
    return { router, cable, ama, brice, uid, phone, cred, assistant };
  }

  it('serves a bundle with equipment, students, credentials and assistants, rotating the key', async () => {
    const w = await world();
    const a = (await kioskCall('GET', '/kiosk/offline-bundle')).json();
    const b = (await kioskCall('GET', '/kiosk/offline-bundle')).json();
    expect(b.keyVersion).toBe(a.keyVersion + 1);
    expect(b.lookupKey).not.toBe(a.lookupKey);
    expect(a.equipment.map((e: { id: string }) => e.id)).toEqual(expect.arrayContaining([w.router.id, w.cable.id]));
    expect(a.students.some((s: { id: string }) => s.id === w.ama.id)).toBe(true);
    expect(a.credentials).toEqual([expect.objectContaining({ credentialId: w.cred.id, kind: 'DEVICE_KEY' })]);
    expect(a.assistants).toEqual([expect.objectContaining({ id: w.assistant.id })]);
    // Never cached: student PIN hashes, contacts, card UIDs, assistant PIN digests.
    const text = JSON.stringify(a);
    expect(text).not.toMatch(/manualPinHash|email|phone|uidHmac|pinHash/);
    expect(text).not.toContain(w.uid);
    const stored = (await t.prisma.adminUser.findUniqueOrThrow({ where: { id: w.assistant.id } })).assistantPinHash!;
    expect(text).not.toContain(stored.slice(stored.lastIndexOf('$') + 1));
    expect(a.assistants[0].pinParams).toBe(stored.slice(0, stored.lastIndexOf('$')));
  });

  it('replays in order, puts conflicts in review, and a second sync is a no-op', async () => {
    const w = await world();
    // Before the outage Ama borrowed one router online with her card.
    const ident = await kioskCall('POST', '/kiosk/identify', { method: 'CARD', uid: w.uid });
    const borrowed = await signIn(t, kiosk.token, ident.json().session.token, [
      { equipmentId: w.router.id, quantity: 1 },
    ]);
    expect(borrowed.statusCode).toBe(201);
    const line = await t.prisma.loanLine.findFirstOrThrow({ where: { loan: { studentId: w.ama.id } } });
    const bundle = (await kioskCall('GET', '/kiosk/offline-bundle')).json();

    const from = Date.now() - 60_000;
    const at = (s: number) => new Date(from + s * 1000).toISOString();
    const nonce = new Uint8Array(randomBytes(16));
    const ts = from + 5000;
    const hce = {
      type: 'HCE' as const,
      credentialId: w.cred.id,
      nonce: b64urlEncode(nonce),
      ts,
      signature: b64urlEncode(signDer(w.phone.key.pkcs8, hceMessage(w.cred.id, nonce, kiosk.kioskId, ts))),
    };
    const card = { type: 'CARD' as const, uidLookup: 'AAAA', uid: w.uid };
    const tx = (seq: number, over: Record<string, unknown>) => ({
      txId: randomUUID(),
      seq,
      occurredAt: at(seq),
      borrowLines: [],
      returnLines: [],
      ...over,
    });
    const transactions = [
      tx(1, {
        kind: 'RETURN',
        studentId: w.ama.id,
        method: 'CARD',
        evidence: card,
        returnLines: [{ loanLineId: line.id, quantity: 1, condition: 'OK' }],
      }),
      tx(2, {
        kind: 'BORROW',
        studentId: w.ama.id,
        method: 'CARD',
        evidence: card,
        borrowLines: [{ equipmentId: w.router.id, quantity: 2 }],
      }),
      tx(3, {
        kind: 'BORROW',
        studentId: w.brice.id,
        method: 'HCE',
        evidence: hce,
        borrowLines: [{ equipmentId: w.cable.id, quantity: 4 }],
      }),
      // Stock changed elsewhere: only 1 router left, the assistant-confirmed loan asks for 2.
      tx(4, {
        kind: 'BORROW',
        studentId: w.brice.id,
        method: 'MANUAL',
        evidence: { type: 'ASSISTANT', assistantId: w.assistant.id },
        borrowLines: [{ equipmentId: w.router.id, quantity: 2 }],
      }),
      // Forged phone evidence.
      tx(5, {
        kind: 'BORROW',
        studentId: w.brice.id,
        method: 'HCE',
        evidence: { ...hce, signature: hce.signature.replace(/^.{4}/, 'AAAA') },
        borrowLines: [{ equipmentId: w.cable.id, quantity: 1 }],
      }),
    ];
    const body = {
      offlineFrom: new Date(from).toISOString(),
      offlineTo: new Date().toISOString(),
      bundleVersion: bundle.version,
      transactions,
    };
    const t4 = transactions[3] as unknown as Parameters<typeof offlineTxMacInput>[0] & {
      evidence: Record<string, unknown>;
    };
    t4.evidence = {
      type: 'ASSISTANT',
      assistantId: w.assistant.id,
      mac: txMac(
        assistantMacKey(t.env.APP_SECRET, w.assistant.id, kiosk.kioskId, bundle.version),
        offlineTxMacInput(t4),
      ),
    };

    const first = await kioskCall('POST', '/kiosk/offline-sync', body);
    expect(first.statusCode).toBe(200);
    const r1 = first.json();
    expect(r1.applied).toEqual(transactions.slice(0, 3).map((x) => x.txId));
    expect(r1.conflicts).toEqual([
      { txId: transactions[3]!.txId, reason: 'INSUFFICIENT_STOCK' },
      { txId: transactions[4]!.txId, reason: 'INVALID_EVIDENCE' },
    ]);
    const routerAfter = await t.prisma.equipment.findUniqueOrThrow({ where: { id: w.router.id } });
    expect(routerAfter.availableQuantity).toBe(1); // 3 − 1 (online) + 1 (offline return) − 2 (offline borrow)
    expect(await t.prisma.loan.count({ where: { offline: true } })).toBe(2);

    const second = (await kioskCall('POST', '/kiosk/offline-sync', body)).json();
    expect(second.applied).toEqual([]);
    expect(second.conflicts).toEqual([]);
    expect(second.duplicates).toHaveLength(5);
    expect((await t.prisma.equipment.findUniqueOrThrow({ where: { id: w.router.id } })).availableQuantity).toBe(1);
    expect(await t.prisma.offlineSyncConflict.count()).toBe(2);

    // Admin review: accept the stock conflict (stock is corrected first, I2 holds), void the forged one.
    const { cookie } = await adminSession(t, 'LAB_ADMIN');
    const list = (await t.request({ method: 'GET', url: '/offline-conflicts?open=true', cookie })).json();
    expect(list).toHaveLength(2);
    const stock = list.find((c: { reason: string }) => c.reason === 'INSUFFICIENT_STOCK');
    const forged = list.find((c: { reason: string }) => c.reason === 'INVALID_EVIDENCE');
    const accept = await t.request({
      method: 'POST',
      url: `/offline-conflicts/${stock.id}/resolve`,
      cookie,
      payload: { resolution: 'ACCEPTED', note: 'Two routers were found in the cupboard' },
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json().resolution).toBe('ACCEPTED');
    const routerFinal = await t.prisma.equipment.findUniqueOrThrow({ where: { id: w.router.id } });
    expect(routerFinal.availableQuantity).toBe(0);
    expect(routerFinal.totalQuantity).toBe(4);
    const voided = await t.request({
      method: 'POST',
      url: `/offline-conflicts/${forged.id}/resolve`,
      cookie,
      payload: { resolution: 'VOIDED', note: 'Signature did not verify' },
    });
    expect(voided.json().resolution).toBe('VOIDED');
    const again = await t.request({
      method: 'POST',
      url: `/offline-conflicts/${forged.id}/resolve`,
      cookie,
      payload: { resolution: 'VOIDED', note: 'twice' },
    });
    expect(again.statusCode).toBe(409);

    // I2: every equipment row stays within 0 ≤ available ≤ total and matches open loans.
    for (const e of await t.prisma.equipment.findMany({ include: { loanLines: true } })) {
      const out = e.loanLines.reduce((n, l) => n + l.qtyIssued - l.qtyReturned - l.qtyDamaged - l.qtyLost, 0);
      expect(e.availableQuantity).toBeGreaterThanOrEqual(0);
      expect(e.availableQuantity + out).toBe(e.totalQuantity);
    }
  });

  it('rejects evidence outside the declared offline window and revoked credentials', async () => {
    const w = await world();
    await t.prisma.mobileCredential.update({ where: { id: w.cred.id }, data: { status: 'REVOKED' } });
    const nonce = new Uint8Array(randomBytes(16));
    const ts = Date.now() - 1000;
    const res = await kioskCall('POST', '/kiosk/offline-sync', {
      offlineFrom: new Date(Date.now() - 60_000).toISOString(),
      offlineTo: new Date().toISOString(),
      bundleVersion: (await kioskCall('GET', '/kiosk/offline-bundle')).json().version,
      transactions: [
        {
          txId: randomUUID(),
          seq: 1,
          occurredAt: new Date(ts).toISOString(),
          kind: 'BORROW',
          studentId: w.brice.id,
          method: 'HCE',
          evidence: {
            type: 'HCE',
            credentialId: w.cred.id,
            nonce: b64urlEncode(nonce),
            ts,
            signature: b64urlEncode(signDer(w.phone.key.pkcs8, hceMessage(w.cred.id, nonce, kiosk.kioskId, ts))),
          },
          borrowLines: [{ equipmentId: w.cable.id, quantity: 1 }],
        },
        {
          txId: randomUUID(),
          seq: 2,
          occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
          kind: 'BORROW',
          studentId: w.ama.id,
          method: 'CARD',
          evidence: { type: 'CARD', uidLookup: 'AAAA', uid: w.uid },
          borrowLines: [{ equipmentId: w.cable.id, quantity: 1 }],
        },
      ],
    });
    expect(res.json().conflicts.map((c: { reason: string }) => c.reason)).toEqual([
      'CREDENTIAL_REVOKED',
      'INVALID_EVIDENCE',
    ]);
    expect((await t.prisma.equipment.findUniqueOrThrow({ where: { id: w.cable.id } })).availableQuantity).toBe(10);
  });

  it('S13: captured signatures, forged assistant MACs, unknown bundles and DESFire-required cards are refused', async () => {
    const w = await world();
    const bundle = (await kioskCall('GET', '/kiosk/offline-bundle')).json();
    // An online tap: its signature must never back an offline transaction later.
    const nonce = await challenge(t, kiosk.token);
    const ts = Date.now();
    const online = {
      method: 'HCE' as const,
      credentialId: w.cred.id,
      nonce,
      ts,
      signature: b64urlEncode(
        signDer(w.phone.key.pkcs8, hceMessage(w.cred.id, b64urlDecode(nonce), kiosk.kioskId, ts)),
      ),
    };
    expect((await kioskCall('POST', '/kiosk/identify', online)).json().status).toBe('IDENTIFIED');
    const base = {
      seq: 1,
      occurredAt: new Date().toISOString(),
      kind: 'BORROW' as const,
      returnLines: [],
      borrowLines: [{ equipmentId: w.cable.id, quantity: 1 }],
    };
    const replayed = {
      ...base,
      txId: randomUUID(),
      studentId: w.brice.id,
      method: 'HCE',
      evidence: { type: 'HCE', ...online },
    };
    const forged = {
      ...base,
      seq: 2,
      txId: randomUUID(),
      studentId: w.ama.id,
      method: 'MANUAL',
      evidence: { type: 'ASSISTANT', assistantId: w.assistant.id, mac: 'A'.repeat(43) },
    };
    await t.prisma.cardBinding.updateMany({ where: { studentId: w.ama.id }, data: { cardTech: 'DESFIRE_EV3' } });
    await setSettings(t, { cardAuthMode: 'DESFIRE_REQUIRED' });
    const cloned = {
      ...base,
      seq: 3,
      txId: randomUUID(),
      studentId: w.ama.id,
      method: 'CARD',
      evidence: { type: 'CARD', uidLookup: 'AAAA', uid: w.uid },
    };
    const sync = (bundleVersion: number) =>
      kioskCall('POST', '/kiosk/offline-sync', {
        offlineFrom: new Date(Date.now() - 600_000).toISOString(),
        offlineTo: new Date().toISOString(),
        bundleVersion,
        transactions: [replayed, forged, cloned],
      });
    const r = (await sync(bundle.version)).json();
    expect(r.applied).toEqual([]);
    expect(r.conflicts.map((c: { reason: string }) => c.reason)).toEqual([
      'INVALID_EVIDENCE',
      'INVALID_EVIDENCE',
      'INVALID_EVIDENCE',
    ]);
    // Conflict payloads never keep the raw card UID.
    expect(JSON.stringify(await t.prisma.offlineSyncConflict.findMany())).not.toContain(w.uid);
    // A bundle version the server never issued is refused outright.
    const unknown = (
      await kioskCall('POST', '/kiosk/offline-sync', {
        offlineFrom: new Date(Date.now() - 600_000).toISOString(),
        offlineTo: new Date().toISOString(),
        bundleVersion: 999,
        transactions: [{ ...cloned, txId: randomUUID() }],
      })
    ).json();
    expect(unknown.conflicts).toEqual([expect.objectContaining({ reason: 'BUNDLE_EXPIRED' })]);
    expect((await t.prisma.equipment.findUniqueOrThrow({ where: { id: w.cable.id } })).availableQuantity).toBe(10);
  });
});
