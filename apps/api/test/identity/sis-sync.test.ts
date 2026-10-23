import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../../src/platform/jobs/jobs';
import { adminSession, bootTestApp, type TestApp } from '../helpers/app';

type SisStudent = { regNo: string; names: { first: string; last: string }; dob: string; email?: string };

/** A tiny fake school system: API-key auth, page-based pagination, items under `data.students`. */
function fakeSis(students: () => SisStudent[]) {
  const server = createServer((req, res) => {
    if (req.headers['x-api-key'] !== 'sis-test-key') {
      res.writeHead(401).end();
      return;
    }
    const page = Number(new URL(req.url!, 'http://x').searchParams.get('page') ?? '1');
    const all = students();
    const items = all.slice((page - 1) * 2, page * 2);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { students: items } }));
  });
  return new Promise<{ server: Server; url: string }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    ),
  );
}

describe('SIS REST connector & scheduled sync (S05 task 3)', () => {
  let t: TestApp;
  let sis: { server: Server; url: string };
  let roster: SisStudent[];
  let superCookie: string;

  beforeAll(async () => {
    t = await bootTestApp();
    sis = await fakeSis(() => roster);
  });
  afterAll(async () => {
    sis.server.close();
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    ({ cookie: superCookie } = await adminSession(t, 'SUPER_ADMIN'));
    roster = [
      {
        regNo: 'ICTU20240101',
        names: { first: 'Awa', last: 'Ngo Bassa' },
        dob: '2004-03-02',
        email: 'awa@ictuniversity.test',
      },
      { regNo: 'ICTU20240102', names: { first: 'Jean', last: 'Kamga' }, dob: '02/01/2003' },
      { regNo: 'ICTU20240103', names: { first: 'Hélène', last: 'Mbarga' }, dob: '2005-12-31' },
    ];
  });

  const configure = (over: Record<string, unknown> = {}) =>
    t.request({
      method: 'PUT',
      url: '/directory/connector',
      cookie: superCookie,
      payload: {
        enabled: true,
        baseUrl: sis.url,
        auth: { type: 'API_KEY', header: 'x-api-key', key: 'sis-test-key' },
        studentsPath: '/api/students',
        pagination: 'PAGE',
        itemsPath: 'data.students',
        mapping: {
          matricule: 'regNo',
          first_name: 'names.first',
          last_name: 'names.last',
          date_of_birth: 'dob',
          email: 'email',
        },
        scheduleCron: '0 2 * * *',
        ...over,
      },
    });

  it('stores the API key sealed, tests the connection, and never returns the secret', async () => {
    const res = await configure();
    expect(res.statusCode).toBe(200);
    expect(res.json().auth).toEqual({ type: 'API_KEY', header: 'x-api-key', hasKey: true });
    const raw = JSON.stringify(
      (await t.prisma.setting.findUniqueOrThrow({ where: { key: '_directoryConnector' } })).value,
    );
    expect(raw).not.toContain('sis-test-key');
    const test = await t.request({ method: 'POST', url: '/directory/connector/test', cookie: superCookie });
    expect(test.json()).toMatchObject({ ok: true, sampleCount: 2 });
  });

  it('rejects an invalid schedule and forbidden addresses', async () => {
    expect((await configure({ scheduleCron: 'every night' })).json().code).toBe('INVALID_SCHEDULE');
    expect((await configure({ baseUrl: 'http://169.254.169.254/latest' })).json().code).toBe('INVALID_URL');
  });

  it('auto-commits a clean scheduled sync and leaves a dirty one for review', async () => {
    await configure();
    const first = (await t.app.get(JobsService).run('directory-sync')) as { status: string; counts: { new: number } };
    expect(first).toMatchObject({ status: 'COMMITTED', counts: { new: 3 } });
    expect(await t.prisma.student.count()).toBe(3);
    expect(
      (await t.prisma.student.findUniqueOrThrow({ where: { matricule: 'ICTU20240102' } })).dateOfBirth.toISOString(),
    ).toMatch(/^2003-01-02/);

    // Nothing changed: no new import is committed.
    const same = (await t.app.get(JobsService).run('directory-sync')) as { status: string };
    expect(same.status).toBe('PREVIEW');

    roster.push({ regNo: 'ICTU20240104', names: { first: '', last: 'Nkemelu' }, dob: '2004-01-01' });
    roster[0]!.names.last = 'Ngo Bassa Epse Tchoua';
    const dirty = (await t.app.get(JobsService).run('directory-sync')) as {
      status: string;
      counts: { invalid: number };
    };
    expect(dirty).toMatchObject({ status: 'PREVIEW', counts: { invalid: 1 } });
    expect((await t.prisma.student.findUniqueOrThrow({ where: { matricule: 'ICTU20240101' } })).lastName).toBe(
      'Ngo Bassa',
    );
  });

  it('does nothing when the connector is disabled', async () => {
    await configure({ enabled: false });
    expect(await t.app.get(JobsService).run('directory-sync')).toBeNull();
  });
});
