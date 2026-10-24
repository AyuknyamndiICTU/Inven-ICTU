/**
 * MIFARE DESFire EV3 helpers for LabPass card authentication (ARCH §6, docs/protocols/card-personalisation-v1.md).
 * Node-only (node:crypto). The API derives keys and runs the authentication; the kiosk only relays APDUs and uses
 * FakeDesfireCard in development. No key ever needs to leave the server.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const LABPASS_AID_LSB = Uint8Array.of(0x31, 0x50, 0x4c); // AID 0x4C5031 ("LP1"), LSB first
export const LABPASS_SYSTEM_ID = new TextEncoder().encode('ICTU-LABPASS');
export const LAK_KEY_NO = 1;

export const DESFIRE = {
  SELECT_APPLICATION: 0x5a,
  AUTHENTICATE_EV2_FIRST: 0x71,
  ADDITIONAL_FRAME: 0xaf,
  STATUS_OK: 0x00,
  STATUS_MORE: 0xaf,
  STATUS_AUTH_ERROR: 0xae,
  STATUS_APP_NOT_FOUND: 0xa0,
  STATUS_NO_SUCH_KEY: 0x40,
  STATUS_ILLEGAL_COMMAND: 0x1c,
  STATUS_ABORTED: 0xca,
} as const;

const ZERO16 = new Uint8Array(16);
const cat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
const xor = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => v ^ b[i]!);
export const rotl1 = (b: Uint8Array) => cat(b.subarray(1), b.subarray(0, 1));
export const bytesEq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

function aesEcb(key: Uint8Array, block: Uint8Array): Uint8Array {
  const c = createCipheriv('aes-128-ecb', key, null).setAutoPadding(false);
  return new Uint8Array(Buffer.concat([c.update(block), c.final()]));
}

/** AES-128-CBC without padding (DESFire uses IV = 0 for each authentication frame). */
export function aesCbcEncrypt(key: Uint8Array, data: Uint8Array, iv: Uint8Array = ZERO16): Uint8Array {
  const c = createCipheriv('aes-128-cbc', key, iv).setAutoPadding(false);
  return new Uint8Array(Buffer.concat([c.update(data), c.final()]));
}

export function aesCbcDecrypt(key: Uint8Array, data: Uint8Array, iv: Uint8Array = ZERO16): Uint8Array {
  const d = createDecipheriv('aes-128-cbc', key, iv).setAutoPadding(false);
  return new Uint8Array(Buffer.concat([d.update(data), d.final()]));
}

function dbl(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = ((b[i]! << 1) | (i < 15 ? b[i + 1]! >> 7 : 0)) & 0xff;
  if (b[0]! & 0x80) out[15] = out[15]! ^ 0x87;
  return out;
}

/** AES-CMAC (NIST SP 800-38B / RFC 4493). */
export function aesCmac(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const k1 = dbl(aesEcb(key, ZERO16));
  const k2 = dbl(k1);
  const n = Math.max(1, Math.ceil(msg.length / 16));
  const complete = msg.length > 0 && msg.length % 16 === 0;
  const tail = msg.subarray((n - 1) * 16);
  const last = complete ? xor(tail, k1) : xor(cat(tail, Uint8Array.of(0x80), new Uint8Array(15 - tail.length)), k2);
  let x: Uint8Array = ZERO16;
  for (let i = 0; i < n - 1; i++) x = aesEcb(key, xor(x, msg.subarray(i * 16, i * 16 + 16)));
  return aesEcb(key, xor(x, last));
}

/** NXP AN10922 AES-128 key diversification: CMAC(K, 0x01 ‖ UID ‖ AID ‖ SystemIdentifier). */
export function diversifyAn10922(
  masterKey: Uint8Array,
  uid: Uint8Array,
  aidLsb: Uint8Array = LABPASS_AID_LSB,
  systemId: Uint8Array = LABPASS_SYSTEM_ID,
): Uint8Array {
  const m = cat(uid, aidLsb, systemId);
  if (m.length > 31) throw new Error('AN10922 diversification input must be at most 31 bytes');
  return aesCmac(masterKey, cat(Uint8Array.of(0x01), m));
}

/** Native DESFire command wrapped in ISO 7816-4: `90 INS 00 00 [Lc data] 00`. */
export function wrapDesfire(ins: number, data: Uint8Array = new Uint8Array()): Uint8Array {
  return data.length
    ? cat(Uint8Array.of(0x90, ins, 0, 0, data.length), data, Uint8Array.of(0))
    : Uint8Array.of(0x90, ins, 0, 0, 0);
}

