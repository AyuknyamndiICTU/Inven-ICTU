/**
 * Node-only helpers for the tap protocol (node:crypto). Used by the API and the kiosk main process
 * (offline verification). Browsers and React Native use WebCrypto / native code instead.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { hceMessage, passkeyChallengeInput, popMessage, scanMessage } from './protocol';

export * from './index';
export * from './desfire';

/** Verifies an ECDSA P-256/SHA-256 DER signature against a DER SubjectPublicKeyInfo. Never throws on bad input. */
export function verifyDerSignature(spkiDer: Uint8Array, message: Uint8Array, derSignature: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(spkiDer), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return false;
    return verify('sha256', message, { key, dsaEncoding: 'der' }, derSignature);
  } catch {
    return false;
  }
}

/** True when `spkiDer` is a valid P-256 public key (enrollment check). */
export function isP256Spki(spkiDer: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(spkiDer), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}

export function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

export function passkeyChallenge(kioskId: string, nonce: Uint8Array): Uint8Array {
  return sha256(passkeyChallengeInput(kioskId, nonce));
}

export interface HceEvidence {
  credentialId: string;
  nonce: Uint8Array;
  kioskId: string;
  ts: number;
  signature: Uint8Array;
}

export function verifyHceEvidence(spkiDer: Uint8Array, e: HceEvidence): boolean {
  return verifyDerSignature(spkiDer, hceMessage(e.credentialId, e.nonce, e.kioskId, e.ts), e.signature);
}

export function verifyScanEvidence(spkiDer: Uint8Array, e: HceEvidence): boolean {
  return verifyDerSignature(spkiDer, scanMessage(e.credentialId, e.nonce, e.kioskId, e.ts), e.signature);
}

export function verifyPopSignature(
  spkiDer: Uint8Array,
  sessionId: string,
  popNonce: Uint8Array,
  sig: Uint8Array,
): boolean {
  return verifyDerSignature(spkiDer, popMessage(sessionId, popNonce), sig);
}

// ───────────── Test/dev helpers (simulated phones, FakeReader, vectors) ─────────────

export interface DeviceKeyPair {
  spki: Uint8Array;
  pkcs8: Uint8Array;
}

export function generateDeviceKey(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    spki: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' })),
    pkcs8: new Uint8Array(privateKey.export({ format: 'der', type: 'pkcs8' })),
  };
}

export function signDer(pkcs8Der: Uint8Array, message: Uint8Array): Uint8Array {
  const key = createPrivateKey({ key: Buffer.from(pkcs8Der), format: 'der', type: 'pkcs8' });
  return new Uint8Array(sign('sha256', message, { key, dsaEncoding: 'der' }));
}
