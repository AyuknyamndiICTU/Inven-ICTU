import { maskContact } from '@labpass/contracts';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { API_ENV, type ApiEnv } from '../../config/env';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { RedisService } from '../../platform/redis/redis.service';
import { type ChannelName, NotificationService } from './notification.service';
import type { Locale, TemplateData, TemplateId } from './templates';

export const DELIVERY_ATTEMPTS = 5;
const DEDUPE_TTL_SEC = 7 * 24 * 3600;

export interface Delivery {
  channel: Exclude<ChannelName, 'PUSH'>;
  to: string;
  template: TemplateId;
  locale: Locale;
  data?: TemplateData;
  /** Stable key: the same key is delivered at most once (e.g. `occurrenceId:channel:adminId`). */
  dedupeKey: string;
  occurrenceId?: string | null;
  delayMs?: number;
}

interface Job extends Omit<Delivery, 'dedupeKey' | 'delayMs'> {
  logId: string;
}

/**
 * Asynchronous delivery (ARCH §5 F8): one BullMQ queue per channel, 5 attempts with exponential backoff, then DEAD
 * (the failed job is kept as the dead letter). Every attempt updates a NotificationLog row with a masked recipient.
 * With WORKER_MODE=off (tests) delivery runs inline, once.
 */
@Injectable()
export class DeliveryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Delivery');
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private queue(channel: string) {
    let q = this.queues.get(channel);
    if (!q) {
      q = new Queue(`lp-notify-${channel.toLowerCase()}`, { connection: this.redis.newConnection() });
      this.queues.set(channel, q);
    }
    return q;
  }

  async enqueue(d: Delivery): Promise<'QUEUED' | 'DUPLICATE' | 'UNAVAILABLE'> {
    const channel = this.notifications.channel(d.channel);
    if (!channel || !(await channel.isConfigured())) return 'UNAVAILABLE';
    const fresh = await this.redis.client.set(`nq:${d.dedupeKey}`, '1', 'EX', DEDUPE_TTL_SEC, 'NX');
    if (fresh !== 'OK') return 'DUPLICATE';
    const log = await this.prisma.notificationLog.create({
      data: {
        channel: d.channel,
        template: d.template,
        recipientMasked: maskContact(d.to) ?? '—',
        status: 'QUEUED',
        occurrenceId: d.occurrenceId ?? null,
      },
    });
    const job: Job = {
      logId: log.id,
      channel: d.channel,
      to: d.to,
      template: d.template,
      locale: d.locale,
      data: d.data ?? {},
      occurrenceId: d.occurrenceId ?? null,
    };
    if (this.env.WORKER_MODE === 'off') {
      // Deferred (quiet hours / digest) deliveries stay QUEUED in tests; immediate ones get their first attempt now.
      if (!d.delayMs) await this.attempt(job, 1, false).catch(() => undefined);
      return 'QUEUED';
    }
    await this.queue(d.channel).add('deliver', job, {
      jobId: d.dedupeKey.replace(/:/g, '_'),
      attempts: DELIVERY_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5_000 },
      delay: d.delayMs ?? 0,
      removeOnComplete: 1000,
      removeOnFail: false,
    });
    return 'QUEUED';
  }

  /** One delivery attempt. Throws on failure so BullMQ retries; the last failure marks the log DEAD. */
  async attempt(job: Job, attemptNo: number, final: boolean) {
    if (job.occurrenceId) {
      const occ = await this.prisma.alertOccurrence.findUnique({ where: { id: job.occurrenceId } });
      if (occ?.resolvedAt && occ.severity === 'LOW') {
        await this.prisma.notificationLog.update({
          where: { id: job.logId },
          data: { status: 'FAILED', error: 'Skipped: stock recovered before delivery', attempts: attemptNo },
        });
        return;
      }
    }
    const channel = this.notifications.channel(job.channel)!;
    if (this.env.NODE_ENV === 'test')
      this.notifications.sentForTest.push({
        channel: job.channel,
        to: job.to,
        template: job.template,
        locale: job.locale,
        data: job.data,
      });
    try {
      const r = await channel.send({ to: job.to, template: job.template, locale: job.locale, data: job.data });
      await this.prisma.notificationLog.update({
        where: { id: job.logId },
        data: { status: 'SENT', attempts: attemptNo, providerMessageId: r.providerMessageId ?? null, error: null },
      });
    } catch (e) {
      const error = (e as Error).message.slice(0, 300);
      await this.prisma.notificationLog.update({
        where: { id: job.logId },
        data: { status: final ? 'DEAD' : 'FAILED', attempts: attemptNo, error },
      });
      this.logger.warn(`${job.channel} ${job.template} attempt ${attemptNo} failed: ${error}`);
      throw e;
    }
  }

  onApplicationBootstrap() {
    if (
      this.env.WORKER_MODE === 'off' ||
      !(this.env.WORKER_MODE === 'inline' || process.env.LABPASS_PROCESS === 'worker')
    )
      return;
    for (const channel of ['EMAIL', 'SMS', 'WHATSAPP']) {
      const w = new Worker(
        `lp-notify-${channel.toLowerCase()}`,
        async (j) => this.attempt(j.data as Job, j.attemptsMade + 1, j.attemptsMade + 1 >= DELIVERY_ATTEMPTS),
        { connection: this.redis.newConnection(), concurrency: 4 },
      );
      w.on('failed', (j, err) => {
        if (j && j.attemptsMade >= DELIVERY_ATTEMPTS)
          this.logger.error(`dead letter ${channel} ${j.id}: ${err.message}`);
      });
      this.workers.push(w);
    }
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