/** Splits a wrapped response `data ‖ 91 status`. Returns null when it is not a DESFire-wrapped response. */
export function parseDesfireResponse(resp: Uint8Array): { data: Uint8Array; status: number } | null {
  if (resp.length < 2 || resp[resp.length - 2] !== 0x91) return null;
  return { data: resp.subarray(0, resp.length - 2), status: resp[resp.length - 1]! };
}

export const selectLabPassApdu = () => wrapDesfire(DESFIRE.SELECT_APPLICATION, LABPASS_AID_LSB);
export const authFirstApdu = (keyNo = LAK_KEY_NO) =>
  wrapDesfire(DESFIRE.AUTHENTICATE_EV2_FIRST, Uint8Array.of(keyNo, 0x00));

/** PCD side, pass 2: decrypt E(K, RndB) and answer E(K, RndA ‖ RndB'). */
export function ev2FirstAnswer(
  key: Uint8Array,
  encRndB: Uint8Array,
  rndA: Uint8Array = new Uint8Array(randomBytes(16)),
) {
  if (encRndB.length !== 16) throw new Error('RndB must be 16 bytes');
  const rndB = aesCbcDecrypt(key, encRndB);
  return { rndA, apdu: wrapDesfire(DESFIRE.ADDITIONAL_FRAME, aesCbcEncrypt(key, cat(rndA, rotl1(rndB)))) };
}

/** PCD side, pass 3: the card proves the key by returning RndA rotated (inside E(K, TI ‖ RndA' ‖ PDcap2 ‖ PCDcap2)). */
export function ev2FirstVerify(key: Uint8Array, enc: Uint8Array, rndA: Uint8Array): { ok: boolean; ti: Uint8Array } {
  if (enc.length !== 32) return { ok: false, ti: new Uint8Array() };
  const dec = aesCbcDecrypt(key, enc);
  return { ok: bytesEq(dec.subarray(4, 20), rotl1(rndA)), ti: dec.subarray(0, 4) };
}

/**
 * A personalised LabPass card for tests and the kiosk FakeReader: answers GET UID, SelectApplication and the two
 * AuthenticateEV2First frames. `lak: null` models a card without the LabPass application.
 */
export class FakeDesfireCard {
  private selected = false;
  private pending: { rndB: Uint8Array } | null = null;

  constructor(
    readonly uid: Uint8Array,
    private readonly lak: Uint8Array | null,
  ) {}

  static personalised(masterLak: Uint8Array, uid: Uint8Array) {
    return new FakeDesfireCard(uid, diversifyAn10922(masterLak, uid));
  }

  private status(s: number, data: Uint8Array = new Uint8Array()) {
    return cat(data, Uint8Array.of(0x91, s));
  }

  transmit(apdu: Uint8Array): Uint8Array {
    if (apdu.length >= 5 && apdu[0] === 0xff && apdu[1] === 0xca) return cat(this.uid, Uint8Array.of(0x90, 0x00));
    if (apdu[0] !== 0x90 || apdu.length < 5) return Uint8Array.of(0x6e, 0x00);
    const ins = apdu[1]!;
    const data = apdu.length > 5 ? apdu.subarray(5, 5 + apdu[4]!) : new Uint8Array();
    if (ins === DESFIRE.SELECT_APPLICATION) {
      this.pending = null;
      this.selected = Boolean(this.lak) && bytesEq(data, LABPASS_AID_LSB);
      return this.status(this.selected ? DESFIRE.STATUS_OK : DESFIRE.STATUS_APP_NOT_FOUND);
    }
    if (ins === DESFIRE.AUTHENTICATE_EV2_FIRST) {
      if (!this.selected || !this.lak) return this.status(DESFIRE.STATUS_AUTH_ERROR);
      if (data[0] !== LAK_KEY_NO) return this.status(DESFIRE.STATUS_NO_SUCH_KEY);
      const rndB = new Uint8Array(randomBytes(16));
      this.pending = { rndB };
      return this.status(DESFIRE.STATUS_MORE, aesCbcEncrypt(this.lak, rndB));
    }
    if (ins === DESFIRE.ADDITIONAL_FRAME) {
      const p = this.pending;
      this.pending = null;
      if (!p || !this.lak || data.length !== 32) return this.status(DESFIRE.STATUS_ABORTED);
      const dec = aesCbcDecrypt(this.lak, data);
      if (!bytesEq(dec.subarray(16, 32), rotl1(p.rndB))) return this.status(DESFIRE.STATUS_AUTH_ERROR);
      const answer = cat(new Uint8Array(randomBytes(4)), rotl1(dec.subarray(0, 16)), new Uint8Array(12));
      return this.status(DESFIRE.STATUS_OK, aesCbcEncrypt(this.lak, answer));
    }
    return this.status(DESFIRE.STATUS_ILLEGAL_COMMAND);
  }
}
