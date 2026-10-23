import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReconcileService } from '../../src/ops/reconcile';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { makeStudent } from '../helpers/identity';
import { cardSession, idemKey, makeEquipment, signIn, signOut } from '../helpers/lending';

/** S06 `test:concurrency`: simultaneous borrows/returns never break I2 and retries never double-apply. */
describe('lending under concurrency (S06)', () => {
  let t: TestApp;
  let kiosk: { kioskId: string; token: string };
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    kiosk = await registerKiosk(t);
  });

  const noDrift = async () => expect((await t.app.get(ReconcileService).check()).drift).toEqual([]);
  const sessions = async (count: number) => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push((await cardSession(t, kiosk.token, (await makeStudent(t)).id)).session);
    return out;
  };

  it('50 parallel borrows of 1 unit with 5 available → exactly 5 succeed', async () => {
    const eq = await makeEquipment(t, { qty: 5 });
    const ss = await sessions(10);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => signIn(t, kiosk.token, ss[i % 10]!, [{ equipmentId: eq.id, quantity: 1 }])),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(5);
    expect(codes.filter((c) => c === 409)).toHaveLength(45);
    expect((await t.prisma.equipment.findUniqueOrThrow({ where: { id: eq.id } })).availableQuantity).toBe(0);
    await noDrift();
  });

  it('the same Idempotency-Key fired 20 times has one effect', async () => {
    const eq = await makeEquipment(t, { qty: 50 });
    const [session] = await sessions(1);
    const key = idemKey();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => signIn(t, kiosk.token, session!, [{ equipmentId: eq.id, quantity: 2 }], key)),
    );
    const ok = results.filter((r) => r.statusCode === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect([201, 409]).toContain(r.statusCode); // 409 = IDEMPOTENCY_IN_PROGRESS, retryable
    for (const r of ok) expect(r.json()).toEqual(ok[0]!.json());
    expect(await t.prisma.loan.count()).toBe(1);
    expect((await t.prisma.equipment.findUniqueOrThrow({ where: { id: eq.id } })).availableQuantity).toBe(48);
    await noDrift();
  });

  it('duplicate returns of the same line → one succeeds', async () => {
    const eq = await makeEquipment(t, { qty: 5 });
    const [session] = await sessions(1);
    await signIn(t, kiosk.token, session!, [{ equipmentId: eq.id, quantity: 1 }]);
    const lineId = (await t.prisma.loanLine.findFirstOrThrow()).id;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        signOut(t, kiosk.token, session!, [{ loanLineId: lineId, quantity: 1, condition: 'OK' }]),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(9);
    expect((await t.prisma.equipment.findUniqueOrThrow({ where: { id: eq.id } })).availableQuantity).toBe(5);
    await noDrift();
  });

  it('borrow vs return on the same item, and return vs force-return on the same line', async () => {
    const { cookie } = await adminSession(t, 'LAB_ASSISTANT');
    const eq = await makeEquipment(t, { qty: 3 });
    const [a, b] = await sessions(2);
    await signIn(t, kiosk.token, a!, [{ equipmentId: eq.id, quantity: 3 }]);
    const line = await t.prisma.loanLine.findFirstOrThrow();
    // b borrows while a returns: b succeeds iff the return committed first; I2 holds either way.
    const [ret, borrow] = await Promise.all([
      signOut(t, kiosk.token, a!, [{ loanLineId: line.id, quantity: 1, condition: 'OK' }]),
      signIn(t, kiosk.token, b!, [{ equipmentId: eq.id, quantity: 1 }]),
    ]);
    expect(ret.statusCode).toBe(200);
    expect([201, 409]).toContain(borrow.statusCode);
    await noDrift();

    const [kioskReturn, force] = await Promise.all([
      signOut(t, kiosk.token, a!, [{ loanLineId: line.id, quantity: 2, condition: 'OK' }]),
      t.request({
        method: 'POST',
        url: `/loans/${line.loanId}/force-return`,
        cookie,
        headers: { 'idempotency-key': idemKey() },
        payload: { reason: 'Collected at the desk', lines: [{ loanLineId: line.id, quantity: 2, condition: 'OK' }] },
      }),
    ]);
    expect([kioskReturn.statusCode, force.statusCode].sort()).toEqual([200, 409]);
    await noDrift();
  });

  it('multi-line carts in opposite orders do not deadlock', async () => {
    const items = [
      await makeEquipment(t, { qty: 40 }),
      await makeEquipment(t, { qty: 40 }),
      await makeEquipment(t, { qty: 40 }),
    ];
    const ss = await sessions(6);
    const carts = ss.map((s, i) => {
      const order = i % 2 ? [...items].reverse() : items;
      return signIn(
        t,
        kiosk.token,
        s,
        order.map((e) => ({ equipmentId: e.id, quantity: 1 })),
      );
    });
    const results = await Promise.all(carts);
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    for (const e of items)
      expect((await t.prisma.equipment.findUniqueOrThrow({ where: { id: e.id } })).availableQuantity).toBe(34);
    await noDrift();
  });
});
