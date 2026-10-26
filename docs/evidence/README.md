# Evidence (S13 / S14)

| File                       | What it proves                                                                                 | How to regenerate                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `load-YYYY-MM-DD.json`     | 300 identify + borrow, 10 kiosks in parallel: errors, p50/p95/max latency, drift               | `pnpm --filter @labpass/api exec vitest run test/load` (in-process); on the lab server: `k6 run tests/load/class-change.js` |
| `restore-YYYY-MM-DD.json`  | Backup → restore into a clean database → equal row counts → reconcile = 0                      | `pwsh scripts/ops/restore-drill.ps1`                                                                                        |
| `identify-YYYY-MM-DD.json` | Card tap → student shown, server side: p50/p95/max over 200 identifies (budget p95 < 150 ms)   | `pnpm --filter @labpass/api exec vitest run test/load/identify-latency.test.ts`                                             |
| `import-YYYY-MM-DD.json`   | 50 000-student import (preview + commit): time (budget < 60 s) and peak memory (budget 300 MB) | `pnpm --filter @labpass/api bench:import` (runs against `labpass_test`)                                                     |

Other S13 evidence lives in the test suites (run in CI and before every release):

- **Attack tests:** `apps/api/test/attacks/`, plus the tests mapped in `docs/security/threat-model.md`.
- **Cross-surface journey:** `apps/api/test/journeys/journey.test.ts` (import → enroll → tap → borrow → low-stock email → damaged return → reconcile 0).
- **Chaos and recovery:**
  - API: idempotent retry after a crash between commit and cache (`reliability.test.ts`), outbox at-least-once with inbox de-duplication (`reliability.test.ts`), provider outage → retries → dead letter (`channels.test.ts`).
  - Kiosk: server outage → offline lending → sync with 0 drift → replay is a no-op (`apps/kiosk/test/offline.test.ts`, API `offline.test.ts`); reader unplugged → K9 → recovery (kiosk e2e).
- **Finish-gate screenshots:**
  - kiosk K1–K10 at 1920×1080 and 1366×768: `apps/kiosk/e2e/.results/screens/` after `pnpm --filter @labpass/kiosk test:e2e`;
  - student web app: 390×844.

Numbers from the developer laptop are **not** acceptance numbers. The p95 < 300 ms gate is measured on the lab server with
k6 during S14 (the laptop runs the API in-process next to Docker on a slow CPU: p95 ≈ 0.5 s at ~2 000 operations/min,
0 errors, 0 drift).
