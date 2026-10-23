// Generates tap-protocol/vectors.json: canonical test vectors shared by the API, the kiosk FakeReader and the
// Kotlin/Swift tests. Keys here are TEST-ONLY and must never be used in production.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = await import(pathToFileURL(join(root, 'dist', 'tap', 'node.js')).href);

const kioskId = '7f3a2c10-5b8e-4d21-9a6c-0e4b1d2f3a45';
const otherKioskId = '0d9e8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b';
const credentialId = '3c1d9e2a-8b7f-4a6e-9d5c-4b3a2f1e0d9c';
const nonce = Uint8Array.from({ length: 16 }, (_, i) => (i * 17 + 3) & 0xff);
const ts = 1793000000000;

const device1 = t.generateDeviceKey();
const device2 = t.generateDeviceKey();
const b64 = t.b64urlEncode;
const hex = t.bytesToHex;

const hceSig = t.signDer(device1.pkcs8, t.hceMessage(credentialId, nonce, kioskId, ts));
const scanSig = t.signDer(device1.pkcs8, t.scanMessage(credentialId, nonce, kioskId, ts));
const hceSigOtherKey = t.signDer(device2.pkcs8, t.hceMessage(credentialId, nonce, kioskId, ts));
const sessionId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const popNonce = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 1) & 0xff);
const popSig = t.signDer(device1.pkcs8, t.popMessage(sessionId, popNonce));

const signApdu = t.buildSignApdu(nonce, kioskId, ts);
const badLc = signApdu.slice();
badLc[4] = 0x27;

const vectors = {
  version: 1,
  warning: 'TEST-ONLY KEYS. Never use outside automated tests and the FakeReader.',
  ids: { kioskId, otherKioskId, credentialId, sessionId },
  keys: {
    device1: { spki: b64(device1.spki), pkcs8: b64(device1.pkcs8) },
    device2: { spki: b64(device2.spki), pkcs8: b64(device2.pkcs8) },
  },
  apdu: {
    select: hex(t.buildSelectApdu()),
    selectResponse: hex(t.selectResponse(credentialId)),
    selectResponseNotEnrolled: hex(t.selectResponse(null)),
    sign: hex(signApdu),
    signResponse: hex(t.signResponse(hceSig)),
  },
  signatures: [
    {
      name: 'valid HCE',
      type: 'HCE',
      key: 'device1',
      credentialId,
      kioskId,
      nonce: b64(nonce),
      ts,
      signature: b64(hceSig),
      expect: true,
    },
    {
      name: 'HCE claimed for another kiosk',
      type: 'HCE',
      key: 'device1',
      credentialId,
      kioskId: otherKioskId,
      nonce: b64(nonce),
      ts,
      signature: b64(hceSig),
      expect: false,
    },
    {
      name: 'HCE with a different timestamp',
      type: 'HCE',
      key: 'device1',
      credentialId,
      kioskId,
      nonce: b64(nonce),
      ts: ts + 1,
      signature: b64(hceSig),
      expect: false,
    },
    {
      name: 'HCE signed by another device',
      type: 'HCE',
      key: 'device1',
      credentialId,
      kioskId,
      nonce: b64(nonce),
      ts,
      signature: b64(hceSigOtherKey),
      expect: false,
    },
    {
      name: 'valid SCAN',
      type: 'SCAN',
      key: 'device1',
      credentialId,
      kioskId,
      nonce: b64(nonce),
      ts,
      signature: b64(scanSig),
      expect: true,
    },
    {
      name: 'HCE signature replayed as SCAN (domain separation)',
      type: 'SCAN',
      key: 'device1',
      credentialId,
      kioskId,
      nonce: b64(nonce),
      ts,
      signature: b64(hceSig),
      expect: false,
    },
  ],
  pop: { sessionId, popNonce: b64(popNonce), key: 'device1', signature: b64(popSig) },
  qr: {
    kioskChallenge: t.formatKioskChallengeQr({ kioskId, nonce }),
    deviceKeyResponse: t.formatDeviceKeyResponseQr({ credentialId, nonce, ts, signature: scanSig }),
  },
  malformed: [
    { name: 'SELECT response too short', kind: 'selectResponse', hex: '019000', expectError: 'BAD_LENGTH' },
    {
      name: 'SELECT response wrong version',
      kind: 'selectResponse',
      hex: hex(t.selectResponse(credentialId)).replace(/^01/, '02'),
      expectError: 'BAD_VERSION',
    },
    { name: 'SELECT not enrolled', kind: 'selectResponse', hex: '6A82', expectError: 'STATUS_WORD' },
    {
      name: 'SIGN response not DER',
      kind: 'signResponse',
      hex: '00112233445566779000',
      expectError: 'BAD_SIGNATURE_FORMAT',
    },
    { name: 'SIGN response locked phone', kind: 'signResponse', hex: '6982', expectError: 'STATUS_WORD' },
    { name: 'SIGN command wrong Lc', kind: 'commandApdu', hex: hex(badLc), expectSw: 0x6700 },
    { name: 'SIGN command truncated', kind: 'commandApdu', hex: hex(signApdu.slice(0, 30)), expectSw: 0x6700 },
    { name: 'unknown proprietary INS', kind: 'commandApdu', hex: '8020000000', expectSw: 0x6d00 },
    { name: 'unknown CLA', kind: 'commandApdu', hex: 'A0A4040000', expectSw: 0x6e00 },
    { name: 'SELECT other AID', kind: 'commandApdu', hex: '00A4040007A000000003101000', expectSw: 0x6a82 },
    { name: 'base64url with padding', kind: 'b64url', text: 'AAAA==', expectError: 'BAD_ENCODING' },
    { name: 'standard base64 characters', kind: 'b64url', text: 'ab+/', expectError: 'BAD_ENCODING' },
    { name: 'response QR wrong prefix', kind: 'responseQr', text: 'LPX1.a.b.c.d', expectError: 'BAD_PREFIX' },
    {
      name: 'response QR missing field',
      kind: 'responseQr',
      text: 'LPR1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.123',
      expectError: 'MALFORMED',
    },
    {
      name: 'kiosk QR short nonce',
      kind: 'kioskQr',
      text: 'LPK1.' + b64(t.uuidToBytes(kioskId)) + '.AAAA',
      expectError: 'BAD_LENGTH',
    },
  ],
  /** Server-side acceptance cases (ARCH §6), exercised by the API identify tests with the keys above. */
  serverRules: {
    hceMaxSkewMs: 30000,
    scanMaxSkewMs: 120000,
    challengeTtlMs: 60000,
    cases: [
      'valid',
      'ts skew 31 s (HCE) → STALE',
      'nonce not issued → UNKNOWN_CHALLENGE',
      'nonce reused → UNKNOWN_CHALLENGE',
      'nonce issued to other kiosk → UNKNOWN_CHALLENGE',
      'credential revoked → CREDENTIAL_INACTIVE',
    ],
  },
};

writeFileSync(join(root, 'tap-protocol', 'vectors.json'), JSON.stringify(vectors, null, 2) + '\n');
console.log('tap-protocol/vectors.json written');
