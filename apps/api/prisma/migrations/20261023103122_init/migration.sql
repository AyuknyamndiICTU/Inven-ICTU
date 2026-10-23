-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'LAB_ADMIN', 'LAB_ASSISTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CardTech" AS ENUM ('DESFIRE_EV3', 'OTHER');

-- CreateEnum
CREATE TYPE "BindingStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "BindingSource" AS ENUM ('SUPPLIER_FILE', 'SIS', 'OTP', 'ADMIN');

-- CreateEnum
CREATE TYPE "CredentialKind" AS ENUM ('DEVICE_KEY', 'PASSKEY');

-- CreateEnum
CREATE TYPE "CredentialPlatform" AS ENUM ('ANDROID_APP', 'WEB');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RequestDecision" AS ENUM ('AUTO_APPROVED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('STARTED', 'OTP_SENT', 'OTP_VERIFIED', 'REVIEW', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RESTOCK', 'WRITE_OFF', 'CORRECTION', 'ISSUE', 'RETURN', 'DAMAGED', 'LOST');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('ADMIN', 'KIOSK', 'STUDENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "IdentifyMethod" AS ENUM ('CARD', 'HCE', 'SCAN', 'MANUAL');

-- CreateEnum
CREATE TYPE "ManualVerification" AS ENUM ('PIN', 'OTP', 'ASSISTANT', 'OPEN');

-- CreateEnum
CREATE TYPE "KioskStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('FILE', 'REST');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('STUDENTS', 'CARD_BATCH');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'COMMITTING', 'COMMITTED', 'ROLLED_BACK', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportChangeType" AS ENUM ('CREATE', 'UPDATE', 'DEACTIVATE', 'BIND_CARD', 'REVOKE_CARD');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'OUT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "PushKind" AS ENUM ('EXPO', 'WEBPUSH');

