import { z } from 'zod';
import { B64Url, IdentifyMethod, IsoDateTime, StudentStatus, Uuid } from '../common';

/** Data a kiosk caches to keep lending while the API is unreachable (ARCH §5 F9). */
export const OfflineBundle = z
  .object({
    version: z.int(),
    issuedAt: IsoDateTime,
    expiresAt: IsoDateTime,
    kioskId: Uuid,
    keyVersion: z.int(),
    /** Per-kiosk HMAC key (base64url) used to look up card UIDs locally. Rotated with every bundle. */
    lookupKey: B64Url,
    equipment: z.array(
      z.object({ id: Uuid, code: z.string(), name: z.string(), categoryName: z.string(), available: z.int() }),
    ),
    cards: z.array(z.object({ uidLookup: B64Url, studentId: Uuid })),
    students: z.array(
      z.object({
        id: Uuid,
        matricule: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        status: StudentStatus,
        overdue: z.boolean(),
        openLines: z.array(
          z.object({ loanLineId: Uuid, equipmentId: Uuid, equipmentName: z.string(), outstanding: z.int() }),
        ),
      }),
    ),
    credentials: z.array(
      z.object({
        credentialId: Uuid,
        studentId: Uuid,
        kind: z.enum(['DEVICE_KEY', 'PASSKEY']),
        publicKey: B64Url,
        webauthnCredentialId: z.string().nullable(),
      }),
    ),
    /**
     * Lab assistants who may confirm offline loans. `pinParams` is the argon2id encoded hash **without** its digest
     * (`$argon2id$v=19$m=…,t=…,p=…$<salt>`); `wrappedKey` is the per-kiosk MAC key sealed with AES-256-GCM under
     * SHA-256(argon2 digest). Only the right PIN unwraps it, and the MAC it yields is verified by the server at sync.
     */
    assistants: z.array(z.object({ id: Uuid, name: z.string(), pinParams: z.string(), wrappedKey: B64Url })),
    settings: z.object({
      blockWhenOverdue: z.boolean(),
      maxItemsPerStudent: z.int().nullable(),
      offlineMaxHours: z.int(),
      cardAuthMode: z.enum(['UID', 'DESFIRE_PREFERRED', 'DESFIRE_REQUIRED']),
    }),
  })
  .meta({ id: 'OfflineBundle' });
export type OfflineBundle = z.infer<typeof OfflineBundle>;

export const OfflineTransaction = z.object({
  txId: Uuid,
  seq: z.int().nonnegative(),
  occurredAt: IsoDateTime,
  kind: z.enum(['BORROW', 'RETURN']),
  studentId: Uuid,
  method: IdentifyMethod,
  evidence: z.discriminatedUnion('type', [
    /**
     * `uid` (hex) lets the server re-check the card binding at sync: the server stores UIDs only as peppered HMACs,
     * so it cannot pre-compute kiosk lookups (ADR-0009). It travels inside the encrypted journal and over TLS only.
     */
    z.object({
      type: z.literal('CARD'),
      uidLookup: B64Url,
      uid: z
        .string()
        .regex(/^[0-9A-Fa-f]{8,20}$/)
        .optional(),
    }),
    z.object({ type: z.literal('HCE'), credentialId: Uuid, nonce: B64Url, ts: z.int(), signature: B64Url }),
    z.object({ type: z.literal('SCAN'), payload: z.string() }),
    /** `mac` = HMAC-SHA256(assistant MAC key, canonical transaction) — see `offlineTxMacInput`. */
    z.object({ type: z.literal('ASSISTANT'), assistantId: Uuid, mac: B64Url }),
  ]),
  borrowLines: z.array(z.object({ equipmentId: Uuid, quantity: z.int().min(1) })).default([]),
  returnLines: z
    .array(z.object({ loanLineId: Uuid, quantity: z.int().min(1), condition: z.enum(['OK', 'DAMAGED']) }))
    .default([]),
});
export type OfflineTransaction = z.infer<typeof OfflineTransaction>;

/**
 * Canonical bytes an assistant MAC covers: who, what and when — so a MAC can never be reused for another student,
 * other lines, or another transaction id.
 */
export function offlineTxMacInput(tx: {
  txId: string;
  studentId: string;
  kind: 'BORROW' | 'RETURN';
  occurredAt: string;
  borrowLines?: Array<{ equipmentId: string; quantity: number }>;
  returnLines?: Array<{ loanLineId: string; quantity: number; condition: string }>;
}): string {
  const lines =
    tx.kind === 'BORROW'
      ? (tx.borrowLines ?? []).map((l) => `${l.equipmentId}:${l.quantity}`).sort()
      : (tx.returnLines ?? []).map((l) => `${l.loanLineId}:${l.quantity}:${l.condition}`).sort();
  return ['LP-OFFLINE-ASSIST-1', tx.txId, tx.studentId, tx.kind, tx.occurredAt, ...lines].join('|');
}

export const OfflineSyncBody = z.object({
  offlineFrom: IsoDateTime,
  offlineTo: IsoDateTime,
  bundleVersion: z.int(),
  transactions: z.array(OfflineTransaction).max(5000),
});
export const OfflineSyncResponse = z.object({
  batchId: Uuid,
  applied: z.array(Uuid),
  duplicates: z.array(Uuid),
  conflicts: z.array(z.object({ txId: Uuid, reason: z.string() })),
});

export const SyncConflictDto = z.object({
  id: Uuid,
  batchId: Uuid,
  kioskId: Uuid,
  txId: z.string(),
  reason: z.enum([
    'INSUFFICIENT_STOCK',
    'CREDENTIAL_REVOKED',
    'STUDENT_INACTIVE',
    'BUNDLE_EXPIRED',
    'INVALID_EVIDENCE',
    'UNKNOWN_LINE',
  ]),
  payload: z.unknown(),
  resolution: z.enum(['ACCEPTED', 'VOIDED']).nullable(),
  note: z.string().nullable(),
  createdAt: IsoDateTime,
  resolvedAt: IsoDateTime.nullable(),
});
export const ResolveConflictBody = z.object({
  resolution: z.enum(['ACCEPTED', 'VOIDED']),
  note: z.string().trim().min(3).max(500),
});
