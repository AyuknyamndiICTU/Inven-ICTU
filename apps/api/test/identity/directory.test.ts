import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminSession, bootTestApp, type TestApp } from '../helpers/app';

const FR_CSV = [
  '\uFEFFMatricule;Prénom;Nom;Date de naissance;Email;Téléphone;Niveau',
  'ICTU20240001;Awa;Ngo Bassa;02/03/2004;awa@ictuniversity.test;699 12 34 12;L2',
  'ICTU20240002;Thérèse;Mballa;15/07/2003;therese@ictuniversity.test;;L3',
  'ICTU20240003;Jean-Paul;Kamga;01/01/2005;;677 00 11 22;L1',
  'ICTU20240004;;Nkemelu;01/01/2005;;;L1',
].join('\r\n');

describe('student directory imports (ARCH §9, S05)', () => {
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

  const upload = (body: string, kind = 'STUDENTS', c = cookie) =>
    t.request({
      method: 'POST',
      url: `/directory/imports?kind=${kind}&fileName=students.csv`,
      cookie: c,
      headers: { 'content-type': 'text/csv' },
      payload: Buffer.from(body, 'utf8'),
    });
  const commit = (id: string, deactivateMissing = false) =>
    t.request({ method: 'POST', url: `/directory/imports/${id}/commit`, cookie, payload: { deactivateMissing } });

  it('previews, commits, re-imports with zero changes, and rolls back an update', async () => {
    const preview = await upload(FR_CSV);
    expect(preview.statusCode).toBe(201);
    const p = preview.json();
    expect(p.status).toBe('PREVIEW');
    expect(p.counts).toMatchObject({ total: 4, new: 3, changed: 0, invalid: 1 });
    expect(p.issues).toEqual([{ row: 5, field: 'first_name', message: 'First name is required' }]);
    expect(await t.prisma.student.count()).toBe(0); // dry run only

    const done = await commit(p.id);
    expect(done.statusCode).toBe(200);
    expect(done.json().status).toBe('COMMITTED');
    const awa = await t.prisma.student.findUniqueOrThrow({ where: { matricule: 'ICTU20240001' } });
    expect(awa).toMatchObject({ firstName: 'Awa', phone: '+237699123412', status: 'ACTIVE' });

    // Same file again: nothing to do.
    const again = (await upload(FR_CSV)).json();
    expect(again.counts).toMatchObject({ new: 0, changed: 0, unchanged: 3 });

    // A corrected spelling, then undo it.
    const fixed = (await upload(FR_CSV.replace('Ngo Bassa', 'Ngo Bassa Epse Tchoua'))).json();
    expect(fixed.counts).toMatchObject({ new: 0, changed: 1 });
    await commit(fixed.id);
    expect((await t.prisma.student.findUniqueOrThrow({ where: { id: awa.id } })).lastName).toBe(
      'Ngo Bassa Epse Tchoua',
    );
    const undo = await t.request({ method: 'POST', url: `/directory/imports/${fixed.id}/rollback`, cookie });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().status).toBe('ROLLED_BACK');
    const back = await t.prisma.student.findUniqueOrThrow({ where: { id: awa.id } });
    expect(back.lastName).toBe('Ngo Bassa');
    expect(back.sourceHash).toBe(awa.sourceHash);

    // Rolling back the first import deletes the students it created (they were never used).
    await t.request({ method: 'POST', url: `/directory/imports/${p.id}/rollback`, cookie });
    expect(await t.prisma.student.count()).toBe(0);
  });

  it('cannot commit twice or roll back a preview', async () => {
    const p = (await upload(FR_CSV)).json();
    const rb = await t.request({ method: 'POST', url: `/directory/imports/${p.id}/rollback`, cookie });
    expect(rb.json().code).toBe('IMPORT_NOT_ROLLBACKABLE');
    const [a, b] = await Promise.all([commit(p.id), commit(p.id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await t.prisma.student.count()).toBe(3);
  });

  it('deactivates students missing from the file only when asked, and rollback reactivates them', async () => {
    await commit((await upload(FR_CSV)).json().id);
    const shorter = FR_CSV.split('\r\n').slice(0, 3).join('\r\n');
    const p = (await upload(shorter)).json();
    expect(p.counts.missing).toBe(1);
    await commit(p.id, true);
    expect((await t.prisma.student.findUniqueOrThrow({ where: { matricule: 'ICTU20240003' } })).status).toBe(
      'INACTIVE',
    );
    await t.request({ method: 'POST', url: `/directory/imports/${p.id}/rollback`, cookie });
    expect((await t.prisma.student.findUniqueOrThrow({ where: { matricule: 'ICTU20240003' } })).status).toBe('ACTIVE');
  });

  it('asks for a mapping when required columns are missing, and re-previews after remapping', async () => {
    const csv = 'Mat;Given;Family;Born\nICTU20240009;Awa;Ngo;02/03/2004\n';
    const p = (await upload(csv)).json();
    expect(p.counts.invalid).toBe(1);
    expect(p.issues[0].message).toMatch(/Map the required column/);
    const remapped = await t.request({
      method: 'PATCH',
      url: `/directory/imports/${p.id}/mapping`,
      cookie,
      payload: { mapping: { Mat: 'matricule', Given: 'first_name', Family: 'last_name', Born: 'date_of_birth' } },
    });
    expect(remapped.json().counts).toMatchObject({ new: 1, invalid: 0 });
  });

  it('serves an injection-safe problems CSV', async () => {
    const csv = 'matricule,first_name,last_name,date_of_birth\n=1+2,Eve,Hack,02/03/2004\n';
    const p = (await upload(csv)).json();
    const res = await t.request({ method: 'GET', url: `/directory/imports/${p.id}/errors.csv`, cookie });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.body
      .replace(/^\uFEFF/, '')
      .trim()
      .split(/\r?\n/);
    expect(lines[0]).toBe('row,field,message');
    for (const line of lines) for (const cell of line.split(',')) expect(cell).not.toMatch(/^[=+\-@]/);
  });

  it('binds supplier card batches as DESFire EV3 cards', async () => {
    await commit((await upload(FR_CSV)).json().id);
    const batch = [
      'card_uid,matricule,batch_id',
      '04A1B2C3D4E580,ICTU20240001,B1',
      '04A1B2C3D4E581,ICTU29999999,B1',
      '04a1b2c3d4e580,ICTU20240002,B1',
    ].join('\n');
    const p = (await upload(batch, 'CARD_BATCH')).json();
    expect(p.kind).toBe('CARD_BATCH');
    expect(p.counts).toMatchObject({ new: 1 });
    expect(p.issues.map((i: { message: string }) => i.message)).toEqual([
      'No student with this matricule',
      'Duplicate card UID in this file',
    ]);
    await commit(p.id);
    const cards = await t.prisma.cardBinding.findMany();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      cardTech: 'DESFIRE_EV3',
      createdVia: 'SUPPLIER_FILE',
      status: 'ACTIVE',
      uidSuffix: 'E580',
    });
    expect(cards[0]!.uidHmac).not.toContain('04A1B2C3D4E580');
  });

  it('is limited to lab admins', async () => {
    const { cookie: assistant } = await adminSession(t, 'LAB_ASSISTANT');
    const res = await upload(FR_CSV, 'STUDENTS', assistant);
    expect(res.statusCode).toBe(403);
  });
});
