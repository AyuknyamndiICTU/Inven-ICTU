import {
  TapProtocolError,
  b64urlDecode,
  b64urlEncode,
  bytesEqual,
  bytesToUuid,
  concatBytes,
  hexToBytes,
  isDerEcdsaSignature,
  readU64be,
  u64be,
  utf8,
  uuidToBytes,
} from './encoding';

/** ICTU Tap Protocol v1 — normative spec: docs/protocols/tap-protocol-v1.md (ARCH §6). */
export const TAP_VERSION = 1;
export const AID_HEX = 'F0494354554C5001';
export const AID = hexToBytes(AID_HEX);
export const CLA_ISO = 0x00;
export const CLA_PROPRIETARY = 0x80;
export const INS_SELECT = 0xa4;
export const INS_SIGN = 0x10;
export const NONCE_LENGTH = 16;
export const SIGN_LC = 40; // nonce(16) + kioskId(16) + ts(8)

export const SW = {
  OK: 0x9000,
  FILE_NOT_FOUND: 0x6a82,
  SECURITY_NOT_SATISFIED: 0x6982,
  WRONG_LENGTH: 0x6700,
  INS_NOT_SUPPORTED: 0x6d00,
  CLA_NOT_SUPPORTED: 0x6e00,
} as const;

export const PREFIX = {
  HCE: 'ICTU-LP1-HCE',
  SCAN: 'ICTU-LP1-SCAN',
  POP: 'ICTU-LP1-POP',
  PASSKEY: 'ICTU-LP1-PK',
} as const;

const swBytes = (sw: number) => Uint8Array.of((sw >> 8) & 0xff, sw & 0xff);
const readSw = (resp: Uint8Array) => (resp[resp.length - 2]! << 8) | resp[resp.length - 1]!;

// ───────────── Kiosk side: build commands, parse responses ─────────────

/** `00 A4 04 00 08 F0494354554C5001 00` */
export function buildSelectApdu(): Uint8Array {
  return concatBytes(Uint8Array.of(CLA_ISO, INS_SELECT, 0x04, 0x00, AID.length), AID, Uint8Array.of(0x00));
}

export function parseSelectResponse(resp: Uint8Array): { version: number; credentialId: string } {
  if (resp.length < 2) throw new TapProtocolError('MALFORMED', 'response too short');
  const sw = readSw(resp);
  if (sw !== SW.OK) throw new TapProtocolError('STATUS_WORD', `SELECT failed with ${sw.toString(16)}`, sw);
  if (resp.length !== 1 + 16 + 2) throw new TapProtocolError('BAD_LENGTH', 'SELECT response must be 19 bytes');
  if (resp[0] !== TAP_VERSION) throw new TapProtocolError('BAD_VERSION', `unsupported version ${resp[0]}`);
  return { version: resp[0], credentialId: bytesToUuid(resp.subarray(1, 17)) };
}

/** `80 10 00 00 28 ‖ nonce(16) ‖ kioskId(16) ‖ ts(8, BE ms) ‖ 00` */
export function buildSignApdu(nonce: Uint8Array, kioskId: string, ts: number): Uint8Array {
  if (nonce.length !== NONCE_LENGTH) throw new TapProtocolError('BAD_LENGTH', 'nonce must be 16 bytes');
  return concatBytes(
    Uint8Array.of(CLA_PROPRIETARY, INS_SIGN, 0x00, 0x00, SIGN_LC),
    nonce,
    uuidToBytes(kioskId),
    u64be(ts),
    Uint8Array.of(0x00),
  );
}

export function parseSignResponse(resp: Uint8Array): Uint8Array {
  if (resp.length < 2) throw new TapProtocolError('MALFORMED', 'response too short');
  const sw = readSw(resp);
  if (sw !== SW.OK) throw new TapProtocolError('STATUS_WORD', `SIGN failed with ${sw.toString(16)}`, sw);
  const sig = resp.subarray(0, resp.length - 2);
  if (!isDerEcdsaSignature(sig)) throw new TapProtocolError('BAD_SIGNATURE_FORMAT', 'signature is not ECDSA DER');
  return sig;
}

