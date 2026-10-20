# ICTU LabPass — Steps S00–S07 (bootstrap, de-risk, foundation, backend)

> Part of [00-blueprint.md](./00-blueprint.md). Each step can be started cold. First read the blueprint
> **Invariants** (note the "enforced from" column) and the **Execution protocol**. Then read this step and only the cited
> `ARCH §` / `DESIGN §` sections ([01-architecture.md](./01-architecture.md), [02-design-direction.md](./02-design-direction.md)).
> **L-sized steps are delivered as the listed PR slices.** Each slice must leave `pnpm verify` green.

---

## S00 · Repository bootstrap

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| — | — | default | XS | repo root |

**ECC skills:** `git-workflow` · **Agents:** none needed

**Context brief.** The workspace (`Inven-ICTU/`) holds two reference videos and `plans/`. It is not a git repository yet.
S01 and S02 run in parallel in separate worktrees, and worktrees need a repository with a first commit.

**Tasks**
1. Run `git init -b main`.
2. Add a `.gitignore`: `node_modules`, `dist`, `.turbo`, `coverage`, `.env*` except `!.env.example`, `*.mp4`, `.playwright-mcp/`, `spikes/**/build`, `spikes/**/.pepper`.
3. Add a `.gitattributes` containing `* text=auto eol=lf`.
4. Commit `plans/` as `chore(s00): bootstrap repository with construction plan` and tag `labpass/s00`.
5. Create the parallel worktrees: `git worktree add ..\labpass-s01 -b s01` and `git worktree add ..\labpass-s02 -b s02`.

**Verify**
```powershell
git log --oneline -1
git worktree list   # main + s01 + s02
```

**Exit criteria**
- [ ] Repository, first commit, tag, and both worktrees exist.

**Rollback.** Remove `.git`. No code exists yet.

---

## S01 · Hardware, platform & SIS spike (de-risk; freezes the tap protocol)

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S00 | S02, S03 (draft protocol) | default | M + procurement lead time | `spikes/`, `docs/spikes/`, `docs/adr/` |

**ECC skills:** `search-first` · `architecture-decision-records` · `benchmark`
**Agents:** Copilot `research` (vendor docs, part availability) · ECC `core/planner` (feeds results back into the plan)

**Context brief.** Five assumptions decide the design, and none is verified yet:
(a) ICTU cards expose a **stable UID** over PC/SC.
(b) Android **HCE with a real Keystore key** answers our reader fast enough (ARCH §2 note on `HostApduService`, §6).
(c) A PC/SC binding builds for **current Electron** on the lab PC's OS (ARCH §2).
(d) A phone camera reads a QR from the **lab monitor** reliably, and the webcam reads a QR off a phone (ARCH §5 F3).
(e) The **SIS** can supply students through an API or an export (ARCH §9).

Procure on day 1: 2× ACS ACR1252U (one spare), 1× 1080p USB webcam, and test phones (one NFC Android 10+, one budget Tecno/Infinix, one iPhone).
A USB 2D scanner is optional.

**Tasks**
1. **Card survey.** Read the ATR and UID of at least 20 real ICTU cards, 3 times each. Classify the chip.
   Commit **aggregate results only**: chip type, UID length, stable yes/no, last 2 bytes redacted.
   If per-card rows are needed, use `HMAC(spike pepper, uid)` with the pepper kept in an ignored `.pepper` file.
2. **PC/SC binding.** In `spikes/reader-node/`, run `nfc-pcsc` under Node LTS **and** inside an Electron `utilityProcess` on the lab PC's OS.
   If it fails, evaluate a maintained fork and a sidecar binary (Rust `pcsc` crate or .NET PCSC) speaking JSON lines over stdio. Record the result in **ADR-0002**.
3. **HCE with the real crypto path.** In `spikes/hce-android/`, write a Kotlin `HostApduService` implementing ARCH §6 SELECT/SIGN.
   - Use a real Keystore P-256 key: `setUnlockedDeviceRequired(true)`; try StrongBox, fall back to TEE on `StrongBoxUnavailableException`.
   - Sign off the main thread and answer with `sendResponseApdu`.
   - Test cold process (app killed), activity not running, screen locked (must produce **no** signature), and `onDeactivated` mid-exchange.
   - `tap-test.mjs` measures the three HCE metrics in DESIGN §7 over 50 unlocked taps per phone.
