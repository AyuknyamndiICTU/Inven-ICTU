import { z } from 'zod';

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Parses `source` (default: process.env) with a zod schema and fails fast with a readable list of problems.
 * Only variable names and messages are reported, never the values (they may be secrets).
 */
export function loadEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new EnvValidationError(issues);
  }
  return result.data;
}

/** Local development ports, chosen to avoid clashes with other projects on the same machine. */
export const DEV_PORTS = {
  api: 4000,
  admin: 3100,
  kioskRenderer: 3101,
  studentWeb: 3102,
  postgres: 5440,
  redis: 6390,
  smtp: 1026,
  mailUi: 8026,
} as const;

/** Parses "true"/"false"/"1"/"0" env strings. */
export const envBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');
