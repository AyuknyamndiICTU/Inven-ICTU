# S13 security findings and scan results

**Date:** 2026-10-26 · **Scope:** S11 kiosk, S11.5 offline mode, S12 student app (new attack surface), plus repository-wide
dependency and secret scans. Earlier surfaces were reviewed in their own steps and are covered by the attack tests mapped
in [`threat-model.md`](./threat-model.md).

## Code review findings (security-review agent)

| #   | Severity  | File                                   | Lines   | Vulnerability                                                                                           | Confidence | Status                                                                                                                                                                            |
| --- | --------- | -------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🟠 HIGH   | apps/api/src/offline/evidence.ts       | 59-61   | Offline ASSISTANT evidence was only an id → anyone with a kiosk token could forge offline loans/returns | 8/10       | **Fixed**: per-kiosk assistant MAC key wrapped under the argon2 digest; every assistant transaction carries an HMAC the server verifies (`assistant-key.ts`, `offlineTxMacInput`) |
| 2   | 🟠 HIGH   | apps/api/src/offline/evidence.ts       | 44-97   | HCE/SCAN signatures replayable at sync; kiosk-declared window; `bundleVersion 0` skipped checks         | 8/10       | **Fixed**: durable `used_evidence_nonces` (online taps and offline syncs), window bounded to [bundle issue, now], unknown bundle → `BUNDLE_EXPIRED`                               |
| 3   | 🟡 MEDIUM | apps/kiosk/src/main/offline/engine.ts  | 259-266 | Offline mode downgraded DESFire cards to UID-only                                                       | 7/10       | **Fixed**: `cardAuthMode` in the bundle; kiosk refuses offline cards and the server rejects CARD evidence when `DESFIRE_REQUIRED`                                                 |
| 4   | 🟡 MEDIUM | apps/api/src/offline/offline.module.ts | 111-115 | Assistant PIN hashes shipped to kiosks; no persisted offline attempt limit; VIEWER not filtered         | 7/10       | **Fixed**: no hash digest leaves the server (params + wrapped key only); 5 attempts → 15 min lock persisted in the encrypted store; VIEWER excluded                               |
| 5   | ⚪ LOW    | apps/api/src/offline/offline.module.ts | 263-267 | Raw card UID stored in conflict payloads shown to assistants                                            | 8/10       | **Fixed**: replaced by `uidSuffix` before storage                                                                                                                                 |
| 6   | ⚪ LOW    | apps/mobile/public/sw.js               | 31-43   | Service worker kept the previous student's `/api/me` on a shared browser                                | 8/10       | **Fixed**: sign-out and revoke purge cached API responses                                                                                                                         |

Residual risk (accepted, documented in ADR-0010): a rogue NFC reader held next to an **unlocked** phone with the LabPass
app can obtain one signature per tap (the same relay limit as any contactless credential). Each signature can back at most
one identification, ever (nonce table), and only at the kiosk id it names.

All fixes have regression tests: `apps/api/test/operations/offline.test.ts` ("S13: captured signatures, forged assistant
MACs, unknown bundles and DESFire-required cards are refused"), `apps/api/test/attacks/attacks.test.ts`,
`apps/kiosk/test/offline.test.ts` (assistant lockout, DESFire refusal, MAC accepted by the server algorithm).

## Dependency audit (`pnpm audit`, 2026-10-26)

| Package                                                                                                                                                                                                         | Highest                                          | Where it runs                                 | Action                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------- |
| electron 38.8.6                                                                                                                                                                                                 | HIGH (context-isolation bypass, sandbox escapes) | **Kiosk runtime**                             | **Upgraded to 42.11.18**; kiosk unit + Electron e2e re-run          |
| fastify 5.11.3                                                                                                                                                                                                  | HIGH (validation/auth bypass)                    | **API runtime**                               | **Upgraded to 5.12.7** (workspace override)                         |
| nodemailer 7.0.13                                                                                                                                                                                               | HIGH (addressparser DoS, TLS validation)         | **API runtime**                               | **Upgraded to 10.2.1**; notification tests re-run                   |
| tinypool (via vitest 3)                                                                                                                                                                                         | CRITICAL                                         | Test runner only                              | Accepted (dev only); vitest 4 migration tracked for after the pilot |
| deepmerge-ts (prisma CLI), image-size / node-forge / decode-uri-component (Expo CLI), postcss (Next/Expo build), esbuild (tsup), extract-zip (Electron download), file-type (@swc/cli), uuid (exceljs internal) | HIGH/MODERATE                                    | Build / install tooling, not shipped to users | Accepted; re-audit on every dependency bump                         |

## Secret scan

`secretlint "**/*"` over the working tree: **0 findings** (also enforced on every commit by lint-staged).

## Electron configuration review

Electronegativity could not be installed offline on the build machine; the equivalent checks were done by review and are
enforced by tests: `contextIsolation`, `sandbox`, `nodeIntegration: false` (+ workers/subframes), `webSecurity`,
`webviewTag: false`, no `allowRunningInsecureContent`, navigation and `window.open` denied, permission handler allows
only video, CSP (meta + header), devtools only in development, IPC sender validation + zod. Run `npx
@doyensec/electronegativity -i apps/kiosk` on a connected machine before the first signed release.