4. **Scan-the-Kiosk proof of concept.**
   - Render an `LPK1` QR on the lab monitor. Measure phone-camera decode time (`expo-camera` in a throwaway Expo app) at 30–60 cm, under lab lighting, on all three phones.
   - Measure webcam decoding of a phone-shown `LPR1` QR (`@zxing/browser`).
5. **Lab PC audit.** Record OS edition, CPU, GPU, RAM, display, USB ports, wired network, admin rights, and the `detect-gpu` tier.
6. **SIS discovery** (with Registry/IT). Record the system's name, API docs or an **anonymised** sample, available fields (DOB? phone? email? photo? card UID?) and update frequency.
   Write `docs/spikes/S01-sis.md`.
7. **ADRs:** 0001 reader hardware · 0002 PC/SC binding · 0003 card identification (UID / DESFire / unsupported) · 0004 SIS integration mode.
8. **Freeze Tap Protocol v1.** Validate S03's draft `docs/protocols/tap-protocol-v1.md` and `vectors.json` on real hardware.
   Apply any fixes, then mark the spec **FROZEN**.
   Then update the blueprint decision gates (Q1, Q2, Q8) and add a changelog row.

**Verify**
```powershell
node spikes/reader-node/tap-test.mjs --mode hce --count 50   # success %, APDU ms, exchange p50/p95
node spikes/reader-node/tap-test.mjs --mode card --count 20  # chip class, UID stability (aggregate)
```

**Exit criteria**
- [ ] Each of (a)–(e) has a go/no-go with evidence.
- [ ] HCE (unlocked): ≥ 98 % success, SIGN ≤ 150 ms on the phone, exchange p95 ≤ 400 ms. Locked taps yield no signature.
  If HCE is no-go, ADR-0003 records that phones use Scan-the-Kiosk only.
- [ ] The tap protocol spec is marked FROZEN. Every no-go becomes a plan mutation **before** S06, S11 or S12 start.

**Rollback.** Spikes stay in `spikes/` and are never imported by apps. Delete the folder.

---

## S02 · Monorepo foundation, tokens & motion package

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S00 | S01 | default | M | repo root, `apps/*` (scaffolds), `packages/*` |

**ECC skills:** `coding-standards` · `docker-patterns` · `design-system` · `motion-foundations` · `i18n-sync`
**Agents:** ECC `architecture/arch-system-design` · `devops/ops-cicd-github`

**Context brief.** Create the layout from ARCH §3 so later steps only add modules. Tokens (DESIGN §3) and motion values (DESIGN §4)
become code **here**, so every surface shares one source of truth.

**Tasks**
1. pnpm workspaces + Turborepo. Root scripts:
   - `dev`, `build`, `lint`, `typecheck`, `test`, `verify` (lint + typecheck + test).
   - `contracts:check` (no-op until S03), `db:migrate`, `db:seed`, `test:e2e`.
   - `evidence:check <surface>`: runs the ECC checker against `docs/evidence/<surface>/evidence.json`.
2. `packages/config`:
   - strict tsconfig (`noUncheckedIndexedAccess`), ESLint flat config with an **import-boundaries rule (I6)**, and a **no-raw-motion-values rule (I5)**.
   - Prettier, plus `loadEnv(zodSchema)`.
3. Scaffold the apps, each with a smoke test:
   - `apps/api`: NestJS + Fastify, `GET /health`.
   - `apps/admin`: Next.js App Router + Tailwind v4. `/api/*` rewrites to the API.
   - `apps/kiosk`: electron-vite + React.
   - `apps/mobile`: Expo Router with a dev-client config.
4. `docker-compose.dev.yml`: `postgres:17`, `redis:7`, `axllent/mailpit`, with healthchecks. Add an `.env.example` per app.
5. `packages/design-tokens`: build `tokens.json` (DESIGN §3) into `css/tokens.css`, `tailwind/theme.css` and `native/theme.ts`.
   Add a **contrast test** for every text/background pair.
