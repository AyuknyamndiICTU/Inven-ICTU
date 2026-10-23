# ADR-0006 — Stock ledger and database-transactional idempotency

- **Status:** Accepted (2026-10-23, S03).
- **Context:** Concurrent borrows and retried requests are the main threats to stock correctness (invariant I2).
  A Redis-only idempotency cache can double-apply an effect if the process crashes after the database commit but before the cache write.
- **Decision:**
  - `equipment.availableQuantity` and `totalQuantity` are updated **in the same transaction** as an append-only `stock_movements` row. Triggers reject UPDATE and DELETE on that table.
  - Database CHECKs enforce `0 ≤ available ≤ total` and `returned + damaged + lost ≤ issued`.
  - Borrowing uses a **conditional decrement** (`… WHERE "availableQuantity" >= $q`, 0 rows → `409`). Locks are taken in `equipmentId` order to avoid deadlocks.
  - Idempotency rows (`idempotency_keys`, unique `(scope, key)`) are inserted and completed **inside the business transaction**, so a committed effect always has its stored response. Redis only caches replays.
  - `pnpm ops:reconcile` recomputes `total − available = Σ outstanding` and `total = Σ totalDelta` from the ledger.
- **Consequences:** Corrections are compensating movements and never edits. Undo is a movement that references the original.
  The production database role gets INSERT/SELECT only on ledger tables (runbook).
