# ADR-0004 — Student directory integration: file import first, REST adapter when available

- **Status:** Proposed (2026-10-23). Finalised when SIS discovery (`docs/spikes/S01-sis.md`) is complete (decision gate Q2).
- **Context:** It is not yet known whether ICTU's SIS has an API. LabPass needs a student mirror for identification and auto-approval.
- **Decision:**
  - Build the `StudentDirectory` port with the **file adapter (CSV/XLSX)** as the primary path (S05).
  - Build the **REST adapter** generically: configurable base URL, auth, pagination and field mapping. It can be switched on without code changes if the SIS has an API.
  - Imports are dry-run → commit, idempotent, and reversible (before-images).
- **Consequences:** The Registry exports a file each term (or more often). When an API becomes available, a scheduled sync replaces manual imports.
