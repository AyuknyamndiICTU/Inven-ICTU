import { z } from 'zod';
import { Problem } from './common';
import { adminEvents, kioskEvents } from './events';
import { pathParams, routes, toOpenApiPath, type RouteSpec } from './routes';

type Json = Record<string, unknown>;

/** Converts a zod schema to JSON Schema 2020-12 (OpenAPI 3.1), fully inlined so every operation is self-contained. */
function toSchema(schema: z.ZodType, io: 'input' | 'output'): Json {
  const json = z.toJSONSchema(schema, {
    io,
    target: 'draft-2020-12',
    unrepresentable: 'any',
    metadata: z.registry(),
  }) as Json;
  delete json.$schema;
  return json;
}

function parameters(r: RouteSpec): Json[] {
  const out: Json[] = [];
  const pathNames = pathParams(r.path);
  const paramShape = (r.params?.shape ?? {}) as Record<string, z.ZodType>;
  for (const name of pathNames) {
    out.push({
      name,
      in: 'path',
      required: true,
      schema: paramShape[name] ? toSchema(paramShape[name], 'input') : { type: 'string' },
    });
  }
  const queryShape = (r.query?.shape ?? {}) as Record<string, z.ZodType>;
  for (const [name, schema] of Object.entries(queryShape)) {
    const optional = schema.safeParse(undefined).success;
    out.push({ name, in: 'query', required: !optional, schema: toSchema(schema, 'input') });
  }
  if (r.idempotent) {
    out.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      description: 'Unique key per logical operation; retries with the same key replay the stored result.',
      schema: { type: 'string', minLength: 8, maxLength: 128 },
    });
  }
  return out;
}

const securityFor = (auth: RouteSpec['auth']) =>
  auth === 'admin'
    ? [{ adminCookie: [] }]
    : auth === 'kiosk'
      ? [{ kioskToken: [] }]
      : auth === 'student'
        ? [{ studentBearer: [] }]
        : [];

export function buildOpenApi(version = '0.1.0'): Json {
  const paths: Record<string, Record<string, Json>> = {};
  for (const [id, r] of Object.entries(routes) as Array<[string, RouteSpec]>) {
    const p = toOpenApiPath(r.path);
    paths[p] ??= {};
    const status = String(r.status ?? (r.responseKind === 'empty' ? 204 : 200));
    const success: Json =
      r.responseKind === 'empty'
        ? { description: 'No content' }
        : r.responseKind === 'csv'
          ? { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string' } } } }
          : r.responseKind === 'binary'
            ? {
                description: 'File',
                content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
              }
            : r.responseKind === 'text'
              ? { description: 'Plain text', content: { 'text/plain': { schema: { type: 'string' } } } }
              : {
                  description: 'OK',
                  content: { 'application/json': { schema: r.response ? toSchema(r.response, 'output') : {} } },
                };
    const op: Json = {
      operationId: id,
      summary: r.summary,
      tags: [r.tag],
      security: securityFor(r.auth),
      'x-auth': r.auth,
      ...(r.minRole ? { 'x-roles': r.minRole } : {}),
      ...(r.audited ? { 'x-audited': true } : {}),
      ...(r.rateLimit ? { 'x-rate-limit': r.rateLimit } : {}),
      parameters: parameters(r),
      responses: {
        [status]: success,
        default: {
          description: 'Problem',
          content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
        },
      },
    };
    if (r.body) {
      op.requestBody = { required: true, content: { 'application/json': { schema: toSchema(r.body, 'input') } } };
    } else if (r.bodyKind === 'binary') {
      op.requestBody = {
        required: true,
        content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
      };
    }
    paths[p][r.method.toLowerCase()] = op;
  }

  const events = (group: Record<string, z.ZodType>) =>
    Object.fromEntries(Object.entries(group).map(([name, s]) => [name, toSchema(s, 'output')]));

  return {
    openapi: '3.1.0',
    info: {
      title: 'ICTU LabPass API',
      version,
      description:
        'Generated from packages/contracts (zod route registry). Do not edit by hand: run `pnpm --filter @labpass/contracts generate`.',
    },
    servers: [{ url: '/api', description: 'Same-origin proxy (admin console, web app)' }],
    tags: [...new Set(Object.values(routes).map((r) => r.tag))].map((name) => ({ name })),
    paths,
    components: {
      schemas: { Problem: toSchema(Problem, 'output') },
      securitySchemes: {
        adminCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'lp_admin',
          description: 'HttpOnly session cookie + Origin check',
        },
        kioskToken: { type: 'http', scheme: 'bearer', description: 'Kiosk device token (ARCH §7)' },
        studentBearer: { type: 'http', scheme: 'bearer', description: 'Short-lived student access token' },
      },
    },
    'x-socket-events': { admin: events(adminEvents), kiosk: events(kioskEvents) },
  };
}
