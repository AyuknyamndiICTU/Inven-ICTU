import { describe, expect, it } from 'vitest';
import {
  aesCmac,
  authFirstApdu,
  diversifyAn10922,
  ev2FirstAnswer,
  ev2FirstVerify,
  FakeDesfireCard,
  parseDesfireResponse,
  selectLabPassApdu,
} from './desfire';
import { bytesToHex, hexToBytes } from './encoding';

const hex = (s: string) => hexToBytes(s.replace(/\s/g, ''));

describe('AES-CMAC (RFC 4493 vectors)', () => {
  const key = hex('2b7e1516 28aed2a6 abf71588 09cf4f3c');
  const msg = hex(
    '6bc1bee2 2e409f96 e93d7e11 7393172a ae2d8a57 1e03ac9c 9eb76fac 45af8e51 30c81c46 a35ce411 e5fbc119 1a0a52ef f69f2445 df4f9b17 ad2b417b e66c3710',
  );
  it.each([
    [0, 'bb1d6929e95937287fa37d129b756746'],
    [16, '070a16b46b4d4144f79bdd9dd04a287c'],
    [40, 'dfa66747de9ae63030ca32611497c827'],
    [64, '51f0bebf7e3b9d92fc49741779363cfe'],
  ])('message length %i', (len, mac) => {
    expect(bytesToHex(aesCmac(key, msg.subarray(0, len))).toLowerCase()).toBe(mac);
  });
});

describe('NXP AN10922 key diversification', () => {
  it('matches the AES-128 example of AN10922 §2.2.1', () => {
    const key = diversifyAn10922(
      hex('00112233445566778899AABBCCDDEEFF'),
      hex('04782E21801D80'),
      hex('3042F5'),
      hex('4E585020416275'),
    );
    expect(bytesToHex(key).toUpperCase()).toBe('A8DD63A3B89D54B37CA802473FDA9175');
  });

  it('gives every card its own key', () => {
    const master = hex('0F1E2D3C4B5A69788796A5B4C3D2E1F0');
    expect(bytesToHex(diversifyAn10922(master, hex('04A1B2C3D4E580')))).not.toBe(
      bytesToHex(diversifyAn10922(master, hex('04A1B2C3D4E581'))),
    );
  });
});

describe('AuthenticateEV2First against the card simulator', () => {
  const master = hex('0F1E2D3C4B5A69788796A5B4C3D2E1F0');
  const uid = hex('04A1B2C3D4E580');

  function run(card: FakeDesfireCard, key: Uint8Array) {
    expect(parseDesfireResponse(card.transmit(selectLabPassApdu()))?.status).toBe(0x00);
    const part1 = parseDesfireResponse(card.transmit(authFirstApdu()))!;
    if (part1.status !== 0xaf) return { ok: false, status: part1.status };
    const { rndA, apdu } = ev2FirstAnswer(key, part1.data);
    const part2 = parseDesfireResponse(card.transmit(apdu))!;
    if (part2.status !== 0x00) return { ok: false, status: part2.status };
    return { ...ev2FirstVerify(key, part2.data, rndA), status: 0 };
  }

  it('authenticates a personalised card with the diversified key', () => {
    const card = FakeDesfireCard.personalised(master, uid);
    expect(run(card, diversifyAn10922(master, uid)).ok).toBe(true);
  });

  it('fails with the wrong key (card answers 91 AE)', () => {
    const card = FakeDesfireCard.personalised(master, uid);
    expect(run(card, diversifyAn10922(hex('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'), uid))).toMatchObject({
      ok: false,
      status: 0xae,
    });
  });

  it('reports a card without the LabPass application', () => {
    const card = new FakeDesfireCard(uid, null);
    expect(parseDesfireResponse(card.transmit(selectLabPassApdu()))?.status).toBe(0xa0);
  });

  it('rejects a second frame without a first one', () => {
    const card = FakeDesfireCard.personalised(master, uid);
    card.transmit(selectLabPassApdu());
    const { apdu } = ev2FirstAnswer(diversifyAn10922(master, uid), new Uint8Array(16));
    expect(parseDesfireResponse(card.transmit(apdu))?.status).toBe(0xca);
  });
});
