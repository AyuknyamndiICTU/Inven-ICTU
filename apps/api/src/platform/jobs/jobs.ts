import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { API_ENV, type ApiEnv } from '../../config/env';
import { RedisService } from '../redis/redis.service';

type JobHandler = () => Promise<unknown>;

/** 5-field cron (minute hour day month weekday) with numbers, ranges, steps and lists. */
const CRON_FIELD = /^(\*|\d{1,2}(-\d{1,2})?)(\/\d{1,2})?(,(\*|\d{1,2}(-\d{1,2})?)(\/\d{1,2})?)*$/;
export function isValidCron(pattern: string): boolean {
  const parts = pattern.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => CRON_FIELD.test(p));
}

/**
 * Named background jobs (SIS sync, overdue sweep, alert digests). Schedules are BullMQ job schedulers, so
 * only one process runs each occurrence. With WORKER_MODE=off (tests) nothing is scheduled; call `run(name)`.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, JobHandler>();
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private get enabled() {
    return this.env.WORKER_MODE !== 'off';
  }

  private getQueue() {
    this.queue ??= new Queue('lp-jobs', { connection: this.redis.newConnection() });
    return this.queue;
  }

  define(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  /** Creates, updates or (with `null`) removes the schedule of a job. */
  async schedule(name: string, pattern: string | null, tz = 'Africa/Douala') {
    if (!this.enabled) return;
    if (!pattern) {
      await this.getQueue().removeJobScheduler(name);
      return;
    }
    if (!isValidCron(pattern)) throw new Error(`Invalid cron pattern for ${name}: ${pattern}`);
    await this.getQueue().upsertJobScheduler(
      name,
      { pattern, tz },
      { name, opts: { removeOnComplete: 50, removeOnFail: 50 } },
    );
  }

  /** Runs a job now in this process (manual trigger, tests). */
  async run(name: string) {
    const h = this.handlers.get(name);
    if (!h) throw new Error(`Unknown job ${name}`);
    return h();
  }

  onApplicationBootstrap() {
    if (!this.enabled || !(this.env.WORKER_MODE === 'inline' || process.env.LABPASS_PROCESS === 'worker')) return;
    this.worker = new Worker(
      'lp-jobs',
      async (job) => {
        const h = this.handlers.get(job.name);
        if (!h) return;
        await h();
      },
      { connection: this.redis.newConnection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => this.logger.warn(`job ${job?.name} failed: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
