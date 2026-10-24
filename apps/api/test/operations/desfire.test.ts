import { bytesToHex, hexToBytes } from '@labpass/contracts/tap';
import { diversifyAn10922, FakeDesfireCard } from '@labpass/contracts/tap-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CardKeyStore } from '../../src/cards/card-auth.module';
import { loadApiEnv } from '../../src/config/env';
import { uidHmac } from '../../src/platform/crypto/crypto';
import { bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { makeStudent } from '../helpers/identity';
import { makeEquipment, setSettings, signIn } from '../helpers/lending';

const MASTER_HEX = '0F1E2D3C4B5A69788796A5B4C3D2E1F0';
const MASTER = hexToBytes(MASTER_HEX);
const UID = '04A1B2C3D4E580';

describe('DESFire EV3 relayed authentication (S06.5)', () => {
  let t: TestApp;
  let kiosk: { kioskId: string; token: string };
  const bodies: string[] = [];

  beforeAll(async () => {
    t = await bootTestApp({ DESFIRE_LAK_KEYS: `1:${MASTER_HEX}` });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    kiosk = await registerKiosk(t);
    await setSettings(t, { cardAuthMode: 'DESFIRE_PREFERRED' });
  });

  async function bind(cardTech: 'DESFIRE_EV3' | 'OTHER' = 'DESFIRE_EV3', uid = UID) {
    const s = await makeStudent(t);
    await t.prisma.cardBinding.create({
      data: {
        studentId: s.id,
        uidHmac: uidHmac(t.env.UID_PEPPER, uid),
        uidSuffix: uid.slice(-4),
        createdVia: 'SUPPLIER_FILE',
        cardTech,
        keyVersion: 1,
      },
    });
    return s;
  }

  const post = async (url: string, payload: Record<string, unknown>, token = kiosk.token) => {
    const res = await t.request({ method: 'POST', url, bearer: token, origin: null, payload });
    bodies.push(res.body);
    return res;
  };

  /** What the kiosk's DesfireRelay does: start, then forward each APDU to the card and the answer back. */
  async function relay(card: { transmit(apdu: Uint8Array): Uint8Array }, uid = UID) {
    let r = (await post('/kiosk/card-auth/start', { uid })).json();
    while (r.status === 'CONTINUE') {
      const answer = card.transmit(hexToBytes(r.apdu));
      const res = await post('/kiosk/card-auth/step', { sessionId: r.sessionId, response: bytesToHex(answer) });
      if (res.statusCode !== 200) return res.json();
      r = res.json();
    }
    return r;
  }

  it('identifies a genuine card after mutual AES authentication (no UID_ONLY flag)', async () => {
    const s = await bind();
    const r = await relay(FakeDesfireCard.personalised(MASTER, hexToBytes(UID)));
    expect(r).toMatchObject({
      status: 'DONE',
      result: { status: 'IDENTIFIED', method: 'CARD', flags: [], student: { id: s.id } },
    });
    const eq = await makeEquipment(t);
    expect(
      (await signIn(t, kiosk.token, r.result.session.token, [{ equipmentId: eq.id, quantity: 1 }])).statusCode,
    ).toBe(201);
  });

  it('PREFERRED: a cloned UID with the wrong key falls back to a flagged UID loan and is counted', async () => {
    await bind();
    const clone = new FakeDesfireCard(
      hexToBytes(UID),
      diversifyAn10922(hexToBytes('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'), hexToBytes(UID)),
    );
    expect(await relay(clone)).toEqual({ status: 'UID_ONLY', reason: 'AUTH_FAILED' });
    expect((await t.prisma.cardBinding.findFirstOrThrow()).authFailures).toBe(1);
    const uidOnly = await post('/kiosk/identify', { method: 'CARD', uid: UID });
    expect(uidOnly.json()).toMatchObject({ status: 'IDENTIFIED', flags: ['UID_ONLY'] });
  });

  it('REQUIRED: refuses clones and plain UID reads of DESFire cards', async () => {
    await bind();
    await setSettings(t, { cardAuthMode: 'DESFIRE_REQUIRED' });
    const clone = new FakeDesfireCard(hexToBytes(UID), null); // e.g. a UID-emulating card without the application
    expect(await relay(clone)).toMatchObject({ code: 'CARD_AUTH_FAILED' });
    expect((await post('/kiosk/identify', { method: 'CARD', uid: UID })).json().code).toBe('CARD_AUTH_REQUIRED');
    expect((await relay(FakeDesfireCard.personalised(MASTER, hexToBytes(UID)))).status).toBe('DONE');
  });

  it('rejects replayed steps, foreign kiosks and timed-out sessions', async () => {
    await bind();
    const card = FakeDesfireCard.personalised(MASTER, hexToBytes(UID));
    const start = (await post('/kiosk/card-auth/start', { uid: UID })).json();
    const answer = bytesToHex(card.transmit(hexToBytes(start.apdu)));
    const other = await registerKiosk(t, 'Second Kiosk');
    expect(
      (await post('/kiosk/card-auth/step', { sessionId: start.sessionId, response: answer }, other.token)).statusCode,
    ).toBe(404);

    const again = (await post('/kiosk/card-auth/start', { uid: UID })).json();
    const a2 = bytesToHex(card.transmit(hexToBytes(again.apdu)));
    expect((await post('/kiosk/card-auth/step', { sessionId: again.sessionId, response: a2 })).json().status).toBe(
      'CONTINUE',
    );
    expect((await post('/kiosk/card-auth/step', { sessionId: again.sessionId, response: a2 })).statusCode).toBe(404); // replay

    const slow = (await post('/kiosk/card-auth/start', { uid: UID })).json();
    await t.redis.client.pexpire(`cas:${slow.sessionId}`, 1);
    await new Promise((r) => setTimeout(r, 20));
    expect((await post('/kiosk/card-auth/step', { sessionId: slow.sessionId, response: '9100' })).statusCode).toBe(404);
  });

  it('handles a card removed mid-authentication, non-DESFire cards, unknown cards and UID mode', async () => {
    await bind();
    const start = (await post('/kiosk/card-auth/start', { uid: UID })).json();
    expect((await post('/kiosk/card-auth/step', { sessionId: start.sessionId, response: '6F00' })).json()).toEqual({
      status: 'UID_ONLY',
      reason: 'APPLICATION_NOT_FOUND',
    });

    await bind('OTHER', '04FFEEDDCCBB');
    expect((await post('/kiosk/card-auth/start', { uid: '04FFEEDDCCBB' })).json()).toEqual({
      status: 'UID_ONLY',
      reason: 'NOT_DESFIRE',
    });
    expect((await post('/kiosk/card-auth/start', { uid: '04000000000001' })).json()).toEqual({
      status: 'DONE',
      result: { status: 'UNKNOWN_CARD', uidSuffix: '0001' },
    });
    await setSettings(t, { cardAuthMode: 'UID' });
    expect((await post('/kiosk/card-auth/start', { uid: UID })).json()).toEqual({
      status: 'UID_ONLY',
      reason: 'MODE_UID',
    });
  });

  it('never exposes key material in responses or logs (I4)', async () => {
    await bind();
    await relay(FakeDesfireCard.personalised(MASTER, hexToBytes(UID)));
    const cardKey = bytesToHex(diversifyAn10922(MASTER, hexToBytes(UID))).toUpperCase();
    const all = [...bodies, ...t.logs].join('\n').toUpperCase();
    expect(all).not.toContain(MASTER_HEX);
    expect(all).not.toContain(cardKey);
  });

  it('reports when no keys are configured', () => {
    const store = new CardKeyStore(
      loadApiEnv({ ...process.env, NODE_ENV: 'test', DESFIRE_LAK_KEYS: '', DESFIRE_KEYS_FILE: './does-not-exist' }),
    );
    expect(store.configured).toBe(false);
    expect(store.cardKey(hexToBytes(UID), 1)).toBeNull();
  });
});
