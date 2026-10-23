import { type AdminRole, roleSatisfies, routes, type RouteSpec } from '@labpass/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSession, bootTestApp, type TestApp } from '../helpers/app';

const ROLES: AdminRole[] = ['VIEWER', 'LAB_ASSISTANT', 'LAB_ADMIN', 'SUPER_ADMIN'];
const ZERO = '00000000-0000-4000-8000-000000000000';

/** The RBAC matrix is generated from each route's `minRole` in the contract (ADR-0005). */
describe('RBAC matrix (generated from the contract)', () => {
  let t: TestApp;
  const cookies = {} as Record<AdminRole, string>;
  let implemented: Array<[string, RouteSpec]> = [];

  beforeAll(async () => {
    t = await bootTestApp();
    await t.reset();
    for (const role of ROLES) cookies[role] = (await adminSession(t, role)).cookie;
    const fastify = t.app.getHttpAdapter().getInstance();
    implemented = (Object.entries(routes) as Array<[string, RouteSpec]>).filter(
      ([id, r]) => r.auth === 'admin' && id !== 'auth.logout' && fastify.hasRoute({ method: r.method, url: r.path }),
    );
  });
  afterAll(() => t.close());

  const urlOf = (r: RouteSpec) => r.path.replace(/:[A-Za-z]+/g, ZERO);

  it('covers the implemented admin routes', () => {
    expect(implemented.length).toBeGreaterThan(10);
  });

  it('requires authentication on every admin route', async () => {
    for (const [id, r] of implemented) {
      const res = await t.request({ method: r.method, url: urlOf(r), payload: r.method === 'GET' ? undefined : {} });
      expect(res.statusCode, id).toBe(401);
    }
  });

  it('allows exactly the roles at or above minRole', async () => {
    for (const [id, r] of implemented) {
      for (const role of ROLES) {
        const res = await t.request({
          method: r.method,
          url: urlOf(r),
          cookie: cookies[role],
          payload: r.method === 'GET' ? undefined : {},
          headers: r.idempotent ? { 'idempotency-key': `rbac-${id}-${role}` } : {},
        });
        const allowed = roleSatisfies(role, r.minRole!);
        if (allowed) expect([401, 403], `${id} as ${role} → ${res.statusCode}`).not.toContain(res.statusCode);
        else {
          expect(res.statusCode, `${id} as ${role}`).toBe(403);
          expect(res.json().code, `${id} as ${role}`).toBe('ROLE_REQUIRED');
        }
      }
    }
  });
});
