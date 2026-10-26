# ICTU LabPass — Project Plan & Progress Tracker

This file is the **single place to track progress**. Each task links to its full specification:

- [00-blueprint.md](./00-blueprint.md): dependencies, invariants, decision gates.
- Step files: [S00–S07](./03-steps-foundation-backend.md) and [S08a–S14](./04-steps-surfaces-release.md).
- [01-architecture.md](./01-architecture.md) and [02-design-direction.md](./02-design-direction.md).

## How to use this tracker

| Mark    | Meaning         |
| ------- | --------------- |
| `- [ ]` | Not started     |
| `- [/]` | **In progress** |
| `- [x]` | **Completed**   |

1. Change a task to `[/]` when you start it. Change it to `[x]` only when its checks pass (from M2 onward, that includes `pnpm verify`).
2. A milestone is complete when **every task and every Acceptance box** under it is `[x]`. Then set its dashboard status to ✅ and fill in _Completed_.
3. If a task is blocked, keep it `[/]` and add `⛔ reason` at the end of the line. Set the milestone to ⛔ in the dashboard.
4. If the plan changes (split, insert, skip), follow the mutation protocol in the blueprint. Mark a skipped task as `- [x] ~~task~~ (skipped: reason)`.
5. The checkboxes inside the step files are _definitions_ of done. Track progress **here** only.
6. **Decision gates** are ticked `[x]` when they are decided, **or** explicitly deferred to the step that needs them. A deferred gate is
   ticked with `→ Mx` and becomes a task in that milestone, so M0 can close. Decisions are recorded in the
   [blueprint decision log](./00-blueprint.md#decision-gates-open-questions-for-ictu).

> GitHub renders `[/]` as plain text rather than a checkbox. It still reads clearly as "in progress".

## Progress dashboard

Status: ⬜ Not started · 🟨 In progress · ✅ Completed · ⛔ Blocked

| Phase                    | Milestone                                                                                  | Steps             | Target weeks* | Done          | Status               |
| ------------------------ | ------------------------------------------------------------------------------------------ | ----------------- | ------------- | ------------- | -------------------- |
| 0 · Kickoff              | [M0 Project kicked off](#m0--project-kicked-off)                                           | S00 + decisions   | W1            | 20 / 28       | 🟨                   |
| 1 · De-risk & foundation | [M1 Hardware de-risked, protocol frozen](#m1--hardware-de-risked--tap-protocol-frozen-s01) | S01               | W1–W4         | 0 / 14        | ⛔ hardware purchase |
|                          | [M2 Foundation ready](#m2--foundation-ready-s02)                                           | S02               | W1–W2         | 10 / 10       | ✅                   |
| 2 · Core backend         | [M3 Contract & platform](#m3--contract--platform-s03-s04)                                  | S03, S04          | W3–W5         | 21 / 21       | ✅                   |
|                          | [M4 Identity & lending engine](#m4--identity--lending-engine-s05--s06)                     | S05, S06          | W6–W8         | 20 / 21       | 🟨                   |
|                          | [M5 Low-stock alerts](#m5--low-stock-alerts-dev-verified-s07)                              | S07               | W9–W10        | 8 / 11        | 🟨                   |
| 3 · Design system        | [M6 UI kit & signature theatre](#m6--ui-kit--signature-theatre-s08a-s08b)                  | S08a, S08b        | W3–W7         | 11 / 13       | 🟨                   |
| 4 · Product surfaces     | [M7 Admin console](#m7--admin-console-s09-s10)                                             | S09, S10          | W9–W13        | 12 / 16       | 🟨                   |
|                          | [M8 Kiosk app](#m8--kiosk-app-s11-s065-s115)                                               | S11, S06.5, S11.5 | W9–W15        | 23 / 28       | 🟨                   |
|                          | [M9 Student app: web + Android](#m9--student-app-web-app--android-nfc-app-s12)             | S12               | W9–W13        | 5 / 11        | 🟨                   |
| 5 · Hardening            | [M10 Release candidate](#m10--release-candidate-s13)                                       | S13               | W16–W17       | 7 / 10        | 🟨                   |
| 6 · Launch               | [M11 Production, pilot & go-live](#m11--production-pilot--go-live-s14)                     | S14               | W18–W21       | 5 / 19        | 🟨                   |
|                          | **Total**                                                                                  | 18 steps          | ~21 weeks     | **142 / 202** |                      |

\* Indicative, for a team of 3–4 developers. Phases 2 and 3 run in parallel, and so do M7–M9. The kiosk (M8) runs 2 weeks longer than in v1.1 because of offline mode and DESFire. Refine the dates after M1.

---

## Phase 0 — Kickoff & decisions (Week 1)

### M0 · Project kicked off

Owner: AyuknyamndiICTU · Started: 2026-10-20 · Completed: —

**Procurement** (hardware lead time is the first schedule risk)

- [ ] Order 2× ACS ACR1252U NFC readers (one spare). Do **not** use the ACR122U.
- [ ] Order a 1080p USB webcam (a USB 2D barcode scanner is optional).
- [ ] Get test phones: an NFC Android (10+), a budget Tecno/Infinix, and an iPhone.
- [ ] Order 20 blank **MIFARE DESFire EV3 (≥ 2 KB)** sample cards (decision Q1; ICTU cards have no NFC chip yet)

**Decision gates** (owners, deadlines and safe defaults are in the [blueprint](./00-blueprint.md#decision-gates-open-questions-for-ictu))

- [x] Q1 — ID card chip: **no NFC chip yet; new cards will use MIFARE DESFire EV3, and the supplier provides a `card_uid,matricule` file** → spec in M1, S06.5 added
- [x] Q2 — School SIS: unknown → investigated with Registry/IT in **M1** (S01 SIS discovery). Default: file import
- [x] Q3 — **Sign In = borrow, Sign Out = return**
- [x] Q4 — Loan rules: **due by lab closing time · no item limit · overdue students blocked**
- [x] Q5 — WhatsApp: **ICTU creates/verifies a Meta Business account with a dedicated number**. SMS provider → chosen in **M5**
- [x] Q6 — Offline loans: **required** → S11.5 added (+~2 weeks)
- [x] Q7 — Hosting: **on-campus server managed by ICTU IT** (public access → Q13)
- [x] Q8 — Lab PC: **one kiosk PC in the Cisco lab, Windows 10/11** (specs and GPU audited in M1)
- [x] Q9 — Manual-entry policy: **`PIN_OR_ASSISTANT`**
- [x] Q10 — Student app: **hybrid**, an installable web app for every phone + an Android NFC app (APK), one codebase, **no store accounts for the pilot** (D3)
- [x] Q11 — Branding → **M6** (ICTU Communications provides logo + colours; placeholders until then) · data-protection sign-off → **M11** (synthetic data only until approved)
- [x] Q12 — Code-signing certificate → **M11** (ICTU IT checks; manual kiosk updates until then)
- [x] Q13 — Public reachability → **M9 / M11** (ICTU IT checks; campus Wi-Fi only until then). An ICTU subdomain with a public certificate is needed either way
- [x] ICTU confirms deviation **D1** (PIN or assistant check after matricule entry)
- [x] ICTU confirms deviation **D2** (iPhones use Scan-the-Kiosk instead of NFC)
- [x] Deviation **D3** chosen: student platform = web app + Android APK (Q10)

**Follow-up actions from the decisions** (start now; these have external lead times)

- [ ] ICTU tells the card supplier now: MIFARE DESFire EV3 (≥ 2 KB), **random UID disabled**, plus a `card_uid,matricule` file per batch. The full personalisation spec follows from M1
- [ ] ICTU starts Meta Business verification and reserves a dedicated WhatsApp number
- [ ] ICTU IT reserves the subdomain `labpass.ictuniversity.edu.cm` (or similar) and plans a **publicly trusted** TLS certificate (Let's Encrypt DNS-01 or ICTU's wildcard). Passkeys need it even if the server stays campus-only

**[S00 · Repository bootstrap](./03-steps-foundation-backend.md#s00--repository-bootstrap)**

- [x] `git init -b main`; add `.gitignore` and `.gitattributes`
- [x] Commit `plans/`; tag `labpass/s00`
- [x] Create the `s01` and `s02` worktrees

**Acceptance**

- [ ] Hardware is ordered and every decision gate has a named owner
- [x] The repository, tag and both worktrees exist

---

## Phase 1 — De-risk & foundation (Weeks 1–4)

### M1 · Hardware de-risked & tap protocol frozen (S01)

Owner: — · Started: — · Completed: — · Details: [S01](./03-steps-foundation-backend.md#s01--hardware-platform--sis-spike-de-risk-freezes-the-tap-protocol)

- [/] Write `docs/protocols/card-personalisation-v1.md` (DESFire EV3, random UID off, AN10922 key diversification, key ceremony, `card_uid,matricule` file format) and **send it to the card supplier** through ICTU — written; ⛔ sending waits for ICTU to choose the card supplier
- [/] Validate 10 blank DESFire EV3 samples: stable UID, relayed AES authentication p95 over PC/SC, failure cases (aggregate results committed) ⛔ waiting for hardware purchase (budget approval)
- [/] PC/SC binding tested in Node and in an Electron `utilityProcess` → ADR-0002 ⛔ waiting for hardware purchase (budget approval)
- [/] HCE spike with a real Keystore key: StrongBox→TEE fallback, async `sendResponseApdu`, cold/locked/deactivated cases ⛔ waiting for hardware purchase (budget approval)
- [/] Scan-the-Kiosk PoC: phone camera reading the lab monitor (Android app **and** web app on iPhone + Android); webcam reading `LPR1`/`LPR2` response QRs ⛔ waiting for hardware purchase (budget approval) (protocol and server side done in S06)
- [/] Passkey PoC: register and assert a passkey on all three test phones, including the budget Android — server side verified with a software authenticator (S05/S06); ⛔ real phones pending
- [/] Lab PC audit: OS, GPU tier, USB ports, network, admin rights ⛔ waiting for hardware purchase (budget approval)
- [/] SIS discovery written up in `docs/spikes/S01-sis.md` (closes Q2) — questionnaire written; ⛔ answers from ICTU Registry/IT pending (file import + REST connector both built)
- [/] ADR-0001 (reader) · ADR-0002 (binding) · ADR-0003 (card identification: DESFire EV3) · ADR-0004 (SIS mode) · ADR-0008 (DESFire key custody) — all drafted; 0001–0003 are confirmed after the hardware run
- [/] Tap Protocol v1 (drafted in S03) validated on hardware and marked **FROZEN** ⛔ waiting for hardware purchase (budget approval)
- [ ] Blueprint gates Q1, Q2 and Q8 updated; changelog row added

**Acceptance**

- [ ] Go/no-go recorded, with evidence, for each of: DESFire cards, HCE, PC/SC binding, camera/QR, SIS
- [ ] HCE (unlocked): ≥ 98 % success, SIGN ≤ 150 ms, exchange p95 ≤ 400 ms; locked phone gives no signature. _Or_ "phones use Scan-the-Kiosk only" is recorded
- [ ] Every no-go is a plan mutation before S06, S11 or S12 start

### M2 · Foundation ready (S02)

Owner: AyuknyamndiICTU · Started: 2026-10-21 · Completed: 2026-10-22 · Details: [S02](./03-steps-foundation-backend.md#s02--monorepo-foundation-tokens--motion-package)

- [x] pnpm workspaces + Turborepo + root scripts (`verify`, `contracts:check`, `evidence:check`, …)
- [x] `packages/config`: strict TS, ESLint import-boundaries and no-raw-motion rules, env loader
- [x] Scaffold `apps/api`, `apps/admin`, `apps/kiosk` and `apps/mobile`, each with a smoke test
- [x] `docker-compose.dev.yml` (Postgres 17, Redis 7, Mailpit) + `.env.example` files
- [x] `packages/design-tokens` (CSS, Tailwind and React Native outputs) + contrast test
- [x] `packages/motion` (tokens, springs, `useSafeMotion`, Reanimated presets) + tests
- [x] `packages/i18n` EN/FR + key-parity test; self-hosted fonts
- [x] CI workflow + pre-commit hook (`secretlint`, `lint-staged`)

**Acceptance**

- [x] All four apps start; `pnpm verify` is green
- [x] Merged to `main` and tagged `labpass/s02`

---

## Phase 2 — Core backend (Weeks 3–10)

### M3 · Contract & platform (S03, S04)

Owner: AyuknyamndiICTU · Started: 2026-10-22 · Completed: 2026-10-23

**[S03 · Domain model, contract & draft protocol](./03-steps-foundation-backend.md#s03--domain-model-api-contract--draft-tap-protocol-contract-first)**

- [x] Multi-file Prisma schema covering every entity, with indexes
- [x] SQL migration: `pg_trgm`, stock and loan CHECKs, one-active-credential partial index, append-only triggers
- [x] Idempotent seed: categories, about 30 Cisco items, 200 synthetic students, SUPER_ADMIN
- [x] OpenAPI 3.1 split per bounded context: `x-roles`, problem+json, `Idempotency-Key`, event schemas — generated from the zod route registry, tagged per context
- [x] Generated client + zod schemas; `pnpm contracts:check`
- [x] Draft tap protocol spec + `verify.ts`/`sign.ts` + positive and malformed vectors
- [x] Testcontainers test for the DB invariants — runs against the compose test database
- [x] ADR-0005 (contract-first) and ADR-0006 (ledger + idempotency)
- [x] **Acceptance:** migrates from empty; seed is idempotent; Redocly lint is clean; vectors pass; rubber-duck review is clean — OpenAPI checked by `contracts:check`

**[S04 · API platform](./03-steps-foundation-backend.md#s04--api-platform-auth-rbac-devices-settings-idempotency-outbox-realtime)**, in PR slices

- [x] (a) Bootstrap: Fastify, helmet, pino redaction, zod pipe, problem+json, `/health` and `/ready`
- [x] (b) Admin auth: argon2id, TOTP, Redis sessions, lockout, RBAC guard
- [x] (c) Kiosk devices + challenge pool
- [x] (c) Student tokens with rotation and family revocation
- [x] (c) Settings module, `/kiosk/config` and `/meta/app-config`
- [x] (d) DB-transactional idempotency, rate limiter, audit service, `toSafeCsv()`
- [x] (e) Outbox (`SKIP LOCKED`) + ConsumerInbox, Socket.IO namespaces
- [x] (e) Ports: Email, Console, ObjectStorage, Clock — Email, notification channels and ObjectStorage ports; time is injected per call
- [x] **Acceptance:** the RBAC matrix (generated from `x-roles`) passes
- [x] **Acceptance:** the log-redaction test passes (I4)
- [x] **Acceptance:** outbox events publish only after commit; duplicates are absorbed
- [x] **Acceptance:** 20 concurrent same-key requests produce one effect; replay after a crash returns the stored response

### M4 · Identity & lending engine (S05 ∥ S06)

Owner: AyuknyamndiICTU · Started: 2026-10-23 · Completed: —

**[S05 · Identity](./03-steps-foundation-backend.md#s05--identity-student-directory-card-binding-enrollment--push)**, in PR slices

- [x] (a) Directory port: file adapter (CSV `;`/`,`, BOM, XLSX) + REST adapter (SSRF allow-list)
- [x] (a) Import pipeline: limits, dry-run diff, batched commit, **rollback**, safe error CSV
- [x] (a) Scheduled REST sync, test-connection and sync-now
- [x] (b) Students API (trigram search, role-scoped profile)
- [x] (b) Card binding, **supplier card-batch import**, kiosk link requests
- [x] (b) Manual-entry PIN (`/me/pin`) and reset
- [x] (c) Enrollment: session, OTP, proof of possession (Android device key **or** web passkey), auto-approve or PENDING, one active credential
- [x] (c) `/me` self-service, lost-phone revoke; admin approve/reject/revoke
- [x] (c) Push channels: Expo push (Android app) + Web Push (web app), `/me/push-token`
- [x] **Acceptance:** name, file, malicious-file, import-rollback and enrollment-race fixtures pass
- [/] **Acceptance:** 50k-row import in < 60 s with RSS < 300 MB; `pii-detector` review is clean — re-measured 2026-10-26: **35 s ✅**, peak RSS 496 MB (231 MB harness baseline + 265 MB import) ❌ over the 300 MB budget, inside the 768 MB API container limit; streaming import planned ([evidence](../../docs/evidence/import-2026-10-26.json)); personal-data review done in S13 (threat model) ✅

**[S06 · Inventory, loans & identify](./03-steps-foundation-backend.md#s06--operations-inventory-loans--identify-the-core-engine)**, in PR slices

- [x] (a) Equipment & categories CRUD, images, low-stock thresholds
- [x] (a) Adjust stock (RESTOCK / WRITE_OFF / CORRECTION) with a 10 s undo
- [x] (b) Identify: CARD, HCE, SCAN (device key or passkey; `/me/scan` → kiosk socket), MANUAL + `/kiosk/manual/verify`
- [x] (c) Borrow — `/kiosk/sign-in` (ARCH F5)
- [x] (c) Return — `/kiosk/sign-out` (ARCH F6)
- [x] (d) Admin loans, force-return, overdue job, `/me/loans`, realtime deltas
- [x] (d) Reports with safe, audited exports; `pnpm ops:reconcile`
- [x] **Acceptance:** the concurrency suite passes 20 runs in a row
- [x] **Acceptance:** positive and malformed vectors pass over HTTP; identify p95 < 150 ms — vectors pass; identify p95 **20–32 ms** over two runs (200 taps each, 0 errors) ([evidence](../../docs/evidence/identify-2026-10-26.json)); re-run on the lab server in the pilot
- [x] **Acceptance:** property tests hold invariant I2; `ops:reconcile` reports 0 drift; an unverified manual entry cannot borrow

### M5 · Low-stock alerts, dev-verified (S07)

Owner: AyuknyamndiICTU · Started: 2026-10-23 · Completed: — · Details: [S07](./03-steps-foundation-backend.md#s07--notifications--low-stock-alerts-email--sms--whatsapp)

- [/] **Choose the SMS provider** (compare local Cameroonian gateways with international ones on cost, delivery and API), which closes Q5 — generic HTTP gateway adapter built; ⛔ ICTU picks the provider (budget)
- [x] SMS adapter (chosen provider) + mock — generic HTTP-JSON gateway adapter + mock
- [/] WhatsApp adapter; `labpass_low_stock` EN/FR template **submitted to Meta** — adapter + templates documented in `docs/runbooks/whatsapp.md`; ⛔ submission waits for Meta Business verification
- [x] Per-channel queues, retries, DLQ, NotificationLog, receipts and webhook (GET handshake + signature)
- [x] AlertEvaluator: AlertOccurrence, one job at a time per item, quiet hours, digest — digest = delay window for LOW alerts
- [x] Admin phone/WhatsApp number verification by OTP
- [x] APIs: alert rules, channel preferences, quiet hours, test send, delivery log — thresholds per item (equipment) and global (settings)
- [x] Student notices (overdue, device revoked)
- [x] Provider secrets encrypted and write-only; per-channel feature flags

**Acceptance**

- [x] The evaluator truth table is covered; webhook signature tests pass
- [/] Email works end-to-end. SMS and WhatsApp pass against sandbox/mock. The template status is recorded in the runbook — email (Mailpit), SMS and WhatsApp (local fakes) pass; ⛔ template status is "pending" until Meta verification

---

## Phase 3 — Design system (Weeks 3–7, in parallel with Phase 2)

### M6 · UI kit & signature theatre (S08a, S08b)

Owner: AyuknyamndiICTU · Started: 2026-10-23 · Completed: —

**[S08a · Accessible primitives](./04-steps-surfaces-release.md#s08a--ui-kit--accessible-primitives-states--css-level-signatures-packagesui)**

- [x] Primitives: Button, Input, **Combobox (the kiosk dropdown)**, QuantityStepper, StockHealth, Dialog/Drawer, Toast + Undo, Table, Skeleton, EmptyState, Tabs, KPI Counter, StatusCapsule, PIN pad
- [x] CSS/SVG signatures: CapsuleNav (A7), StockSkyline (A5), BlurPush (A8), DepthType (A9), HorizonGlow (A10), plus static fallbacks
- [x] Icons: lucide + in-house equipment silhouettes
- [/] Apply the ICTU logo and brand colours (`ictu-*` tokens) once ICTU Communications delivers them (Q11). Until then, keep the placeholders and a re-check contrast test ⛔ waiting for ICTU Communications
- [x] ~~Storybook~~ → component tests (vitest + axe, reduced motion, CSS↔token parity) + a living gallery at admin `/kit`; visual snapshots move to S13 (plan change: Storybook's install/runtime cost on the dev machine)
- [x] **Acceptance:** 0 serious axe violations ✅ (27 tests); rendered critique against DESIGN §2 done on the `/kit` gallery during S09

**[S08b · Signature theatre & WebGL](./04-steps-surfaces-release.md#s08b--signature-theatre--webgl-scenes)**

- [x] SceneProvider: shared ~~OGL~~ raw-WebGL canvas (lazy 3.3 KB chunk), GPU tier gating (offline renderer heuristic instead of `detect-gpu`), `motionLevel` + FrameGovernor auto-degrade
- [x] ReaderEye: idle orb (A1), horizon sweep (A2), error flicker (E1)
- [x] IdentityRise (A3) and FannedCart (A4)
- [x] RingLanding + ParticleConverge (A6) — Canvas 2D, ≤ 600 deterministic particles
- [x] LiveTicker (A11), LiveChallengeQR (A13), WebGL HorizonGlow
- [x] ~~Stories~~ → `/kit` Theatre lab (full/reduced/minimal switch + 10 s perf probe), 16 theatre tests, lazy loading, size budget script (index 13.3 KB gz)
- [/] **Acceptance:** every effect has a fallback ✅; `minimal` keeps every action usable ✅; long tasks > 50 ms seen only from the Next dev page (at every motion level) — re-measure on a production build / lab PC in S13

---

## Phase 4 — Product surfaces (Weeks 9–15)

### M7 · Admin console (S09, S10)

Owner: AyuknyamndiICTU · Started: 2026-10-24 · Completed: —

**[S09 · Operations](./04-steps-surfaces-release.md#s09--admin-console--operations-inventory-loans-dashboard-kiosks)**, in PR slices

- [x] (a) Shell: CapsuleNav, role-aware navigation, EN/FR, light/dark, ⌘K palette, realtime cache bridge
- [x] (a) Login + TOTP (enrolment QR, one-step retry on a wrong code)
- [x] (b) Dashboard: KPIs, live StockSkyline, activity feed, low stock, kiosks, overdue
- [x] (c) Inventory table, **Add/Edit equipment**, **Adjust stock** (+/−) with Undo, movement timeline
- [x] (d) Loans (tabs, force-return, export)
- [x] (d) Kiosks (register with code + QR, status, revoke); permission screens
- [/] **Acceptance:** e2e login → add item → adjust +5/−3 → undo → skyline updates — verified by hand in a browser (login + TOTP, write-off −3 → Undo, live socket); the automated Playwright suite lands in S13
- [/] **Acceptance:** route JS ≤ 250 KB ✅ (max 223 KB first load, zod-free `@labpass/contracts/client`); LCP/INP and the finish gate at 1440x900 and 390x844 are measured on the lab server in S13

**[S10 · People, credentials & configuration](./04-steps-surfaces-release.md#s10--admin-console--people-credentials--configuration)**, in PR slices

- [x] (a) Students: search and profile, card bind/unbind, link approvals, PIN reset
- [x] (a) Import wizard (map → diff → commit → history → rollback) + SIS connector page
- [x] (b) Credential request queue: per-field diff, in-person verification
- [x] (c) Alerts & notifications: thresholds, channels with OTP verification, quiet hours, test send, delivery log
- [x] (d) Settings: labels, manual policy, loan rules, kiosk settings, retention, `minSupportedVersion`
- [x] (d) Users & roles, audit log, reports
- [/] **Acceptance:** (API-level tests cover each flow; browser e2e moves to S13) e2e covers import + rollback, auto and manual approval, threshold → email, settings → kiosk event
- [/] **Acceptance:** (scheduled with the S13 audit pass) `click-path-audit` is clean, the finish gate passes, and the `pii-detector` review is clean

### M8 · Kiosk app (S11, S06.5, S11.5)

Owner: AyuknyamndiICTU · Started: 2026-10-26 · Completed: — · Details: [S11](./04-steps-surfaces-release.md#s11--kiosk-app-electron--nfc-reader--the-showpiece) · [S06.5](./03-steps-foundation-backend.md#s065--desfire-ev3-card-authentication-inserted-by-decision-q1) · [S11.5](./04-steps-surfaces-release.md#s115--kiosk-offline-mode-inserted-by-decision-q6)

**S11 · Kiosk app**

- [x] (a) Hardened Electron main process: kiosk mode, single instance, auto-start, relaunch on crash (+ CSP that forbids every renderer request, webcam-only permission, PII-free rotating log)
- [x] (a) ReaderDriver (PcscDriver in a `utilityProcess` + FakeReader): SELECT-then-UID, locked-phone detection, debounce, LED and buzzer — native binding verified on the lab PC in M1
- [x] (a) Typed IPC for business operations only; the token never reaches the renderer (device token in DPAPI `safeStorage`; the student session JWT also stays in main)
- [x] (b) Main-process API client, `/kiosk` socket, challenge pool, heartbeat, device registration (code or `LPKR1` QR)
- [x] (b) Scan-the-Kiosk: LiveChallengeQR + optional webcam response QR (jsQR in the renderer → text only to main)
- [x] (c) XState flow and timers, K9 error states, K10 assistant overlay (19 model tests: every transition and timeout)
- [x] (d) Screens K1–K10 with A1–A13/E1: **dropdown borrow**, open-lines return, matricule + PIN, link card; EN/FR, aria-live greeting, sound cues
- [x] (e) Degraded mode (reader missing / API down → K9), NSIS packaging (`pnpm --filter @labpass/kiosk dist`, self-contained 1.8 MB asar), ~~signed auto-update~~ → manual-update runbook [`docs/runbooks/kiosk.md`](../../docs/runbooks/kiosk.md) until Q12
- [x] **Acceptance:** e2e passes: card, HCE, scan, manual, unknown card, `409`, API down, token isolation (13 Playwright `_electron` scenarios + 43 main-process tests)
- [ ] **Acceptance:** real reader: A2 ≤ 100 ms; tap → student shown p95 ≤ 800 ms ⛔ hardware
- [ ] **Acceptance:** the 12 h soak passes; 60 fps on the lab PC (or the auto-selected `motionLevel`) ⛔ lab PC
- [/] **Acceptance:** finish gate at 1920x1080 and 1366x768 ✅ (screenshots from the e2e run, layout fixed for both); Electronegativity scan moves to S13 with the other security scans

**S06.5 · DESFire EV3 card authentication** (decision Q1)

- [x] `CardKeyStore` port: master key from a secret, per-card AN10922 keys, versioned keys, never logged
- [x] Relay endpoints `/kiosk/card-auth/start` and `/step` (`AuthenticateEV2First`), added to the contract
- [x] Kiosk `transceive` + `DesfireRelay`; failures follow `cardAuthMode` (no answer → `6F00`, server decides)
- [x] NXP test vectors + FakeCard simulator, with all failure cases
- [x] Admin: `cardAuthMode` setting, key version and auth-failure count on the student profile
- [x] **Acceptance:** all vectors and failure cases pass; keys never leave the server (I4 test)
- [ ] **Acceptance:** 50 real sample-card taps: ≥ 99 % success, p95 ≤ 800 ms; crypto review is clean

**S11.5 · Kiosk offline mode** (decision Q6)

- [x] (a) API offline bundle (versioned, `KioskOfflineKey` rotation; equipment, students, credential keys, assistant hashes — no contacts/photos/UIDs). ~~Signed~~ → integrity by TLS + device token; card lookups learned by the kiosk ([ADR-0009](../../docs/adr/0009-kiosk-offline-mode.md))
- [x] (a) Kiosk encrypted offline store (AES-256-GCM, key wrapped by DPAPI `safeStorage`), refreshed every 5 minutes, wiped on revocation
- [x] (b) Offline engine: detection (10 s), local identification (learned CARD lookup / HCE / LPR1 with kiosk nonces / assistant PIN via argon2), ordered journal, read-only lock after `offlineMaxHours` (assistant can extend), amber UI + pending counter + offline receipts — LPR2 passkeys → assistant (ADR-0009)
- [x] (b) API `/kiosk/offline-sync`: ordered replay with txId idempotency, evidence re-verified, `OfflineSyncConflict` rows, admin realtime alert
- [x] (c) Admin **Offline sync** page (accept with stock correction, or void; audited)
- [x] (c) Contract additions (`evidence.uid`, OpenAPI regenerated) + [`docs/runbooks/kiosk-offline.md`](../../docs/runbooks/kiosk-offline.md)
- [x] **Acceptance:** cut the API → 20 offline transactions → sync → 0 drift; replaying the sync is a no-op (kiosk round-trip test + API replay test)
- [x] **Acceptance:** conflicts go to admin review and never break I2 (API test asserts `available + out = total` after accept/void)
- [/] **Acceptance:** read-only lock works ✅; the cache is encrypted at rest ✅ (test checks no matricule/UID in the file); formal `pii-detector` review with S13

### M9 · Student app: web app + Android NFC app (S12)

Owner: — · Started: — · Completed: — · Details: [S12](./04-steps-surfaces-release.md#s12--student-app-expo--installable-web-app--android-nfc-app)

- [ ] ICTU IT provides the LabPass subdomain with a **publicly trusted** TLS certificate, and decides whether it is reachable from the internet (Q13). Needed before device testing; use an HTTPS tunnel for development until then ⛔ ICTU IT
- [x] (a) Expo foundation for **web + Android** targets: router, query client, EN/FR, theme (system light/dark from tokens), platform token storage (SecureStore / HttpOnly cookie), minimum-version and APK-update check
- [x] (b) **Web app (PWA)**: manifest + generated icons, service worker (shell + last Pass/loans), install guide (iOS Add to Home Screen), passkeys (WebAuthn), camera QR scan (BarcodeDetector + lazy jsQR), Web Push (VAPID opt-in), `LPR2` offline QR
- [/] (c) **Android native module** `ictu-credential`: Keystore key (StrongBox → TEE, unlocked-only), headless `HostApduService`, manifest merge (~~config plugin~~ not needed), NFC detection + preferred service; JUnit vector test written — ⏳ run with Gradle on the build PC (runbook)
- [x] (d) Shared screens: onboarding, enroll, OTP, credential creation, pending/approved/rejected
- [x] (d) **Pass** screen: Tap (Android app) and **Scan kiosk** (all) with offline response QR; loans; profile (language, PIN, revoke, sign out)
- [/] (e) Hardening: screen capture blocked + brightness boost on the response QR ✅, 60 s QR expiry ✅, pinning + key-custody [ADR-0010](../../docs/adr/0010-student-app-hardening.md) ✅, passkey BE/BS recorded server-side ✅; soft root warning → S13
- [x] (e) Distribution: ICTU-held APK signing key ([runbook](../../docs/runbooks/android-release.md)), `/download/android` page (checksum + QR), PWA served same-origin at the site root (~~`/app`~~, so passkeys and cookies share the API origin), `runtimeVersion` policy

**Acceptance**

- [/] Android native vectors pass (⏳ Gradle on build PC); Playwright passkey flow (virtual authenticator) → S13; PWA installability: manifest + icons + SW in the build ✅, Lighthouse run in S13. Web bundle 328 KB gzip (budget 300) → trim in S13
- [ ] 50 Android-app taps ≥ 98 % (with the app killed); 20 web-app scans each on iPhone Safari and Android Chrome = 100 %; cold start / first load within budget ⛔ hardware + domain
- [ ] Finish gate at 390x844 and 360x800 for both targets; TalkBack and VoiceOver pass; security and PII reviews are clean → S13

---

## Phase 5 — Hardening (Weeks 16–17)

### M10 · Release candidate (S13)

Owner: AyuknyamndiICTU · Started: 2026-10-26 · Completed: — · Details: [S13](./04-steps-surfaces-release.md#s13--hardening-security--end-to-end-qa)

- [x] STRIDE threat model with one attack test per threat ([threat-model.md](../../docs/security/threat-model.md), `apps/api/test/attacks/`); 2 HIGH + 2 MEDIUM + 2 LOW findings in the new offline/student code **fixed** with regression tests ([s13-findings.md](../../docs/security/s13-findings.md))
- [x] Dependency, secret and Electron security scans: runtime HIGHs fixed (Electron 38→42.11.18, fastify 5.12.7, nodemailer 10.2.1); dev-only advisories accepted with rationale; secretlint clean; Electron config reviewed (Electronegativity run on a connected machine before the signed release)
- [x] Cross-surface journey test (import → enroll → tap → borrow → alert → return damaged → reconcile) — `apps/api/test/journeys/`
- [/] k6 class-change load test: script `tests/load/class-change.js` ✅; in-process run 300 ops / 10 kiosks: 0 errors, 0 drift, p95 ≈ 0.5 s on the laptop ([evidence](../../docs/evidence/)); the 15-minute p95 < 300 ms gate runs on the lab server (S14)
- [x] Chaos tests: crash between commit and cache, duplicate delivery, provider outage → DLQ (API suites); unplug the reader → K9 → recovery and API down (kiosk e2e)
- [x] Offline outage drill: server down → kiosk lends offline (20 transactions) → sync with 0 drift → replaying the sync is a no-op (kiosk + API tests)
- [/] Finish gates: kiosk K1–K10 at 1920×1080 / 1366×768 ✅, student web app 390×844 ✅, ui-kit `/kit` ✅; admin Playwright e2e (deferred from S09/S10) and `click-path-audit` → run with the deployed stack in S14
- [x] Backup/restore drill: dump → restore into a clean database → equal row counts → reconcile 0 (`scripts/ops/restore-drill.ps1`, [evidence](../../docs/evidence/))

**Acceptance**

- [x] No open critical/high findings (runtime); `verification-loop`: tests, typecheck and lint pass for api, kiosk, mobile, admin, ui, contracts
- [/] Load p95 < 300 ms ⏳ lab server; 0 drift after chaos and restore ✅; evidence filed in `docs/evidence/` ✅

---

## Phase 6 — Launch (Weeks 18–21)

### M11 · Production, pilot & go-live (S14)

Owner: — · Started: 2026-10-26 (software) · Completed: — · Details: [S14](./04-steps-surfaces-release.md#s14--deployment-pilot--handover)

**Production**

- [ ] ICTU IT decides on the **code-signing certificate** (Q12): signed builds + auto-update, or manual kiosk updates with a runbook
- [ ] **Data-protection sign-off** from ICTU's legal officer before any real student data is imported (Q11)
- [ ] Production domain + publicly trusted TLS; public reachability configured if approved (Q13)
- [x] `deploy/compose.prod.yml` (api, worker, migrate, admin, web app + APK downloads, postgres, redis, Caddy, backup, optional uptime-kuma): healthchecks, limits, restart policies, Docker secret, per-release tags; full stack brought up locally as a staging run (S14)
- [x] Encrypted nightly backups (`deploy/backup`: pg_dump + files, age, 14 days, heartbeat) + restore runbook; restore drill evidenced ([backup-restore.md](../../docs/runbooks/backup-restore.md))
- [/] Monitoring: Uptime Kuma (profile `monitoring`) ✅, kiosk-offline alert via `GET /api/health/kiosks` ✅, backup heartbeat ✅ ([monitoring.md](../../docs/runbooks/monitoring.md)); GlitchTip/Sentry deferred (documented)
- [ ] **Real-channel gate:** real email, SMS and WhatsApp alerts delivered (or a signed deferral)
- [ ] Kiosk installed: driver, signed build, registration, restricted account, power settings
- [/] Student apps: web app served at the site root (same origin as `/api`, ADR-0010) ✅ and APK drop folder `/downloads` ✅; ⏳ signed APK build (signing key, ICTU IT) and lab posters/QR codes
- [ ] Real SIS import (dry run, then commit)
- [ ] Supplier **card-batch import** + acceptance test on the first batch + DESFire key ceremony (ADR-0008), then `cardAuthMode=DESFIRE_PREFERRED`

**Pilot (2 weeks, one class)**

- [ ] Pilot week 1: KPIs reviewed, fixes released, `canary-watch` run
- [ ] Pilot week 2: KPIs reviewed, fixes released, `canary-watch` run

**Handover**

- [x] Admin guide ([EN](../../docs/guides/admin-guide.en.md) / [FR](../../docs/guides/admin-guide.fr.md)) + one-page [lab-assistant card](../../docs/guides/lab-assistant-card.md); ⏳ screenshots once ICTU branding lands
- [x] Runbooks ([index](../../docs/runbooks/README.md)): deploy/upgrade/rollback, reader + kiosk re-register + manual update (kiosk.md), backup/restore, monitoring, secrets rotation + add admin, WhatsApp template, kiosk offline mode, DESFire key escrow
- [x] ADR index ([docs/adr/README.md](../../docs/adr/README.md)), plus the missing ADR-0007 (Android attestation)

**Acceptance (go-live)**

- [ ] `production-audit` is PASS; the restore drill is evidenced
- [ ] For 2 consecutive weeks: tap success ≥ 98 %, median borrow ≤ 20 s, alert delivery ≥ 99 %, nightly reconcile = 0
- [ ] ICTU signs the go-live checklist
