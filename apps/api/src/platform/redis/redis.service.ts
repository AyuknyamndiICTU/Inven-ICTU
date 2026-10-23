import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { API_ENV, type ApiEnv } from '../../config/env';

/** Shared Redis connections: one for commands, one for pub/sub subscriptions, factories for BullMQ. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private subscriber?: Redis;
  private readonly extra: Redis[] = [];

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.client = new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3, enableReadyCheck: true });
  }

  /** Dedicated connection for SUBSCRIBE (a subscribed connection cannot run other commands). */
  sub(): Redis {
    this.subscriber ??= new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    return this.subscriber;
  }

  /** New connection for BullMQ (requires maxRetriesPerRequest: null). */
  newConnection(): Redis {
    const c = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.extra.push(c);
    return c;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    const all = [this.client, this.subscriber, ...this.extra].filter(Boolean) as Redis[];
    await Promise.allSettled(all.map((c) => c.quit()));
  }
}
