import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TapProtocolError,
  b64urlDecode,
  b64urlEncode,
  buildSelectApdu,
  buildSignApdu,
  bytesToHex,
  formatDeviceKeyResponseQr,
  formatKioskChallengeQr,
  hexToBytes,
  parseCommandApdu,
  parseKioskChallengeQr,
  parseResponseQr,
  parseSelectResponse,
  parseSignResponse,
  selectResponse,
  signResponse,
  u64be,
  readU64be,
  uuidToBytes,
  bytesToUuid,
} from './index';
import {
  generateDeviceKey,
  hceMessage,
  signDer,
  verifyHceEvidence,
  verifyPopSignature,
  verifyScanEvidence,
} from './node';

const vectors = JSON.parse(readFileSync(join(__dirname, '../../tap-protocol/vectors.json'), 'utf8'));

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof TapProtocolError ? e.code : 'OTHER';
  }
}

describe('encoding', () => {
  it('round-trips base64url without padding', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const text = b64urlEncode(bytes);
      expect(text).not.toContain('=');
      expect(Array.from(b64urlDecode(text))).toEqual(Array.from(bytes));
      expect(text).toBe(Buffer.from(bytes).toString('base64url'));
    }
  });

  it('round-trips UUIDs and u64', () => {
    const id = '3c1d9e2a-8b7f-4a6e-9d5c-4b3a2f1e0d9c';
    expect(bytesToHex(uuidToBytes(id))).toBe('3C1D9E2A8B7F4A6E9D5C4B3A2F1E0D9C');
    expect(bytesToUuid(uuidToBytes(id))).toBe(id);
    expect(readU64be(u64be(1793000000000))).toBe(1793000000000);
    expect(bytesToHex(u64be(1))).toBe('0000000000000001');
  });
});

describe('APDUs (ARCH §6)', () => {
  it('builds SELECT exactly as specified', () => {
    expect(bytesToHex(buildSelectApdu())).toBe('00A4040008F0494354554C500100');
  });

  it('builds a 46-byte SIGN command with Lc = 0x28', () => {
    const apdu = buildSignApdu(new Uint8Array(16), vectors.ids.kioskId, 1);
    expect(apdu.length).toBe(46);
    expect(bytesToHex(apdu.subarray(0, 5))).toBe('8010000028');
    expect(apdu[45]).toBe(0x00);
  });

  it('round-trips through the phone-side parser', () => {
    expect(parseCommandApdu(buildSelectApdu())).toEqual({ kind: 'SELECT' });
    const nonce = Uint8Array.from({ length: 16 }, (_, i) => i);
    const parsed = parseCommandApdu(buildSignApdu(nonce, vectors.ids.kioskId, 42));
    expect(parsed).toMatchObject({ kind: 'SIGN', kioskId: vectors.ids.kioskId, ts: 42 });
    expect(selectResponse(null).length).toBe(2);
    expect(parseSelectResponse(selectResponse(vectors.ids.credentialId))).toEqual({
      version: 1,
      credentialId: vectors.ids.credentialId,
    });
  });

  it('matches the committed APDU vectors', () => {
    expect(bytesToHex(buildSelectApdu())).toBe(vectors.apdu.select);
    expect(parseSelectResponse(hexToBytes(vectors.apdu.selectResponse)).credentialId).toBe(vectors.ids.credentialId);
    const sig = parseSignResponse(hexToBytes(vectors.apdu.signResponse));
    expect(bytesToHex(signResponse(sig))).toBe(vectors.apdu.signResponse);
  });

  it.each(vectors.malformed as Array<Record<string, string | number>>)('rejects malformed input: $name', (v) => {
    switch (v.kind) {
      case 'selectResponse':
        expect(errorCode(() => parseSelectResponse(hexToBytes(String(v.hex))))).toBe(v.expectError);
        break;
      case 'signResponse':
        expect(errorCode(() => parseSignResponse(hexToBytes(String(v.hex))))).toBe(v.expectError);
        break;
      case 'commandApdu':
        expect(parseCommandApdu(hexToBytes(String(v.hex)))).toEqual({ kind: 'ERROR', sw: v.expectSw });
        break;
      case 'b64url':
        expect(errorCode(() => b64urlDecode(String(v.text)))).toBe(v.expectError);
        break;
      case 'responseQr':
        expect(errorCode(() => parseResponseQr(String(v.text)))).toBe(v.expectError);
        break;
      case 'kioskQr':
        expect(errorCode(() => parseKioskChallengeQr(String(v.text)))).toBe(v.expectError);
        break;
      default:
        throw new Error(`unknown vector kind ${String(v.kind)}`);
    }
  });
});

describe('signatures (shared vectors)', () => {
  const spkiOf = (k: string) => b64urlDecode(vectors.keys[k].spki);

  it.each(vectors.signatures as Array<Record<string, string | number | boolean>>)('$name → $expect', (v) => {
    const evidence = {
      credentialId: String(v.credentialId),
      kioskId: String(v.kioskId),
      nonce: b64urlDecode(String(v.nonce)),
      ts: Number(v.ts),
      signature: b64urlDecode(String(v.signature)),
    };
    const verify = v.type === 'HCE' ? verifyHceEvidence : verifyScanEvidence;
    expect(verify(spkiOf(String(v.key)), evidence)).toBe(v.expect);
  });

  it('verifies the enrollment proof of possession', () => {
    const p = vectors.pop;
    expect(verifyPopSignature(spkiOf(p.key), p.sessionId, b64urlDecode(p.popNonce), b64urlDecode(p.signature))).toBe(
      true,
    );
    expect(
      verifyPopSignature(spkiOf('device2'), p.sessionId, b64urlDecode(p.popNonce), b64urlDecode(p.signature)),
    ).toBe(false);
  });

  it('never throws on garbage keys or signatures', () => {
    const e = {
      credentialId: vectors.ids.credentialId,
      kioskId: vectors.ids.kioskId,
      nonce: new Uint8Array(16),
      ts: 1,
      signature: new Uint8Array([1, 2, 3]),
    };
    expect(verifyHceEvidence(new Uint8Array([0, 1, 2]), e)).toBe(false);
  });

  it('signs and verifies fresh keys end to end', () => {
    const key = generateDeviceKey();
    const nonce = Uint8Array.from({ length: 16 }, () => 9);
    const sig = signDer(key.pkcs8, hceMessage(vectors.ids.credentialId, nonce, vectors.ids.kioskId, 5));
    expect(
      verifyHceEvidence(key.spki, {
        credentialId: vectors.ids.credentialId,
        kioskId: vectors.ids.kioskId,
        nonce,
        ts: 5,
        signature: sig,
      }),
    ).toBe(true);
  });
});

describe('QR payloads', () => {
  it('round-trips the kiosk challenge and response codes', () => {
    const q = parseKioskChallengeQr(vectors.qr.kioskChallenge);
    expect(q.kioskId).toBe(vectors.ids.kioskId);
    expect(formatKioskChallengeQr(q)).toBe(vectors.qr.kioskChallenge);
    const r = parseResponseQr(vectors.qr.deviceKeyResponse);
    expect(r.kind).toBe('DEVICE_KEY');
    if (r.kind === 'DEVICE_KEY') expect(formatDeviceKeyResponseQr(r)).toBe(vectors.qr.deviceKeyResponse);
  });
});