6. `packages/motion`: `motionTokens`, `springs`, `useSafeMotion` (web) and `reanimated.ts` (RN). Test that stagger stays in 0.05–0.10 and that no value is undefined.
7. `packages/i18n`: `en.json` + `fr.json` with a key-parity test. Self-hosted fonts via `@fontsource/{inter,unbounded,jetbrains-mono}`.
8. Add `.github/workflows/ci.yml` (`pnpm verify` + `contracts:check`), which activates once a remote exists.
   Add a pre-commit hook (`simple-git-hooks`) running `secretlint` + `lint-staged`.

**Verify**
```powershell
pnpm install; pnpm verify
docker compose -f docker-compose.dev.yml up -d --wait
pnpm --filter api dev   # other shell: curl.exe -s http://localhost:3000/health  ->  {"status":"ok"}
```

**Exit criteria**
- [ ] All four apps start; `pnpm verify` is green; the contrast and parity tests pass.
- [ ] Merged to `main` and tagged `labpass/s02`.

**Rollback.** Delete the `s02` branch/worktree. Nothing depends on it yet.

---

## S03 · Domain model, API contract & draft tap protocol (contract-first)

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S02 | S01, S08a | **strongest** | M | `apps/api/prisma`, `packages/contracts`, `docs/protocols` |

**ECC skills:** `contract-first` · `api-design` · `prisma-patterns` · `postgres-patterns` · `database-migrations` · `hexagonal-architecture`
**Agents:** ECC `v3/ddd-domain-expert` · `documentation/docs-api-openapi` · Copilot `rubber-duck` review

**Context brief.** Implements ARCH §4 (every entity, the stock math), §6 (protocol) and §8 (the **whole** API surface).
Doing all of it now means parallel steps S05/S06 rarely touch shared schema or contract files. The OpenAPI contract is authoritative (I3).
The tap protocol is written here as a **DRAFT**, and S01 freezes it on real hardware.

**Tasks**
1. **Multi-file Prisma schema** (`prisma/schema/{platform,identity,inventory,lending,notification}.prisma`) covering **every** ARCH §4 entity.
   Indexes: `matricule` unique, GIN `pg_trgm` on names, `Equipment.code` unique, `(Loan.status, dueAt)`, `(StockMovement.equipmentId, createdAt)`.
2. **Hand-written SQL** in the initial migration (`--create-only`, then edit):
   - `pg_trgm`.
   - Equipment `CHECK (0 <= available <= total)` and loan-line `CHECK (returned + damaged + lost <= issued)`.
   - **Partial unique** `mobile_credential(student_id) WHERE status='ACTIVE'`.
   - Triggers rejecting UPDATE/DELETE on `stock_movement` and `audit_log`.
3. **Idempotent seed**:
   - 8 categories and about 30 items (ISR 4321, Catalyst 2960-X, ASA 5506-X, console cables, SFPs, crimpers, LAN testers…).
   - 200 **synthetic** students: a mix of email-only, phone-only and no-contact.
   - One SUPER_ADMIN from env.
4. **OpenAPI 3.1, split per bounded context** (`packages/contracts/paths/{platform,identity,inventory,lending,notification}.yaml`), bundled by Redocly.
   - Cover all of ARCH §8.
   - RFC 9457 problem schema; `Idempotency-Key`; security schemes `adminCookie`, `kioskToken`, `studentBearer`; `x-roles` on every admin operation.
   - Socket events as JSON Schema in `events/`.
5. Generate the client (`openapi-typescript` + `openapi-fetch`) and zod schemas. `pnpm contracts:check` fails on stale output.
6. Write **`docs/protocols/tap-protocol-v1.md` (DRAFT)**: the byte-level spec from ARCH §6, covering every field, length, encoding, status word, payload grammar and server rule.
   Add `tap-protocol/verify.ts`, `sign.ts` (test helper) and `vectors.json`. Vectors cover positive cases plus **malformed** ones:
   - truncated APDU, wrong Lc, bad DER, base64url with padding, wrong prefix/version;
   - expired, consumed and foreign-kiosk nonce; revoked credential.
7. Testcontainers test proving the CHECKs, the partial unique index and the append-only triggers fire.
8. Write ADR-0005 (contract-first + conventions) and ADR-0006 (stock ledger + DB-transactional idempotency).

