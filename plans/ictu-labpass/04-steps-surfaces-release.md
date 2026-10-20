# ICTU LabPass — Steps S08a–S14 (experience, surfaces, release)

> Part of [00-blueprint.md](./00-blueprint.md). Each step can be started cold. Read the blueprint **Invariants** and
> **Execution protocol**, then this step, then only the cited `ARCH §` / `DESIGN §` sections
> ([01-architecture.md](./01-architecture.md), [02-design-direction.md](./02-design-direction.md)).
> Visual references are in [references/](./references/). Study them, but never ship them.
> **L-sized steps are delivered as the listed PR slices.** Each slice must leave `pnpm verify` green.

---

## S08a · UI kit — accessible primitives, states & CSS-level signatures (`packages/ui`)

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S02 | S03, S04 | default | M | `packages/ui` |

**ECC skills:** `frontend-design-direction` · `frontend-design` · `design-system` · `motion-foundations` · `motion-patterns` · `accessibility` · `frontend-a11y` · `make-interfaces-feel-better`
**Agents:** Copilot `general-purpose` (with the skills loaded) · Copilot `rubber-duck` (critique against DESIGN §2)

**Context brief.** These are the functional, accessible building blocks for the admin console and the kiosk (DESIGN §3–§6).
They carry the look without WebGL, so S09 and S11 can build real screens while S08b adds the theatre.
Every animation uses `packages/motion`, has an exit, and honours reduced motion (I5).

**Tasks**
1. **Primitives** (Radix + tokens):
   - Button (pill), IconButton, Input.
   - **Combobox** (cmdk): the kiosk "dropdown". Virtualised, grouped by category, with an image, an availability badge, and disabled at 0.
   - QuantityStepper, StockHealth badge (icon + label + colour), Dialog/Drawer (focus trap, Esc, scroll lock).
   - Toast with **Undo**, Table primitives, Skeleton, EmptyState (grid paper), Tabs, KPI Counter, StatusCapsule, PIN pad.
2. **CSS/SVG-level signatures**:
   - `CapsuleNav` (A7), `StockSkyline` (A5, SVG), `BlurPush` (A8).
   - `DepthType` (A9), `HorizonGlow` (A10, CSS gradient + grain), plus the static fallbacks of A1/A6.
3. **Icons**: `lucide-react` + **in-house** equipment silhouettes (router, switch, firewall, AP, patch cable, SFP, console cable). No Cisco logos.
4. **Storybook**: a story for each component × DESIGN §6 state × reduced motion, with interaction + axe tests (`@storybook/test-runner`) and Playwright visual snapshots.

**Verify**
```powershell
pnpm --filter ui test; pnpm --filter ui storybook:test; pnpm --filter ui test:visual
pnpm evidence:check ui-kit
```

**Exit criteria**
- [ ] axe reports 0 serious violations; reduced motion is verified; the evidence record passes.
- [ ] The critique finds no DESIGN §2 anti-patterns.

**Rollback.** Revert the commit; no consumers exist yet.

---

## S08b · Signature theatre & WebGL scenes

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S08a | S04, S05, S06 | **strongest** | M | `packages/ui/src/theatre` |

**ECC skills:** `frontend-design-direction` · `motion-advanced` · `motion-patterns` · `react-performance` · `accessibility`
**Agents:** Copilot `general-purpose` · ECC `v3/performance-engineer` · ECC `analysis/code-analyzer`

**Context brief.** These are the kiosk's "wow" moments from DESIGN §4: A1 Reader Eye, A2 Horizon Sweep, A3 Identity Rise, A4 Fanned Cart,
A6 Ring Landing with particles, A11 Live Ticker, A13 Live Challenge QR, and E1 Slit Flicker. Study the matching frames in `references/` (DESIGN §2).
Theatre must **never delay input**, and every effect falls back to its S08a static version.

**Tasks**
1. `SceneProvider`: one shared OGL canvas per surface; pause on `visibilitychange`; DPR ≤ 1.5; `detect-gpu` gating; `motionLevel: full|reduced|minimal`.
2. Components:
   - `ReaderEye` (`state: idle|reading|success|error`; shader orb with a slit, drifting silhouettes at 3 depths).
   - `IdentityRise`, `FannedCart` (`layoutId`).
   - `RingLanding` + `ParticleConverge` (≤ 600 points).
   - `LiveTicker`, `LiveChallengeQR` (dissolve/reform plus a TTL ring).
   - WebGL `HorizonGlow` upgrade.
