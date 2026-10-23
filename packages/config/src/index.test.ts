import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, envBoolean, loadEnv } from './index';

describe('loadEnv', () => {
  const schema = z.object({
    PORT: z.coerce.number().int(),
    SECRET: z.string().min(8),
    FLAG: envBoolean.default(false),
  });

  it('parses and coerces valid values', () => {
    expect(loadEnv(schema, { PORT: '4000', SECRET: 'abcdefgh', FLAG: 'true' })).toEqual({
      PORT: 4000,
      SECRET: 'abcdefgh',
      FLAG: true,
    });
  });

  it('lists every invalid variable without echoing the values', () => {
    let caught: unknown;
    try {
      loadEnv(schema, { PORT: 'x', SECRET: 'short' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const err = caught as EnvValidationError;
    expect(err.issues.map((i) => i.split(':')[0])).toEqual(['PORT', 'SECRET']);
    expect(err.message).not.toContain('short');
  });
});