-- CreateEnum
CREATE TYPE "LinkRequestStatus" AS ENUM ('PENDING_OTP', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SyncConflictReason" AS ENUM ('INSUFFICIENT_STOCK', 'CREDENTIAL_REVOKED', 'STUDENT_INACTIVE', 'BUNDLE_EXPIRED', 'INVALID_EVIDENCE', 'UNKNOWN_LINE');

-- CreateEnum
CREATE TYPE "SyncConflictResolution" AS ENUM ('ACCEPTED', 'VOIDED');

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "matricule" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "dateOfBirth" DATE NOT NULL,
    "program" TEXT,
    "level" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "sisExternalId" TEXT,
    "sourceHash" TEXT,
    "photoKey" TEXT,
    "manualPinHash" TEXT,
    "pinFailures" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_imports" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL DEFAULT 'STUDENTS',
    "source" "ImportSource" NOT NULL DEFAULT 'FILE',
    "fileName" TEXT,
    "storageKey" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "mapping" JSONB,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "deactivateMissing" BOOLEAN NOT NULL DEFAULT false,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "directory_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_import_issues" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "row" INTEGER NOT NULL,
    "field" TEXT,
    "message" TEXT NOT NULL,

    CONSTRAINT "directory_import_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_import_changes" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "changeType" "ImportChangeType" NOT NULL,
    "studentId" UUID,
    "cardBindingId" UUID,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "directory_import_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_bindings" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "uidHmac" TEXT NOT NULL,
    "uidSuffix" TEXT,
    "cardTech" "CardTech" NOT NULL DEFAULT 'OTHER',
    "keyVersion" INTEGER,
    "status" "BindingStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdVia" "BindingSource" NOT NULL,
    "authFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "card_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_link_requests" (
    "id" UUID NOT NULL,
    "uidHmac" TEXT NOT NULL,
    "uidSuffix" TEXT,
    "matricule" TEXT NOT NULL,
    "studentId" UUID,
    "kioskId" UUID,
    "status" "LinkRequestStatus" NOT NULL,
    "otpHash" TEXT,
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_link_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_sessions" (
    "id" UUID NOT NULL,
    "matricule" TEXT NOT NULL,
    "studentId" UUID,
    "submitted" JSONB NOT NULL,
    "matchResult" JSONB NOT NULL,
    "allMatch" BOOLEAN NOT NULL,
    "otpHash" TEXT,
    "otpChannel" TEXT,
    "otpDestinationMasked" TEXT,
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "otpSentAt" TIMESTAMP(3),
    "otpVerifiedAt" TIMESTAMP(3),
    "popNonce" TEXT,
    "pollTokenHash" TEXT,
    "webauthnChallenge" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'STARTED',
    "deviceFingerprint" TEXT,
    "credentialId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mobile_credentials" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "kind" "CredentialKind" NOT NULL,
    "platform" "CredentialPlatform" NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "deviceLabel" TEXT,
    "status" "CredentialStatus" NOT NULL DEFAULT 'PENDING',
    "publicKeySpki" BYTEA,
    "attestation" JSONB,
    "webauthnCredentialId" TEXT,
    "cosePublicKey" BYTEA,
    "signCount" INTEGER NOT NULL DEFAULT 0,
    "backupEligible" BOOLEAN,
    "backedUp" BOOLEAN,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenFamilyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "mobile_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_requests" (
    "id" UUID NOT NULL,
    "enrollmentSessionId" UUID NOT NULL,
    "credentialId" UUID NOT NULL,
    "studentId" UUID,
    "decision" "RequestDecision" NOT NULL,
    "matchResult" JSONB NOT NULL,
    "reviewerId" UUID,
    "verifiedInPerson" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "credential_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_refresh_tokens" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "credentialId" UUID NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "student_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "kind" "PushKind" NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "equipment_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "description" TEXT,
    "imageKey" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "totalQuantity" INTEGER NOT NULL DEFAULT 0,
    "availableQuantity" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "totalDelta" INTEGER NOT NULL DEFAULT 0,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "loanLineId" UUID,
    "kioskId" UUID,
    "reason" TEXT,
    "compensatesId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "kioskId" UUID,
    "identifyMethod" "IdentifyMethod" NOT NULL,
    "manualVerification" "ManualVerification",
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "status" "LoanStatus" NOT NULL DEFAULT 'OPEN',
    "overdueNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_lines" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "qtyIssued" INTEGER NOT NULL,
    "qtyReturned" INTEGER NOT NULL DEFAULT 0,
    "qtyDamaged" INTEGER NOT NULL DEFAULT 0,
    "qtyLost" INTEGER NOT NULL DEFAULT 0,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "loan_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosks" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "tokenHash" TEXT,
    "registrationCodeHash" TEXT,
    "registrationExpiresAt" TIMESTAMP(3),
    "status" "KioskStatus" NOT NULL DEFAULT 'PENDING',
    "lastSeenAt" TIMESTAMP(3),
    "appVersion" TEXT,
    "readerStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecretEnc" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "phoneE164" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "whatsappE164" TEXT,
    "whatsappVerifiedAt" TIMESTAMP(3),
    "assistantPinHash" TEXT,
    "notificationPrefs" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumer_inbox" (
    "consumer" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumer_inbox_pkey" PRIMARY KEY ("consumer","eventId")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "diff" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_occurrences" (
    "id" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "availableAtFire" INTEGER NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "alert_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "occurrenceId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "recipientMasked" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kiosk_offline_keys" (
    "id" UUID NOT NULL,
    "kioskId" UUID NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kiosk_offline_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_sync_batches" (
    "id" UUID NOT NULL,
    "kioskId" UUID NOT NULL,
    "offlineFrom" TIMESTAMP(3) NOT NULL,
    "offlineTo" TIMESTAMP(3) NOT NULL,
    "txCount" INTEGER NOT NULL,
    "applied" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_sync_conflicts" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "offlineTxId" TEXT NOT NULL,
    "reason" "SyncConflictReason" NOT NULL,
    "payload" JSONB NOT NULL,
    "resolution" "SyncConflictResolution",
    "resolverId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "offline_sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "students_matricule_key" ON "students"("matricule");

-- CreateIndex
CREATE INDEX "students_status_idx" ON "students"("status");

-- CreateIndex
CREATE INDEX "directory_imports_createdAt_idx" ON "directory_imports"("createdAt");

-- CreateIndex
CREATE INDEX "directory_import_issues_importId_idx" ON "directory_import_issues"("importId");

-- CreateIndex
CREATE INDEX "directory_import_changes_importId_idx" ON "directory_import_changes"("importId");

-- CreateIndex
CREATE INDEX "card_bindings_studentId_idx" ON "card_bindings"("studentId");

-- CreateIndex
CREATE INDEX "card_bindings_uidHmac_idx" ON "card_bindings"("uidHmac");

-- CreateIndex
CREATE INDEX "card_link_requests_status_idx" ON "card_link_requests"("status");

-- CreateIndex
CREATE INDEX "enrollment_sessions_matricule_createdAt_idx" ON "enrollment_sessions"("matricule", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_credentials_webauthnCredentialId_key" ON "mobile_credentials"("webauthnCredentialId");

-- CreateIndex
CREATE INDEX "mobile_credentials_studentId_idx" ON "mobile_credentials"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "credential_requests_enrollmentSessionId_key" ON "credential_requests"("enrollmentSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "credential_requests_credentialId_key" ON "credential_requests"("credentialId");

-- CreateIndex
CREATE INDEX "credential_requests_decision_createdAt_idx" ON "credential_requests"("decision", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "student_refresh_tokens_tokenHash_key" ON "student_refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "student_refresh_tokens_familyId_idx" ON "student_refresh_tokens"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_studentId_idx" ON "push_tokens"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_categories_name_key" ON "equipment_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_code_key" ON "equipment"("code");

-- CreateIndex
CREATE INDEX "equipment_categoryId_idx" ON "equipment"("categoryId");

-- CreateIndex
CREATE INDEX "stock_movements_equipmentId_createdAt_idx" ON "stock_movements"("equipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_createdAt_idx" ON "stock_movements"("createdAt");

-- CreateIndex
CREATE INDEX "loans_status_dueAt_idx" ON "loans"("status", "dueAt");

-- CreateIndex
CREATE INDEX "loans_studentId_status_idx" ON "loans"("studentId", "status");

-- CreateIndex
CREATE INDEX "loan_lines_loanId_idx" ON "loan_lines"("loanId");

-- CreateIndex
CREATE INDEX "loan_lines_equipmentId_idx" ON "loan_lines"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "kiosks_tokenHash_key" ON "kiosks"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE INDEX "outbox_events_publishedAt_createdAt_idx" ON "outbox_events"("publishedAt", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- CreateIndex
CREATE INDEX "alert_occurrences_equipmentId_firedAt_idx" ON "alert_occurrences"("equipmentId", "firedAt");

-- CreateIndex
CREATE INDEX "notification_logs_createdAt_idx" ON "notification_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notification_logs_providerMessageId_idx" ON "notification_logs"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "kiosk_offline_keys_kioskId_keyVersion_key" ON "kiosk_offline_keys"("kioskId", "keyVersion");

-- CreateIndex
CREATE INDEX "offline_sync_conflicts_resolution_idx" ON "offline_sync_conflicts"("resolution");

-- CreateIndex
CREATE UNIQUE INDEX "offline_sync_conflicts_offlineTxId_key" ON "offline_sync_conflicts"("offlineTxId");

-- AddForeignKey
ALTER TABLE "directory_import_issues" ADD CONSTRAINT "directory_import_issues_importId_fkey" FOREIGN KEY ("importId") REFERENCES "directory_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_import_changes" ADD CONSTRAINT "directory_import_changes_importId_fkey" FOREIGN KEY ("importId") REFERENCES "directory_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_bindings" ADD CONSTRAINT "card_bindings_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_credentials" ADD CONSTRAINT "mobile_credentials_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_requests" ADD CONSTRAINT "credential_requests_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "mobile_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_requests" ADD CONSTRAINT "credential_requests_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_refresh_tokens" ADD CONSTRAINT "student_refresh_tokens_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "equipment_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_lines" ADD CONSTRAINT "loan_lines_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_lines" ADD CONSTRAINT "loan_lines_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_occurrences" ADD CONSTRAINT "alert_occurrences_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "alert_occurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kiosk_offline_keys" ADD CONSTRAINT "kiosk_offline_keys_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "kiosks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_conflicts" ADD CONSTRAINT "offline_sync_conflicts_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "offline_sync_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- LabPass invariants that Prisma cannot express (ARCH §4; invariants I2 and I7)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fast fuzzy student search (admin console, matricule lookups).
CREATE INDEX "students_name_trgm_idx" ON "students" USING gin ((lower("firstName" || ' ' || "lastName")) gin_trgm_ops);
CREATE INDEX "students_matricule_trgm_idx" ON "students" USING gin ((lower("matricule")) gin_trgm_ops);

-- I2: stock can never go negative or above the total.
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_quantities_check"
  CHECK ("totalQuantity" >= 0 AND "availableQuantity" >= 0 AND "availableQuantity" <= "totalQuantity");
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_threshold_check"
  CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0);

-- A loan line can never settle more units than were issued.
ALTER TABLE "loan_lines" ADD CONSTRAINT "loan_lines_quantities_check"
  CHECK ("qtyIssued" > 0 AND "qtyReturned" >= 0 AND "qtyDamaged" >= 0 AND "qtyLost" >= 0
         AND "qtyReturned" + "qtyDamaged" + "qtyLost" <= "qtyIssued");

-- One ACTIVE credential per student; one ACTIVE binding per card and per student; one open alert per item.
CREATE UNIQUE INDEX "mobile_credentials_one_active_per_student" ON "mobile_credentials" ("studentId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "card_bindings_one_active_per_uid" ON "card_bindings" ("uidHmac") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "card_bindings_one_active_per_student" ON "card_bindings" ("studentId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "alert_occurrences_one_open_per_equipment" ON "alert_occurrences" ("equipmentId") WHERE "resolvedAt" IS NULL;

-- Outbox relay scans only unpublished events.
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" ("createdAt") WHERE "publishedAt" IS NULL;

-- I7: the stock ledger and the audit log are append-only.
-- (TRUNCATE is reserved for the database owner; the production app role is granted INSERT/SELECT only — see runbook.)
CREATE OR REPLACE FUNCTION labpass_reject_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER "stock_movements_append_only" BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION labpass_reject_modification();
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION labpass_reject_modification();