// ───────────── Phone side (reference implementation of the Android HostApduService logic) ─────────────

export type ParsedCommand =
  { kind: 'SELECT' } | { kind: 'SIGN'; nonce: Uint8Array; kioskId: string; ts: number } | { kind: 'ERROR'; sw: number };

export function parseCommandApdu(apdu: Uint8Array): ParsedCommand {
  if (apdu.length < 4) return { kind: 'ERROR', sw: SW.WRONG_LENGTH };
  const [cla, ins, p1, p2] = [apdu[0]!, apdu[1]!, apdu[2]!, apdu[3]!];
  if (cla === CLA_ISO && ins === INS_SELECT) {
    if (p1 !== 0x04 || p2 !== 0x00 || apdu.length < 5) return { kind: 'ERROR', sw: SW.WRONG_LENGTH };
    const lc = apdu[4]!;
    if (apdu.length < 5 + lc) return { kind: 'ERROR', sw: SW.WRONG_LENGTH };
    return bytesEqual(apdu.subarray(5, 5 + lc), AID) ? { kind: 'SELECT' } : { kind: 'ERROR', sw: SW.FILE_NOT_FOUND };
  }
  if (cla === CLA_PROPRIETARY) {
    if (ins !== INS_SIGN) return { kind: 'ERROR', sw: SW.INS_NOT_SUPPORTED };
    if (apdu.length !== 5 + SIGN_LC + 1 || apdu[4] !== SIGN_LC) return { kind: 'ERROR', sw: SW.WRONG_LENGTH };
    const body = apdu.subarray(5, 5 + SIGN_LC);
    return {
      kind: 'SIGN',
      nonce: body.slice(0, 16),
      kioskId: bytesToUuid(body.subarray(16, 32)),
      ts: readU64be(body, 32),
    };
  }
  return { kind: 'ERROR', sw: SW.CLA_NOT_SUPPORTED };
}

export function selectResponse(credentialId: string | null): Uint8Array {
  if (!credentialId) return swBytes(SW.FILE_NOT_FOUND);
  return concatBytes(Uint8Array.of(TAP_VERSION), uuidToBytes(credentialId), swBytes(SW.OK));
}

export function signResponse(derSignature: Uint8Array): Uint8Array {
  return concatBytes(derSignature, swBytes(SW.OK));
}

export function statusResponse(sw: number): Uint8Array {
  return swBytes(sw);
}

// ───────────── Signed messages ─────────────

export function hceMessage(credentialId: string, nonce: Uint8Array, kioskId: string, ts: number): Uint8Array {
  return concatBytes(utf8(PREFIX.HCE), uuidToBytes(credentialId), nonce, uuidToBytes(kioskId), u64be(ts));
}

export function scanMessage(credentialId: string, nonce: Uint8Array, kioskId: string, ts: number): Uint8Array {
  return concatBytes(utf8(PREFIX.SCAN), uuidToBytes(credentialId), nonce, uuidToBytes(kioskId), u64be(ts));
}

/** Enrollment proof of possession: the new device key signs the server's popNonce for this session. */
export function popMessage(sessionId: string, popNonce: Uint8Array): Uint8Array {
  return concatBytes(utf8(PREFIX.POP), uuidToBytes(sessionId), popNonce);
}

/** Pre-image of the WebAuthn challenge for a passkey scan; the challenge is SHA-256 of these bytes. */
export function passkeyChallengeInput(kioskId: string, nonce: Uint8Array): Uint8Array {
  return concatBytes(utf8(PREFIX.PASSKEY), uuidToBytes(kioskId), nonce);
}

// ───────────── QR payloads ─────────────

