import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminSession, bootTestApp, registerKiosk, type TestApp } from '../helpers/app';
import { lastOtp, makeStudent } from '../helpers/identity';

describe('students & card links (ARCH §5 F1, §7, S05)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it('masks contacts and hides the date of birth below LAB_ADMIN', async () => {
    const s = await makeStudent(t, { email: 'awa.ngo@ictuniversity.test', phone: '+237699123412' });
    const { cookie: viewer } = await adminSession(t, 'VIEWER');
    const { cookie: admin } = await adminSession(t, 'LAB_ADMIN');
    const masked = (await t.request({ method: 'GET', url: `/students/${s.id}`, cookie: viewer })).json();
    expect(masked.email).not.toBe('awa.ngo@ictuniversity.test');
    expect(masked.email).toMatch(/\*/);
    expect(masked.phone).not.toBe('+237699123412');
    expect(masked.dateOfBirth).toBeNull();
    const full = (await t.request({ method: 'GET', url: `/students/${s.id}`, cookie: admin })).json();
    expect(full).toMatchObject({
      email: 'awa.ngo@ictuniversity.test',
      phone: '+237699123412',
      dateOfBirth: '2004-03-02',
    });
  });

  it('searches by name or matricule with paging', async () => {
    await makeStudent(t, { firstName: 'Awa', lastName: 'Ngo Bassa' });
    await makeStudent(t, { firstName: 'Jean', lastName: 'Kamga', matricule: 'ICTU20259999' });
    const { cookie } = await adminSession(t, 'VIEWER');
    const byName = (await t.request({ method: 'GET', url: '/students?search=kamg', cookie })).json();
    expect(byName.items.map((i: { lastName: string }) => i.lastName)).toEqual(['Kamga']);
    const byMat = (await t.request({ method: 'GET', url: '/students?search=20259999', cookie })).json();
    expect(byMat.total).toBe(1);
    const wildcard = (await t.request({ method: 'GET', url: '/students?search=%25', cookie })).json();
    expect(wildcard.total).toBe(0); // LIKE wildcards are escaped
  });

  it('links an unknown card at the kiosk with an OTP sent to the school contact', async () => {
    const s = await makeStudent(t);
    const { token } = await registerKiosk(t);
    const link = await t.request({
      method: 'POST',
      url: '/kiosk/card-link',
      bearer: token,
      origin: null,
      payload: { uid: '04A1B2C3D4E580', matricule: s.matricule },
    });
    expect(link.statusCode).toBe(200);
    expect(link.json()).toMatchObject({ verification: 'OTP' });
    const bad = await t.request({
      method: 'POST',
      url: '/kiosk/card-link/confirm',
      bearer: token,
      origin: null,
      payload: { requestId: link.json().requestId, code: lastOtp(t) === '000000' ? '111111' : '000000' },
    });
    expect(bad.json().code).toBe('INVALID_CODE');
    const ok = await t.request({
      method: 'POST',
      url: '/kiosk/card-link/confirm',
      bearer: token,
      origin: null,
      payload: { requestId: link.json().requestId, code: lastOtp(t) },
    });
    expect(ok.json()).toEqual({ status: 'LINKED' });
    const b = await t.prisma.cardBinding.findFirstOrThrow({ where: { studentId: s.id } });
    expect(b).toMatchObject({ createdVia: 'OTP', status: 'ACTIVE', uidSuffix: 'E580' });

    const again = await t.request({
      method: 'POST',
      url: '/kiosk/card-link',
      bearer: token,
      origin: null,
      payload: { uid: '04A1B2C3D4E580', matricule: s.matricule },
    });
    expect(again.json().code).toBe('CARD_ALREADY_LINKED');
  });

  it('sends unknown matricules to review without revealing whether they exist', async () => {
    const { token } = await registerKiosk(t);
    const link = await t.request({
      method: 'POST',
      url: '/kiosk/card-link',
      bearer: token,
      origin: null,
      payload: { uid: '04A1B2C3', matricule: 'ICTU20990001' },
    });
    expect(link.json()).toMatchObject({ verification: 'REVIEW', destination: null });
    const { cookie } = await adminSession(t, 'LAB_ADMIN');
    const queue = (await t.request({ method: 'GET', url: '/card-link-requests', cookie })).json();
    expect(queue).toHaveLength(1);
    const approve = await t.request({ method: 'POST', url: `/card-link-requests/${queue[0].id}/approve`, cookie });
    expect(approve.json().code).toBe('NO_STUDENT');
  });

  it('lets an admin bind a card, never to two students', async () => {
    const a = await makeStudent(t);
    const b = await makeStudent(t);
    const { cookie } = await adminSession(t, 'LAB_ADMIN');
    const first = await t.request({
      method: 'POST',
      url: `/students/${a.id}/cards`,
      cookie,
      payload: { uid: '04a1b2c3d4e5' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ status: 'ACTIVE', uidSuffix: 'D4E5' });
    const steal = await t.request({
      method: 'POST',
      url: `/students/${b.id}/cards`,
      cookie,
      payload: { uid: '04A1B2C3D4E5' },
    });
    expect(steal.json().code).toBe('CARD_IN_USE');
    const replace = await t.request({
      method: 'POST',
      url: `/students/${a.id}/cards`,
      cookie,
      payload: { uid: '04FFFFFFFFFF' },
    });
    expect(replace.statusCode).toBe(201);
    expect(await t.prisma.cardBinding.count({ where: { studentId: a.id, status: 'ACTIVE' } })).toBe(1);
  });
});
