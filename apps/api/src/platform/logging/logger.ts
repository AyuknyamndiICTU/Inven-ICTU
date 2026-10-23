import pino, { type DestinationStream, type Logger } from 'pino';

/**
 * Invariant I4: no PII, card UIDs, OTPs, PINs, tokens or secrets in logs.
 * Request/response bodies are never logged; only method, route, status and timing.
 * Header and known sensitive fields are censored defensively in case they are logged elsewhere.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.pin',
  '*.assistantPin',
  '*.code',
  '*.otp',
  '*.uid',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.secret',
  '*.signature',
  '*.spki',
  '*.email',
  '*.phone',
  '*.dateOfBirth',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { svc: 'labpass-api' },
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      serializers: {
        req: (req: { method?: string; url?: string; routeOptions?: { url?: string }; ip?: string; id?: string }) => ({
          id: req.id,
          method: req.method,
          // Log the route template, never the concrete URL (which may contain query strings with tokens).
          route: req.routeOptions?.url ?? (req.url ?? '').split('?')[0],
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
        err: pino.stdSerializers.err,
      },
    },
    destination,
  );
}
