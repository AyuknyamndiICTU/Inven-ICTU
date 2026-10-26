import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Offline lab-assistant confirmation (S13 findings 1 and 4). The bundle never ships a PIN hash. Instead it ships:
 * - `pinParams`: the argon2id parameters and salt (the encoded hash minus its digest);
 * - `wrappedKey`: a per-kiosk, per-bundle MAC key sealed under SHA-256(argon2 digest).
 * Only the right PIN reproduces the digest, so only the right PIN unwraps the key, and every offline transaction the
 * assistant confirms carries an HMAC the server recomputes at sync.
 */

const WRAP_INFO = 'labpass-offline-assistant-wrap-v1';
export const ASSISTANT_HASH_LENGTH = 32;

/** `$argon2id$v=19$m=…,t=…,p=…$<salt>$<digest>` → params+salt and the raw digest. */
export function splitArgon2(encoded: string): { pinParams: string; digest: Buffer } | null {
  const i = encoded.lastIndexOf('$');
  if (!encoded.startsWith('$argon2id$') || i < 0) return null;
  const digest = Buffer.from(encoded.slice(i + 1), 'base64');
  if (digest.length !== ASSISTANT_HASH_LENGTH) return null;
  return { pinParams: encoded.slice(0, i), digest };
}

export function assistantMacKey(appSecret: string, assistantId: string, kioskId: string, keyVersion: number): Buffer {
  return createHmac('sha256', appSecret).update(`offline-assistant:${assistantId}:${kioskId}:${keyVersion}`).digest();
}

export function wrapKeyFromDigest(digest: Uint8Array): Buffer {
  return createHash('sha256').update(WRAP_INFO).update(digest).digest();
}

/** AES-256-GCM: iv(12) ‖ ciphertext ‖ tag(16), base64url. */
export function wrapMacKey(digest: Uint8Array, macKey: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', wrapKeyFromDigest(digest), iv);
  const ct = Buffer.concat([c.update(macKey), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64url');
}

export function txMac(macKey: Buffer, input: string): string {
  return createHmac('sha256', macKey).update(input).digest('base64url');
}