**Verify**
```powershell
pnpm db:migrate; pnpm db:seed; pnpm db:seed          # second seed = no changes
pnpm --filter contracts test; pnpm contracts:check
pnpm dlx @redocly/cli lint packages/contracts/openapi.yaml
pnpm --filter api test -- prisma-invariants
```

**Exit criteria**
- [ ] Migrations run from empty; the seed is idempotent; lint is clean; all vectors behave as expected.
- [ ] The rubber-duck review leaves no critical schema or contract issue open.

**Rollback.** `prisma migrate reset` on dev, then revert. No production data exists yet.

---

## S04 · API platform (auth, RBAC, devices, settings, idempotency, outbox, realtime)

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S03 | S08a, S08b | default | L | `apps/api/src/{platform,auth,settings,kiosks,audit,outbox,realtime,notifications/core,storage}` |

**ECC skills:** `nestjs-patterns` · `backend-patterns` · `error-handling` · `redis-patterns` · `hexagonal-architecture` · `mailtrap-email-integration` · `security-review`
**Agents:** ECC `development/dev-backend-api` · `testing/tdd-london-swarm` · `v3/security-architect`

**PR slices:** (a) tasks 1, 11 · (b) 2 · (c) 3–5 · (d) 6–7 · (e) 8–10.

**Context brief.** This is the cross-cutting platform that S05–S07 plug into: ARCH §7 and the Auth/Settings/Kiosks rows of §8.
Domain services depend on **ports** only (I6). Idempotency is **database-transactional** (ARCH §5 F5); Redis is only a cache.

**Tasks**
1. **Bootstrap**:
   - Fastify, helmet, CORS disabled (admin is same-origin).
   - pino with redaction (names, emails, phones, UIDs, tokens, OTPs, PINs) for I4; request id.
   - A contract-driven zod pipe and a problem+json filter.
   - A test helper that validates responses against OpenAPI.
2. **Admin auth**:
   - argon2id; TOTP (`otplib`); Redis sessions; `HttpOnly; Secure; SameSite=Strict` cookies; Origin check; lockout after 5 failures in 15 minutes.
   - `RolesGuard` + `@Roles()`; AdminUser CRUD for SUPER_ADMIN.
3. **Kiosk devices**:
   - Registration code (10 min, single use) → 256-bit token, stored as a SHA-256 hash. `KioskAuthGuard`, heartbeat, revoke.
   - **Challenge pool**: `POST /kiosk/challenges` returns 3 nonces stored at `kc:{kioskId}:{nonce}` with a 60 s TTL. Consumption uses `GETDEL`.
4. **Student tokens**: 10-minute access JWT + rotating refresh token with reuse detection and **token-family revocation**.
5. **Settings module**: typed `Setting` store; `GET/PUT /settings`; `GET /kiosk/config`; a `SettingsChanged` event to `/kiosk`.
   Also `GET /meta/app-config` (`minSupportedVersion`).
6. **Idempotency**: `withIdempotency(tx, scope, key, requestHash, fn)` implements ARCH §5 F5 step 1 inside the caller's transaction, storing the response in the same commit.
   A Redis cache serves fast replays.
7. **Rate limiter** (Redis sliding window, per route). **AuditService** (append-only) + `@Audited()`.
   **CSV utility** `toSafeCsv()` that sanitises cells starting with `= + - @ \t \r`.
8. **Outbox**: an event is written in the same transaction as the change.
   - The relay (separate entry `src/worker.ts`) polls with `FOR UPDATE SKIP LOCKED`, publishes to BullMQ and Socket.IO, and sets `publishedAt`.
   - `ConsumerInbox` helper `handleOnce(consumer, eventId, fn)`.
9. **Realtime**: Socket.IO `/admin` (cookie) and `/kiosk` (device token) with the Redis adapter.
10. **Ports and adapters**:
    - `NotificationChannel` + `EmailChannel` (Nodemailer → Mailpit) + `ConsoleChannel`, with EN/FR react-email templates.
    - `ObjectStorage` + `LocalDiskStorage` (signed upload URLs); `Clock`.