3. Stories for every state at all three `motionLevel`s. Lazy-load the WebGL paths. Set a size budget for `theatre`.
4. Measure frame time on a **reference integrated GPU**: Intel UHD 620-class, or Chrome DevTools 4× CPU throttle as a proxy.
   The real lab-PC 60 fps gate is in S11.

**Verify**
```powershell
pnpm --filter ui storybook:test -- theatre; pnpm --filter ui test:visual -- theatre
pnpm --filter ui perf:theatre     # frame-time report per component and motionLevel
```

**Exit criteria**
- [ ] Every listed animation has a working fallback, and `minimal` mode keeps every action usable.
- [ ] No long tasks over 50 ms on the reference profile.

**Rollback.** Revert the commit; S08a fallbacks remain.

---

## S09 · Admin console — operations (inventory, loans, dashboard, kiosks)

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S04, S06, S08a | S07, S11, S12 | default | L | `apps/admin` |

**ECC skills:** `nextjs-turbopack` · `react-patterns` · `frontend-patterns` · `motion-patterns` · `accessibility` · `react-testing` · `e2e-testing` · `i18n-sync`
**Agents:** Copilot `general-purpose` · Copilot `task` (runs the e2e suites) · ECC `testing/tdd-london-swarm`

**PR slices:** (a) tasks 1–2 · (b) 3 · (c) 4 · (d) 5–7.

**Context brief.** This covers DESIGN §5 "Admin", operations half. It is a light, dense, calm tool used every day, so keep motion subtle with no ambient animation in tables.
The brief explicitly asks for **adding new equipment and increasing or decreasing quantity**. That flow must be fast and safe.
Same-origin `/api` rewrite; cookie auth (S04).

**Tasks**
1. **Shell**: CapsuleNav, role-aware sidebar, EN/FR toggle, light/dark, subtle page transition, **⌘K palette**, and a Socket.IO → TanStack Query cache bridge.
2. **Auth**: login + TOTP enrol/verify on a `DepthType` + `HorizonGlow` backdrop. Session expiry returns to login.
3. **Dashboard**: KPI counters, live StockSkyline, activity feed, low-stock list, kiosk status, overdue list. Each widget loads and fails independently.
4. **Inventory**:
   - TanStack Table (server pagination, category chips, health filter, search).
   - **Add/Edit equipment** drawer: image upload; threshold with "use global default".
   - **Adjust stock** drawer: ± stepper, type, required reason, live preview of total/available/out, inline error when going below "out".
   - Toast with **Undo (10 s)**; equipment detail with a movement timeline.
5. **Loans**: Open/Overdue tabs, filters, detail, force-return with a reason, safe CSV export.
6. **Kiosks**: register (one-time code **and** a QR for the kiosk to scan), online/offline status, revoke.
7. **Permission state**: role-gated pages show a lock screen naming the required role.

**Verify**
```powershell
pnpm --filter admin test
pnpm --filter admin test:e2e    # login+TOTP → add item → adjust +5/−3 → undo → skyline updates after an API-driven kiosk borrow
pnpm --filter admin lighthouse  # LCP ≤ 2.0 s, INP ≤ 200 ms
pnpm evidence:check admin-ops
```

**Exit criteria**
- [ ] All e2e flows pass. The finish gate passes at `1440x900` and `390x844`. Route JS ≤ 250 KB gzip.

**Rollback.** Revert by slice. The API is unaffected.

---

## S10 · Admin console — people, credentials & configuration

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S09, S05, S07 | S11, S12 (if still running) | default | L | `apps/admin` |

**ECC skills:** `react-patterns` · `frontend-patterns` · `accessibility` · `e2e-testing` · `i18n-sync` · `click-path-audit`
**Agents:** Copilot `general-purpose` · ECC `v3/pii-detector` (student screens and exports)

**PR slices:** (a) tasks 1–3 · (b) 4 · (c) 5 · (d) 6–7.

**Context brief.** This is the admin's control panel for the rest of the brief:
- **import students** or connect the school system;
- review **mobile credential requests** (most are auto-approved);
- the **settings page**, where low-stock alert levels and delivery by **WhatsApp, SMS and email** are configured.

It builds on the S09 shell.

