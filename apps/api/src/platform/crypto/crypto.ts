import { hash, verify } from '@node-rs/argon2';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

// ───────────── Passwords & PINs (argon2id) ─────────────

/** Production uses the library's secure defaults; tests use a cheap profile so suites stay fast on modest machines. */
const ARGON2_OPTS = process.env.NODE_ENV === 'test' ? { memoryCost: 1024, timeCost: 1, parallelism: 1 } : undefined;

export function hashSecret(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTS);
}

export async function verifySecret(hashed: string | null | undefined, plain: string): Promise<boolean> {
  if (!hashed) {
    // Spend comparable time so missing accounts are not distinguishable by timing.
    await hash(plain, ARGON2_OPTS);
    return false;
  }
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

// ───────────── Random values ─────────────

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const randomOtp = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const sha256Hex = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O, 1/I/L, U
/** Human-friendly code such as "K7QM-4XPA" (kiosk registration). */
export function randomCode(groups = 2, groupLength = 4): string {
  return Array.from({ length: groups }, () =>
    Array.from({ length: groupLength }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join(''),
  ).join('-');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ───────────── Keyed hashes ─────────────

export function hmacB64(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

/** Card UIDs are stored only as HMAC(pepper, upper-case hex UID). */
export function uidHmac(pepper: string, uidHex: string): string {
  return hmacB64(pepper, `uid:${uidHex.toUpperCase()}`);
}

/** OTP / PIN-style codes are stored only as HMAC(secret, purpose:subject:code). */
export function codeHash(secret: string, purpose: string, subject: string, code: string): string {
  return hmacB64(secret, `${purpose}:${subject}:${code}`);
}

// ───────────── AES-256-GCM secret box (secrets at rest) ─────────────

export class SecretBox {
  private readonly key: Buffer;
  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('DATA_KEY must be 32 bytes');
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join(
      '.',
    );
  }

  open(sealed: string): string {
    const [v, iv, ct, tag] = sealed.split('.');
    if (v !== 'v1' || !iv || ct === undefined || !tag) throw new Error('Unsupported secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }
}

// ───────────── Signed tokens (kiosk sessions, student access tokens, file URLs) ─────────────

export type TokenKind = 'ksess' | 'sat' | 'mlook' | 'file';

export class TokenSigner {
  constructor(private readonly secret: string) {}

  sign<T extends object>(
    kind: TokenKind,
    payload: T,
    ttlSec: number,
    now = Date.now(),
  ): { token: string; expiresAt: Date } {
    const exp = Math.floor(now / 1000) + ttlSec;
    const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
    const sig = hmacB64(this.secret, `${kind}.${body}`);
    return { token: `${kind}.${body}.${sig}`, expiresAt: new Date(exp * 1000) };
  }

  verify<T extends object>(
    kind: TokenKind,
    token: string | undefined | null,
    now = Date.now(),
  ): (T & { exp: number }) | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== kind) return null;
    const expected = hmacB64(this.secret, `${kind}.${parts[1]}`);
    if (!safeEqual(expected, parts[2]!)) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as T & { exp: number };
      if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
      return payload;
    } catch {
      return null;
    }
  }
}