11. **Health**: `/health` and `/ready` (DB + Redis).

**Verify**
```powershell
pnpm --filter api test
pnpm --filter api test:e2e        # Fastify inject + Testcontainers (Postgres, Redis)
pwsh scripts/smoke/auth.ps1       # login → TOTP → /auth/me → logout
```

**Exit criteria**
- [ ] The RBAC matrix test (generated from `x-roles`) covers every admin route × role.
- [ ] A log-redaction test passes (I4).
- [ ] Outbox: publishes only after commit; duplicate delivery is absorbed by `handleOnce`.
- [ ] Idempotency: 20 concurrent same-key requests yield exactly one effect. A replay after a simulated crash post-commit returns the stored response.

**Rollback.** Revert by PR slice. Modules are isolated, so you can also unregister one from `AppModule`.

---

## S05 · Identity: student directory, card binding, enrollment & push

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S04 (+ S01 SIS findings) | S06, S08b | default | L | `apps/api/src/{students,directory,cards,credentials,notifications/push}` |

**ECC skills:** `nestjs-patterns` · `hexagonal-architecture` · `tdd-workflow` · `error-handling` · `security-review`
**Agents:** ECC `development/dev-backend-api` · `v3/pii-detector` · `v3/security-architect`

**PR slices:** (a) tasks 1–3 · (b) 4–5 · (c) 6–8.

**Context brief.** Students come from the school system (REST connector) **or** an imported file (ARCH §9).
Mobile enrollment is **auto-approved** when the details exactly match school records (ARCH §5 F7).
OTPs go through the `NotificationChannel` port. Email works now; SMS starts working automatically when S07 adds the adapter.
If S01 has not finished SIS discovery, build the FILE adapter and stub the REST adapter.

**Parallel-work rule (with S06).** Schema and contract are complete from S03. If a migration is still needed, create it in this worktree.
Whichever of S05/S06 merges **second** rebases and regenerates its migration (`prisma migrate dev --create-only`). Shared composition files take append-only edits.

**Tasks**
1. **`StudentDirectory` port**:
   - `FileDirectoryAdapter`: streaming papaparse with **`;`/`,` auto-detect** and BOM stripping; exceljs streaming reader.
   - `RestDirectoryAdapter`: host allow-list (SSRF guard), API-key or OAuth2 client-credentials auth, pagination, JSONPath mapping.
2. **Import pipeline** (ARCH §9) with **all limits and defences built in now**:
   - inflated-size, row, column and cell caps; formulas read as values only;
   - `photo_url` worker (https, allow-listed host, ≤ 2 MB, re-encoded);
   - dry-run diff; batched commit storing `DirectoryImportChange` before/after;
   - **`POST /directory/imports/{id}/rollback`** applies compensation;
   - error-report CSV via `toSafeCsv()`; template file.
3. **Scheduled REST sync** (BullMQ repeatable) plus `test-connection` and `sync-now`.
4. **Students API**: trigram search and a role-scoped profile.
   **Card binding**: `uidHmac`; admin bind/unbind; import `card_uid`; kiosk **link request** (unknown UID + matricule → OTP to SIS contact, or admin queue).
5. **Manual-entry PIN**: `POST /me/pin` (argon2; requires a session younger than 5 min) and admin/assistant reset. Used by S06 F4.
6. **Enrollment** (ARCH §5 F7 exactly):
   - `EnrollmentSession` binds all phases; `normalizeName`; OTP hashed, 5 attempts, invalidated after use.
   - **Proof of possession** over `popNonce`.
   - Approval runs in one transaction with `SELECT … FOR UPDATE` on the student. It revokes the previous credential and its token family.
   - Rate limits. Android attestation is stored **for audit only** (ADR-0007 decides future enforcement).
7. **Self-service + admin**: `/me`, `/me/credential`, `/me/credential/revoke` (lost phone); the admin queue; approve (`verifiedInPerson` required on mismatch), reject, revoke.
   Outbox events `CredentialRequested` and `CredentialDecided`.
8. **Push**: `ExpoPushChannel` adapter + `POST /me/push-token`. Notify on credential decision.