**Tasks**
1. **Students**: search, profile (photo, programme, status, cards, credentials, loans), card bind/unbind, link-request approvals, manual-PIN reset.
2. **Import wizard**:
   - upload → auto/manual mapping → **dry-run diff** (new/changed/invalid/missing) → "deactivate missing" → commit with live progress;
   - history with a **Rollback** action; template download.
3. **SIS connector** (SUPER_ADMIN): URL, auth, mapping, schedule, **Test connection**, **Sync now**.
4. **Credential requests**: realtime queue with a per-field diff. "Identity verified in person" is required to approve a mismatch; reject needs a reason; revoke.
5. **Alerts & notifications**:
   - global threshold + per-item overrides (bulk edit);
   - per-admin channel toggles with **number verification by OTP**;
   - quiet hours, digest window, **Send test** per channel, delivery log.
6. **Settings**:
   - Sign In/Out labels (EN/FR); manual-entry policy (default `PIN_OR_ASSISTANT`; choosing `OPEN` shows a risk warning and needs SUPER_ADMIN); loan-due policy; max items; overdue block;
   - kiosk timeout and `motionLevel`; assistant PINs; retention; `minSupportedVersion`.
7. **Users & roles**, **Audit log**, **Reports** (charts + audited export).

**Verify**
```powershell
pnpm --filter admin test:e2e -- people config
pnpm evidence:check admin-config
```
The e2e flows must cover:
- Import an FR `;` CSV → diff counts → commit → re-import gives 0 changes → rollback.
- An exact-match enrollment shows as AUTO_APPROVED. A mismatch appears live in the queue and is approved with in-person verification.
- Threshold 3, adjust stock to 2 → Mailpit email + NotificationLog SENT.
- A settings change reaches the kiosk config event.

**Exit criteria**
- [ ] All flows pass. `click-path-audit` is clean, the finish gate passes, and the `pii-detector` review is clean.

**Rollback.** Revert by slice.

---

## S11 · Kiosk app (Electron + NFC reader) — the showpiece

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S01, S05, S06, S08b | S07, S09, S12 | **strongest** | L | `apps/kiosk` |

**ECC skills:** `frontend-design-direction` · `motion-patterns` · `motion-advanced` · `accessibility` · `react-performance` · `security-review` · `e2e-testing` · `i18n-sync`
**Agents:** Copilot `general-purpose` · ECC `v3/security-architect` (Electron hardening) · ECC `v3/performance-engineer` (latency, 12 h soak)

**PR slices:** (a) tasks 1–2, 4 · (b) 3, 5 · (c) 6 · (d) 7 · (e) 8–9.

**Context brief.** At the kiosk a student taps a **physical NFC card** or an **Android phone**, **scans the kiosk** with any phone, or **types a matricule** (verified per policy).
They then see their details and **Sign In (borrow)** or **Sign Out (return)** equipment from a dropdown (ARCH §5 F1–F6; DESIGN §5 K1–K10).

Rules for this step:
- The reader driver is the one chosen in ADR-0002.
- The device token **never leaves the main process** (ARCH §7).
- Feedback starts at the **reader event** (A2 ≤ 100 ms), before the API answers.

**Tasks**
1. **Main process**:
   - Hardened window: `contextIsolation`, `sandbox`, CSP, no remote content, devtools off in production.
   - `kiosk: true`, single instance, auto-start, relaunch on crash, PII-free rotating logs.
2. **Reader service** (`utilityProcess` or sidecar) behind `ReaderDriver`:
   - Implementations: `PcscDriver` and `FakeReader` (replays the vectors).
   - On card present: SELECT AID first; on `6A82` or failure, read the UID (`FF CA 00 00 00`). No response from a phone → "Unlock your phone and tap again".
   - Debounce 1.5 s; handle unplug/replug; LED and buzzer via control/escape commands.
3. **API client in main**: HTTPS + `/kiosk` socket; challenge pool (3, refreshed after use); handles `identified` (scan flow), `SettingsChanged` and revocation; heartbeat every 30 s; registration (code or admin QR) → token in `safeStorage`.
4. **Typed IPC (zod), business operations only**:
   - Commands: `identifyManual`, `verifyManual`, `signIn`, `signOut`, `submitScanResponse`.
   - Subscriptions: reader/identify/config events.
   - **No** token access, generic fetch or URLs.
