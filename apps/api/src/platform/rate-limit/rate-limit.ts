import { type RateLimit, routes, type RouteSpec } from '@labpass/contracts';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { routeIdOf } from '../http/contract';
import { Errors } from '../http/problem';
import type { LpRequest } from '../http/request';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Fixed-window counter. Returns seconds to wait when the limit is exceeded, otherwise 0. */
  async consume(key: string, limit: number, windowSec: number): Promise<number> {
    const k = `rl:${key}`;
    const [[, count], [, ttl]] = (await this.redis.client.multi().incr(k).ttl(k).exec()) as [
      [null, number],
      [null, number],
    ];
    if (count === 1 || ttl < 0) await this.redis.client.expire(k, windowSec);
    if (count > limit) return ttl > 0 ? ttl : windowSec;
    return 0;
  }

  async reset(key: string): Promise<void> {
    await this.redis.client.del(`rl:${key}`);
  }
}

function keyFor(rl: RateLimit, req: LpRequest): string | null {
  switch (rl.key) {
    case 'ip':
      return req.ip;
    case 'kiosk':
      return req.kiosk?.id ?? req.ip;
    case 'student':
      return req.student?.studentId ?? req.ip;
    case 'admin':
      return req.admin?.id ?? req.ip;
    case 'body': {
      const v = (req.body as Record<string, unknown> | undefined)?.[rl.field ?? ''];
      return typeof v === 'string' && v.length > 0 ? v.trim().toLowerCase().slice(0, 100) : req.ip;
    }
  }
}

/** Applies the contract route's `rateLimit` after authentication (so per-kiosk/per-student keys are known). */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimitService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const id = routeIdOf(ctx);
    const rl = id ? (routes[id] as RouteSpec).rateLimit : undefined;
    if (!id || !rl) return true;
    const key = keyFor(rl, ctx.switchToHttp().getRequest<LpRequest>());
    if (!key) return true;
    const wait = await this.limiter.consume(`${id}:${rl.key}:${key}`, rl.limit, rl.windowSec);
    if (wait > 0) throw Errors.tooMany(wait);
    return true;
  }
}
