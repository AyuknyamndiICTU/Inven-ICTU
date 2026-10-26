-- S13 finding 2: phone nonces that backed an identification can never be reused (offline replay protection).
CREATE TABLE "used_evidence_nonces" (
    "credentialId" UUID NOT NULL,
    "nonce" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "used_evidence_nonces_pkey" PRIMARY KEY ("credentialId","nonce")
);

CREATE INDEX "used_evidence_nonces_usedAt_idx" ON "used_evidence_nonces"("usedAt");
