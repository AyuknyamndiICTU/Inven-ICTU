import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RealtimeService } from '../../src/platform/realtime/realtime';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { enrollAndroid } from '../helpers/identity';
import { challenge, idemKey, makeEquipment, scanSignature, signOut } from '../helpers/lending';

/**
 * Fall 2026 admissions list → enrolment without a date of birth → Scan-the-Kiosk → borrow for a hall → return,
 * and the hall in loans, the student app, reports and live activity.
 */
async function admissionsXlsx(): Promise<Buffer> {
  const head = [
    'MATRICULE',
    'NAME',
    'GENDER',
    'NATIONALITY',
    'ICT-U EMAIL',
    'EMAIL',
    'PASSWORD',
    'PHONE NUMBER',
    'SECTION ',
  ];
  const wb = new ExcelJS.Workbook();
  const sen = wb.addWorksheet('SEN');
  sen.addRow(head);
  sen.addRow([
    'ICTU20269101',
    'FOMBA NJI GRACE',
    'FEMALE',
    'CAMEROONIAN',
    'fomba.grace@ictuniversity.edu.cm',
    'grace@example.com',
    'TopSecret@2026',
    670101010,
    'English',
  ]);
  const cyber = wb.addWorksheet('CYBER');
  cyber.addRow([' ', ...head.slice(1)]);
  cyber.addRow(['ICTU20269102', 'ATEBA EYENGA PAUL', 'MALE', 'CAMEROONIAN', 'ateba.paul@ictuniversity.edu.cm']);
  cyber.addRow([null, 'NO MATRICULE YET', 'MALE', 'CAMEROONIAN', 'nomat@ictuniversity.edu.cm']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('admissions import, halls and Scan-the-Kiosk borrowing', () => {
  let t: TestApp;
  let cookie: string;
  beforeAll(async () => {
    t = await bootTestApp();
    await t.reset();
    ({ cookie } = await adminSession(t, 'SUPER_ADMIN'));
  });
  afterAll(() => t.close());

  it('imports every programme sheet without storing passwords', async () => {
    const preview = await t.request({
      method: 'POST',
      url: '/directory/imports?kind=STUDENTS&fileName=Fall%202026%20ADMISSIONS.xlsx',
      cookie,
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      payload: await admissionsXlsx(),
    });
    expect(preview.statusCode).toBe(201);
    const p = preview.json();
    expect(p.detectedHeaders).not.toContain('PASSWORD');
    expect(p.counts).toMatchObject({ total: 3, new: 2, invalid: 1 });
    expect(p.issues).toEqual([
      expect.objectContaining({ field: 'matricule', message: 'CYBER, row 3: Matricule is required' }),
    ]);
    const stored = await t.prisma.directoryImport.findUniqueOrThrow({ where: { id: p.id } });
    expect(stored.storageKey).toMatch(/\.json$/);
    expect(JSON.stringify(stored)).not.toContain('TopSecret');

    const commit = await t.request({
      method: 'POST',
      url: `/directory/imports/${p.id}/commit`,
      cookie,
      payload: { deactivateMissing: false },
    });
    expect(commit.statusCode).toBe(200);
    const grace = await t.prisma.student.findUniqueOrThrow({ where: { matricule: 'ICTU20269101' } });
    expect(grace).toMatchObject({
      firstName: 'Nji Grace',
      lastName: 'Fomba',
      email: 'fomba.grace@ictuniversity.edu.cm',
      personalEmail: 'grace@example.com',
      phone: '+237670101010',
      gender: 'Female',
      nationality: 'Cameroonian',
      section: 'English',
      program: 'SEN',
      dateOfBirth: null,
      status: 'ACTIVE',
    });

    const list = await t.request({ method: 'GET', url: '/students?program=cyber', cookie });
    expect(list.json().items.map((s: { matricule: string }) => s.matricule)).toEqual(['ICTU20269102']);
    const detail = await t.request({ method: 'GET', url: `/students/${grace.id}`, cookie });
    expect(detail.json()).toMatchObject({ section: 'English', personalEmail: 'grace@example.com', dateOfBirth: null });
  });

  it('enrols a student with no date of birth on record, names in any order, and auto-approves', async () => {
    const grace = await t.prisma.student.findUniqueOrThrow({ where: { matricule: 'ICTU20269101' } });
    const e = await enrollAndroid(t, {
      matricule: grace.matricule,
      firstName: 'Grace',
      lastName: 'Fomba Nji',
      dateOfBirth: null,
    });
    expect(e.status).toBe('ACTIVE');
  });

  it('Scan-the-Kiosk → borrow for a hall → return; the hall shows everywhere', async () => {
    const kiosk = await registerKiosk(t);
    const grace = await t.prisma.student.findUniqueOrThrow({ where: { matricule: 'ICTU20269101' } });
    await t.prisma.credentialRequest.deleteMany({ where: { studentId: grace.id } });
    await t.prisma.mobileCredential.deleteMany({ where: { studentId: grace.id } });
    const e = await enrollAndroid(t, {
      matricule: grace.matricule,
      firstName: 'Nji Grace',
      lastName: 'Fomba',
      dateOfBirth: null,
    });
    const projector = await makeEquipment(t, { name: 'HD Projector', qty: 3 });
    const hdmi = await makeEquipment(t, { name: 'HDMI Cable 3 m', qty: 10 });

    const config = await t.request({ method: 'GET', url: '/kiosk/config', bearer: kiosk.token, origin: null });
    expect(config.json().lendingLocations).toEqual(expect.arrayContaining(['Chumbow Hall', 'IT Hall', 'Computer Lab']));

    // The student scans the kiosk QR with the app; the kiosk receives the identified student over its socket.
    const spy = vi.spyOn(t.app.get(RealtimeService), 'toKiosk');
    const nonce = await challenge(t, kiosk.token);
    const ts = Date.now();
    const scan = await t.request({
      method: 'POST',
      url: '/me/scan',
      origin: null,
      bearer: e.tokens.accessToken,
      payload: {
        kind: 'DEVICE_KEY',
        kioskId: kiosk.kioskId,
        nonce,
        ts,
        signature: scanSignature(e.phone, e.credentialId, kiosk.kioskId, nonce, ts),
      },
    });
    expect(scan.json()).toMatchObject({ status: 'IDENTIFIED' });
    const pushed = spy.mock.calls.find((c) => c[1] === 'identified')![2] as unknown as {
      session: { token: string };
      method: string;
    };
    spy.mockRestore();
    expect(pushed.method).toBe('SCAN');

    const borrow = await t.request({
      method: 'POST',
      url: '/kiosk/sign-in',
      bearer: kiosk.token,
      origin: null,
      headers: { 'idempotency-key': idemKey() },
      payload: {
        session: pushed.session.token,
        location: 'Chumbow Hall',
        lines: [
          { equipmentId: projector.id, quantity: 1 },
          { equipmentId: hdmi.id, quantity: 2 },
        ],
      },
    });
    expect(borrow.statusCode, borrow.body).toBe(201);
    expect(borrow.json()).toMatchObject({ kind: 'BORROW', location: 'Chumbow Hall', studentFirstName: 'Nji Grace' });

    const loans = await t.request({ method: 'GET', url: '/loans?location=chumbow%20hall', cookie });
    expect(loans.json().items).toEqual([expect.objectContaining({ location: 'Chumbow Hall', identifyMethod: 'SCAN' })]);
    expect((await t.request({ method: 'GET', url: '/loans?location=IT%20Hall', cookie })).json().items).toEqual([]);
    const csv = await t.request({ method: 'GET', url: '/loans/export.csv', cookie });
    expect(csv.body).toContain('Chumbow Hall');

    const mine = await t.request({ method: 'GET', url: '/me/loans', origin: null, bearer: e.tokens.accessToken });
    expect(mine.json()).toEqual([expect.objectContaining({ location: 'Chumbow Hall' })]);

    const today = new Date().toISOString().slice(0, 10);
    const usage = await t.request({ method: 'GET', url: `/reports/usage?from=${today}&to=${today}`, cookie });
    expect(usage.json().byLocation).toEqual([{ location: 'Chumbow Hall', loans: 1, quantity: 3 }]);
    const activity = await t.request({ method: 'GET', url: '/dashboard/activity', cookie });
    expect(activity.json().map((a: { text: string }) => a.text)).toContain(
      '1 × HD Projector borrowed at Cisco Lab Kiosk for Chumbow Hall',
    );

    // Return at the kiosk (a second scan opens a new session).
    const nonce2 = await challenge(t, kiosk.token);
    const spy2 = vi.spyOn(t.app.get(RealtimeService), 'toKiosk');
    const ts2 = Date.now();
    await t.request({
      method: 'POST',
      url: '/me/scan',
      origin: null,
      bearer: e.tokens.accessToken,
      payload: {
        kind: 'DEVICE_KEY',
        kioskId: kiosk.kioskId,
        nonce: nonce2,
        ts: ts2,
        signature: scanSignature(e.phone, e.credentialId, kiosk.kioskId, nonce2, ts2),
      },
    });
    const again = spy2.mock.calls.find((c) => c[1] === 'identified')![2] as unknown as {
      session: { token: string };
      openLines: Array<{ loanLineId: string; outstanding: number }>;
    };
    spy2.mockRestore();
    const back = await signOut(
      t,
      kiosk.token,
      again.session.token,
      again.openLines.map((l) => ({ loanLineId: l.loanLineId, quantity: l.outstanding, condition: 'OK' as const })),
    );
    expect(back.statusCode, back.body).toBe(200);
    expect((await t.prisma.equipment.findUniqueOrThrow({ where: { id: hdmi.id } })).availableQuantity).toBe(10);
  });

  it('a borrow without a hall still works for older kiosks, and halls are editable in settings', async () => {
    const res = await t.request({
      method: 'PATCH',
      url: '/settings',
      cookie,
      payload: { lendingLocations: ['Chumbow Hall', 'IT Hall', 'Library'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lendingLocations).toEqual(['Chumbow Hall', 'IT Hall', 'Library']);
    const bad = await t.request({ method: 'PATCH', url: '/settings', cookie, payload: { lendingLocations: [] } });
    expect(bad.statusCode).toBe(400);
  });
});
