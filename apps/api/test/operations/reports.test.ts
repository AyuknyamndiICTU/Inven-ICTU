import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { makeStudent } from '../helpers/identity';
import { cardSession, idemKey, makeEquipment, signIn, signOut } from '../helpers/lending';

describe('dashboard, reports & audit (S06)', () => {
  let t: TestApp;
  let cookie: string;
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    ({ cookie } = await adminSession(t, 'LAB_ADMIN'));
  });

  async function activity() {
    const kiosk = await registerKiosk(t);
    const router = await makeEquipment(t, { qty: 4, threshold: 2, name: 'Cisco 4321 Router' });
    const cable = await makeEquipment(t, { qty: 10, threshold: 2, name: 'Console cable' });
    const [a, b] = [await makeStudent(t), await makeStudent(t)];
    const sa = (await cardSession(t, kiosk.token, a.id)).session;
    const sb = (await cardSession(t, kiosk.token, b.id)).session;
    await signIn(t, kiosk.token, sa, [
      { equipmentId: router.id, quantity: 2 },
      { equipmentId: cable.id, quantity: 3 },
    ]);
    await signIn(t, kiosk.token, sb, [{ equipmentId: router.id, quantity: 1 }]);
    const line = await t.prisma.loanLine.findFirstOrThrow({ where: { equipmentId: cable.id } });
    await signOut(t, kiosk.token, sa, [{ loanLineId: line.id, quantity: 3, condition: 'OK' }]);
    return { kiosk, router, cable };
  }

  it('summarises stock, loans, kiosks and queues', async () => {
    const { router } = await activity();
    const s = (await t.request({ method: 'GET', url: '/dashboard/summary', cookie })).json();
    expect(s).toMatchObject({
      itemsOut: 3,
      openLoans: 2,
      overdueLoans: 0,
      lowStockItems: 1,
      outOfStockItems: 0,
      studentsToday: 2,
      kiosksTotal: 1,
      pendingCredentialRequests: 0,
      openSyncConflicts: 0,
    });
    expect(s.skyline.find((x: { equipmentId: string }) => x.equipmentId === router.id)).toMatchObject({
      available: 1,
      total: 4,
      health: 'LOW',
    });
  });

  it('lists recent activity without student names', async () => {
    await activity();
    const items = (await t.request({ method: 'GET', url: '/dashboard/activity', cookie })).json();
    expect(items[0]).toMatchObject({ kind: 'RETURN', text: '3 × Console cable returned at Cisco Lab Kiosk' });
    expect(items.some((i: { kind: string }) => i.kind === 'BORROW')).toBe(true);
  });

  it('reports usage by item, day and hour, and exports it as CSV', async () => {
    await activity();
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10); // Douala date (UTC+1)
    const r = (await t.request({ method: 'GET', url: `/reports/usage?from=${today}&to=${today}`, cookie })).json();
    expect(r.byItem).toEqual([
      expect.objectContaining({ name: 'Cisco 4321 Router', loans: 2, quantity: 3 }),
      expect.objectContaining({ name: 'Console cable', loans: 1, quantity: 3 }),
    ]);
    expect(r.byDay).toEqual([{ date: today, loans: 2 }]);
    expect(r.byHour).toHaveLength(24);
    expect(r.byHour.reduce((n: number, h: { loans: number }) => n + h.loans, 0)).toBe(2);
    expect(r.uniqueStudents).toBe(2);
    expect(
      (await t.request({ method: 'GET', url: `/reports/usage?from=${today}&to=2020-01-01`, cookie })).json().code,
    ).toBe('INVALID_RANGE');
    const csv = await t.request({ method: 'GET', url: `/reports/usage.csv?from=${today}&to=${today}`, cookie });
    expect(csv.body).toContain('Cisco 4321 Router');
    expect(await t.prisma.auditLog.count({ where: { action: 'reports.export' } })).toBe(1);
  });

  it('shows the audit log to lab admins only', async () => {
    const eq = await makeEquipment(t);
    await t.request({
      method: 'POST',
      url: `/equipment/${eq.id}/adjust`,
      cookie,
      headers: { 'idempotency-key': idemKey() },
      payload: { type: 'RESTOCK', delta: 2, reason: 'Delivery' },
    });
    const log = (await t.request({ method: 'GET', url: '/audit?entity=inventory', cookie })).json();
    expect(log.items[0]).toMatchObject({
      action: 'equipment.adjust',
      actorType: 'ADMIN',
      actorLabel: expect.any(String),
    });
    const { cookie: viewer } = await adminSession(t, 'VIEWER');
    expect((await t.request({ method: 'GET', url: '/audit', cookie: viewer })).statusCode).toBe(403);
  });
});
