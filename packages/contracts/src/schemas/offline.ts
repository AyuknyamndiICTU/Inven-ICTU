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
    assistants: z.array(z.object({ id: Uuid, name: z.string(), pinHash: z.string() })),
    settings: z.object({
      blockWhenOverdue: z.boolean(),
      maxItemsPerStudent: z.int().nullable(),
      offlineMaxHours: z.int(),
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
    z.object({ type: z.literal('CARD'), uidLookup: B64Url }),
    z.object({ type: z.literal('HCE'), credentialId: Uuid, nonce: B64Url, ts: z.int(), signature: B64Url }),
    z.object({ type: z.literal('SCAN'), payload: z.string() }),
    z.object({ type: z.literal('ASSISTANT'), assistantId: Uuid }),
  ]),
  borrowLines: z.array(z.object({ equipmentId: Uuid, quantity: z.int().min(1) })).default([]),
  returnLines: z
    .array(z.object({ loanLineId: Uuid, quantity: z.int().min(1), condition: z.enum(['OK', 'DAMAGED']) }))
    .default([]),
});
export type OfflineTransaction = z.infer<typeof OfflineTransaction>;

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
