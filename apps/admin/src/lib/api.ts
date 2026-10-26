import { ApiError, createApiClient, type RouteId, type RouteInput, type RouteOutput } from '@labpass/contracts/client';
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

/** Same-origin API: the browser calls /api/*, Next rewrites to the NestJS API so the session cookie stays first-party. */
export const api = createApiClient({
  baseUrl: '/api',
  credentials: 'same-origin',
});

export { ApiError };
export type { RouteId, RouteInput, RouteOutput };

export const queryKey = <Id extends RouteId>(id: Id, input?: RouteInput<Id>) =>
  input === undefined ? [id] : [id, input];

/** Typed query for a contract route. Keys start with the route id so realtime events can invalidate whole groups. */
export function useApi<Id extends RouteId>(
  id: Id,
  input?: RouteInput<Id>,
  opts: Omit<UseQueryOptions<RouteOutput<Id>, ApiError>, 'queryKey' | 'queryFn'> = {},
) {
  return useQuery<RouteOutput<Id>, ApiError>({
    queryKey: queryKey(id, input),
    queryFn: ({ signal }) => api.call(id, { ...(input ?? {}), signal } as RouteInput<Id>),
    ...opts,
  });
}

/** Typed mutation; `invalidates` lists route ids whose cached queries become stale on success. */
export function useApiMutation<Id extends RouteId>(
  id: Id,
  opts: { invalidates?: RouteId[]; onSuccess?: (data: RouteOutput<Id>, input: RouteInput<Id>) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation<RouteOutput<Id>, ApiError, RouteInput<Id>>({
    mutationFn: (input) => api.call(id, input),
    onSuccess: async (data, input) => {
      await Promise.all((opts.invalidates ?? []).map((k) => qc.invalidateQueries({ queryKey: [k] })));
      opts.onSuccess?.(data, input);
    },
  });
}

/** Problem+json message for a failed call (the API already writes human sentences). */
export function problemText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.problem.detail ?? e.problem.title ?? fallback;
  return fallback;
}

/** Field-level messages from a VALIDATION_FAILED problem, keyed by the last path segment. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !e.problem.errors) return {};
  return Object.fromEntries(e.problem.errors.map((x) => [x.path.split('.').pop() ?? x.path, x.message]));
}

/** Downloads a CSV route through the same-origin proxy (keeps the session cookie, triggers a file save). */
export async function downloadCsv<Id extends RouteId>(id: Id, input: RouteInput<Id>, fileName: string) {
  const text = (await api.call(id, input)) as unknown as string;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
