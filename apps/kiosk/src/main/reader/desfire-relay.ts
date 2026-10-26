import type { IdentifyResponse } from '@labpass/contracts';
import { bytesToHex, hexToBytes } from '@labpass/contracts/tap';
import type { CardHandle } from './driver';
import { withTimeout } from './driver';

type Step =
  | { status: 'CONTINUE'; sessionId: string; apdu: string }
  | { status: 'DONE'; result: IdentifyResponse }
  | { status: 'UID_ONLY'; reason: string };

export interface CardAuthApi {
  start(uid: string): Promise<Step>;
  step(sessionId: string, response: string): Promise<Step>;
}

export type RelayOutcome = { kind: 'DONE'; result: IdentifyResponse } | { kind: 'UID_ONLY'; reason: string };

/** AuthenticateEV2First is three exchanges; a cap stops a misbehaving server from looping the kiosk. */
const MAX_STEPS = 6;
/** ISO 7816 "no precise diagnosis": sent when the card did not answer, so the server records the failure. */
const NO_ANSWER = '6F00';

/**
 * Relays DESFire EV3 mutual authentication between the card and the API (ARCH §6, S06.5).
 * The kiosk never holds a key: it forwards the API's APDUs and the card's responses verbatim.
 * When the card cannot answer (pulled away, timeout) the kiosk relays `6F00`, so the server counts the failure and
 * apply `cardAuthMode` (DESFIRE_PREFERRED → UID_ONLY fallback; DESFIRE_REQUIRED → 403 CARD_AUTH_FAILED).
 */
export async function relayDesfire(
  card: CardHandle,
  uid: string,
  api: CardAuthApi,
  apduTimeoutMs = 700,
): Promise<RelayOutcome> {
  let step = await api.start(uid);
  for (let i = 0; i < MAX_STEPS; i++) {
    if (step.status === 'DONE') return { kind: 'DONE', result: step.result };
    if (step.status === 'UID_ONLY') return { kind: 'UID_ONLY', reason: step.reason };
    let response: string;
    try {
      response = bytesToHex(await withTimeout(card.transceive(hexToBytes(step.apdu)), apduTimeoutMs));
    } catch {
      response = NO_ANSWER;
    }
    step = await api.step(step.sessionId, response);
  }
  return { kind: 'UID_ONLY', reason: 'RELAY_STEP_LIMIT' };
}
