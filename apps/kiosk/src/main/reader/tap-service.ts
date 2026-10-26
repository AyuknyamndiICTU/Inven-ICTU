import {
  b64urlEncode,
  buildSelectApdu,
  buildSignApdu,
  bytesToHex,
  parseSelectResponse,
  parseSignResponse,
  SW,
} from '@labpass/contracts/tap';
import type { TapErrorCode } from '../../shared/ipc';
import { type CardHandle, Emitter, type ReaderDriver, withTimeout } from './driver';

export const GET_UID_APDU = Uint8Array.of(0xff, 0xca, 0x00, 0x00, 0x00);

export type TapResult =
  | { kind: 'HCE'; credentialId: string; nonce: string; ts: number; signature: string }
  | { kind: 'CARD'; uid: string; card: CardHandle }
  | { kind: 'ERROR'; code: TapErrorCode };

export interface TapServiceEvents {
  /** The reader event itself: drives A2 before any API call (≤ 100 ms budget). */
  present: () => void;
  removed: () => void;
  tap: (result: TapResult) => void;
}

export interface TapServiceDeps {
  /** Takes one fresh challenge nonce from the pool (consumed). Null when the pool is empty. */
  takeChallenge(): Uint8Array | null;
  kioskId(): string | null;
  now?: () => number;
  /** Ignore the same card/phone for this long after a completed tap (S11 task 2). */
  debounceMs?: number;
  /** Per-APDU timeout. A locked phone never answers SELECT. */
  apduTimeoutMs?: number;
}

const swOf = (r: Uint8Array) => (r.length >= 2 ? (r[r.length - 2]! << 8) | r[r.length - 1]! : -1);
/** Random NUIDs (first byte 0x08, 4 bytes) come from phones in card-emulation mode and are never stable identities. */
const isRandomUid = (uid: Uint8Array) => uid.length === 4 && uid[0] === 0x08;

/**
 * Reads a card or phone as soon as it enters the field (ARCH §5 F1/F2):
 * SELECT the LabPass AID first; a phone answers with its credentialId and signs a pool challenge. On 6A82 or any
 * failure, read the UID. A phone that does not answer SELECT is locked → "Unlock your phone and tap again".
 */
export class TapService {
  private readonly events = new Emitter<TapServiceEvents>();
  private busy = false;
  private last: { key: string; at: number } | null = null;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly apduTimeoutMs: number;
  private readonly offs: Array<() => void> = [];

  constructor(
    private readonly driver: ReaderDriver,
    private readonly deps: TapServiceDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.debounceMs = deps.debounceMs ?? 1500;
    this.apduTimeoutMs = deps.apduTimeoutMs ?? 700;
    this.offs.push(
      driver.on('card', (card) => void this.handle(card)),
      driver.on('removed', () => this.events.emit('removed')),
    );
  }

  on<E extends keyof TapServiceEvents>(event: E, listener: TapServiceEvents[E]) {
    return this.events.on(event, listener);
  }

  dispose() {
    for (const off of this.offs) off();
  }

  private debounced(key: string): boolean {
    const t = this.now();
    if (this.last && this.last.key === key && t - this.last.at < this.debounceMs) return true;
    this.last = { key, at: t };
    return false;
  }

  private async handle(card: CardHandle) {
    if (this.busy) return;
    this.busy = true;
    this.events.emit('present');
    try {
      const result = await this.read(card);
      const key =
        result.kind === 'HCE'
          ? `hce:${result.credentialId}`
          : result.kind === 'CARD'
            ? `uid:${result.uid}`
            : `err:${result.code}`;
      if (this.debounced(key)) return;
      this.events.emit('tap', result);
    } finally {
      this.busy = false;
    }
  }

  async read(card: CardHandle): Promise<TapResult> {
    let selectResp: Uint8Array | null = null;
    try {
      selectResp = await withTimeout(card.transceive(buildSelectApdu()), this.apduTimeoutMs);
    } catch {
      selectResp = null;
    }
    if (selectResp && swOf(selectResp) === SW.OK) return this.signWithPhone(card, selectResp);

    const uid = await this.readUid(card);
    if (!uid) return { kind: 'ERROR', code: 'READ_FAILED' };
    // No answer at all → the HCE service is not reachable because the phone is locked.
    if (isRandomUid(uid)) return { kind: 'ERROR', code: selectResp === null ? 'PHONE_LOCKED' : 'FOREIGN_PHONE' };
    return { kind: 'CARD', uid: bytesToHex(uid), card };
  }

  private async readUid(card: CardHandle): Promise<Uint8Array | null> {
    try {
      const r = await withTimeout(card.transceive(GET_UID_APDU), this.apduTimeoutMs);
      if (swOf(r) !== SW.OK || r.length < 6) return null;
      return r.subarray(0, r.length - 2);
    } catch {
      return null;
    }
  }

  private async signWithPhone(card: CardHandle, selectResp: Uint8Array): Promise<TapResult> {
    let credentialId: string;
    try {
      credentialId = parseSelectResponse(selectResp).credentialId;
    } catch {
      return { kind: 'ERROR', code: 'READ_FAILED' };
    }
    const kioskId = this.deps.kioskId();
    const nonce = this.deps.takeChallenge();
    if (!kioskId || !nonce) return { kind: 'ERROR', code: 'NO_CHALLENGE' };
    const ts = this.now();
    try {
      const resp = await withTimeout(card.transceive(buildSignApdu(nonce, kioskId, ts)), this.apduTimeoutMs * 2);
      const signature = parseSignResponse(resp);
      return { kind: 'HCE', credentialId, nonce: b64urlEncode(nonce), ts, signature: b64urlEncode(signature) };
    } catch {
      return { kind: 'ERROR', code: 'READ_FAILED' };
    }
  }
}
