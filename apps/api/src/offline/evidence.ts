import type { OfflineTransaction } from '@labpass/contracts';
import { b64urlDecode, parseResponseQr, verifyHceEvidence, verifyScanEvidence } from '@labpass/contracts/tap-node';

export type ConflictReason =
  | 'INSUFFICIENT_STOCK'
  | 'CREDENTIAL_REVOKED'
  | 'STUDENT_INACTIVE'
  | 'BUNDLE_EXPIRED'
  | 'INVALID_EVIDENCE'
  | 'UNKNOWN_LINE';

/** What the sync needs to know about the credential or card named in the evidence. */
export interface EvidenceLookups {
  /** ACTIVE card binding owner for a raw UID (via the peppered HMAC), or null. */
  cardOwner(uidHex: string): Promise<string | null>;
  credential(id: string): Promise<{
    studentId: string;
    status: string;
    kind: 'DEVICE_KEY' | 'PASSKEY';
    spki: Uint8Array | null;
  } | null>;
  assistantActive(id: string): Promise<boolean>;
}

export interface EvidenceContext {
  kioskId: string;
  /** The window the kiosk was offline, widened by `skewMs` either side. */
  offlineFrom: number;
  offlineTo: number;
  skewMs?: number;
}

export type EvidenceResult = { ok: true } | { ok: false; reason: ConflictReason };

const bad = (reason: ConflictReason): EvidenceResult => ({ ok: false, reason });

/**
 * Re-verifies offline identification evidence at sync time (ARCH §5 F9, S11.5 task 4).
 * The kiosk generated its own nonces offline, so instead of the online single-use challenge the signed timestamp
 * must fall inside the declared offline window; the txId is the replay guard (unique idempotency key).
 */
export async function checkEvidence(
  tx: Pick<OfflineTransaction, 'studentId' | 'occurredAt' | 'evidence'>,
  ctx: EvidenceContext,
  look: EvidenceLookups,
): Promise<EvidenceResult> {
  const skew = ctx.skewMs ?? 5 * 60_000;
  const inWindow = (ms: number) => ms >= ctx.offlineFrom - skew && ms <= ctx.offlineTo + skew;
  if (!inWindow(Date.parse(tx.occurredAt))) return bad('INVALID_EVIDENCE');
  const e = tx.evidence;

  if (e.type === 'CARD') {
    if (!e.uid) return bad('INVALID_EVIDENCE');
    const owner = await look.cardOwner(e.uid.toUpperCase());
    if (!owner) return bad('CREDENTIAL_REVOKED');
    return owner === tx.studentId ? { ok: true } : bad('INVALID_EVIDENCE');
  }

  if (e.type === 'ASSISTANT') {
    return (await look.assistantActive(e.assistantId)) ? { ok: true } : bad('INVALID_EVIDENCE');
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
      return ok ? { ok: true } : bad('INVALID_EVIDENCE');
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
    return ok ? { ok: true } : bad('INVALID_EVIDENCE');
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
