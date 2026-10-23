/** Byte helpers shared by the tap protocol. Pure TypeScript so they run in Node, browsers and React Native. */

export class TapProtocolError extends Error {
  constructor(
    public readonly code:
      | 'MALFORMED'
      | 'BAD_PREFIX'
      | 'BAD_VERSION'
      | 'BAD_LENGTH'
      | 'BAD_ENCODING'
      | 'BAD_SIGNATURE_FORMAT'
      | 'STATUS_WORD',
    message: string,
    public readonly statusWord?: number,
  ) {
    super(message);
    this.name = 'TapProtocolError';
  }
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64URL_LOOKUP = new Map([...B64URL].map((c, i) => [c, i] as const));

/** base64url without padding (RFC 4648 §5). */
export function b64urlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]! + B64URL[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]!;
  }
  return out;
}

/** Strict decoder: rejects padding, standard-base64 characters and impossible lengths. */
export function b64urlDecode(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new TapProtocolError('BAD_ENCODING', 'invalid base64url length');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of text) {
    const v = B64URL_LOOKUP.get(ch);
    if (v === undefined) throw new TapProtocolError('BAD_ENCODING', `invalid base64url character "${ch}"`);
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new TapProtocolError('BAD_ENCODING', 'non-canonical base64url trailing bits');
  }
  return Uint8Array.from(out);
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new TapProtocolError('BAD_ENCODING', 'invalid hex');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID → 16 bytes in RFC 4122 network order (the same order as the hex string). */
export function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_RE.test(uuid)) throw new TapProtocolError('BAD_ENCODING', 'invalid UUID');
  return hexToBytes(uuid.replace(/-/g, ''));
}

export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new TapProtocolError('BAD_LENGTH', 'UUID must be 16 bytes');
  const h = bytesToHex(bytes).toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Unsigned 64-bit big-endian (Unix milliseconds fit comfortably in Number). */
export function u64be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new TapProtocolError('MALFORMED', 'timestamp out of range');
  const out = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function readU64be(bytes: Uint8Array, offset = 0): number {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[offset + i]!);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new TapProtocolError('MALFORMED', 'timestamp out of range');
  return Number(v);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Structural check of an ECDSA DER signature: SEQUENCE { INTEGER r, INTEGER s }, each ≤ 33 bytes. */
export function isDerEcdsaSignature(sig: Uint8Array): boolean {
  if (sig.length < 8 || sig.length > 72) return false;
  if (sig[0] !== 0x30 || sig[1] !== sig.length - 2) return false;
  let o = 2;
  for (let k = 0; k < 2; k++) {
    if (sig[o] !== 0x02) return false;
    const len = sig[o + 1]!;
    if (len < 1 || len > 33 || o + 2 + len > sig.length) return false;
    o += 2 + len;
  }
  return o === sig.length;
}
