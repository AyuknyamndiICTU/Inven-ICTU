import type { OfflineBundle, OfflineTransaction, Receipt } from '@labpass/contracts';
import {
  b64urlDecode,
  b64urlEncode,
  formatKioskChallengeQr,
  parseResponseQr,
  verifyHceEvidence,
  verifyScanEvidence,
} from '@labpass/contracts/tap-node';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { IdentifiedView, IdentifyView } from '../../shared/ipc';
import { KioskApiError } from '../kiosk-api';

export interface OfflineState {
  bundle: OfflineBundle | null;
  bundleAt: number | null;
  /** Kiosk-local HMAC key for learned card lookups (the server stores UIDs peppered; ADR-0009). */
  cardKey: string;
  /** HMAC(cardKey, uid) → studentId, learned from successful online card taps at this kiosk. */
  cards: Record<string, { studentId: string; at: number }>;
  journal: Array<OfflineTransaction & { evidence: OfflineTransaction['evidence'] }>;
  seq: number;
  offlineSince: number | null;
  extendedUntil: number | null;
  availability: Record<string, number>;
  /** Units returned offline per loan line, so the student's open lines stay correct until sync. */
  returned: Record<string, number>;
}

export interface OfflineDeps {
  load(): OfflineState | null;
  save(state: OfflineState): void;
  wipe(): void;
  kioskId(): string | null;
  now?: () => number;
  /** argon2id verification (hash-wasm in the kiosk, injectable in tests). */
  verifyPin(pin: string, hash: string): Promise<boolean>;
}

type Session = {
  studentId: string;
  method: OfflineTransaction['method'];
  evidence: OfflineTransaction['evidence'];
  expiresAt: number;
};

const CARD_CACHE_DAYS = 120;
const SESSION_MS = 120_000;
const NONCE_TTL_MS = 60_000;

const fail = (code: string, message: string, status = 422): never => {
  throw new KioskApiError({ code, status, message });
};

function fresh(): OfflineState {
  return {
    bundle: null,
    bundleAt: null,
    cardKey: randomBytes(32).toString('base64url'),
    cards: {},
    journal: [],
    seq: 0,
    offlineSince: null,
    extendedUntil: null,
    availability: {},
    returned: {},
  };
}

/**
 * Offline lending engine (S11.5 task 3, ARCH §5 F9). Identifies students locally (learned card lookups, HCE and
 * LPR1 signatures against cached SPKIs with kiosk-generated nonces, matricule + lab-assistant PIN), keeps local
 * availability, and writes every borrow/return to an encrypted, ordered journal for the later sync.
 */
