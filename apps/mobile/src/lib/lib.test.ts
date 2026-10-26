import { formatKioskChallengeQr, parseResponseQr } from '@labpass/contracts/tap';
import { describe, expect, it, vi } from 'vitest';
import { compareVersions, installMode, updateAdvice, validateEnroll } from './app-logic';
import { readKioskQr, passkeyResponseQr } from './kiosk-qr';
import { StudentSession, type TokenStore } from './session';
import {
  assertionToJson,
  b64urlToBytes,
  bytesToB64url,
  creationOptionsFromJson,
  requestOptionsFromJson,
} from './webauthn';

const KIOSK = '7f3a2c10-5b8e-4d21-9a6c-0e4b1d2f3a45';
const CRED = '3c1d9e2a-8b7f-4a6e-9d5c-4b3a2f1e0d9c';

function memStore(refresh: string | null = 'rt-1'): TokenStore & { refresh: string | null; cred: string | null } {
  const s = {
    refresh,
    cred: null as string | null,
    getRefresh: async () => s.refresh,
    setRefresh: async (t: string | null) => void (s.refresh = t),
    getCredentialId: async () => s.cred,
    setCredentialId: async (id: string | null) => void (s.cred = id),
  };
  return s;
}

describe('StudentSession', () => {
  const tokens = (n: number, ttl = 600_000) => ({
    accessToken: `at-${n}`,
    accessExpiresAt: new Date(Date.now() + ttl).toISOString(),
    refreshToken: `rt-${n + 1}`,
  });

  it('shares one refresh between concurrent callers (refresh tokens rotate)', async () => {
    let n = 0;
    const refresh = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return tokens(++n);
    });
    const store = memStore();
    const s = new StudentSession({ store, refresh });
    const [a, b, c] = await Promise.all([s.token(), s.token(), s.token()]);
    expect([a, b, c]).toEqual(['at-1', 'at-1', 'at-1']);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.refresh).toBe('rt-2');
    expect(await s.token()).toBe('at-1'); // cached until shortly before expiry
  });

  it('refreshes early and ends the session on 401, keeps it on network errors', async () => {
    const store = memStore();
    const changes: boolean[] = [];
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 401 }));
    const s = new StudentSession({ store, refresh });
    s.onChange((v) => changes.push(v));
    expect(await s.token()).toBeNull();
    expect(store.refresh).toBe('rt-1');
    expect(await s.token()).toBeNull();
    expect(store.refresh).toBeNull();
    expect(changes).toEqual([false]);
  });

  it('accept() stores the rotated refresh token and the credential id', async () => {
    const store = memStore(null);
    const s = new StudentSession({ store, refresh: vi.fn() });
    await s.accept(tokens(5), CRED);
    expect(await s.token()).toBe('at-5');
    expect(store.refresh).toBe('rt-6');
    expect(store.cred).toBe(CRED);
  });
});

describe('WebAuthn JSON encoding', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(b64urlToBytes(bytesToB64url(bytes))).toEqual(bytes);
    expect(bytesToB64url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('decodes creation and request options', () => {
    const c = creationOptionsFromJson({
      challenge: 'AQID',
      rp: { id: 'labpass.local', name: 'LabPass' },
      user: { id: 'BAUG', name: 'ICTU20231234', displayName: 'Ama' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ id: 'BwgJ', type: 'public-key' }],
    });
    expect(new Uint8Array(c.challenge as Uint8Array)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(c.user.id as Uint8Array)).toEqual(new Uint8Array([4, 5, 6]));
    expect(new Uint8Array(c.excludeCredentials![0]!.id as Uint8Array)).toEqual(new Uint8Array([7, 8, 9]));
    const r = requestOptionsFromJson({ challenge: 'AQID', allowCredentials: [{ id: 'BwgJ', type: 'public-key' }] });
    expect(new Uint8Array(r.allowCredentials![0]!.id as Uint8Array)).toEqual(new Uint8Array([7, 8, 9]));
  });

  it('encodes an assertion for @simplewebauthn', () => {
    const buf = (x: number[]) => new Uint8Array(x).buffer;
    const json = assertionToJson({
      id: 'abc',
      rawId: buf([1]),
      type: 'public-key',
      response: { clientDataJSON: buf([2]), authenticatorData: buf([3]), signature: buf([4]), userHandle: null },
    });
    expect(json).toEqual({
      id: 'abc',
      rawId: 'AQ',
      type: 'public-key',
      response: { clientDataJSON: 'Ag', authenticatorData: 'Aw', signature: 'BA' },
      clientExtensionResults: {},
    });
  });
});

describe('kiosk QR', () => {
  const nonce = new Uint8Array(16).map((_, i) => i + 1);

  it('reads the kiosk challenge and rejects other codes', () => {
    const q = readKioskQr(formatKioskChallengeQr({ kioskId: KIOSK, nonce }));
    expect(q?.kioskId).toBe(KIOSK);
    expect(b64urlToBytes(q!.nonceB64)).toEqual(nonce);
    expect(readKioskQr('https://evil.example')).toBeNull();
    expect(readKioskQr('LPK1.short.x')).toBeNull();
  });

  it('packs an LPR2 passkey response the kiosk can parse', () => {
    const challenge = readKioskQr(formatKioskChallengeQr({ kioskId: KIOSK, nonce }))!;
    const authData = bytesToB64url(new Uint8Array(37).fill(9));
    // Minimal DER ECDSA signature: SEQUENCE { INTEGER 1, INTEGER 1 }
    const sig = bytesToB64url(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]));
    const qr = passkeyResponseQr(CRED, challenge, {
      response: {
        authenticatorData: authData,
        clientDataJSON: bytesToB64url(new TextEncoder().encode('{}')),
        signature: sig,
      },
    });
    const parsed = parseResponseQr(qr);
    expect(parsed.kind).toBe('PASSKEY');
    expect(parsed.credentialId).toBe(CRED);
  });
});

describe('app logic', () => {
  it('compares versions', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });

  it('advises Android updates (optional vs required)', () => {
    const apk = { version: '0.3.0', url: 'https://x/app.apk', sha256: 'a'.repeat(64) };
    expect(updateAdvice('0.3.0', { minSupportedVersion: '0.1.0', androidApk: apk })).toEqual({ kind: 'none' });
    expect(updateAdvice('0.2.0', { minSupportedVersion: '0.1.0', androidApk: apk }).kind).toBe('optional');
    expect(updateAdvice('0.1.0', { minSupportedVersion: '0.2.0', androidApk: apk }).kind).toBe('required');
    expect(updateAdvice('0.1.0', { minSupportedVersion: '0.2.0', androidApk: null })).toEqual({ kind: 'none' });
  });

  it('validates enrollment input like the API', () => {
    expect(
      validateEnroll({ matricule: 'ICTU20231234', firstName: 'Ama', lastName: 'Mbah', dateOfBirth: '2003-05-14' }),
    ).toEqual({});
    expect(
      validateEnroll({ matricule: 'bad matricule!', firstName: '', lastName: ' ', dateOfBirth: '2003-02-30' }),
    ).toEqual({
      matricule: 'invalid',
      firstName: 'required',
      lastName: 'required',
      dateOfBirth: 'invalid',
    });
  });

  it('chooses the install experience', () => {
    expect(installMode('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', false)).toBe('ios-guide');
    expect(installMode('Mozilla/5.0 (Linux; Android 14)', false)).toBe('prompt');
    expect(installMode('anything', true)).toBe('installed');
  });
});
