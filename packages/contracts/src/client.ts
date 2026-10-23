import type { z } from 'zod';
import type { Problem } from './common';
import { routes, type RouteId, type Routes, type RouteSpec } from './routes';

type InputOf<R> = (R extends { params: infer P extends z.ZodType } ? { params: z.input<P> } : { params?: undefined }) &
  (R extends { query: infer Q extends z.ZodType } ? { query?: Partial<z.input<Q>> } : { query?: undefined }) &
  (R extends { body: infer B extends z.ZodType }
    ? { body: z.input<B> }
    : R extends { bodyKind: 'binary' }
      ? { body: Blob | ArrayBuffer | Uint8Array; contentType: string }
      : { body?: undefined }) & {
    idempotencyKey?: string;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  };

type OutputOf<R> = R extends { response: infer S extends z.ZodType }
  ? z.output<S>
  : R extends { responseKind: 'csv' | 'text' }
    ? string
    : undefined;

export type RouteInput<Id extends RouteId> = InputOf<Routes[Id]>;
export type RouteOutput<Id extends RouteId> = OutputOf<Routes[Id]>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Problem,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
  get code(): string {
    return this.problem.code;
  }
}

export interface ApiClientOptions {
  /** e.g. "/api" (browser, same origin) or "https://labpass.example/api". */
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  credentials?: RequestCredentials;
  /** Validate JSON responses against the contract (recommended in development and tests). */
  validateResponses?: boolean;
}

export function buildPath(spec: RouteSpec, params?: Record<string, unknown>, query?: Record<string, unknown>): string {
  const path = spec.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
    const v = params?.[name];
    if (v === undefined || v === null) throw new Error(`Missing path parameter "${name}"`);
    return encodeURIComponent(String(v));
  });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export function createApiClient(opts: ApiClientOptions) {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const base = opts.baseUrl.replace(/\/$/, '');

  async function call<Id extends RouteId>(
    id: Id,
    input: RouteInput<Id> = {} as RouteInput<Id>,
  ): Promise<RouteOutput<Id>> {
    const spec = routes[id] as RouteSpec;
    const anyInput = input as {
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: unknown;
      contentType?: string;
      idempotencyKey?: string;
      signal?: AbortSignal;
      headers?: Record<string, string>;
    };
    const headers: Record<string, string> = {
      Accept: 'application/json, text/csv;q=0.9, */*;q=0.1',
      ...(await opts.headers?.()),
      ...anyInput.headers,
    };
    let body: BodyInit | undefined;
    if (spec.bodyKind === 'binary' && anyInput.body !== undefined) {
      body = anyInput.body as BodyInit;
      headers['Content-Type'] = anyInput.contentType ?? 'application/octet-stream';
    } else if (anyInput.body !== undefined) {
      body = JSON.stringify(anyInput.body);
      headers['Content-Type'] = 'application/json';
    }
    if (spec.idempotent) headers['Idempotency-Key'] = anyInput.idempotencyKey ?? crypto.randomUUID();

    const res = await f(`${base}${buildPath(spec, anyInput.params, anyInput.query)}`, {
      method: spec.method,
      headers,
      body,
      credentials: opts.credentials,
      signal: anyInput.signal,
    });

    if (!res.ok) {
      let problem: Problem;
      try {
        problem = (await res.json()) as Problem;
      } catch {
        problem = {
          type: 'about:blank',
          title: res.statusText || 'Request failed',
          status: res.status,
          code: 'HTTP_ERROR',
        };
      }
      throw new ApiError(res.status, problem);
    }
    if (res.status === 204 || spec.responseKind === 'empty') return undefined as RouteOutput<Id>;
    if (spec.responseKind === 'csv' || spec.responseKind === 'text') return (await res.text()) as RouteOutput<Id>;
    if (spec.responseKind === 'binary') return (await res.blob()) as RouteOutput<Id>;
    const data: unknown = await res.json();
    if (opts.validateResponses && spec.response) return spec.response.parse(data) as RouteOutput<Id>;
    return data as RouteOutput<Id>;
  }

  return { call };
}

export type ApiClient = ReturnType<typeof createApiClient>;
