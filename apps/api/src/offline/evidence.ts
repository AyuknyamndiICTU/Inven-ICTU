import { offlineTxMacInput, type OfflineTransaction } from '@labpass/contracts';
import { b64urlDecode, parseResponseQr, verifyHceEvidence, verifyScanEvidence } from '@labpass/contracts/tap-node';
import { timingSafeEqual } from 'node:crypto';

export type ConflictReason =
  | 'INSUFFICIENT_STOCK'
  | 'CREDENTIAL_REVOKED'
  | 'STUDENT_INACTIVE'
  | 'BUNDLE_EXPIRED'
  | 'INVALID_EVIDENCE'
  | 'UNKNOWN_LINE';

/** What the sync needs to know about the credential, card or assistant named in the evidence. */
export interface EvidenceLookups {
  /** ACTIVE card binding for a raw UID (via the peppered HMAC), or null. */
  card(uidHex: string): Promise<{ studentId: string; cardTech: string } | null>;
  credential(id: string): Promise<{
    studentId: string;
    status: string;
    kind: 'DEVICE_KEY' | 'PASSKEY';
    spki: Uint8Array | null;
  } | null>;
  /** The per-kiosk MAC key of an active assistant for this bundle version, or null. */
  assistantKey(id: string): Promise<Buffer | null>;
  /** Records a phone nonce as used; false when it was already used (online or by an earlier sync). */
  useNonce(credentialId: string, nonce: string): Promise<boolean>;
  computeMac(key: Buffer, input: string): string;
}

export interface EvidenceContext {
  kioskId: string;
  /** The window the kiosk was offline, already bounded by the server (bundle issue time … now). */
  offlineFrom: number;
  offlineTo: number;
  cardAuthMode: 'UID' | 'DESFIRE_PREFERRED' | 'DESFIRE_REQUIRED';
  skewMs?: number;
}

export type EvidenceResult = { ok: true } | { ok: false; reason: ConflictReason };

const bad = (reason: ConflictReason): EvidenceResult => ({ ok: false, reason });

const sameB64 = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Re-verifies offline identification evidence at sync time (ARCH §5 F9, S11.5 task 4, S13 findings 1–3).
 * The kiosk generated its own nonces offline, so instead of the online single-use challenge: the signed timestamp
 * must fall inside the server-bounded window, and each phone nonce can back only one identification ever.
 */
export async function checkEvidence(
  tx: Pick<
    OfflineTransaction,
    'txId' | 'studentId' | 'occurredAt' | 'evidence' | 'kind' | 'borrowLines' | 'returnLines'
  >,
  ctx: EvidenceContext,
  look: EvidenceLookups,
): Promise<EvidenceResult> {
  const skew = ctx.skewMs ?? 5 * 60_000;
  const inWindow = (ms: number) => ms >= ctx.offlineFrom - skew && ms <= ctx.offlineTo + skew;
  if (!inWindow(Date.parse(tx.occurredAt))) return bad('INVALID_EVIDENCE');
  const e = tx.evidence;

  if (e.type === 'CARD') {
    if (!e.uid) return bad('INVALID_EVIDENCE');
    const card = await look.card(e.uid.toUpperCase());
    if (!card) return bad('CREDENTIAL_REVOKED');
    if (card.studentId !== tx.studentId) return bad('INVALID_EVIDENCE');
    // A copied UID must not bypass DESFire authentication just because the kiosk was offline.
    if (ctx.cardAuthMode === 'DESFIRE_REQUIRED' && card.cardTech === 'DESFIRE_EV3') return bad('INVALID_EVIDENCE');
    return { ok: true };
  }

  if (e.type === 'ASSISTANT') {
    const key = await look.assistantKey(e.assistantId);
    if (!key) return bad('INVALID_EVIDENCE');
    return sameB64(look.computeMac(key, offlineTxMacInput(tx)), e.mac) ? { ok: true } : bad('INVALID_EVIDENCE');
  }

  type KeyCheck = { spki: Uint8Array; error?: undefined } | { error: EvidenceResult; spki?: undefined };
  const deviceKey = async (credentialId: string): Promise<KeyCheck> => {
    const cred = await look.credential(credentialId);
    if (!cred) return { error: bad('INVALID_EVIDENCE') };
    if (cred.studentId !== tx.studentId) return { error: bad('INVALID_EVIDENCE') };
    if (cred.status !== 'ACTIVE') return { error: bad('CREDENTIAL_REVOKED') };
    if (cred.kind !== 'DEVICE_KEY' || !cred.spki) return { error: bad('INVALID_EVIDENCE') };
    return { spki: cred.spki };
  };

  try {
    if (e.type === 'HCE') {
      if (!inWindow(e.ts)) return bad('INVALID_EVIDENCE');
      const k = await deviceKey(e.credentialId);
      if (k.error) return k.error;
      const ok = verifyHceEvidence(k.spki, {
        credentialId: e.credentialId,
        nonce: b64urlDecode(e.nonce),
        kioskId: ctx.kioskId,
        ts: e.ts,
        signature: b64urlDecode(e.signature),
      });
      if (!ok) return bad('INVALID_EVIDENCE');
      return (await look.useNonce(e.credentialId, e.nonce)) ? { ok: true } : bad('INVALID_EVIDENCE');
    }

    // SCAN: only device-key response QRs (LPR1) can be verified offline; passkey users are confirmed by an assistant.
    const qr = parseResponseQr(e.payload);
    if (qr.kind !== 'DEVICE_KEY' || !inWindow(qr.ts)) return bad('INVALID_EVIDENCE');
    const k = await deviceKey(qr.credentialId);
    if (k.error) return k.error;
    const ok = verifyScanEvidence(k.spki, {
      credentialId: qr.credentialId,
      nonce: qr.nonce,
      kioskId: ctx.kioskId,
      ts: qr.ts,
      signature: qr.signature,
    });
    if (!ok) return bad('INVALID_EVIDENCE');
    const nonce = Buffer.from(qr.nonce).toString('base64url');
    return (await look.useNonce(qr.credentialId, nonce)) ? { ok: true } : bad('INVALID_EVIDENCE');
  } catch {
    return bad('INVALID_EVIDENCE');
  }
}

/** Maps a lending error code from the replay to a conflict reason (null = not a conflict, rethrow). */
export function conflictFromError(code: string): ConflictReason | null {
  switch (code) {
    case 'INSUFFICIENT_STOCK':
    case 'EQUIPMENT_UNAVAILABLE':
      return 'INSUFFICIENT_STOCK';
    case 'STUDENT_INACTIVE':
    case 'STUDENT_SUSPENDED':
      return 'STUDENT_INACTIVE';
    case 'ALREADY_RETURNED':
    case 'NEEDS_REVIEW':
    case 'NOT_FOUND':
      return 'UNKNOWN_LINE';
    default:
      return null;
  }
}
