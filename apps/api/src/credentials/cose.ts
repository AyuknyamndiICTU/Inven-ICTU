/**
 * Minimal CBOR decoder for COSE EC2 public keys (RFC 9052/9053) and conversion to DER SubjectPublicKeyInfo,
 * so passkeys can be verified with the same node:crypto path as Android device keys (and offline at the kiosk).
 */

type CborValue = number | Uint8Array | string | Map<CborValue, CborValue> | CborValue[] | boolean | null;

function readHead(buf: Uint8Array, o: number): { major: number; value: number; next: number } {
  const first = buf[o];
  if (first === undefined) throw new Error('CBOR: truncated');
  const major = first >> 5;
  const info = first & 0x1f;
  if (info < 24) return { major, value: info, next: o + 1 };
  if (info === 24) return { major, value: buf[o + 1]!, next: o + 2 };
  if (info === 25) return { major, value: (buf[o + 1]! << 8) | buf[o + 2]!, next: o + 3 };
  if (info === 26)
    return {
      major,
      value: ((buf[o + 1]! << 24) >>> 0) + (buf[o + 2]! << 16) + (buf[o + 3]! << 8) + buf[o + 4]!,
      next: o + 5,
    };
  throw new Error('CBOR: unsupported length encoding');
}

export function decodeCbor(buf: Uint8Array, offset = 0, depth = 0): { value: CborValue; next: number } {
  if (depth > 8) throw new Error('CBOR: too deep');
  const { major, value, next } = readHead(buf, offset);
  switch (major) {
    case 0:
      return { value, next };
    case 1:
      return { value: -1 - value, next };
    case 2:
      return { value: buf.slice(next, next + value), next: next + value };
    case 3:
      return { value: new TextDecoder().decode(buf.slice(next, next + value)), next: next + value };
    case 4: {
      const arr: CborValue[] = [];
      let p = next;
      for (let i = 0; i < value; i++) {
        const r = decodeCbor(buf, p, depth + 1);
        arr.push(r.value);
        p = r.next;
      }
      return { value: arr, next: p };
    }
    case 5: {
      const map = new Map<CborValue, CborValue>();
      let p = next;
      for (let i = 0; i < value; i++) {
        const k = decodeCbor(buf, p, depth + 1);
        const v = decodeCbor(buf, k.next, depth + 1);
        map.set(k.value, v.value);
        p = v.next;
      }
      return { value: map, next: p };
    }
    case 7:
      if (value === 20) return { value: false, next };
      if (value === 21) return { value: true, next };
      if (value === 22) return { value: null, next };
      throw new Error('CBOR: unsupported simple value');
    default:
      throw new Error(`CBOR: unsupported major type ${major}`);
  }
}

// DER prefix of a P-256 SubjectPublicKeyInfo (id-ecPublicKey, prime256v1, BIT STRING of 66 bytes).
const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce,
  0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

/** Converts a COSE EC2 P-256 / ES256 key to DER SPKI. Returns null for any other key type or algorithm. */
export function coseEc2ToSpki(cose: Uint8Array): Uint8Array | null {
  try {
    const { value } = decodeCbor(cose);
    if (!(value instanceof Map)) return null;
    const kty = value.get(1);
    const alg = value.get(3);
    const crv = value.get(-1);
    const x = value.get(-2);
    const y = value.get(-3);
    if (
      kty !== 2 ||
      alg !== -7 ||
      crv !== 1 ||
      !(x instanceof Uint8Array) ||
      !(y instanceof Uint8Array) ||
      x.length !== 32 ||
      y.length !== 32
    )
      return null;
    const out = new Uint8Array(P256_SPKI_PREFIX.length + 65);
    out.set(P256_SPKI_PREFIX);
    out[P256_SPKI_PREFIX.length] = 0x04;
    out.set(x, P256_SPKI_PREFIX.length + 1);
    out.set(y, P256_SPKI_PREFIX.length + 33);
    return out;
  } catch {
    return null;
  }
}
