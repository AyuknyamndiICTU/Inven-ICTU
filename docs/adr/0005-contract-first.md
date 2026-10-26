# ADR-0005 — Contract-first with a zod route registry (OpenAPI generated)

- **Status:** Accepted (2026-10-23, S03).
- **Context:** The plan (S03) called for a hand-written `openapi.yaml` with generated TypeScript clients. All four surfaces are TypeScript in one monorepo.
  A hand-written YAML spec drifts from both the server validation and the client types unless three artifacts are kept in sync.
- **Decision:** The **authoritative contract is `packages/contracts`**:
  - zod schemas, plus a route registry (`routes.ts`) recording, for each endpoint: method, path, auth kind, minimum role, params/query/body/response schemas, and the idempotent, audited and rate-limit flags.
  - The **API** validates every request (and, in tests, every response) against the registry.
  - The **clients** (admin, kiosk, student app) use `createApiClient()`, whose types are inferred from the registry.
    Browser bundles import it from `@labpass/contracts/client`, which reads a generated zod-free `manifest.ts` (method, path, idempotent and body/response kinds) so route JS stays within the 250 KB budget.
    A test fails when the manifest drifts from the registry. Callers can pass `validate: validateResponse` (main entry) to check responses.
  - **`openapi.json` (OpenAPI 3.1)** is generated from the registry. `pnpm contracts:check` fails when it is stale (invariant I3).
  - The **RBAC matrix test** is generated from each route's `minRole` (the plan's `x-roles`).
- **Consequences:**
  - There is one source of truth, and drift is impossible without failing CI.
  - Non-TypeScript consumers (Kotlin) use `openapi.json` and the tap-protocol vectors.
  - WebAuthn payloads are opaque in the contract and validated by `@simplewebauthn/server`.
