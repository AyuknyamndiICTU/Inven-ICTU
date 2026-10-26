import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReconcileService } from '../../src/ops/reconcile';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { enrollAndroid } from '../helpers/identity';
import { challenge, drain, hceTap, idemKey, makeEquipment, signIn, signOut } from '../helpers/lending';

/**
 * S13 cross-surface journey (API level, the same calls the admin console, student app and kiosk make):
 * admin imports students → student enrolls on Android (auto-approved) → taps at the kiosk → borrows 3 items →
 * low-stock email → returns 1 as DAMAGED → write-off visible → reconcile reports 0 drift.
 */
describe('journey: import → enroll → tap → borrow → alert → damaged return → reconcile', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await bootTestApp();
    await t.reset();
  });
  afterAll(() => t.close());

  it('runs end to end with zero drift', async () => {
    const { cookie, user: admin } = await adminSession(t, 'LAB_ADMIN');

    // 1. Admin imports the class list.
    const csv =
      'matricule,first_name,last_name,date_of_birth,email\nICTU20250077,Ngozi,Ayuk Tabe,14/05/2004,ngozi@ictuniversity.test\n';
    const preview = await t.request({
      method: 'POST',
      url: '/directory/imports?kind=STUDENTS&fileName=class.csv',
      cookie,
      headers: { 'content-type': 'text/csv' },
      payload: Buffer.from(csv, 'utf8'),
    });
    expect(preview.statusCode).toBe(201);
    const committed = await t.request({
      method: 'POST',
      url: `/directory/imports/${preview.json().id}/commit`,
      cookie,
      payload: { deactivateMissing: false },
    });
    expect(committed.statusCode).toBe(200);

    // 2. The student enrolls with the Android app: exact match + OTP → auto-approved.
    const enrolled = await enrollAndroid(t, {
      matricule: 'ICTU20250077',
      firstName: 'Ngozi',
      lastName: 'Ayuk Tabe',
      dateOfBirth: new Date('2004-05-14T00:00:00Z'),
    });
    expect(enrolled.status).toBe('ACTIVE');

    // 3. Equipment with a low-stock threshold, a registered kiosk.
    const routers = await makeEquipment(t, { qty: 4, threshold: 2, name: 'Cisco 2911 Router' });
    const cables = await makeEquipment(t, { qty: 10, threshold: 1, name: 'Console cable' });
    const kiosk = await registerKiosk(t);

    const tap = async () => {
      const nonce = await challenge(t, kiosk.token);
      const res = await t.request({
        method: 'POST',
        url: '/kiosk/identify',
        bearer: kiosk.token,
        origin: null,
        payload: hceTap(enrolled.phone, enrolled.credentialId, kiosk.kioskId, nonce),
      });
      return res.json();
    };

    // 4. Phone tap (HCE) at the kiosk → identified.
    const who = await tap();
    expect(who).toMatchObject({ status: 'IDENTIFIED', method: 'HCE', student: { matricule: 'ICTU20250077' } });

    // 5. Borrow 3 items: 2 routers + 1 cable.
    const borrow = await signIn(t, kiosk.token, who.session.token, [
      { equipmentId: routers.id, quantity: 2 },
      { equipmentId: cables.id, quantity: 1 },
    ]);
    expect(borrow.statusCode).toBe(201);

    // 6. Routers fell to the threshold → a low-stock email reaches the lab admin (once; every admin is notified).
    await drain(t);
    const lowStock = t.notifications.sentForTest.filter((m) => m.template === 'low_stock');
    expect(lowStock.filter((m) => m.to === admin.email)).toEqual([expect.objectContaining({ channel: 'EMAIL' })]);

    // 7. Return one router as DAMAGED → written off the total.
    const again = await tap();
    const routerLine = (again.openLines as Array<{ loanLineId: string; equipmentId: string }>).find(
      (l) => l.equipmentId === routers.id,
    )!;
    const ret = await signOut(
      t,
      kiosk.token,
      again.session.token,
      [{ loanLineId: routerLine.loanLineId, quantity: 1, condition: 'DAMAGED' }],
      idemKey(),
    );
    expect(ret.statusCode).toBe(200);
    const r = await t.prisma.equipment.findUniqueOrThrow({ where: { id: routers.id } });
    expect({ total: r.totalQuantity, available: r.availableQuantity }).toEqual({ total: 3, available: 2 });
    expect(await t.prisma.stockMovement.count({ where: { equipmentId: routers.id, totalDelta: -1 } })).toBe(1);

    // 8. Nightly reconcile: the ledger and the quantities agree.
    await drain(t);
    const report = await t.app.get(ReconcileService).check();
    expect(report.drift).toEqual([]);
  });
});