export type KioskChallengeQr = { kioskId: string; nonce: Uint8Array };
export type DeviceKeyResponseQr = { credentialId: string; nonce: Uint8Array; ts: number; signature: Uint8Array };
export type PasskeyResponseQr = {
  credentialId: string;
  nonce: Uint8Array;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
};

export function formatKioskChallengeQr(q: KioskChallengeQr): string {
  return `LPK1.${b64urlEncode(uuidToBytes(q.kioskId))}.${b64urlEncode(q.nonce)}`;
}

export function parseKioskChallengeQr(text: string): KioskChallengeQr {
  const parts = text.trim().split('.');
  if (parts[0] !== 'LPK1') throw new TapProtocolError('BAD_PREFIX', 'not a LabPass kiosk code');
  if (parts.length !== 3) throw new TapProtocolError('MALFORMED', 'LPK1 needs 3 fields');
  const kioskId = b64urlDecode(parts[1]!);
  const nonce = b64urlDecode(parts[2]!);
  if (kioskId.length !== 16 || nonce.length !== NONCE_LENGTH)
    throw new TapProtocolError('BAD_LENGTH', 'bad LPK1 field length');
  return { kioskId: bytesToUuid(kioskId), nonce };
}

export function formatDeviceKeyResponseQr(q: DeviceKeyResponseQr): string {
  return [
    'LPR1',
    b64urlEncode(uuidToBytes(q.credentialId)),
    b64urlEncode(q.nonce),
    String(q.ts),
    b64urlEncode(q.signature),
  ].join('.');
}

export function formatPasskeyResponseQr(q: PasskeyResponseQr): string {
  return [
    'LPR2',
    b64urlEncode(uuidToBytes(q.credentialId)),
    b64urlEncode(q.nonce),
    b64urlEncode(q.authenticatorData),
    b64urlEncode(q.clientDataJSON),
    b64urlEncode(q.signature),
  ].join('.');
}

export type ParsedResponseQr =
  ({ kind: 'DEVICE_KEY' } & DeviceKeyResponseQr) | ({ kind: 'PASSKEY' } & PasskeyResponseQr);

export function parseResponseQr(text: string): ParsedResponseQr {
  const parts = text.trim().split('.');
  const tag = parts[0];
  const readCommon = () => {
    const cred = b64urlDecode(parts[1] ?? '');
    const nonce = b64urlDecode(parts[2] ?? '');
    if (cred.length !== 16 || nonce.length !== NONCE_LENGTH)
      throw new TapProtocolError('BAD_LENGTH', 'bad id/nonce length');
    return { credentialId: bytesToUuid(cred), nonce };
  };
  if (tag === 'LPR1') {
    if (parts.length !== 5) throw new TapProtocolError('MALFORMED', 'LPR1 needs 5 fields');
    const tsText = parts[3]!;
    if (!/^\d{1,16}$/.test(tsText)) throw new TapProtocolError('MALFORMED', 'bad timestamp');
    const signature = b64urlDecode(parts[4]!);
    if (!isDerEcdsaSignature(signature))
      throw new TapProtocolError('BAD_SIGNATURE_FORMAT', 'signature is not ECDSA DER');
    return { kind: 'DEVICE_KEY', ...readCommon(), ts: Number(tsText), signature };
  }
  if (tag === 'LPR2') {
    if (parts.length !== 6) throw new TapProtocolError('MALFORMED', 'LPR2 needs 6 fields');
    const authenticatorData = b64urlDecode(parts[3]!);
    const clientDataJSON = b64urlDecode(parts[4]!);
    const signature = b64urlDecode(parts[5]!);
    if (authenticatorData.length < 37) throw new TapProtocolError('BAD_LENGTH', 'authenticatorData too short');
    if (!isDerEcdsaSignature(signature))
      throw new TapProtocolError('BAD_SIGNATURE_FORMAT', 'signature is not ECDSA DER');
    return { kind: 'PASSKEY', ...readCommon(), authenticatorData, clientDataJSON, signature };
  }
  throw new TapProtocolError('BAD_PREFIX', 'not a LabPass response code');
}
