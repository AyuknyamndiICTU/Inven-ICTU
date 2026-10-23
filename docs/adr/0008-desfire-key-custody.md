# ADR-0008 — DESFire key custody

- **Status:** Proposed (2026-10-23). To be approved by ICTU IT before the first card personalisation.
- **Context:** Per-card DESFire keys are derived from two ICTU master keys (AMK, LAK; card spec Part B3).
  Whoever holds the master keys can clone or re-key every card. Losing them makes cards un-re-keyable.
- **Decision:**
  - **Personalisation option B-1:** ICTU writes the LabPass application after delivery, with the LabPass tool. The supplier never sees the keys.
  - **Key generation:** master keys are generated on an offline machine and recorded as **2-of-3 Shamir shares**, held by the LabPass owner, ICTU IT and the Registrar, each in a sealed envelope or safe.
  - **Key storage:** the LabPass server loads the master keys from a Docker secret (`/run/secrets/desfire_master_keys`). They are never logged, never returned by any API, and never sent to the kiosk.
  - **Rotation:** keys are versioned (`keyVersion`). On rotation, cards are re-keyed on their next tap at the kiosk.
- **Consequences:** Card distribution includes a personalisation step (about 2 s per card). The escrow procedure is in the runbook `docs/runbooks/desfire-keys.md` (S14).
