import { formatPasskeyResponseQr, parseKioskChallengeQr, TapProtocolError } from '@labpass/contracts/tap';
import { b64urlToBytes } from './webauthn';

/** A kiosk challenge read from the attract screen (`LPK1.<kioskId>.<nonce>`), in the shapes the API expects. */
export interface KioskChallenge {
  kioskId: string;
  nonce: Uint8Array;
  nonceB64: string;
}

export function readKioskQr(text: string): KioskChallenge | null {
  try {
    const q = parseKioskChallengeQr(text);
    let s = '';
    for (const x of q.nonce) s += String.fromCharCode(x);
    return {
      kioskId: q.kioskId,
      nonce: q.nonce,
      nonceB64: btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    };
  } catch (e) {
    if (e instanceof TapProtocolError) return null;
    throw e;
  }
}

/** Offline fallback for the web app: a passkey assertion packed as an `LPR2` response QR for the kiosk webcam. */
export function passkeyResponseQr(
  credentialId: string,
  challenge: KioskChallenge,
  assertion: { response: { authenticatorData: string; clientDataJSON: string; signature: string } },
): string {
  return formatPasskeyResponseQr({
    credentialId,
    nonce: challenge.nonce,
    authenticatorData: b64urlToBytes(assertion.response.authenticatorData),
    clientDataJSON: b64urlToBytes(assertion.response.clientDataJSON),
    signature: b64urlToBytes(assertion.response.signature),
  });
}
