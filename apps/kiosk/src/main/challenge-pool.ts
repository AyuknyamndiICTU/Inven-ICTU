import { b64urlDecode, formatKioskChallengeQr } from '@labpass/contracts/tap';

export interface Challenge {
  nonce: string;
  bytes: Uint8Array;
  expiresAt: number;
  issuedAt: number;
}

export interface ChallengePoolOptions {
  fetch: () => Promise<{ kioskId: string; challenges: Array<{ nonce: string; expiresAt: string }> }>;
  now?: () => number;
  size?: number;
  /** Never hand out a nonce this close to expiry (tap + network must fit). */
  safetyMs?: number;
  /** Refresh the displayed QR when its remaining life drops below this. */
  qrRefreshMs?: number;
}

/**
 * Keeps ≥ 3 fresh kiosk challenges (ARCH §5 "Kiosk challenge pool"). The newest is displayed as the
 * Scan-the-Kiosk QR (A13); phone taps take the oldest *other* valid challenge so a scan and a tap never race for
 * the same nonce. Every take or scan triggers an immediate refill.
 */
export class ChallengePool {
  private items: Challenge[] = [];
  private kioskId: string | null = null;
  private inflight: Promise<void> | null = null;
  private listeners = new Set<(qr: { qr: string; issuedAt: number; expiresAt: number } | null) => void>();
  private shownNonce: string | null = null;
  private readonly now: () => number;
  private readonly size: number;
  private readonly safetyMs: number;
  private readonly qrRefreshMs: number;

  constructor(private readonly opts: ChallengePoolOptions) {
    this.now = opts.now ?? Date.now;
    this.size = opts.size ?? 3;
    this.safetyMs = opts.safetyMs ?? 5000;
    this.qrRefreshMs = opts.qrRefreshMs ?? 20_000;
  }

  onDisplay(listener: (qr: { qr: string; issuedAt: number; expiresAt: number } | null) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private valid(): Challenge[] {
    const t = this.now() + this.safetyMs;
    return this.items.filter((c) => c.expiresAt > t);
  }

  /** The challenge for the QR, or null before the first fetch / while offline. */
  displayed(): { qr: string; issuedAt: number; expiresAt: number } | null {
    const newest = this.valid().at(-1);
    if (!newest || !this.kioskId) return null;
    return {
      qr: formatKioskChallengeQr({ kioskId: this.kioskId, nonce: newest.bytes }),
      issuedAt: newest.issuedAt,
      expiresAt: newest.expiresAt,
    };
  }

  /** Consumes a challenge for an HCE tap (never the one currently on screen, unless it is the only one). */
  take(): Uint8Array | null {
    const valid = this.valid();
    const pick = valid.find((c) => c.nonce !== this.shownNonce) ?? valid[0];
    if (!pick) return null;
    this.items = this.items.filter((c) => c !== pick);
    void this.refill();
    return pick.bytes;
  }

  /** The displayed challenge was used by a phone scan (`identified` socket event): rotate the QR. */
  rotateDisplayed() {
    if (this.shownNonce) this.items = this.items.filter((c) => c.nonce !== this.shownNonce);
    this.publish();
    void this.refill(true);
  }

  /** Periodic upkeep: prune expired, keep the pool full and the QR fresh. */
  async tick() {
    this.items = this.valid();
    const newest = this.items.at(-1);
    const stale = !newest || newest.expiresAt - this.now() < this.qrRefreshMs;
    await this.refill(stale);
    this.publish();
  }

  clear() {
    this.items = [];
    this.publish();
  }

  async refill(force = false): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!force && this.valid().length >= this.size) return;
    this.inflight = (async () => {
      try {
        const res = await this.opts.fetch();
        this.kioskId = res.kioskId;
        const issuedAt = this.now();
        for (const c of res.challenges) {
          this.items.push({
            nonce: c.nonce,
            bytes: b64urlDecode(c.nonce),
            expiresAt: Date.parse(c.expiresAt),
            issuedAt,
          });
        }
        this.items.sort((a, b) => a.expiresAt - b.expiresAt);
        this.publish();
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  private publish() {
    const d = this.displayed();
    const nonce = this.valid().at(-1)?.nonce ?? null;
    if (nonce === this.shownNonce) return;
    this.shownNonce = nonce;
    for (const l of this.listeners) l(d);
  }
}
