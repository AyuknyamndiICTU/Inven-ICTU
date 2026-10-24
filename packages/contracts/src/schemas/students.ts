import { z } from 'zod';
import { IsoDate, IsoDateTime, PageQuery, StudentStatus, Uuid } from '../common';

export const StudentListItem = z
  .object({
    id: Uuid,
    matricule: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    program: z.string().nullable(),
    level: z.string().nullable(),
    status: StudentStatus,
    hasCard: z.boolean(),
    hasCredential: z.boolean(),
    openLoans: z.int(),
  })
  .meta({ id: 'StudentListItem' });

export const CardBindingDto = z.object({
  id: Uuid,
  uidSuffix: z.string().nullable(),
  cardTech: z.enum(['DESFIRE_EV3', 'OTHER']),
  status: z.enum(['ACTIVE', 'REVOKED']),
  createdVia: z.enum(['SUPPLIER_FILE', 'SIS', 'OTP', 'ADMIN']),
  authFailures: z.int(),
  /** DESFire key version (ADR-0008); null for UID-only cards. */
  keyVersion: z.int().nullable(),
  createdAt: IsoDateTime,
  revokedAt: IsoDateTime.nullable(),
});

export const CredentialDto = z
  .object({
    id: Uuid,
    kind: z.enum(['DEVICE_KEY', 'PASSKEY']),
    platform: z.enum(['ANDROID_APP', 'WEB']),
    status: z.enum(['PENDING', 'ACTIVE', 'REVOKED', 'REJECTED']),
    deviceLabel: z.string().nullable(),
    capabilities: z.object({ hce: z.boolean(), scan: z.boolean() }),
    backedUp: z.boolean().nullable(),
    createdAt: IsoDateTime,
    revokedAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'Credential' });

export const StudentDetail = StudentListItem.extend({
  /** Contact fields are masked for LAB_ASSISTANT and VIEWER (ARCH §7). */
  email: z.string().nullable(),
  phone: z.string().nullable(),
  dateOfBirth: IsoDate.nullable(),
  photoUrl: z.string().nullable(),
  hasPin: z.boolean(),
  pinLocked: z.boolean(),
  cards: z.array(CardBindingDto),
  credentials: z.array(CredentialDto),
  createdAt: IsoDateTime,
  syncedAt: IsoDateTime.nullable(),
}).meta({ id: 'StudentDetail' });

export const StudentListQuery = PageQuery.extend({
  search: z.string().trim().max(80).optional(),
  status: StudentStatus.optional(),
});

export const BindCardBody = z.object({ uid: z.string().regex(/^[0-9A-Fa-f]{8,20}$/) });

export const CardLinkRequestDto = z.object({
  id: Uuid,
  matricule: z.string(),
  uidSuffix: z.string().nullable(),
  status: z.enum(['PENDING_OTP', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED']),
  student: z.object({ id: Uuid, firstName: z.string(), lastName: z.string() }).nullable(),
  createdAt: IsoDateTime,
});

// ───────────── Directory imports (ARCH §9) ─────────────

export const ImportKind = z.enum(['STUDENTS', 'CARD_BATCH']);
export const StudentField = z.enum([
  'matricule',
  'first_name',
  'last_name',
  'date_of_birth',
  'email',
  'phone',
  'program',
  'level',
  'status',
  'card_uid',
  'photo_url',
]);
export const CardBatchField = z.enum(['card_uid', 'matricule', 'batch_id', 'printed_at']);

export const ImportCounts = z.object({
  total: z.int(),
  new: z.int(),
  changed: z.int(),
  unchanged: z.int(),
  invalid: z.int(),
  missing: z.int(),
});

export const DirectoryImportDto = z
  .object({
    id: Uuid,
    kind: ImportKind,
    source: z.enum(['FILE', 'REST']),
    fileName: z.string().nullable(),
    status: z.enum(['PREVIEW', 'COMMITTING', 'COMMITTED', 'ROLLED_BACK', 'FAILED']),
    counts: ImportCounts,
    detectedHeaders: z.array(z.string()),
    mapping: z.record(z.string(), z.string().nullable()),
    deactivateMissing: z.boolean(),
    issues: z.array(z.object({ row: z.int(), field: z.string().nullable(), message: z.string() })),
    issueCount: z.int(),
    createdAt: IsoDateTime,
    committedAt: IsoDateTime.nullable(),
    rolledBackAt: IsoDateTime.nullable(),
    error: z.string().nullable(),
  })
  .meta({ id: 'DirectoryImport' });
export type DirectoryImportDto = z.infer<typeof DirectoryImportDto>;

export const ImportUploadQuery = z.object({
  kind: ImportKind.default('STUDENTS'),
  fileName: z.string().trim().min(1).max(200),
});
export const ImportMappingBody = z.object({ mapping: z.record(z.string(), z.string().nullable()) });
export const ImportCommitBody = z.object({ deactivateMissing: z.boolean().default(false) });

export const ConnectorConfig = z
  .object({
    enabled: z.boolean(),
    baseUrl: z.url().nullable(),
    auth: z.discriminatedUnion('type', [
      z.object({ type: z.literal('NONE') }),
      z.object({ type: z.literal('API_KEY'), header: z.string().min(1), hasKey: z.boolean() }),
      z.object({ type: z.literal('OAUTH2'), tokenUrl: z.url(), clientId: z.string(), hasSecret: z.boolean() }),
    ]),
    studentsPath: z.string().default('/students'),
    pagination: z.enum(['NONE', 'PAGE', 'CURSOR']).default('PAGE'),
    itemsPath: z.string().default('items'),
    mapping: z.record(z.string(), z.string()),
    scheduleCron: z.string().nullable(),
    lastSyncAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'ConnectorConfig' });

export const ConnectorUpdateBody = ConnectorConfig.omit({ lastSyncAt: true, auth: true }).extend({
  auth: z.discriminatedUnion('type', [
    z.object({ type: z.literal('NONE') }),
    z.object({ type: z.literal('API_KEY'), header: z.string().min(1), key: z.string().min(1).optional() }),
    z.object({
      type: z.literal('OAUTH2'),
      tokenUrl: z.url(),
      clientId: z.string(),
      clientSecret: z.string().min(1).optional(),
    }),
  ]),
});
export const ConnectorTestResponse = z.object({ ok: z.boolean(), sampleCount: z.int(), message: z.string() });
