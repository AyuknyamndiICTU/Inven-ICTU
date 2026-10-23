import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventoryService } from '../../src/inventory/inventory.module';
import { IdentifyService } from '../../src/lending/identify.service';
import { LendingService } from '../../src/lending/lending.service';
import { ReconcileService } from '../../src/ops/reconcile';
import { AppError } from '../../src/platform/http/problem';
import { bootTestApp, type TestApp } from '../helpers/app';
import { makeStudent } from '../helpers/identity';
import { makeEquipment } from '../helpers/lending';

const op = fc.oneof(
  fc.record({
    kind: fc.constant('adjust' as const),
    eq: fc.integer({ min: 0, max: 1 }),
    delta: fc.integer({ min: -4, max: 5 }).filter((d) => d !== 0),
  }),
  fc.record({
    kind: fc.constant('borrow' as const),
    student: fc.integer({ min: 0, max: 1 }),
    eq: fc.integer({ min: 0, max: 1 }),
    qty: fc.integer({ min: 1, max: 3 }),
  }),
  fc.record({
    kind: fc.constant('return' as const),
    student: fc.integer({ min: 0, max: 1 }),
    pick: fc.nat(),
    qty: fc.integer({ min: 1, max: 3 }),
    condition: fc.constantFrom('OK' as const, 'DAMAGED' as const),
  }),
  fc.record({
    kind: fc.constant('force' as const),
    pick: fc.nat(),
    qty: fc.integer({ min: 1, max: 3 }),
    condition: fc.constantFrom('OK' as const, 'DAMAGED' as const, 'LOST' as const),
  }),
);

/** S06 `test:property`: any interleaving of stock operations keeps invariant I2 and the ledger in agreement. */
describe('stock invariants under random operation sequences (S06)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());

  it('keeps total − available = Σ outstanding and 0 ≤ available ≤ total', async () => {
    const inventory = t.app.get(InventoryService);
    const lending = t.app.get(LendingService);
    const identify = t.app.get(IdentifyService);
    const reconcile = t.app.get(ReconcileService);
    const adminId = randomUUID();
    const kioskId = randomUUID();
    const key = () => `prop-${randomUUID()}`;

    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 14 }), async (ops) => {
        await t.reset();
        const eqs = [await makeEquipment(t, { qty: 3 }), await makeEquipment(t, { qty: 2 })];
        const students = [await makeStudent(t), await makeStudent(t)];
        const sessions = await Promise.all(
          students.map(async (s) => (await identify.identified(kioskId, s, 'CARD', null)).session.token),
        );
        for (const o of ops) {
          try {
            if (o.kind === 'adjust') {
              await inventory.adjust(
                eqs[o.eq]!.id,
                { type: o.delta > 0 ? 'RESTOCK' : 'WRITE_OFF', delta: o.delta, reason: 'property test' },
                adminId,
                key(),
              );
            } else if (o.kind === 'borrow') {
              await lending.signIn(
                kioskId,
                { session: sessions[o.student]!, lines: [{ equipmentId: eqs[o.eq]!.id, quantity: o.qty }] },
                key(),
              );
            } else if (o.kind === 'return') {
              const lines = await identify.openLines(students[o.student]!.id);
              if (!lines.length) continue;
              const l = lines[o.pick % lines.length]!;
              await lending.signOut(
                kioskId,
                {
                  session: sessions[o.student]!,
                  lines: [{ loanLineId: l.loanLineId, quantity: o.qty, condition: o.condition }],
                },
                key(),
              );
            } else {
              const lines = (await Promise.all(students.map((s) => identify.openLines(s.id)))).flat();
              if (!lines.length) continue;
              const l = lines[o.pick % lines.length]!;
              await lending.forceReturn(
                l.loanId,
                {
                  lines: [{ loanLineId: l.loanLineId, quantity: o.qty, condition: o.condition }],
                  reason: 'property test',
                },
                adminId,
                key(),
              );
            }
          } catch (e) {
            // Business refusals (insufficient stock, over-return, below quantity out) are expected outcomes.
            if (!(e instanceof AppError) || e.status >= 500) throw e;
          }
        }
        const { drift } = await reconcile.check();
        expect(drift).toEqual([]);
        for (const e of await t.prisma.equipment.findMany()) {
          expect(e.availableQuantity).toBeGreaterThanOrEqual(0);
          expect(e.availableQuantity).toBeLessThanOrEqual(e.totalQuantity);
        }
      }),
      { numRuns: 15 },
    );
  });
});
