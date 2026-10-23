import { describe, expect, it } from 'vitest';
import { apiPath } from './api-path';

describe('apiPath', () => {
  it('prefixes paths with the same-origin /api proxy', () => {
    expect(apiPath('/equipment')).toBe('/api/equipment');
    expect(apiPath('auth/me')).toBe('/api/auth/me');
  });
});