5. **Scan-the-Kiosk**:
   - K1 shows the newest challenge as `LiveChallengeQR` (A13).
   - Optional webcam mode decodes `LPR1` response QRs in the renderer and passes the **text** to `submitScanResponse`.
6. **Renderer state machine** (XState): `attract → reading → identified → borrowing|returning → confirming → success → attract`.
   - Timers: 45 s inactivity, 8 s success reset.
   - Error state K9; assistant overlay K10 (corner long-press + PIN). Next actions stay focusable during theatre.
7. **Screens K1–K10** with A1–A13 and E1:
   - K4: Combobox + QuantityStepper + FannedCart.
   - K5: **only the student's open lines**, OK/DAMAGED.
   - K7: matricule → name + photo → PIN/OTP/assistant.
   - K8: link card.
   - aria-live greeting, EN/FR, optional sound cues.
8. **Degraded mode**: API unreachable or reader missing → K9 with the next step. **No offline transactions in v1** (Q6).
9. **Packaging & updates**: electron-builder NSIS for the S01 OS.
   - **Production auto-update only with Authenticode-signed builds** from an HTTPS, allow-listed, versioned feed with signature verification (Q12).
   - Without signing, auto-update is disabled and a manual-update runbook is used.

**Verify**
```powershell
pnpm --filter kiosk test                 # state-machine model tests: every transition and timeout
pnpm --filter kiosk test:e2e             # Playwright _electron + FakeReader (scenarios below)
pnpm --filter kiosk hw:tap -- --count 50 # real reader: A2 ≤ 100 ms; tap→student p95 ≤ 800 ms
pnpm --filter kiosk soak -- --hours 12   # flat memory, no WebGL context loss
pnpm evidence:check kiosk
```
The e2e scenarios cover:
- Card → borrow 2 items → success.
- HCE vectors (positive and malformed).
- Scan via a mocked socket `identified`.
- Manual with PIN.
- Unknown card.
- `409` out of stock.
- API down.
- Renderer cannot read the token.

**Exit criteria**
- [ ] All e2e flows, hardware budgets and the soak pass. **60 fps on the actual lab PC** at `motionLevel=full`; otherwise ship the auto-selected level.
- [ ] The finish gate passes at `1920x1080` and `1366x768`. Electronegativity has no high findings.

**Rollback.** Keep the previous signed installer. Kiosks update only from a **promoted** channel, so rolling back means promoting the prior build.

---

## S12 · Student mobile app (Expo) — virtual card, enrollment & loans

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S01, S05, S06 | S07, S09, S11 | **strongest** | L | `apps/mobile`, `apps/mobile/modules/ictu-credential` |

**ECC skills:** `react-native-patterns` · `motion-foundations` · `accessibility` · `security-review` · `i18n-sync` · `e2e-testing`
**Agents:** ECC `specialized/spec-mobile-react-native` · `v3/security-architect` · `v3/pii-detector`

**PR slices:** (a) task 1 · (b) task 2 Android · (c) task 2 iOS · (d) 3 · (e) 4–5.

**Context brief.** The phone holds the student's virtual card.
- **Android with NFC** taps it on the reader (HCE, ARCH §6).
- **Every phone**, including iPhone (iOS HCE is EEA-only) and Android without NFC, can **Scan the Kiosk** (ARCH §5 F3).
- Enrollment is **auto-approved** when details exactly match school records (ARCH §5 F7).

Build constraints:
- Custom native code requires an **Expo dev client / EAS Build** (Expo Go will not work).
- iOS builds and tests need macOS or EAS cloud builds.
- APDU handling must be **fully native and headless** (ARCH §2).

**Tasks**
1. **Foundation**: Expo Router, TanStack Query + generated client + zod, `expo-secure-store`, EN/FR, `design-tokens/native`, Reanimated + Skia, `expo-haptics`, `expo-camera`.
   Check `/meta/app-config` against `minSupportedVersion` at startup.
