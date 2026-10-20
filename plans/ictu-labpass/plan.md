# ICTU LabPass — Project Plan & Progress Tracker

This file is the **single place to track progress**. Each task links to its full specification:
- [00-blueprint.md](./00-blueprint.md): dependencies, invariants, decision gates.
- Step files: [S00–S07](./03-steps-foundation-backend.md) and [S08a–S14](./04-steps-surfaces-release.md).
- [01-architecture.md](./01-architecture.md) and [02-design-direction.md](./02-design-direction.md).

## How to use this tracker

| Mark | Meaning |
|---|---|
| `- [ ]` | Not started |
| `- [/]` | **In progress** |
| `- [x]` | **Completed** |

1. Change a task to `[/]` when you start it. Change it to `[x]` only when its checks pass (from M2 onward, that includes `pnpm verify`).
2. A milestone is complete when **every task and every Acceptance box** under it is `[x]`. Then set its dashboard status to ✅ and fill in *Completed*.
3. If a task is blocked, keep it `[/]` and add `⛔ reason` at the end of the line. Set the milestone to ⛔ in the dashboard.
4. If the plan changes (split, insert, skip), follow the mutation protocol in the blueprint. Mark a skipped task as `- [x] ~~task~~ (skipped: reason)`.
5. The checkboxes inside the step files are *definitions* of done. Track progress **here** only.

> GitHub renders `[/]` as plain text rather than a checkbox. It still reads clearly as "in progress".

## Progress dashboard

Status: ⬜ Not started · 🟨 In progress · ✅ Completed · ⛔ Blocked

