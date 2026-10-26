import {
  ApiError,
  createApiClient,
  type RouteId,
  type RouteInput,
  type RouteOutput,
  validateResponse,
} from '@labpass/contracts';
import type { KioskError } from '../shared/ipc';

export class KioskApiError extends Error {
  constructor(readonly info: KioskError) {
    super(info.message);
    this.name = 'KioskApiError';
  }
}

export function toKioskError(e: unknown): KioskError {
  if (e instanceof KioskApiError) return e.info;
  if (e instanceof ApiError) {
    return {
      code: e.problem.code ?? 'HTTP_ERROR',
      status: e.status,
      message: e.problem.detail ?? e.problem.title,
      details: (e.problem as { extensions?: Record<string, unknown> }).extensions,
    };
  }
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
    return { code: 'NETWORK', status: 0, message: 'The server did not answer in time' };
  if (e instanceof TypeError) return { code: 'NETWORK', status: 0, message: 'The server is unreachable' };
  return { code: 'INTERNAL', status: 0, message: 'Unexpected kiosk error' };
}

export const isNetworkError = (e: KioskError) => e.code === 'NETWORK';
export const isAuthError = (e: KioskError) => e.status === 401;

/**
 * Typed API client living in the main process only (ARCH §7): it adds the device token, validates every response
 * against the contract and applies a request timeout. The renderer reaches it only through named IPC commands.
 */
export class KioskApi {
  private readonly client;

  constructor(
    readonly baseUrl: string,
    private readonly token: () => string | null,
    private readonly timeoutMs = 8000,
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    /** Connectivity observer: any answer from the server means online; a transport failure means offline. */
    private readonly observer?: { reachable(ok: boolean): void },
  ) {
    this.client = createApiClient({
      baseUrl,
      fetch: fetchImpl,
      validate: validateResponse,
      headers: (): Record<string, string> => {
        const t = this.token();
        return t ? { Authorization: `Bearer ${t}` } : {};
      },
    });
  }

  async call<Id extends RouteId>(id: Id, input?: RouteInput<Id>): Promise<RouteOutput<Id>> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      const out = await this.client.call(id, { ...(input ?? {}), signal } as RouteInput<Id>);
      this.observer?.reachable(true);
      return out;
    } catch (e) {
      const info = toKioskError(e);
      this.observer?.reachable(!isNetworkError(info));
      throw new KioskApiError(info);
    }
  }
}

const MAX_IMAGE_BYTES = 600_000;

/**
 * Fetches a signed file URL from the API origin and returns a data: URL, so the renderer's CSP can forbid every
 * network request (img-src 'self' data:). Other origins, non-images and oversized files are dropped.
 */
export async function inlineImage(
  url: string | null | undefined,
  apiUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<string | null> {
  if (!url) return null;
  try {
    const target = new URL(url, apiUrl);
    if (target.origin !== new URL(apiUrl).origin) return null;
    const res = await fetchImpl(target, { signal: AbortSignal.timeout(3000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^image\/(png|jpe?g|webp|gif|avif)$/.test(type.split(';')[0]!.trim())) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