**Verify**
```powershell
pnpm --filter api test -- directory credentials cards
pnpm --filter api test:e2e -- enrollment import
pnpm --filter api bench:import    # 50k rows: < 60 s, RSS < 300 MB
```
Required fixtures:
- **Names:** "Ngo Bassa  Marie-Thérèse" ≡ "NGO BASSA MARIE-THÉRÈSE"; "Therese" ≢ "Thérèse".
- **Files:**
  - FR headers + `;` CSV + BOM; XLSX with date serials; duplicate matricules; missing required columns.
  - Rows with no contact or phone-only.
  - **Malicious files:** zip bomb, 1M-row CSV, formula cells, `=HYPERLINK(...)` names, private-IP `photo_url`.
- **Import idempotency and rollback:** re-import → 0 changes; commit → rollback → state identical.
- **Enrollment:**
  - Concurrent approvals → exactly one ACTIVE credential.
  - Reused session, expired session, and a wrong PoP signature are all rejected.

**Exit criteria**
- [ ] Import, rollback, enrollment, binding and PIN flows pass; the RBAC matrix is updated.
- [ ] The `pii-detector` review finds no PII in logs or errors, and no unaudited export.

**Rollback.** Revert by slice. A bad production import is undone with the import rollback endpoint.

---

## S06 · Operations: inventory, loans & identify (the core engine)

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S04, S01 (frozen protocol, ADR-0003) | S05, S08b | **strongest** | L | `apps/api/src/{equipment,stock,loans,identify,reports}` |

**ECC skills:** `nestjs-patterns` · `postgres-patterns` · `prisma-patterns` · `tdd-workflow` · `error-handling` · `redis-patterns` · `security-review`
**Agents:** ECC `development/dev-backend-api` · `testing/tdd-london-swarm` · `v3/security-architect` · `v3/performance-engineer`

**PR slices:** (a) tasks 1–2 · (b) 3 · (c) 4–5 · (d) 6–9.

**Context brief.** This is the heart of the system: stock math (ARCH §4), flows F1–F6 (ARCH §5) and the **frozen** tap protocol (§6).
Concurrency correctness comes first. Simultaneous borrows or returns must never break invariant I2, and retries must never double-apply.
Use the `withIdempotency` helper from S04. The same parallel-work rule as S05 applies.

**Tasks**
1. **Equipment & categories**: CRUD, image upload, soft deactivation, search, `lowStockThreshold` (null = global).
2. **Adjust stock** (`POST /equipment/{id}/adjust`, Idempotency-Key):
   - Body `{type: RESTOCK|WRITE_OFF|CORRECTION, delta, reason}`. The new total must be ≥ the quantity out; total and available move together.
   - Writes a movement + `StockChanged`. **Undo** (10 s) is a compensating movement.
3. **Identify** (ARCH §5 F1–F4):
   - `CARD`: HMAC lookup.
   - `HCE` / `SCAN`: verify with the **same `verify.ts`** as contracts, plus atomic challenge consumption.
   - `POST /me/scan`: verifies, then emits `identified` to the target kiosk socket.
   - `MANUAL`: returns name + photo only, then `POST /kiosk/manual/verify` with `PIN` / `OTP` / `ASSISTANT` (`OPEN` only if set by SUPER_ADMIN).

   Generic errors and per-kiosk rate limits apply. The result is `StudentSummary`, eligibility, open lines and a `kioskSession` (2 min).
4. **Borrow** (`POST /kiosk/sign-in`): ARCH §5 F5 exactly — idempotency row, policy checks, ordered conditional decrements, `409` with availability.
5. **Return** (`POST /kiosk/sign-out`): ARCH §5 F6 exactly — lock order (loan lines, then equipment), conditional loan-line update, OK vs DAMAGED handling.
6. **Admin loans**: list/filter; **force-return** (same pattern, reason required, audited). The `OVERDUE` job emits `LoanOverdue`.
7. **Mobile**: `/me/loans`. **Realtime**: availability deltas to `/kiosk` and `/admin`.
8. **Reports**: usage per item/day and peak hours. Exports go through `toSafeCsv()` and are audited.
9. **Ops**: `pnpm ops:reconcile` recomputes I2 from the ledger and reports any drift.