export class OfflineEngine {
  private state: OfflineState;
  private session: Session | null = null;
  private lookups = new Map<string, { studentId: string; at: number }>();
  private nonces = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly d: OfflineDeps) {
    this.now = d.now ?? Date.now;
    this.state = d.load() ?? fresh();
  }

  private persist() {
    this.d.save(this.state);
  }

  // ───────────── bundle & lifecycle ─────────────

  get bundle() {
    return this.state.bundle;
  }

  /** Replaces the bundle (only called when the journal is empty, i.e. right after a successful sync). */
  setBundle(b: OfflineBundle) {
    this.state.bundle = b;
    this.state.bundleAt = this.now();
    this.state.availability = Object.fromEntries(b.equipment.map((e) => [e.id, e.available]));
    this.state.returned = {};
    this.persist();
  }

  bundleAge(): number | null {
    return this.state.bundleAt === null ? null : this.now() - this.state.bundleAt;
  }

  /** Offline lending is possible: a fresh-enough bundle exists and the admin has not disabled it (offlineMaxHours 0). */
  usable(): boolean {
    const b = this.state.bundle;
    return Boolean(b && b.settings.offlineMaxHours > 0 && Date.parse(b.expiresAt) > this.now());
  }

  wentOffline() {
    if (this.state.offlineSince === null) {
      this.state.offlineSince = this.now();
      this.persist();
    }
  }

  cameOnline() {
    if (this.state.journal.length === 0 && this.state.offlineSince !== null) {
      this.state.offlineSince = null;
      this.state.extendedUntil = null;
      this.persist();
    }
  }

  get offlineSince() {
    return this.state.offlineSince;
  }

  /** After `offlineMaxHours` the kiosk only allows returns until an assistant extends the window (F9). */
  readOnly(): boolean {
    const b = this.state.bundle;
    if (!b || this.state.offlineSince === null) return false;
    if (this.state.extendedUntil && this.state.extendedUntil > this.now()) return false;
    return this.now() - this.state.offlineSince > b.settings.offlineMaxHours * 3_600_000;
  }

  extend(hours = 2) {
    this.state.extendedUntil = this.now() + hours * 3_600_000;
    this.persist();
  }

  pending(): number {
    return this.state.journal.length;
  }

  wipe() {
    this.d.wipe();
    this.state = fresh();
    this.session = null;
  }

  // ───────────── learned card lookups ─────────────

  private cardLookup(uid: string) {
    return createHmac('sha256', Buffer.from(this.state.cardKey, 'base64url'))
      .update(`uid:${uid.toUpperCase()}`)
      .digest('base64url');
  }

  learnCard(uid: string, studentId: string) {
    this.state.cards[this.cardLookup(uid)] = { studentId, at: this.now() };
    const cutoff = this.now() - CARD_CACHE_DAYS * 86_400_000;
    for (const [k, v] of Object.entries(this.state.cards)) if (v.at < cutoff) delete this.state.cards[k];
    this.persist();
  }

  // ───────────── kiosk-generated challenges ─────────────

  /** A nonce for an HCE tap or the offline Scan-the-Kiosk QR (verified locally, re-verified at sync). */
  issueNonce(): Uint8Array {
    const n = new Uint8Array(randomBytes(16));
    this.nonces.set(b64urlEncode(n), this.now() + NONCE_TTL_MS);
    for (const [k, exp] of this.nonces) if (exp < this.now()) this.nonces.delete(k);
    return n;
  }

  private consumeNonce(n: Uint8Array): boolean {
    const k = b64urlEncode(n);
    const exp = this.nonces.get(k);
    this.nonces.delete(k);
    return exp !== undefined && exp >= this.now();
  }

  challengeQr(): { qr: string; issuedAt: number; expiresAt: number } | null {
    const kioskId = this.d.kioskId();
    if (!kioskId) return null;
    const issuedAt = this.now();
    return {
      qr: formatKioskChallengeQr({ kioskId, nonce: this.issueNonce() }),
      issuedAt,
      expiresAt: issuedAt + NONCE_TTL_MS,
    };
  }

  // ───────────── identification ─────────────

  private student(id: string) {
    const s = this.state.bundle?.students.find((x) => x.id === id);
    if (!s) return fail('NOT_RECOGNISED', 'We could not verify this. Please ask a lab assistant.');
    return s!;
  }

  private openLines(studentId: string) {
    const s = this.student(studentId);
    return s.openLines
      .map((l) => ({ ...l, outstanding: l.outstanding - (this.state.returned[l.loanLineId] ?? 0) }))
      .filter((l) => l.outstanding > 0);
  }

  private identified(studentId: string, method: Session['method'], evidence: Session['evidence']): IdentifiedView {
    const s = this.student(studentId);
    const b = this.state.bundle!;
    const lines = this.openLines(studentId);
    const reasons: IdentifiedView['eligibility']['reasons'] = [];
    if (s.status === 'INACTIVE') reasons.push('INACTIVE');
    if (s.status === 'SUSPENDED') reasons.push('SUSPENDED');
    if (b.settings.blockWhenOverdue && s.overdue) reasons.push('OVERDUE');
    const outstanding = lines.reduce((n, l) => n + l.outstanding, 0);
    const max = b.settings.maxItemsPerStudent;
    if (max !== null && outstanding >= max) reasons.push('LIMIT_REACHED');
    const expiresAt = this.now() + SESSION_MS;
    this.session = { studentId, method, evidence, expiresAt };
    const flags: IdentifiedView['flags'] = ['OFFLINE'];
    if (method === 'CARD') flags.push('UID_ONLY');
    if (method === 'MANUAL') flags.push('MANUAL');
    return {
      status: 'IDENTIFIED',
      method,
      sessionExpiresAt: new Date(expiresAt).toISOString(),
      student: {
        id: s.id,
        matricule: s.matricule,
        firstName: s.firstName,
        lastName: s.lastName,
        program: null,
        level: null,
        photoUrl: null,
        status: s.status,
      },
      eligibility: {
        canBorrow: reasons.length === 0 && !this.readOnly(),
        canReturn: lines.length > 0,
        reasons,
        remainingItems: max === null ? null : Math.max(0, max - outstanding),
      },
      openLines: lines.map((l) => ({
        loanLineId: l.loanLineId,
        loanId: l.loanLineId,
        equipmentId: l.equipmentId,
        equipmentCode: this.state.bundle!.equipment.find((e) => e.id === l.equipmentId)?.code ?? '',
        equipmentName: l.equipmentName,
        outstanding: l.outstanding,
        dueAt: b.expiresAt,
        overdue: s.overdue,
      })),
      flags,
    };
  }

  identifyCard(uid: string): IdentifyView {
    const hit = this.state.cards[this.cardLookup(uid)];
    if (!hit) return fail('OFFLINE_UNKNOWN_CARD', 'This card cannot be checked while offline. Ask a lab assistant.');
    return this.identified(hit!.studentId, 'CARD', {
      type: 'CARD',
      uidLookup: this.cardLookup(uid),
      uid: uid.toUpperCase(),
    });
  }

  private deviceKey(credentialId: string) {
    const c = this.state.bundle?.credentials.find((x) => x.credentialId === credentialId && x.kind === 'DEVICE_KEY');
    if (!c) return fail('NOT_RECOGNISED', 'We could not verify this. Try again, or ask a lab assistant.');
    return c!;
  }

  identifyHce(e: { credentialId: string; nonce: string; ts: number; signature: string }): IdentifyView {
    const c = this.deviceKey(e.credentialId);
    const nonce = b64urlDecode(e.nonce);
    const ok =
      this.consumeNonce(nonce) &&
      verifyHceEvidence(b64urlDecode(c.publicKey), {
        credentialId: e.credentialId,
        nonce,
        kioskId: this.d.kioskId()!,
        ts: e.ts,
        signature: b64urlDecode(e.signature),
      });
    if (!ok) fail('NOT_RECOGNISED', 'We could not verify this. Try again, or ask a lab assistant.');
    return this.identified(c.studentId, 'HCE', { type: 'HCE', ...e });
  }

  identifyScan(text: string): IdentifyView {
    let qr: ReturnType<typeof parseResponseQr>;
    try {
      qr = parseResponseQr(text);
    } catch {
      return fail('NOT_A_LABPASS_CODE', 'This is not a LabPass response code');
    }
    if (qr!.kind !== 'DEVICE_KEY')
      return fail('OFFLINE_PASSKEY', 'Web-app codes cannot be checked offline. Ask a lab assistant to confirm.');
    const q = qr as Extract<ReturnType<typeof parseResponseQr>, { kind: 'DEVICE_KEY' }>;
    const c = this.deviceKey(q.credentialId);
    const ok =
      this.consumeNonce(q.nonce) &&
      verifyScanEvidence(b64urlDecode(c.publicKey), {
        credentialId: q.credentialId,
        nonce: q.nonce,
        kioskId: this.d.kioskId()!,
        ts: q.ts,
        signature: q.signature,
      });
    if (!ok) fail('NOT_RECOGNISED', 'This code has expired. Scan the code on the screen again.');
    return this.identified(c.studentId, 'SCAN', { type: 'SCAN', payload: text.trim() });
  }

  /** Offline matricule entry always needs a lab assistant (student PIN hashes are never cached, F9). */
  identifyManual(matricule: string): IdentifyView {
    const s = this.state.bundle?.students.find((x) => x.matricule.toUpperCase() === matricule.toUpperCase());
    if (!s) return fail('NOT_RECOGNISED', 'We could not find this matricule. Check it, or ask a lab assistant.');
    const lookupId = randomUUID();
    this.lookups.set(lookupId, { studentId: s!.id, at: this.now() });
    return {
      status: 'VERIFICATION_REQUIRED',
      lookupId,
      student: { firstName: s!.firstName, lastName: s!.lastName, photoUrl: null },
      options: ['ASSISTANT'],
    };
  }

  async verifyAssistant(lookupId: string, pin: string): Promise<IdentifiedView> {
    const l = this.lookups.get(lookupId);
    if (!l || this.now() - l.at > 5 * 60_000)
      return fail('LOOKUP_EXPIRED', 'This entry has expired. Type the matricule again.', 400);
    for (const a of this.state.bundle?.assistants ?? []) {
      if (await this.d.verifyPin(pin, a.pinHash)) {
        this.lookups.delete(lookupId);
        return this.identified(l!.studentId, 'MANUAL', { type: 'ASSISTANT', assistantId: a.id });
      }
    }
    return fail('VERIFICATION_FAILED', 'That PIN is not right.', 400);
  }

  endSession() {
    this.session = null;
  }

  // ───────────── lending ─────────────

  private requireSession(): Session {
    if (!this.session || this.session.expiresAt <= this.now()) {
      this.session = null;
      return fail('SESSION_EXPIRED', 'Your session has ended. Tap again.', 401);
    }
    return this.session!;
  }

  private record(s: Session, kind: 'BORROW' | 'RETURN', lines: Partial<OfflineTransaction>) {
    const tx = {
      txId: randomUUID(),
      seq: ++this.state.seq,
      occurredAt: new Date(this.now()).toISOString(),
      kind,
      studentId: s.studentId,
      method: s.method,
      evidence: s.evidence,
      borrowLines: [],
      returnLines: [],
      ...lines,
    } as OfflineTransaction;
    this.state.journal.push(tx);
    this.persist();
    this.session = null;
    return tx;
  }

  signIn(lines: Array<{ equipmentId: string; quantity: number }>): Receipt {
    const s = this.requireSession();
    if (this.readOnly())
      fail('OFFLINE_READ_ONLY', 'Borrowing is paused until the server is back. Returns still work.', 403);
    const view = this.identified(s.studentId, s.method, s.evidence);
    this.session = s;
    if (!view.eligibility.canBorrow)
      fail('STUDENT_INACTIVE', 'This account cannot borrow right now. See a lab assistant.', 403);
    const b = this.state.bundle!;
    if (b.settings.maxItemsPerStudent !== null) {
      const want = lines.reduce((n, l) => n + l.quantity, 0);
      if (view.eligibility.remainingItems !== null && want > view.eligibility.remainingItems)
        fail('LIMIT_REACHED', `You can borrow ${view.eligibility.remainingItems} more item(s).`, 409);
    }
    for (const l of lines) {
      const avail = this.state.availability[l.equipmentId] ?? 0;
      const e = b.equipment.find((x) => x.id === l.equipmentId);
      if (!e) fail('EQUIPMENT_UNAVAILABLE', 'This equipment is not available for borrowing.', 409);
      if (avail < l.quantity) {
        throw new KioskApiError({
          code: 'INSUFFICIENT_STOCK',
          status: 409,
          message: `Only ${avail} × ${e!.name} left.`,
          details: { equipmentId: l.equipmentId, available: avail },
        });
      }
    }
    for (const l of lines) this.state.availability[l.equipmentId]! -= l.quantity;
    const tx = this.record(s, 'BORROW', { borrowLines: lines });
    return {
      kind: 'BORROW',
      loanIds: [],
      occurredAt: tx.occurredAt,
      dueAt: null,
      studentFirstName: this.student(s.studentId).firstName,
      lines: lines.map((l) => ({
        equipmentId: l.equipmentId,
        equipmentName: b.equipment.find((x) => x.id === l.equipmentId)!.name,
        quantity: l.quantity,
        condition: null,
      })),
      offline: true,
    };
  }

  signOut(lines: Array<{ loanLineId: string; quantity: number; condition: 'OK' | 'DAMAGED' }>): Receipt {
    const s = this.requireSession();
    const open = this.openLines(s.studentId);
    for (const l of lines) {
      const o = open.find((x) => x.loanLineId === l.loanLineId);
      if (!o || o.outstanding < l.quantity) fail('ALREADY_RETURNED', 'This item was already returned.', 409);
    }
    const names = new Map(open.map((o) => [o.loanLineId, o]));
    for (const l of lines) {
      this.state.returned[l.loanLineId] = (this.state.returned[l.loanLineId] ?? 0) + l.quantity;
      if (l.condition === 'OK') {
        const eq = names.get(l.loanLineId)!.equipmentId;
        this.state.availability[eq] = (this.state.availability[eq] ?? 0) + l.quantity;
      }
    }
    const tx = this.record(s, 'RETURN', { returnLines: lines });
    return {
      kind: 'RETURN',
      loanIds: [],
      occurredAt: tx.occurredAt,
      dueAt: null,
      studentFirstName: this.student(s.studentId).firstName,
      lines: lines.map((l) => ({
        equipmentId: names.get(l.loanLineId)!.equipmentId,
        equipmentName: names.get(l.loanLineId)!.equipmentName,
        quantity: l.quantity,
        condition: l.condition,
      })),
      offline: true,
    };
  }

  availability(equipmentId: string): number | undefined {
    return this.state.availability[equipmentId];
  }

  // ───────────── sync ─────────────

  syncBody() {
    if (!this.state.journal.length) return null;
    const first = Date.parse(this.state.journal[0]!.occurredAt);
    return {
      offlineFrom: new Date(Math.min(this.state.offlineSince ?? first, first)).toISOString(),
      offlineTo: new Date(this.now()).toISOString(),
      bundleVersion: this.state.bundle?.version ?? 0,
      transactions: this.state.journal,
    };
  }

  /** Removes everything the server has accounted for (applied, duplicate, or parked as a conflict for review). */
  acknowledge(r: { applied: string[]; duplicates: string[]; conflicts: Array<{ txId: string }> }) {
    const done = new Set([...r.applied, ...r.duplicates, ...r.conflicts.map((c) => c.txId)]);
    this.state.journal = this.state.journal.filter((t) => !done.has(t.txId));
    if (!this.state.journal.length) {
      this.state.offlineSince = null;
      this.state.extendedUntil = null;
    }
    this.persist();
  }
}