2. **Native module `ictu-credential`** (Expo Modules API):
   - **Android (Kotlin)**:
     - Keystore P-256 key (StrongBox → TEE fallback, `setUnlockedDeviceRequired(true)`, non-exportable); SPKI + attestation export.
     - `setActiveCredential(id)` stores the credentialId in native storage.
     - **`HostApduService` is fully native.** It reads native storage, signs on a worker thread, answers with `sendResponseApdu`, never touches JS, and emits an optional event when the app is alive.
     - Config plugin: service with `BIND_NFC_SERVICE`; `apduservice.xml` (category `other`, AID `F0494354554C5001`, `requireDeviceUnlock="true"`).
     - NFC present/enabled detection; `CardEmulation.setPreferredService` while Pass is in the foreground.
   - **iOS (Swift)**: Secure Enclave P-256 (`kSecAttrTokenIDSecureEnclave`, this device only, when unlocked).
   - **Both platforms**: `signPop(nonce)`, `signScan(kioskId, nonce, ts)`, `responseQr(...)`. JUnit and XCTest run the **shared `vectors.json`**.
3. **Screens** (DESIGN §5 Mobile):
   - Onboarding; Enroll; OTP (autofill); key creation behind `expo-local-authentication`.
   - Pending/Approved/Rejected (push registered via `/me/push-token`).
   - **Pass** (A12): Tap mode and **Scan kiosk** mode (camera reads `LPK1` → `POST /me/scan`). Offline fallback shows an `LPR1` response QR with a brightness boost.
   - My loans, history, profile (language, **manual-entry PIN**, **lost phone → revoke**, sign out).
4. **Hardening**: screen capture blocked on the response QR on Android (`expo-screen-capture`); iOS detection plus a live shimmer.
   The response QR only works at one kiosk for 60 s. Root/jailbreak is a soft warning. Pinning decision in an ADR.
5. **Distribution prep**: EAS profiles `development`, `preview` (pilot APK) and `production`; `runtimeVersion` policy for EAS Update (JS-only fixes); icons and splash from tokens.

**Verify**
```powershell
pnpm --filter mobile test                                   # jest + @testing-library/react-native (incl. role/label a11y queries)
cd apps\mobile\android; .\gradlew.bat :ictu-credential:testDebugUnitTest
pnpm --filter mobile test:ios      # runs `xcodebuild test` on the macOS CI job / EAS build; required for exit
pnpm --filter mobile e2e           # Maestro: enroll → OTP → approved → Pass (Tap + Scan modes)
pnpm evidence:check mobile
```
Hardware checks:
- 50 Android taps on the kiosk reader, unlocked, with the app killed: ≥ 98 %.
- 20 iPhone scans of the kiosk QR: 100 %.
- Budget Android cold start ≤ 2.5 s.
- Manual TalkBack and VoiceOver pass.

**Exit criteria**
- [ ] Native vectors pass on both platforms; the hardware checks meet their targets.
- [ ] The finish gate passes at `390x844` and `360x800`; the security and PII reviews are clean.

**Rollback.**
- Staged releases only (pilot APK → Play staged rollout / TestFlight).
- JS-only fixes ship through EAS Update on the same `runtimeVersion`.
- Raise `minSupportedVersion` to force an upgrade away from a bad native build.
- Revoke affected credentials from admin.

---

## S13 · Hardening, security & end-to-end QA

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S07, S09, S10, S11, S12 | — | **strongest** (review) | M | all; `docs/security`, `docs/evidence` |

**ECC skills:** `security-review` · `security-scan` · `e2e-testing` · `browser-qa` · `click-path-audit` · `verification-loop` · `benchmark` · `production-audit` · `accessibility` · `ai-regression-testing`
**Agents:** Copilot `security-review` · ECC `v3/security-architect` · `v3/pii-detector` · `testing/production-validator` · `v3/performance-engineer` · Copilot `code-review`

**Context brief.** All surfaces now exist. This step proves the system is safe, correct under load and accessible before real students use it.
Run the DESIGN §8 finish gate for every surface and exercise every DESIGN §6 state.

**Tasks**
1. **STRIDE threat model** (`docs/security/threat-model.md`) with an **attack test per threat**:
   - replayed or foreign-kiosk challenge; response-QR screenshot replay;
   - manual-matricule enumeration and PIN brute force; cloned UID card;
   - token theft from the kiosk renderer; tampered update feed;
   - admin takeover; import bombs and CSV injection; SSRF via the SIS URL; webhook spoofing; enrollment races.

   Fix every high or critical finding.
2. **Scans**: `pnpm audit`/OSV, `secretlint` over history, Electronegativity. Present the results in the security-review table format.
3. **Cross-surface journey** (`tests/journeys/`):
   - Admin imports students → student enrolls (auto-approved) → taps at the kiosk (FakeReader + one real run) → borrows 3 items.
   - Skyline updates → low-stock email → returns 1 as DAMAGED → write-off visible → `ops:reconcile` = 0.
