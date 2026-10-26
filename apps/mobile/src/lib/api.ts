import { ApiError, createApiClient, type RouteId, type RouteInput, type RouteOutput } from '@labpass/contracts/client';
import type { StudentSession } from './session';

export { ApiError };

/** Problem code of a failed call (or NETWORK for transport errors), for UI messages. */
export function errorCode(e: unknown): string {
  if (e instanceof ApiError) return e.code;
  return 'NETWORK';
}

export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.problem.detail ?? e.problem.title ?? fallback;
  return fallback;
}

export interface StudentApi {
  call<Id extends RouteId>(id: Id, input?: RouteInput<Id>): Promise<RouteOutput<Id>>;
  /** Authenticated call: adds the access token and retries once after refreshing on 401. */
  me<Id extends RouteId>(id: Id, input?: RouteInput<Id>): Promise<RouteOutput<Id>>;
}

/**
 * Web app: same-origin `/api` with cookies (the refresh token is an HttpOnly cookie, ARCH §7).
 * Android app: absolute HTTPS URL, no cookies, refresh token in expo-secure-store.
 */
export function createStudentApi(opts: {
  baseUrl: string;
  web: boolean;
  session: () => StudentSession;
  fetch?: typeof fetch;
}): StudentApi {
  const anon = createApiClient({
    baseUrl: opts.baseUrl,
    fetch: opts.fetch,
    credentials: opts.web ? 'include' : 'omit',
  });
  const authed = createApiClient({
    baseUrl: opts.baseUrl,
    fetch: opts.fetch,
    credentials: opts.web ? 'include' : 'omit',
    headers: async (): Promise<Record<string, string>> => {
      const t = await opts.session().token();
      return t ? { Authorization: `Bearer ${t}` } : {};
    },
  });
  return {
    call: (id, input) => anon.call(id, input),
    async me(id, input) {
      try {
        return await authed.call(id, input);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          opts.session().invalidate();
          return authed.call(id, input);
        }
        throw e;
      }
    },
  };
}
