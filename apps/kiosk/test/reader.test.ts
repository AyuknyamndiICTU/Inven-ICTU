import {
  authFirstApdu,
  b64urlDecode,
  bytesToHex,
  diversifyAn10922,
  DESFIRE,
  ev2FirstAnswer,
  ev2FirstVerify,
  FakeDesfireCard,
  hexToBytes,
  parseDesfireResponse,
  selectLabPassApdu,
  verifyHceEvidence,
} from '@labpass/contracts/tap-node';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { relayDesfire, type CardAuthApi } from '../src/main/reader/desfire-relay';
import {
  desfireCard,
  FakeReader,
  foreignPhone,
  hcePhone,
  lockedPhone,
  uidCard,
  vectorPhone,
} from '../src/main/reader/fake-reader';
import { PcscDriver, type PcscLiteLike, type PcscReaderLike } from '../src/main/reader/pcsc-driver';
import { GET_UID_APDU, TapService, type TapResult } from '../src/main/reader/tap-service';

const vectors = createRequire(__filename)('@labpass/contracts/vectors.json') as {
  ids: { kioskId: string; credentialId: string };
  keys: { device1: { spki: string; pkcs8: string } };
  apdu: { select: string; selectResponse: string; sign: string; signResponse: string };
  malformed: Array<{ name: string; kind: string; hex: string }>;
};

const NONCE = new Uint8Array(16).fill(7);

function setup(opts: { now?: () => number; challenge?: Uint8Array | null } = {}) {
  const reader = new FakeReader();
  const taps: TapResult[] = [];
  const present = vi.fn();
  const tap = new TapService(reader, {
    takeChallenge: () => (opts.challenge === undefined ? NONCE : opts.challenge),
    kioskId: () => vectors.ids.kioskId,
    now: opts.now,
    apduTimeoutMs: 50,
  });
  tap.on('tap', (r) => taps.push(r));
  tap.on('present', present);
  void reader.start();
  const flush = () => new Promise((r) => setTimeout(r, 120));
  return { reader, taps, present, flush };
}

describe('TapService (SELECT-then-UID, ARCH §5 F1/F2)', () => {
  it('reads a plain card: SELECT first, then the UID', async () => {
    const { reader, taps, present, flush } = setup();
    reader.place(uidCard('04A1B2C3D4E5F6'));
    await flush();
    expect(present).toHaveBeenCalledTimes(1);
    expect(taps).toEqual([expect.objectContaining({ kind: 'CARD', uid: '04A1B2C3D4E5F6' })]);
    expect(reader.log.map((l) => l.apdu)).toEqual([vectors.apdu.select, bytesToHex(GET_UID_APDU)]);
  });

  it('signs a pool challenge with an unlocked phone; the signature verifies against the device key', async () => {
    const { reader, taps, flush } = setup({ now: () => 1_793_000_000_000 });
    reader.place(hcePhone(vectors.ids.credentialId, b64urlDecode(vectors.keys.device1.pkcs8)));
    await flush();
    const r = taps[0];
    expect(r?.kind).toBe('HCE');
    if (r?.kind !== 'HCE') return;
    expect(r.credentialId).toBe(vectors.ids.credentialId);
    expect(r.ts).toBe(1_793_000_000_000);
    expect(
      verifyHceEvidence(b64urlDecode(vectors.keys.device1.spki), {
        credentialId: r.credentialId,
        nonce: b64urlDecode(r.nonce),
        kioskId: vectors.ids.kioskId,
        ts: r.ts,
        signature: b64urlDecode(r.signature),
      }),
    ).toBe(true);
    // The SIGN APDU is exactly the protocol layout: 80 10 00 00 28 ‖ nonce ‖ kioskId ‖ ts ‖ 00.
    expect(reader.log[1]?.apdu).toMatch(/^8010000028/);
  });

  it('replays the vector SELECT/SIGN responses', async () => {
    const { reader, taps, flush } = setup();
    reader.place(vectorPhone(vectors.apdu.selectResponse, vectors.apdu.signResponse));
    await flush();
    expect(taps[0]).toMatchObject({ kind: 'HCE', credentialId: vectors.ids.credentialId });
  });

  it.each(
    vectors.malformed.filter(
      (m) => (m.kind === 'selectResponse' || m.kind === 'signResponse') && m.hex.toUpperCase() !== '6A82',
    ),
  )('malformed vector "$name" never yields an identity', async (m) => {
    const { reader, taps, flush } = setup();
    const select = m.kind === 'selectResponse' ? m.hex : vectors.apdu.selectResponse;
    const sign = m.kind === 'signResponse' ? m.hex : vectors.apdu.signResponse;
    reader.place(vectorPhone(select, sign));
    await flush();
    expect(taps[0]?.kind).not.toBe('HCE');
  });

  it('a locked phone (no answer to SELECT) asks to unlock', async () => {
    const { reader, taps, flush } = setup();
    reader.place(lockedPhone());
    await flush();
    expect(taps).toEqual([{ kind: 'ERROR', code: 'PHONE_LOCKED' }]);
  });

  it('a phone without LabPass is not treated as a card (random UID)', async () => {
    const { reader, taps, flush } = setup();
    reader.place(foreignPhone());
    await flush();
    expect(taps).toEqual([{ kind: 'ERROR', code: 'FOREIGN_PHONE' }]);
  });

  it('no challenge available → NO_CHALLENGE, never an unsigned identity', async () => {
    const { reader, taps, flush } = setup({ challenge: null });
    reader.place(hcePhone(vectors.ids.credentialId, b64urlDecode(vectors.keys.device1.pkcs8)));
    await flush();
    expect(taps).toEqual([{ kind: 'ERROR', code: 'NO_CHALLENGE' }]);
  });

  it('debounces the same card for 1.5 s', async () => {
    let t = 0;
    const { reader, taps, flush } = setup({ now: () => t });
    reader.place(uidCard('04A1B2C3D4E5F6'));
    await flush();
    reader.remove();
    t = 1000;
    reader.place(uidCard('04A1B2C3D4E5F6'));
    await flush();
    expect(taps).toHaveLength(1);
    reader.remove();
    t = 2600;
    reader.place(uidCard('04A1B2C3D4E5F6'));
    await flush();
    expect(taps).toHaveLength(2);
  });

  it('an unplugged reader produces no taps', async () => {
    const { reader, taps, flush } = setup();
    reader.unplug();
    reader.place(uidCard('04A1B2C3D4E5F6'));
    await flush();
    expect(taps).toHaveLength(0);
    expect(reader.status).toBe('DISCONNECTED');
  });
});

