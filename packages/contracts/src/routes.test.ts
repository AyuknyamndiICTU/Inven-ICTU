import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildOpenApi } from './openapi';
import { pathParams, routeIds, routes, type RouteSpec } from './routes';
import { defaultSettings } from './schemas/settings';
import { maskContact, roleSatisfies } from './common';

const all = Object.entries(routes) as Array<[string, RouteSpec]>;

describe('route registry (invariant I3)', () => {
  it('has unique method + path pairs', () => {
    const keys = all.map(([, r]) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every admin route a minimum role and no other route one', () => {
    for (const [id, r] of all) {
      if (r.auth === 'admin') expect(r.minRole, id).toBeDefined();
      else expect(r.minRole, id).toBeUndefined();
    }
  });

  it('declares a params schema matching the path placeholders', () => {
    for (const [id, r] of all) {
      const names = pathParams(r.path).sort();
      const declared = Object.keys((r.params?.shape ?? {}) as object).sort();
      expect(declared, id).toEqual(names);
    }
  });

  it('only marks mutating requests as idempotent and never GET requests with a body', () => {
    for (const [id, r] of all) {
      if (r.idempotent) expect(['POST', 'PUT', 'PATCH'], id).toContain(r.method);
      if (r.method === 'GET') expect(r.body, id).toBeUndefined();
    }
  });

  it('describes every response', () => {
    for (const [id, r] of all) expect(r.response !== null || r.responseKind !== undefined, id).toBe(true);
  });

  it('generates a valid OpenAPI 3.1 document covering every route', () => {
    const doc = buildOpenApi() as { openapi: string; paths: Record<string, Record<string, { operationId: string }>> };
    expect(doc.openapi).toBe('3.1.0');
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    expect(ops.sort()).toEqual([...routeIds].sort());
  });

  it('serialises deterministically', () => {
    expect(JSON.stringify(buildOpenApi())).toBe(JSON.stringify(buildOpenApi()));
  });
});

describe('roles and helpers', () => {
  it('applies the role hierarchy', () => {
    expect(roleSatisfies('SUPER_ADMIN', 'LAB_ADMIN')).toBe(true);
    expect(roleSatisfies('LAB_ASSISTANT', 'LAB_ADMIN')).toBe(false);
    expect(roleSatisfies('VIEWER', 'VIEWER')).toBe(true);
  });

  it('masks contacts', () => {
    expect(maskContact('awa.ngo@ictuniversity.edu.cm')).toBe('a***@ictuniversity.edu.cm');
    expect(maskContact('+237699123412')).toMatch(/^\+2376\*+12$/);
    expect(maskContact(null)).toBeNull();
  });
});

describe('settings defaults encode the Phase 0 decisions', () => {
  const s = defaultSettings();
  it('Q4: no item limit, block overdue, due at lab closing', () => {
    expect(s.maxItemsPerStudent).toBeNull();
    expect(s.blockWhenOverdue).toBe(true);
    expect(s.loanDue.mode).toBe('LAB_CLOSING');
  });
  it('Q9: PIN or assistant for matricule entry', () => expect(s.manualEntryPolicy).toBe('PIN_OR_ASSISTANT'));
  it('Q6: offline mode enabled for 8 h', () => expect(s.offlineMaxHours).toBe(8));
  it('Q1: UID mode until DESFire cards are personalised', () => expect(s.cardAuthMode).toBe('UID'));
  it('Q3: Sign In = borrow, Sign Out = return labels', () => {
    expect(s.labels.signIn.fr).toBe('Emprunter');
    expect(s.labels.signOut.fr).toBe('Rendre');
  });
  it('rejects invalid partial updates', () => {
    expect(z.object({ x: z.int() }).safeParse({ x: 1.5 }).success).toBe(false);
  });
});
