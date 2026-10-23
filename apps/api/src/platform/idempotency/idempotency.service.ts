import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { sha256Hex } from '../crypto/crypto';
import { Errors } from '../http/problem';
import type { LpRequest } from '../http/request';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/** Deterministic JSON (sorted keys) so equivalent requests hash identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Buffer.isBuffer(value)) return JSON.stringify(sha256Hex(value));
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function idempotencyKeyOf(req: LpRequest): string {
  const key = req.headers['idempotency-key'];
  const value = Array.isArray(key) ? key[0] : key;
  if (!value || value.length < 8 || value.length > 128 || !/^[\w.:-]+$/.test(value)) {
    throw Errors.badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (8–128 characters).');
  }
  return value;
}

class Replay {
  constructor(public readonly row: { requestHash: string; status: string; responseBody: Prisma.JsonValue | null }) {}
}

/**
 * Exactly-once mutations (ARCH §5 F5, ADR-0006): the idempotency row is inserted and completed inside the same
 * database transaction as the business effect. A concurrent request with the same key blocks on the unique index
 * until the first commits, then replays its stored response. Redis only caches replays.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async execute<T>(opts: {
    scope: string;
    key: string;
    request: unknown;
    work: (tx: Tx) => Promise<T>;
    timeoutMs?: number;
  }): Promise<{ body: T; replayed: boolean }> {
    const requestHash = sha256Hex(stableStringify(opts.request));
    const cacheKey = `idem:${opts.scope}:${opts.key}`;
    const cached = await this.redis.client.get(cacheKey);
    if (cached) {
      const c = JSON.parse(cached) as { requestHash: string; body: T };
      if (c.requestHash !== requestHash) throw this.reused();
      return { body: c.body, replayed: true };
    }
    try {
      const body = await this.prisma.tx(
        async (tx) => {
          const inserted = await tx.$executeRaw`
          INSERT INTO idempotency_keys (id, scope, key, "requestHash", status, "createdAt")
          VALUES (gen_random_uuid(), ${opts.scope}, ${opts.key}, ${requestHash}, 'IN_PROGRESS', now())
          ON CONFLICT (scope, key) DO NOTHING`;
          if (inserted === 0) {
            const row = await tx.idempotencyKey.findUniqueOrThrow({
              where: { scope_key: { scope: opts.scope, key: opts.key } },
            });
            throw new Replay(row);
          }
          const result = await opts.work(tx);
          await tx.idempotencyKey.update({
            where: { scope_key: { scope: opts.scope, key: opts.key } },
            data: { status: 'DONE', responseStatus: 200, responseBody: result as unknown as Prisma.InputJsonValue },
          });
          return result;
        },
        { timeoutMs: opts.timeoutMs },
      );
      await this.redis.client.set(cacheKey, JSON.stringify({ requestHash, body }), 'EX', 24 * 3600);
      return { body, replayed: false };
    } catch (e) {
      if (!(e instanceof Replay)) throw e;
      if (e.row.requestHash !== requestHash) throw this.reused();
      if (e.row.status !== 'DONE')
        throw Errors.conflict('IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed. Retry shortly.');
      return { body: e.row.responseBody as T, replayed: true };
    }
  }

  private reused() {
    return Errors.unprocessable(
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used for a different request.',
    );
  }
}