describe('DesfireRelay (S06.5 kiosk side)', () => {
  const master = new Uint8Array(16).fill(0x42);
  const uid = hexToBytes('04112233445566');

  /** A faithful mini version of the API's CardAuthService (start/step), holding the key server-side. */
  function server(mode: 'PREFERRED' | 'REQUIRED' = 'PREFERRED'): CardAuthApi & { sawKey: boolean } {
    const key = diversifyAn10922(master, uid);
    let phase: 'SELECT' | 'AUTH1' | 'AUTH2' = 'SELECT';
    let rndA: Uint8Array = new Uint8Array();
    const failed = () => {
      if (mode === 'REQUIRED') throw new Error('CARD_AUTH_FAILED');
      return { status: 'UID_ONLY' as const, reason: 'AUTH_FAILED' };
    };
    return {
      sawKey: false,
      start: async () => ({
        status: 'CONTINUE',
        sessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        apdu: bytesToHex(selectLabPassApdu()),
      }),
      step: async (sessionId, response) => {
        const r = parseDesfireResponse(hexToBytes(response));
        if (phase === 'SELECT') {
          if (r?.status !== DESFIRE.STATUS_OK) return failed();
          phase = 'AUTH1';
          return { status: 'CONTINUE', sessionId, apdu: bytesToHex(authFirstApdu()) };
        }
        if (phase === 'AUTH1') {
          if (r?.status !== DESFIRE.STATUS_MORE) return failed();
          const a = ev2FirstAnswer(key, r.data);
          rndA = a.rndA;
          phase = 'AUTH2';
          return { status: 'CONTINUE', sessionId, apdu: bytesToHex(a.apdu) };
        }
        if (r?.status !== DESFIRE.STATUS_OK || !ev2FirstVerify(key, r.data, rndA).ok) return failed();
        return { status: 'DONE', result: { status: 'UNKNOWN_CARD', uidSuffix: '5566' } };
      },
    };
  }

  const handle = (card: FakeDesfireCard) => {
    const fake = desfireCard(card);
    return { atr: fake.atr, transceive: async (apdu: Uint8Array) => fake.respond(apdu) };
  };

  it('relays a full AuthenticateEV2First without ever holding a key', async () => {
    const out = await relayDesfire(handle(FakeDesfireCard.personalised(master, uid)), '04112233445566', server());
    expect(out.kind).toBe('DONE');
  });

  it('a card with the wrong key falls back to UID_ONLY in DESFIRE_PREFERRED', async () => {
    const wrong = FakeDesfireCard.personalised(new Uint8Array(16).fill(1), uid);
    expect(await relayDesfire(handle(wrong), '04112233445566', server())).toEqual({
      kind: 'UID_ONLY',
      reason: 'AUTH_FAILED',
    });
  });

  it('a card pulled away mid-relay sends 6F00 and lets the server decide (REQUIRED → refused)', async () => {
    const gone = { atr: new Uint8Array(), transceive: () => Promise.reject(new Error('Card removed')) };
    await expect(relayDesfire(gone, '04112233445566', server('REQUIRED'))).rejects.toThrow('CARD_AUTH_FAILED');
  });

  it('caps a looping server', async () => {
    const looping: CardAuthApi = {
      start: async () => ({ status: 'CONTINUE', sessionId: 's', apdu: '00' }),
      step: async () => ({ status: 'CONTINUE', sessionId: 's', apdu: '00' }),
    };
    const card = { atr: new Uint8Array(), transceive: async () => Uint8Array.of(0x90, 0x00) };
    expect(await relayDesfire(card, '04112233445566', looping)).toEqual({
      kind: 'UID_ONLY',
      reason: 'RELAY_STEP_LIMIT',
    });
  });
});