**Verify**
```powershell
pnpm --filter api test -- stock loans identify
pnpm --filter api test:concurrency   # see list below
pnpm --filter api test:property      # fast-check: random adjust/borrow/return/force-return sequences keep I2
pnpm --filter api bench:identify     # server p95 < 150 ms on seed data
```
`test:concurrency` must cover:
- 50 parallel borrows of 1 unit with available = 5 → exactly 5 succeed.
- Duplicate returns of the same line.
- Borrow vs return on the same item.
- Return vs force-return.
- Multi-line carts in opposite orders (deadlock check).
- Same Idempotency-Key fired 20 times.

**Exit criteria**
- [ ] The concurrency suite passes 20 runs in a row; all **positive and malformed** vectors pass through the HTTP endpoints.
- [ ] `ops:reconcile` = 0 drift after the property run. Manual entry without verification cannot reach sign-in.

**Rollback.** Revert by slice. The ledger is append-only, so data fixes are compensating movements.

---

## S07 · Notifications & low-stock alerts (email · SMS · WhatsApp)

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S06 | S09, S11, S12 | default | M | `apps/api/src/{notifications,alerts}` |

**ECC skills:** `nestjs-patterns` · `redis-patterns` · `error-handling` · `mailtrap-email-integration` · `i18n-sync` · `security-review`
**Agents:** ECC `development/dev-backend-api` · `v3/security-architect` (secrets, webhook verification)

**Context brief.** The admin sets a threshold per item (or a global default). When available stock reaches it, subscribed admins are
alerted by **email, SMS and/or WhatsApp** (ARCH §5 F8).

WhatsApp Cloud API needs a verified Meta Business account, a registered sender number and **pre-approved templates** for
business-initiated messages. The webhook needs a GET verification handshake and `X-Hub-Signature-256` over the raw body.

This step delivers working adapters, verified against sandboxes or mocks. **Real-channel acceptance is a mandatory S14 gate.**

**Tasks**
1. **Channel adapters**:
   - `SmsChannel`: provider interface; one implementation per decision gate Q5, plus a mock.
   - `WhatsAppChannel`: Graph API `messages`. The utility template `labpass_low_stock` (item, available, threshold, link) is written in EN/FR and **submitted for approval now**.
     Use a webhook raw-body parser. Track the opt-in record for each admin recipient.
2. **Delivery**:
   - A BullMQ queue per channel; 5 retries with exponential backoff; dead-letter queue.
   - Job id `occurrenceId:channel:recipient`. `NotificationLog` with masked recipients. Provider receipts and webhooks update the status.
3. **AlertEvaluator** (ARCH §5 F8 exactly):
   - Inbox-deduplicated, one job at a time per equipment, reading **current** stock.
   - Creates and resolves `AlertOccurrence`. OUT bypasses quiet hours. Optional digest window.
4. **Recipient verification**: an admin phone/WhatsApp number must pass OTP (`POST /admin-users/me/verify-phone`) before it receives alerts.
5. **APIs**: alert rules (global and per item), per-admin channel preferences, quiet hours, `POST /notifications/test`, delivery log.
6. **Student notices**: overdue reminders (setting: off / email / SMS / push) and a device-revoked notice.
7. **Secrets**: provider secrets encrypted at rest (AES-256-GCM), write-only via the API, SUPER_ADMIN only. Per-channel feature flags.

**Verify**
```powershell
pnpm --filter api test -- alerts notifications   # see list below
pnpm --filter api test:e2e -- low-stock          # adjust below threshold → Mailpit email; NotificationLog SENT
```
The unit tests must cover:
- Crossing down fires once; staying below does not repeat; crossing back up re-arms.
- OUT during quiet hours still sends.
- Duplicate and reordered events cause no extra sends.
- Webhook: valid, tampered and missing signature; GET handshake.

**Exit criteria**
- [ ] The evaluator truth table is fully covered; email works end-to-end.
- [ ] SMS and WhatsApp pass against their sandbox/mock. The template submission and its status are recorded in `docs/runbooks/whatsapp.md`.

**Rollback.** **Pause** the affected queues (`queue.pause()`) so jobs are kept, not dropped. Fix or revert, then resume. Disable the channel flags if needed.