| Phase | Milestone | Steps | Target weeks* | Done | Status |
|---|---|---|---|---|---|
| 0 · Kickoff | [M0 Project kicked off](#m0--project-kicked-off) | S00 + decisions | W1 | 0 / 22 | 🟨 |
| 1 · De-risk & foundation | [M1 Hardware de-risked, protocol frozen](#m1--hardware-de-risked--tap-protocol-frozen-s01) | S01 | W1–W4 | 0 / 12 | ⬜ |
| | [M2 Foundation ready](#m2--foundation-ready-s02) | S02 | W1–W2 | 0 / 10 | ⬜ |
| 2 · Core backend | [M3 Contract & platform](#m3--contract--platform-s03-s04) | S03, S04 | W3–W5 | 0 / 21 | ⬜ |
| | [M4 Identity & lending engine](#m4--identity--lending-engine-s05--s06) | S05, S06 | W6–W8 | 0 / 21 | ⬜ |
| | [M5 Low-stock alerts](#m5--low-stock-alerts-dev-verified-s07) | S07 | W9–W10 | 0 / 10 | ⬜ |
| 3 · Design system | [M6 UI kit & signature theatre](#m6--ui-kit--signature-theatre-s08a-s08b) | S08a, S08b | W3–W7 | 0 / 12 | ⬜ |
| 4 · Product surfaces | [M7 Admin console](#m7--admin-console-s09-s10) | S09, S10 | W9–W13 | 0 / 16 | ⬜ |
| | [M8 Kiosk app](#m8--kiosk-app-s11) | S11 | W9–W12 | 0 / 12 | ⬜ |
| | [M9 Student mobile app](#m9--student-mobile-app-s12) | S12 | W9–W13 | 0 / 9 | ⬜ |
| 5 · Hardening | [M10 Release candidate](#m10--release-candidate-s13) | S13 | W14–W15 | 0 / 9 | ⬜ |
| 6 · Launch | [M11 Production, pilot & go-live](#m11--production-pilot--go-live-s14) | S14 | W16–W19 | 0 / 15 | ⬜ |
| | **Total** | 16 steps | ~19 weeks | **0 / 169** | |

\* Indicative, for a team of 3–4 developers. Phases 2 and 3 run in parallel, and so do M7–M9. Refine the dates after M1.

---

## Phase 0 — Kickoff & decisions (Week 1)

### M0 · Project kicked off
Owner: AyuknyamndiICTU · Started: 2026-10-20 · Completed: —

**Procurement** (hardware lead time is the first schedule risk)
- [ ] Order 2× ACS ACR1252U NFC readers (one spare). Do **not** use the ACR122U.
- [ ] Order a 1080p USB webcam (a USB 2D barcode scanner is optional).
- [ ] Get test phones: an NFC Android (10+), a budget Tecno/Infinix, and an iPhone.

**Decision gates** (owners, deadlines and safe defaults are in the [blueprint](./00-blueprint.md#decision-gates-open-questions-for-ictu))
- [ ] Q1 — ID card chip type and UID behaviour *(needed by S01 exit)*
- [ ] Q2 — School SIS: API or export, and which fields *(by S05)*
- [ ] Q3 — Confirm Sign In = borrow, Sign Out = return *(by S06)*
- [ ] Q4 — Loan rules: due time, max items, overdue block *(by S06)*
- [ ] Q5 — SMS provider; owner of the Meta Business / WhatsApp number *(provider by S07, accounts by S14)*
- [ ] Q6 — Must the kiosk queue loans offline? *(by S11)*
- [ ] Q7 — Hosting and domain *(staging by S09, production by S14)*
- [ ] Q8 — Lab PC OS edition and specs; number of kiosks *(by S01)*
- [ ] Q9 — Manual-entry policy *(by S06)*
- [ ] Q10 — Apple and Google organisation developer accounts *(by S12 / S14)*
- [ ] Q11 — Brand assets; data-protection approval *(branding by S08a, approval before real data)*
- [ ] Q12 — Code-signing certificate for the kiosk installer *(by S14)*
- [ ] ICTU confirms deviation **D1** (PIN or assistant check after matricule entry)
- [ ] ICTU confirms deviation **D2** (iPhones use Scan-the-Kiosk instead of NFC)

**[S00 · Repository bootstrap](./03-steps-foundation-backend.md#s00--repository-bootstrap)**
- [/] `git init -b main`; add `.gitignore` and `.gitattributes`
- [/] Commit `plans/`; tag `labpass/s00`
- [/] Create the `s01` and `s02` worktrees

**Acceptance**
- [ ] Hardware is ordered and every decision gate has a named owner
- [ ] The repository, tag and both worktrees exist

---

## Phase 1 — De-risk & foundation (Weeks 1–4)

### M1 · Hardware de-risked & tap protocol frozen (S01)
Owner: — · Started: — · Completed: — · Details: [S01](./03-steps-foundation-backend.md#s01--hardware-platform--sis-spike-de-risk-freezes-the-tap-protocol)

- [ ] Card survey: at least 20 cards × 3 reads, aggregate results committed
- [ ] PC/SC binding tested in Node and in an Electron `utilityProcess` → ADR-0002
- [ ] HCE spike with a real Keystore key: StrongBox→TEE fallback, async `sendResponseApdu`, cold/locked/deactivated cases
- [ ] Scan-the-Kiosk PoC: phone camera reading the lab monitor; webcam reading a phone screen
- [ ] Lab PC audit: OS, GPU tier, USB ports, network, admin rights
- [ ] SIS discovery written up in `docs/spikes/S01-sis.md`
- [ ] ADR-0001 (reader) · ADR-0002 (binding) · ADR-0003 (card identification) · ADR-0004 (SIS mode)
- [ ] Tap Protocol v1 (drafted in S03) validated on hardware and marked **FROZEN**
- [ ] Blueprint gates Q1, Q2 and Q8 updated; changelog row added

**Acceptance**
- [ ] Go/no-go recorded, with evidence, for each of: cards, HCE, PC/SC binding, camera/QR, SIS
- [ ] HCE (unlocked): ≥ 98 % success, SIGN ≤ 150 ms, exchange p95 ≤ 400 ms; locked phone gives no signature. *Or* "phones use Scan-the-Kiosk only" is recorded
- [ ] Every no-go is a plan mutation before S06, S11 or S12 start

### M2 · Foundation ready (S02)
Owner: — · Started: — · Completed: — · Details: [S02](./03-steps-foundation-backend.md#s02--monorepo-foundation-tokens--motion-package)

- [ ] pnpm workspaces + Turborepo + root scripts (`verify`, `contracts:check`, `evidence:check`, …)
- [ ] `packages/config`: strict TS, ESLint import-boundaries and no-raw-motion rules, env loader
- [ ] Scaffold `apps/api`, `apps/admin`, `apps/kiosk` and `apps/mobile`, each with a smoke test
- [ ] `docker-compose.dev.yml` (Postgres 17, Redis 7, Mailpit) + `.env.example` files
- [ ] `packages/design-tokens` (CSS, Tailwind and React Native outputs) + contrast test
- [ ] `packages/motion` (tokens, springs, `useSafeMotion`, Reanimated presets) + tests
- [ ] `packages/i18n` EN/FR + key-parity test; self-hosted fonts
- [ ] CI workflow + pre-commit hook (`secretlint`, `lint-staged`)

**Acceptance**
- [ ] All four apps start; `pnpm verify` is green
- [ ] Merged to `main` and tagged `labpass/s02`

---

## Phase 2 — Core backend (Weeks 3–10)

### M3 · Contract & platform (S03, S04)
Owner: — · Started: — · Completed: —

**[S03 · Domain model, contract & draft protocol](./03-steps-foundation-backend.md#s03--domain-model-api-contract--draft-tap-protocol-contract-first)**
- [ ] Multi-file Prisma schema covering every entity, with indexes
- [ ] SQL migration: `pg_trgm`, stock and loan CHECKs, one-active-credential partial index, append-only triggers
- [ ] Idempotent seed: categories, about 30 Cisco items, 200 synthetic students, SUPER_ADMIN
- [ ] OpenAPI 3.1 split per bounded context: `x-roles`, problem+json, `Idempotency-Key`, event schemas
- [ ] Generated client + zod schemas; `pnpm contracts:check`
- [ ] Draft tap protocol spec + `verify.ts`/`sign.ts` + positive and malformed vectors
- [ ] Testcontainers test for the DB invariants
- [ ] ADR-0005 (contract-first) and ADR-0006 (ledger + idempotency)
- [ ] **Acceptance:** migrates from empty; seed is idempotent; Redocly lint is clean; vectors pass; rubber-duck review is clean

**[S04 · API platform](./03-steps-foundation-backend.md#s04--api-platform-auth-rbac-devices-settings-idempotency-outbox-realtime)**, in PR slices
- [ ] (a) Bootstrap: Fastify, helmet, pino redaction, zod pipe, problem+json, `/health` and `/ready`
- [ ] (b) Admin auth: argon2id, TOTP, Redis sessions, lockout, RBAC guard
- [ ] (c) Kiosk devices + challenge pool
- [ ] (c) Student tokens with rotation and family revocation
- [ ] (c) Settings module, `/kiosk/config` and `/meta/app-config`
- [ ] (d) DB-transactional idempotency, rate limiter, audit service, `toSafeCsv()`
- [ ] (e) Outbox (`SKIP LOCKED`) + ConsumerInbox, Socket.IO namespaces
- [ ] (e) Ports: Email, Console, ObjectStorage, Clock
- [ ] **Acceptance:** the RBAC matrix (generated from `x-roles`) passes
- [ ] **Acceptance:** the log-redaction test passes (I4)
- [ ] **Acceptance:** outbox events publish only after commit; duplicates are absorbed
- [ ] **Acceptance:** 20 concurrent same-key requests produce one effect; replay after a crash returns the stored response

### M4 · Identity & lending engine (S05 ∥ S06)
Owner: — · Started: — · Completed: —

**[S05 · Identity](./03-steps-foundation-backend.md#s05--identity-student-directory-card-binding-enrollment--push)**, in PR slices
- [ ] (a) Directory port: file adapter (CSV `;`/`,`, BOM, XLSX) + REST adapter (SSRF allow-list)
- [ ] (a) Import pipeline: limits, dry-run diff, batched commit, **rollback**, safe error CSV
- [ ] (a) Scheduled REST sync, test-connection and sync-now
- [ ] (b) Students API (trigram search, role-scoped profile)
- [ ] (b) Card binding + kiosk link requests
- [ ] (b) Manual-entry PIN (`/me/pin`) and reset
- [ ] (c) Enrollment: session, OTP, proof of possession, auto-approve or PENDING, one active credential
- [ ] (c) `/me` self-service, lost-phone revoke; admin approve/reject/revoke
- [ ] (c) Expo push channel + `/me/push-token`
- [ ] **Acceptance:** name, file, malicious-file, import-rollback and enrollment-race fixtures pass
- [ ] **Acceptance:** 50k-row import in < 60 s with RSS < 300 MB; `pii-detector` review is clean

**[S06 · Inventory, loans & identify](./03-steps-foundation-backend.md#s06--operations-inventory-loans--identify-the-core-engine)**, in PR slices
- [ ] (a) Equipment & categories CRUD, images, low-stock thresholds
- [ ] (a) Adjust stock (RESTOCK / WRITE_OFF / CORRECTION) with a 10 s undo
- [ ] (b) Identify: CARD, HCE, SCAN (`/me/scan` → kiosk socket), MANUAL + `/kiosk/manual/verify`
- [ ] (c) Borrow — `/kiosk/sign-in` (ARCH F5)
- [ ] (c) Return — `/kiosk/sign-out` (ARCH F6)
- [ ] (d) Admin loans, force-return, overdue job, `/me/loans`, realtime deltas
- [ ] (d) Reports with safe, audited exports; `pnpm ops:reconcile`
- [ ] **Acceptance:** the concurrency suite passes 20 runs in a row
- [ ] **Acceptance:** positive and malformed vectors pass over HTTP; identify p95 < 150 ms
- [ ] **Acceptance:** property tests hold invariant I2; `ops:reconcile` reports 0 drift; an unverified manual entry cannot borrow

### M5 · Low-stock alerts, dev-verified (S07)
Owner: — · Started: — · Completed: — · Details: [S07](./03-steps-foundation-backend.md#s07--notifications--low-stock-alerts-email--sms--whatsapp)

- [ ] SMS adapter (provider from Q5) + mock
- [ ] WhatsApp adapter; `labpass_low_stock` EN/FR template **submitted to Meta**
- [ ] Per-channel queues, retries, DLQ, NotificationLog, receipts and webhook (GET handshake + signature)
- [ ] AlertEvaluator: AlertOccurrence, one job at a time per item, quiet hours, digest
- [ ] Admin phone/WhatsApp number verification by OTP
- [ ] APIs: alert rules, channel preferences, quiet hours, test send, delivery log
- [ ] Student notices (overdue, device revoked)
- [ ] Provider secrets encrypted and write-only; per-channel feature flags

**Acceptance**
- [ ] The evaluator truth table is covered; webhook signature tests pass
- [ ] Email works end-to-end. SMS and WhatsApp pass against sandbox/mock. The template status is recorded in the runbook

---

## Phase 3 — Design system (Weeks 3–7, in parallel with Phase 2)

### M6 · UI kit & signature theatre (S08a, S08b)
Owner: — · Started: — · Completed: —

**[S08a · Accessible primitives](./04-steps-surfaces-release.md#s08a--ui-kit--accessible-primitives-states--css-level-signatures-packagesui)**
- [ ] Primitives: Button, Input, **Combobox (the kiosk dropdown)**, QuantityStepper, StockHealth, Dialog/Drawer, Toast + Undo, Table, Skeleton, EmptyState, Tabs, KPI Counter, StatusCapsule, PIN pad
- [ ] CSS/SVG signatures: CapsuleNav (A7), StockSkyline (A5), BlurPush (A8), DepthType (A9), HorizonGlow (A10), plus static fallbacks
- [ ] Icons: lucide + in-house equipment silhouettes
- [ ] Storybook: every component × state × reduced motion; axe and visual tests
- [ ] **Acceptance:** 0 serious axe violations; `pnpm evidence:check ui-kit` passes; no DESIGN §2 anti-patterns

**[S08b · Signature theatre & WebGL](./04-steps-surfaces-release.md#s08b--signature-theatre--webgl-scenes)**
- [ ] SceneProvider: shared OGL canvas, GPU tier gating, `motionLevel`
- [ ] ReaderEye: idle orb (A1), horizon sweep (A2), error flicker (E1)
- [ ] IdentityRise (A3) and FannedCart (A4)
- [ ] RingLanding + ParticleConverge (A6)
- [ ] LiveTicker (A11), LiveChallengeQR (A13), WebGL HorizonGlow
- [ ] Stories at full, reduced and minimal; lazy loading; performance report
- [ ] **Acceptance:** every effect has a fallback; `minimal` keeps every action usable; no long tasks over 50 ms on the reference GPU profile

---

## Phase 4 — Product surfaces (Weeks 9–14)

### M7 · Admin console (S09, S10)
Owner: — · Started: — · Completed: —

**[S09 · Operations](./04-steps-surfaces-release.md#s09--admin-console--operations-inventory-loans-dashboard-kiosks)**, in PR slices
- [ ] (a) Shell: CapsuleNav, role-aware navigation, EN/FR, light/dark, ⌘K palette, realtime cache bridge
- [ ] (a) Login + TOTP
- [ ] (b) Dashboard: KPIs, live StockSkyline, activity feed, low stock, kiosks, overdue
- [ ] (c) Inventory table, **Add/Edit equipment**, **Adjust stock** (+/−) with Undo, movement timeline
- [ ] (d) Loans (tabs, force-return, export)
- [ ] (d) Kiosks (register with code + QR, status, revoke); permission screens
- [ ] **Acceptance:** e2e login → add item → adjust +5/−3 → undo → skyline updates
- [ ] **Acceptance:** LCP ≤ 2.0 s, INP ≤ 200 ms, route JS ≤ 250 KB; finish gate at 1440x900 and 390x844

**[S10 · People, credentials & configuration](./04-steps-surfaces-release.md#s10--admin-console--people-credentials--configuration)**, in PR slices
- [ ] (a) Students: search and profile, card bind/unbind, link approvals, PIN reset
- [ ] (a) Import wizard (map → diff → commit → history → rollback) + SIS connector page
- [ ] (b) Credential request queue: per-field diff, in-person verification
- [ ] (c) Alerts & notifications: thresholds, channels with OTP verification, quiet hours, test send, delivery log
- [ ] (d) Settings: labels, manual policy, loan rules, kiosk settings, retention, `minSupportedVersion`
- [ ] (d) Users & roles, audit log, reports
- [ ] **Acceptance:** e2e covers import + rollback, auto and manual approval, threshold → email, settings → kiosk event
- [ ] **Acceptance:** `click-path-audit` is clean, the finish gate passes, and the `pii-detector` review is clean

### M8 · Kiosk app (S11)
Owner: — · Started: — · Completed: — · Details: [S11](./04-steps-surfaces-release.md#s11--kiosk-app-electron--nfc-reader--the-showpiece)

- [ ] (a) Hardened Electron main process: kiosk mode, single instance, auto-start, relaunch on crash
- [ ] (a) ReaderDriver (PcscDriver + FakeReader): SELECT-then-UID, debounce, LED and buzzer
- [ ] (a) Typed IPC for business operations only; the token never reaches the renderer
- [ ] (b) Main-process API client, `/kiosk` socket, challenge pool, heartbeat, device registration
- [ ] (b) Scan-the-Kiosk: LiveChallengeQR + optional webcam response QR
- [ ] (c) XState flow and timers, K9 error states, K10 assistant overlay
- [ ] (d) Screens K1–K10 with A1–A13/E1: **dropdown borrow**, open-lines return, matricule + PIN, link card
- [ ] (e) Degraded mode, NSIS packaging, signed auto-update (or the manual-update runbook)

**Acceptance**
- [ ] e2e passes: card, HCE, scan, manual, unknown card, `409`, API down, token isolation
- [ ] Real reader: A2 ≤ 100 ms; tap → student shown p95 ≤ 800 ms
- [ ] The 12 h soak passes; 60 fps on the lab PC (or the auto-selected `motionLevel`)
- [ ] Finish gate at 1920x1080 and 1366x768; Electronegativity reports no high findings

### M9 · Student mobile app (S12)
Owner: — · Started: — · Completed: — · Details: [S12](./04-steps-surfaces-release.md#s12--student-mobile-app-expo--virtual-card-enrollment--loans)

- [ ] (a) Expo foundation: router, query client, secure store, EN/FR, theme, minimum-version check
- [ ] (b) Android native: Keystore key, headless `HostApduService`, config plugin, NFC detection
- [ ] (c) iOS native: Secure Enclave key; shared vectors pass in JUnit and XCTest
- [ ] (d) Screens: onboarding, enroll, OTP, key + biometrics, pending/approved
- [ ] (d) **Pass** screen with Tap and **Scan kiosk** modes; loans, history, profile
- [ ] (e) Hardening (screen capture, root warning, pinning ADR); EAS profiles + `runtimeVersion`

**Acceptance**
- [ ] Native vectors pass on Android and iOS
- [ ] 50 Android taps ≥ 98 % (with the app killed); 20 iPhone scans at 100 %; cold start ≤ 2.5 s
- [ ] Finish gate at 390x844 and 360x800; TalkBack and VoiceOver pass; security and PII reviews are clean

---

## Phase 5 — Hardening (Weeks 14–15)

### M10 · Release candidate (S13)
Owner: — · Started: — · Completed: — · Details: [S13](./04-steps-surfaces-release.md#s13--hardening-security--end-to-end-qa)

- [ ] STRIDE threat model with one attack test per threat; fix every high/critical finding
- [ ] Dependency, secret and Electron security scans
- [ ] Cross-surface journey test (import → enroll → tap → borrow → alert → return damaged → reconcile)
- [ ] k6 class-change load test (300 per minute for 15 minutes)
- [ ] Chaos tests: kill Redis/API, unplug the reader, provider outage
- [ ] Finish gates for the ui-kit, admin, kiosk and mobile; click-path audits
- [ ] Backup/restore drill

**Acceptance**
- [ ] No open critical/high findings; `verification-loop` is PASS
- [ ] Load p95 < 300 ms; 0 drift after chaos and restore; evidence filed in `docs/evidence/`

---

## Phase 6 — Launch (Weeks 16–19)

### M11 · Production, pilot & go-live (S14)
Owner: — · Started: — · Completed: — · Details: [S14](./04-steps-surfaces-release.md#s14--deployment-pilot--handover)

**Production**
- [ ] `deploy/compose.prod.yml` (api, worker, admin, postgres, redis, Caddy)
- [ ] Encrypted nightly backups + a tested restore runbook
- [ ] Monitoring: Uptime Kuma, GlitchTip/Sentry, kiosk-offline alert
- [ ] **Real-channel gate:** real email, SMS and WhatsApp alerts delivered (or a signed deferral)
- [ ] Kiosk installed: driver, signed build, registration, restricted account, power settings
- [ ] Mobile: pilot APK / Play staged rollout; TestFlight → App Store
- [ ] Real SIS import (dry run, then commit) and card binding

**Pilot (2 weeks, one class)**
- [ ] Pilot week 1: KPIs reviewed, fixes released, `canary-watch` run
- [ ] Pilot week 2: KPIs reviewed, fixes released, `canary-watch` run

**Handover**
- [ ] Admin guide (EN/FR) + one-page lab-assistant card
- [ ] Runbooks: reader, kiosk re-register, restore, secrets rotation, add admin, WhatsApp template, manual kiosk update
- [ ] ADR index

**Acceptance (go-live)**
- [ ] `production-audit` is PASS; the restore drill is evidenced
- [ ] For 2 consecutive weeks: tap success ≥ 98 %, median borrow ≤ 20 s, alert delivery ≥ 99 %, nightly reconcile = 0
- [ ] ICTU signs the go-live checklist
