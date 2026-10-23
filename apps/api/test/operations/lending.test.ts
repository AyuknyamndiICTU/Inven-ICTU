import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../../src/platform/jobs/jobs';
import { ReconcileService } from '../../src/ops/reconcile';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { enrollAndroid, makeStudent } from '../helpers/identity';
import { cardSession, idemKey, makeEquipment, setSettings, signIn, signOut } from '../helpers/lending';

describe('Sign In / Sign Out (ARCH §5 F5–F6, S06)', () => {
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

  const stock = async (id: string) =>
    t.prisma.equipment.findUniqueOrThrow({ where: { id }, select: { totalQuantity: true, availableQuantity: true } });
  const noDrift = async () => expect((await t.app.get(ReconcileService).check()).drift).toEqual([]);

  it('borrows a cart in one transaction, due at lab closing time, and replays the same key', async () => {
    const s = await makeStudent(t);
    const [a, b] = [await makeEquipment(t, { qty: 5 }), await makeEquipment(t, { qty: 3 })];
    const { session } = await cardSession(t, kiosk.token, s.id);
    const key = idemKey();
    const res = await signIn(
      t,
      kiosk.token,
      session,
      [
        { equipmentId: a.id, quantity: 2 },
        { equipmentId: b.id, quantity: 1 },
      ],
      key,
    );
    expect(res.statusCode).toBe(201);
    const receipt = res.json();
    expect(receipt).toMatchObject({ kind: 'BORROW', studentFirstName: s.firstName, offline: false });
    expect(receipt.lines).toHaveLength(2);
    // Lab closing time 18:00 Africa/Douala = 17:00 UTC (or the next day's, after closing).
    expect(new Date(receipt.dueAt).getUTCHours()).toBe(17);
    expect(await stock(a.id)).toEqual({ totalQuantity: 5, availableQuantity: 3 });

    const replay = await signIn(
      t,
      kiosk.token,
      session,
      [
        { equipmentId: b.id, quantity: 1 },
        { equipmentId: a.id, quantity: 2 },
      ],
      key,
    );
    expect(replay.json()).toEqual(receipt); // same request (any line order) → same receipt, no second effect
    expect(await stock(a.id)).toEqual({ totalQuantity: 5, availableQuantity: 3 });
    const reused = await signIn(t, kiosk.token, session, [{ equipmentId: a.id, quantity: 1 }], key);
    expect(reused.statusCode).toBe(422);
    expect(await t.prisma.stockMovement.count({ where: { type: 'ISSUE' } })).toBe(2);
    await noDrift();
  });

  it('refuses more than is available and rolls the whole cart back', async () => {
    const s = await makeStudent(t);
    const [a, b] = [await makeEquipment(t, { qty: 5 }), await makeEquipment(t, { qty: 1 })];
    const { session } = await cardSession(t, kiosk.token, s.id);
    const res = await signIn(t, kiosk.token, session, [
      { equipmentId: a.id, quantity: 2 },
      { equipmentId: b.id, quantity: 2 },
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'INSUFFICIENT_STOCK', extensions: { equipmentId: b.id, available: 1 } });
    expect(await stock(a.id)).toEqual({ totalQuantity: 5, availableQuantity: 5 });
    const inactive = await makeEquipment(t, { active: false });
    expect((await signIn(t, kiosk.token, session, [{ equipmentId: inactive.id, quantity: 1 }])).json().code).toBe(
      'EQUIPMENT_UNAVAILABLE',
    );
  });

  it('applies the borrowing policy: overdue block, item limit, suspended students', async () => {
    const s = await makeStudent(t);
    const eq = await makeEquipment(t, { qty: 10 });
    const { session } = await cardSession(t, kiosk.token, s.id);
    await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 1 }]);
    await t.prisma.loan.updateMany({ data: { dueAt: new Date(Date.now() - 60_000) } });
    expect((await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 1 }])).json().code).toBe(
      'OVERDUE_BLOCKED',
    );
    const again = await t.request({
      method: 'POST',
      url: '/kiosk/identify',
      bearer: kiosk.token,
      origin: null,
      payload: { method: 'MANUAL', matricule: s.matricule },
    });
    expect(again.statusCode).toBe(200);

    await setSettings(t, { blockWhenOverdue: false, maxItemsPerStudent: 3 });
    const over = await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 3 }]);
    expect(over.json()).toMatchObject({ code: 'LIMIT_REACHED', extensions: { remaining: 2 } });
    expect((await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 2 }])).statusCode).toBe(201);

    await t.prisma.student.update({ where: { id: s.id }, data: { status: 'SUSPENDED' } });
    expect((await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 1 }])).json().code).toBe(
      'STUDENT_SUSPENDED',
    );
  });

  it('returns OK and damaged units, closes the loan, and refuses a second return', async () => {
    const s = await makeStudent(t);
    const eq = await makeEquipment(t, { qty: 5 });
    const { session } = await cardSession(t, kiosk.token, s.id);
    await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 3 }]);
    const identified = await cardSession(t, kiosk.token, s.id);
    const line = identified.result.openLines[0];
    expect(line).toMatchObject({ outstanding: 3, equipmentId: eq.id, overdue: false });

    const partial = await signOut(t, kiosk.token, session, [
      { loanLineId: line.loanLineId, quantity: 1, condition: 'OK' },
    ]);
    expect(partial.statusCode).toBe(200);
    expect((await t.prisma.loan.findFirstOrThrow()).status).toBe('OPEN');
    const rest = await signOut(t, kiosk.token, session, [
      { loanLineId: line.loanLineId, quantity: 1, condition: 'OK' },
      { loanLineId: line.loanLineId, quantity: 1, condition: 'DAMAGED' },
    ]);
    expect(rest.json()).toMatchObject({ kind: 'RETURN', dueAt: null });
    expect(
      rest
        .json()
        .lines.map((l: { condition: string }) => l.condition)
        .sort(),
    ).toEqual(['DAMAGED', 'OK']);
    // Damaged units leave the stock: total 5 → 4, all 4 remaining units are on the shelf.
    expect(await stock(eq.id)).toEqual({ totalQuantity: 4, availableQuantity: 4 });
    const loan = await t.prisma.loan.findFirstOrThrow();
    expect(loan.status).toBe('CLOSED');
    expect(loan.closedAt).not.toBeNull();
    const dup = await signOut(t, kiosk.token, session, [{ loanLineId: line.loanLineId, quantity: 1, condition: 'OK' }]);
    expect(dup.json().code).toBe('ALREADY_RETURNED');
    await noDrift();
  });

  it("cannot return another student's loan line or use another kiosk's session", async () => {
    const [s1, s2] = [await makeStudent(t), await makeStudent(t)];
    const eq = await makeEquipment(t, { qty: 5 });
    const one = await cardSession(t, kiosk.token, s1.id);
    await signIn(t, kiosk.token, one.session, [{ equipmentId: eq.id, quantity: 1 }]);
    const lineId = (await t.prisma.loanLine.findFirstOrThrow()).id;
    const two = await cardSession(t, kiosk.token, s2.id);
    expect(
      (await signOut(t, kiosk.token, two.session, [{ loanLineId: lineId, quantity: 1, condition: 'OK' }])).statusCode,
    ).toBe(404);
    const other = await registerKiosk(t, 'Second Kiosk');
    expect((await signIn(t, other.token, one.session, [{ equipmentId: eq.id, quantity: 1 }])).statusCode).toBe(401);
  });

  it('lets staff force-return (including lost units) with a reason, audited', async () => {
    const { cookie } = await adminSession(t, 'LAB_ASSISTANT');
    const s = await makeStudent(t);
    const eq = await makeEquipment(t, { qty: 4 });
    const { session } = await cardSession(t, kiosk.token, s.id);
    await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 2 }]);
    const loan = await t.prisma.loan.findFirstOrThrow({ include: { lines: true } });
    const res = await t.request({
      method: 'POST',
      url: `/loans/${loan.id}/force-return`,
      cookie,
      headers: { 'idempotency-key': idemKey() },
      payload: {
        reason: 'Student left the lab; one router missing',
        lines: [
          { loanLineId: loan.lines[0]!.id, quantity: 1, condition: 'OK' },
          { loanLineId: loan.lines[0]!.id, quantity: 1, condition: 'LOST' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'CLOSED', lines: [{ qtyReturned: 1, qtyLost: 1, outstanding: 0 }] });
    expect(await stock(eq.id)).toEqual({ totalQuantity: 3, availableQuantity: 3 });
    expect(await t.prisma.auditLog.count({ where: { action: 'loans.forceReturn' } })).toBe(1);
    expect((await t.prisma.stockMovement.findFirstOrThrow({ where: { type: 'LOST' } })).reason).toMatch(
      /router missing/,
    );
    await noDrift();
  });

  it('lists, filters and exports loans; students see their own open loans', async () => {
    const { cookie } = await adminSession(t, 'LAB_ADMIN');
    const s = await makeStudent(t);
    const eq = await makeEquipment(t, { qty: 5, name: 'Catalyst 2960 Switch' });
    const e = await enrollAndroid(t, s);
    const { session } = await cardSession(t, kiosk.token, s.id);
    await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 2 }]);
    await t.prisma.loan.updateMany({ data: { dueAt: new Date(Date.now() - 1000) } });

    const overdue = (await t.request({ method: 'GET', url: '/loans?status=OVERDUE', cookie })).json();
    expect(overdue.total).toBe(1);
    expect(overdue.items[0]).toMatchObject({
      overdue: true,
      student: { matricule: s.matricule },
      lines: [{ equipmentName: 'Catalyst 2960 Switch', outstanding: 2 }],
    });
    expect(
      (await t.request({ method: 'GET', url: `/loans?search=${s.matricule.slice(-4)}`, cookie })).json().total,
    ).toBe(1);
    expect((await t.request({ method: 'GET', url: '/loans?status=CLOSED', cookie })).json().total).toBe(0);

    const csv = await t.request({ method: 'GET', url: '/loans/export.csv', cookie });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toContain('Catalyst 2960 Switch');
    expect(csv.body).toContain('OVERDUE');

    const mine = await t.request({ method: 'GET', url: '/me/loans', origin: null, bearer: e.tokens.accessToken });
    expect(mine.json()).toEqual([
      expect.objectContaining({ overdue: true, lines: [{ equipmentName: 'Catalyst 2960 Switch', outstanding: 2 }] }),
    ]);
  });

  it('emits LoanOverdue once per loan', async () => {
    const s = await makeStudent(t);
    const eq = await makeEquipment(t, { qty: 5 });
    const { session } = await cardSession(t, kiosk.token, s.id);
    await signIn(t, kiosk.token, session, [{ equipmentId: eq.id, quantity: 1 }]);
    await t.prisma.loan.updateMany({ data: { dueAt: new Date(Date.now() - 1000) } });
    expect(await t.app.get(JobsService).run('loans-overdue')).toBe(1);
    expect(await t.app.get(JobsService).run('loans-overdue')).toBe(0);
    expect(await t.prisma.outboxEvent.count({ where: { type: 'LoanOverdue' } })).toBe(1);
  });
});