4. **Load test** (k6): 300 identify + borrow per minute for 15 minutes. p95 < 300 ms, no 5xx, pool sizing documented.
5. **Chaos**:
   - Kill Redis/API mid-borrow → no drift; idempotent retry is safe.
   - Unplug the reader mid-tap → K9, then recovery.
   - Provider outage → retries, then DLQ, with no duplicates.
6. **Finish gates** for ui-kit, admin, kiosk and mobile; `click-path-audit` on the kiosk and admin.
7. **Backup/restore drill** into a clean database; `ops:reconcile` = 0.

**Verify**
```powershell
pnpm verify; pnpm test:e2e; pnpm test:journeys; pnpm test:attacks
k6 run tests/load/class-change.js
pnpm ops:reconcile
```

**Exit criteria**
- [ ] No open critical/high findings. `verification-loop` = **PASS**.
- [ ] Load, chaos and restore evidence is in `docs/evidence/`.

**Rollback.** Each fix is its own revertable commit.

---

## S14 · Deployment, pilot & handover

| Depends on | Parallel with | Tier | Size | Touches |
|---|---|---|---|---|
| S13 | — | default | M | `deploy/`, `docs/runbooks`, `docs/guides` |

**ECC skills:** `deployment-patterns` · `docker-patterns` · `production-audit` · `canary-watch` · `architecture-decision-records` · `git-workflow`
**Agents:** ECC `devops/ops-cicd-github` · `testing/production-validator`

**Context brief.** Deploy on the hosting chosen at Q7, install the kiosk at the Cisco lab, and release the mobile app.
Pass the **real-channel gate**, then run a **two-week pilot** with one class.

**Tasks**
1. `deploy/compose.prod.yml`: `api`, `worker`, `admin` (Next standalone), `postgres`, `redis`, and **Caddy** (automatic TLS, or an internal CA on the LAN).
   Healthchecks, limits, restart policies, Docker secrets. Images tagged per release.
2. **Backups**: nightly encrypted `pg_dump` plus the image volume, kept off-site for 14 days. The restore runbook is tested.
3. **Monitoring**: Uptime Kuma (API, admin, kiosk heartbeat → admin alert if a kiosk is offline > 5 min) and GlitchTip/Sentry.
4. **Real-channel gate (mandatory, R8)**:
   - Send a real email, **SMS** and **WhatsApp** low-stock alert to verified admin recipients, with delivery receipts recorded.
   - WhatsApp needs the approved EN/FR template, a production sender number and a working webhook.
   - If ICTU cannot provide a channel by go-live, record a **stakeholder-signed deferral** in the changelog.
5. **Kiosk install**:
   - Reader driver; the signed NSIS build, or the manual-update runbook if Q12 is unresolved; device registration.
   - A restricted Windows account with auto-login and auto-start (Shell Launcher on Enterprise/Education); no sleep; update hours outside lab time.
6. **Mobile release**: pilot APK → Play staged rollout; TestFlight → App Store. This needs ICTU **organisation** accounts (Q10).
7. **Real data** with the Registry: SIS import as a dry run first, then commit (with rollback available). Card binding by import, or a start-of-term link drive.
8. **Pilot** (2 weeks):
   - KPIs: tap success ≥ 98 %, median borrow ≤ 20 s, alert delivery ≥ 99 %, nightly `ops:reconcile` = 0.
   - Weekly fix releases, with `canary-watch` after each.
9. **Handover**: EN/FR admin guide, lab-assistant card, runbooks (reader, kiosk re-register, restore, rotate secrets, add admin, WhatsApp template, manual kiosk update), ADR index.

**Verify**
```powershell
docker compose -f deploy/compose.prod.yml up -d --wait
curl.exe -fsS https://<host>/api/ready
pnpm ops:reconcile -- --env production
```

**Exit criteria**
- [ ] `production-audit` is PASS; the restore drill and the real-channel gate (or signed deferral) are evidenced.
- [ ] Pilot KPIs are met for 2 consecutive weeks; ICTU signs the go-live checklist.

**Rollback.**
- Server: redeploy the previous image tag. Migrations are expand → migrate → contract, so the prior tag stays compatible.
- Kiosk: promote the prior signed build.
- Mobile: halt the staged rollout and raise `minSupportedVersion` / use EAS Update.
