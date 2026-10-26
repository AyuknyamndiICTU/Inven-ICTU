import type { RouteId, RouteSpec } from './routes';
import { routes } from './routes';

/** Pass as `createApiClient({ validate: validateResponse })` to check JSON responses against the contract. */
export function validateResponse(id: RouteId, data: unknown): unknown {
  const schema = (routes[id] as RouteSpec).response;
  return schema ? schema.parse(data) : data;
}
