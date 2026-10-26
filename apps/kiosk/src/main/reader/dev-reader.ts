import { b64urlDecode } from '@labpass/contracts/tap';
import { createRequire } from 'node:module';
import { FakeReader, foreignPhone, hcePhone, lockedPhone, uidCard } from './fake-reader';

export type Scenario = 'card' | 'unknownCard' | 'phone' | 'lockedPhone' | 'foreignPhone' | 'unplug' | 'plug';

interface Vectors {
  ids: { credentialId: string };
  keys: { device1: { pkcs8: string } };
}

/** The shared TEST-ONLY phone key from the tap-protocol vectors (allowed in the FakeReader by the vectors' warning). */
function vectorPhoneKey(): { credentialId: string; pkcs8: Uint8Array } {
  const v = createRequire(__filename)('@labpass/contracts/vectors.json') as Vectors;
  return { credentialId: v.ids.credentialId, pkcs8: b64urlDecode(v.keys.device1.pkcs8) };
}

function randomCardUid(): string {
  const b = new Uint8Array(7);
  crypto.getRandomValues(b);
  b[0] = 0x04; // NXP manufacturer byte, like real ICTU cards.
  return [...b]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * FakeReader wired to named scenarios for development, demos and e2e tests (never used in production builds).
 * Env: `LABPASS_FAKE_CARD_UID` (a card bound in the dev database), `LABPASS_FAKE_CREDENTIAL_ID` +
 * `LABPASS_FAKE_DEVICE_KEY` (base64url PKCS#8 of an enrolled dev phone). Defaults come from the test vectors.
 */
export function createDevReader(latencyMs = 30) {
  const reader = new FakeReader(latencyMs);
  const hold = (card: Parameters<FakeReader['place']>[0]) => {
    reader.place(card);
    setTimeout(() => reader.remove(), 1200);
  };
  const simulate = (scenario: Scenario) => {
    switch (scenario) {
      case 'card':
        return hold(uidCard(process.env.LABPASS_FAKE_CARD_UID ?? '04A1B2C3D4E5F6'));
      case 'unknownCard':
        return hold(uidCard(randomCardUid()));
      case 'phone': {
        const fallback = vectorPhoneKey();
        const credentialId = process.env.LABPASS_FAKE_CREDENTIAL_ID ?? fallback.credentialId;
        const key = process.env.LABPASS_FAKE_DEVICE_KEY
          ? b64urlDecode(process.env.LABPASS_FAKE_DEVICE_KEY)
          : fallback.pkcs8;
        return hold(hcePhone(credentialId, key));
      }
      case 'lockedPhone':
        return hold(lockedPhone());
      case 'foreignPhone':
        return hold(foreignPhone());
      case 'unplug':
        return reader.unplug();
      case 'plug':
        return reader.plug();
    }
  };
  return { reader, simulate };
}
