import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { API_ENV, type ApiEnv } from '../../config/env';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface DomainEvent<T = unknown> {
  id: string;
  type: string;
  payload: T;
  createdAt: string;
}

/** Adds an event to the transactional outbox. Call inside the same transaction as the state change. */
@Injectable()
export class OutboxService {
  async add<T>(tx: Tx, type: string, payload: T): Promise<string> {
    const row = await tx.outboxEvent.create({
      data: { type, payload: payload as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
    return row.id;
  }
}

type Handler = (event: DomainEvent, tx: Tx) => Promise<void>;
type DirectHandler = (event: DomainEvent) => Promise<void> | void;

/** Exactly-once effects on top of at-least-once delivery: one inbox row per (consumer, event). */
@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async handleOnce(consumer: string, eventId: string, fn: (tx: Tx) => Promise<void>): Promise<boolean> {
    return this.prisma.tx(async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO consumer_inbox (consumer, "eventId", "processedAt") VALUES (${consumer}, ${eventId}::uuid, now())
        ON CONFLICT DO NOTHING`;
      if (inserted === 0) return false;
      await fn(tx);
      return true;
    });
  }
}

/**
 * Routes outbox events to consumers. Durable consumers run through BullMQ (retries, dead letters) and the inbox;
 * direct consumers (realtime fan-out) run best-effort in the relay. With WORKER_MODE=off (tests) durable consumers
 * run synchronously so behaviour is deterministic, still through the inbox.
 */
@Injectable()
export class EventBus implements OnModuleDestroy {
  private readonly logger = new Logger('EventBus');
  private readonly durable = new Map<string, { types: Set<string>; handler: Handler }>();
  private readonly direct: Array<{ types: Set<string>; handler: DirectHandler }> = [];
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly inbox: InboxService,
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  register(consumer: string, types: string[], handler: Handler) {
    this.durable.set(consumer, { types: new Set(types), handler });
  }

  onDirect(types: string[], handler: DirectHandler) {
    this.direct.push({ types: new Set(types), handler });
  }

  private get useQueue() {
    return this.env.WORKER_MODE !== 'off';
  }

  private getQueue(): Queue {
    this.queue ??= new Queue('lp-events', { connection: this.redis.newConnection() });
    return this.queue;
  }

  async dispatch(event: DomainEvent): Promise<void> {
    for (const d of this.direct) {
      if (!d.types.has(event.type) && !d.types.has('*')) continue;
      try {
        await d.handler(event);
      } catch (e) {
        this.logger.warn(`direct handler failed for ${event.type}: ${(e as Error).message}`);
      }
    }
    for (const [consumer, c] of this.durable) {
      if (!c.types.has(event.type)) continue;
      if (this.useQueue) {
        await this.getQueue().add(
          'event',
          { consumer, event },
          {
            jobId: `${consumer}:${event.id}`,
            attempts: 6,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: false,
          },
        );
      } else {
        await this.inbox.handleOnce(consumer, event.id, (tx) => c.handler(event, tx));
      }
    }
  }

  /** Starts the BullMQ worker that executes durable consumers (API inline mode or the separate worker process). */
  startWorker(concurrency = 4) {
    if (this.worker || !this.useQueue) return;
    this.worker = new Worker(
      'lp-events',
      async (job) => {
        const { consumer, event } = job.data as { consumer: string; event: DomainEvent };
        const c = this.durable.get(consumer);
        if (!c) return;
        await this.inbox.handleOnce(consumer, event.id, (tx) => c.handler(event, tx));
      },
      { connection: this.redis.newConnection(), concurrency },
    );
    this.worker.on('failed', (job, err) => this.logger.warn(`consumer ${job?.data?.consumer} failed: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}

/** Polls the outbox with FOR UPDATE SKIP LOCKED and dispatches committed events (never rolled-back ones). */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger('OutboxRelay');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onApplicationBootstrap() {
    if (this.env.WORKER_MODE === 'inline' || process.env.LABPASS_PROCESS === 'worker') this.start();
  }

  start(intervalMs = 250) {
    if (this.timer) return;
    this.bus.startWorker();
    this.timer = setInterval(() => void this.safeTick(), intervalMs);
  }

  private async safeTick() {
    if (this.running) return;
    this.running = true;
    try {
      while ((await this.tick()) === 100) {
        /* drain backlog */
      }
    } catch (e) {
      this.logger.warn(`relay tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async tick(): Promise<number> {
    return this.prisma.tx(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; type: string; payload: unknown; createdAt: Date }>>`
        SELECT id, type, payload, "createdAt" FROM outbox_events
        WHERE "publishedAt" IS NULL ORDER BY "createdAt" LIMIT 100 FOR UPDATE SKIP LOCKED`;
        for (const r of rows) {
          await this.bus.dispatch({ id: r.id, type: r.type, payload: r.payload, createdAt: r.createdAt.toISOString() });
        }
        if (rows.length) {
          const ids = rows.map((r) => r.id);
          await tx.$executeRaw`UPDATE outbox_events SET "publishedAt" = now(), attempts = attempts + 1 WHERE id = ANY(${ids}::uuid[])`;
        }
        return rows.length;
      },
      { timeoutMs: 30_000 },
    );
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
