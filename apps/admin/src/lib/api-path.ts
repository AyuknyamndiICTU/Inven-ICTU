/** Builds a same-origin API URL. The browser always talks to `/api/*`; Next rewrites it to the API. */
export function apiPath(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `/api${clean}`;
}
