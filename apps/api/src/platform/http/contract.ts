import { type RouteId, type Routes, routes, type RouteSpec } from '@labpass/contracts';
import {
  applyDecorators,
  createParamDecorator,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  SetMetadata,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { zodToProblemErrors } from './problem.filter';
import { Errors } from './problem';

export const ROUTE_META = 'lp:route';

const METHOD_DECORATORS = { GET: Get, POST: Post, PUT: Put, PATCH: Patch, DELETE: Delete } as const;

/** Binds a controller method to a contract route: HTTP method, path, status and metadata for the guards. */
export function Contract(id: RouteId) {
  const spec = routes[id] as RouteSpec;
  const method = METHOD_DECORATORS[spec.method];
  const status = spec.status ?? (spec.responseKind === 'empty' ? 204 : spec.method === 'POST' ? 200 : 200);
  return applyDecorators(SetMetadata(ROUTE_META, id), method(spec.path), HttpCode(status));
}

export function routeIdOf(ctx: ExecutionContext): RouteId | undefined {
  return Reflect.getMetadata(ROUTE_META, ctx.getHandler()) as RouteId | undefined;
}

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;
export type In<Id extends RouteId> = {
  params: Out<Routes[Id] extends { params: infer P } ? P : undefined>;
  query: Out<Routes[Id] extends { query: infer Q } ? Q : undefined>;
  body: Routes[Id] extends { body: infer B } ? Out<B> : Routes[Id] extends { bodyKind: 'binary' } ? Buffer : undefined;
};

function parsePart(schema: z.ZodType | undefined, value: unknown, part: string) {
  if (!schema) return undefined;
  const res = schema.safeParse(value ?? (part === 'body' ? undefined : {}));
  if (!res.success) {
    throw Errors.validation(
      zodToProblemErrors(res.error).map((e) => ({ ...e, path: e.path === '(root)' ? part : `${part}.${e.path}` })),
    );
  }
  return res.data;
}

/** Validated `{ params, query, body }` for the current contract route (invariant I3). */
export const ContractInput = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const id = routeIdOf(ctx);
  if (!id) throw new Error('ContractInput used on a handler without @Contract');
  const spec = routes[id] as RouteSpec;
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  let body: unknown;
  if (spec.bodyKind === 'binary') {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw Errors.badRequest('FILE_REQUIRED', 'Send the file as the raw request body.');
    }
    body = req.body;
  } else {
    body = parsePart(spec.body, req.body, 'body');
  }
  return {
    params: parsePart(spec.params, req.params, 'params'),
    query: parsePart(spec.query, req.query, 'query'),
    body,
  };
});