describe('PcscDriver (raw PC/SC, ADR-0002)', () => {
  function fakePcsc() {
    const handlers: Record<string, (...a: never[]) => void> = {};
    const readerHandlers: Record<string, (...a: never[]) => void> = {};
    const card = uidCard('04A1B2C3D4E5F6');
    const reader: PcscReaderLike = {
      name: 'ACS ACR1252 1S CL Reader PICC 0',
      state: 0,
      SCARD_STATE_EMPTY: 0x10,
      SCARD_STATE_PRESENT: 0x20,
      SCARD_SHARE_SHARED: 2,
      SCARD_PROTOCOL_T0: 1,
      SCARD_PROTOCOL_T1: 2,
      SCARD_LEAVE_CARD: 0,
      SCARD_CTL_CODE: (c) => 0x310000 + c * 4,
      on: (e: string, cb: (...a: never[]) => void) => {
        readerHandlers[e] = cb;
      },
      connect: (_o, cb) => cb(null, 2),
      transmit: (data, _len, _p, cb) => cb(null, Buffer.from(card.respond(new Uint8Array(data)))),
      control: vi.fn((_d, _c, _l, cb: (e: Error | null, d: Buffer) => void) => cb(null, Buffer.alloc(0))),
      disconnect: (_d, cb) => cb(null),
      close: vi.fn(),
    } as PcscReaderLike;
    const pcsc: PcscLiteLike = {
      on: (e: string, cb: (...a: never[]) => void) => {
        handlers[e] = cb;
      },
      close: vi.fn(),
    } as PcscLiteLike;
    const fire = {
      reader: (r: PcscReaderLike) => (handlers.reader as (r: PcscReaderLike) => void)(r),
      status: (state: number) => {
        (readerHandlers.status as (s: { state: number; atr: Buffer }) => void)({ state, atr: Buffer.from([0x3b]) });
        reader.state = state;
      },
      end: () => (readerHandlers.end as () => void)(),
    };
    return { pcsc, reader, fire };
  }

  it('connects on card present, transmits APDUs, reports removal and unplug', async () => {
    const { pcsc, reader, fire } = fakePcsc();
    const driver = new PcscDriver(() => pcsc);
    const statuses: string[] = [];
    const cards: Array<{ transceive: (a: Uint8Array) => Promise<Uint8Array> }> = [];
    const removed = vi.fn();
    driver.on('status', (s) => statuses.push(s));
    driver.on('card', (c) => cards.push(c));
    driver.on('removed', removed);
    await driver.start();
    fire.reader({ ...reader, name: 'ACS ACR1252 1S CL Reader SAM 0' } as PcscReaderLike);
    expect(statuses).toEqual(['DISCONNECTED']); // SAM slot ignored
    fire.reader(reader);
    fire.status(0x20);
    expect(cards).toHaveLength(1);
    expect(bytesToHex(await cards[0]!.transceive(GET_UID_APDU))).toBe('04A1B2C3D4E5F69000');
    await driver.feedback('ok');
    expect(reader.control).toHaveBeenCalledTimes(2);
    fire.status(0x10);
    expect(removed).toHaveBeenCalledTimes(1);
    await expect(cards[0]!.transceive(GET_UID_APDU)).rejects.toThrow('Card removed');
    fire.end();
    expect(statuses).toEqual(['DISCONNECTED', 'CONNECTED', 'DISCONNECTED']);
  });

  it('a missing native binding is a reader ERROR, not a crash', async () => {
    const driver = new PcscDriver(() => {
      throw new Error('Cannot find module');
    });
    const statuses: string[] = [];
    driver.on('status', (s) => statuses.push(s));
    await driver.start();
    expect(statuses).toEqual(['ERROR']);
  });
});
