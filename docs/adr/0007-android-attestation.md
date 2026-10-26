# ADR-0007 — Android key attestation: store for audit, do not enforce (v1)

- **Status:** Accepted (2026-10-27).
- **Context:** When a student turns their Android phone into a lab card (S12), the app creates a hardware-backed device key and can send the Android Key Attestation certificate chain with the credential request. Enforcing attestation would prove the key lives in a TEE/StrongBox on a genuine, unrooted device. However:
  - Many low-cost phones used by students ship broken or missing attestation roots. Enforcing it would lock out a meaningful share of students for reasons they cannot fix.
  - Google rotates the attestation root (2026) and publishes revocation lists. Verifying properly means keeping both up to date on a server that may run offline for weeks.
  - The tap itself is already protected by a fresh kiosk challenge signed by the device key, and every request is approved or auto-approved against the school record (S05). Cloning a phone credential requires extracting the private key.
- **Decision:** For v1 the server **accepts and stores** the attestation chain (`credential.attestation`, JSON) for audit and later analysis, but **does not reject** a credential based on it. The chain is classified as sensitive and is never written to logs or audit diffs (`platform/audit/audit.ts`).
- **Consequences:**
  - A rooted phone can hold a valid LabPass credential. Mitigations: per-credential revocation in Admin → Students, the "one active phone per student" rule, and nonce-replay protection (`used_evidence_nonces`, S13).
  - Revisit after the pilot. If more than 95 % of enrolled devices present a valid chain, add an `attestationPolicy` setting (`off` | `warn` | `require`) and verify chains against the Google roots and revocation list.
