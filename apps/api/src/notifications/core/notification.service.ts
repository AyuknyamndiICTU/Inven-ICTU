import { maskContact } from '@labpass/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { API_ENV, type ApiEnv } from '../../config/env';
import { Errors } from '../../platform/http/problem';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { type Locale, render, type TemplateData, type TemplateId } from './templates';

export type ChannelName = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH';

export interface OutboundMessage {
  to: string;
  template: TemplateId;
  locale: Locale;
  data?: TemplateData;
}

/** Port implemented by every delivery channel (ARCH §3, invariant I6). */
export interface NotificationChannelPort {
  readonly channel: ChannelName;
  readonly provider: string;
  isConfigured(): Promise<boolean> | boolean;
  send(msg: OutboundMessage): Promise<{ providerMessageId?: string }>;
}

export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');

export class EmailChannel implements NotificationChannelPort {
  readonly channel = 'EMAIL' as const;
  readonly provider = 'smtp';
  private readonly transport: Transporter;

  constructor(private readonly env: ApiEnv) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }

  isConfigured() {
    return Boolean(this.env.SMTP_HOST);
  }

  async send(msg: OutboundMessage) {
    const r = render(msg.template, msg.locale, msg.data);
    const info = await this.transport.sendMail({
      from: this.env.SMTP_FROM,
      to: msg.to,
      subject: r.subject,
      text: r.text,
      html: r.html,
    });
    return { providerMessageId: info.messageId };
  }
}

/** Development / test channel: records messages in memory, never sends anything. */
export class MockChannel implements NotificationChannelPort {
  readonly provider = 'mock';
  readonly sent: Array<OutboundMessage & { at: Date }> = [];
  constructor(readonly channel: ChannelName) {}
  isConfigured() {
    return true;
  }
  async send(msg: OutboundMessage) {
    this.sent.push({ ...msg, at: new Date() });
    return { providerMessageId: `mock-${this.sent.length}` };
  }
}

/** Sends notifications through the configured channels and records a masked delivery log. */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger('Notifications');
  /** Test hook: every message sent in NODE_ENV=test (OTP codes included) for assertions. */
  readonly sentForTest: Array<{ channel: ChannelName } & OutboundMessage> = [];

  constructor(
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannelPort[],
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  channel(name: ChannelName): NotificationChannelPort | undefined {
    return this.channels.find((c) => c.channel === name);
  }

  async status() {
    return Promise.all(
      (['EMAIL', 'SMS', 'WHATSAPP', 'PUSH'] as const).map(async (name) => {
        const c = this.channel(name);
        return {
          channel: name,
          enabled: Boolean(c),
          configured: c ? await c.isConfigured() : false,
          provider: c?.provider ?? null,
        };
      }),
    );
  }

  /** Immediate delivery (OTPs, tests). Alerts go through the queue in S07. */
  async sendNow(channel: ChannelName, msg: OutboundMessage, opts: { occurrenceId?: string; log?: boolean } = {}) {
    const c = this.channel(channel);
    if (!c || !(await c.isConfigured())) throw Errors.unavailable(`The ${channel} channel is not configured.`);
    if (this.env.NODE_ENV === 'test') this.sentForTest.push({ channel, ...msg });
    let status: 'SENT' | 'FAILED' = 'SENT';
    let providerMessageId: string | undefined;
    let error: string | undefined;
    try {
      ({ providerMessageId } = await c.send(msg));
    } catch (e) {
      status = 'FAILED';
      error = (e as Error).message.slice(0, 300);
      this.logger.warn(`${channel} delivery failed (${msg.template}): ${error}`);
    }
    if (opts.log !== false) {
      await this.prisma.notificationLog.create({
        data: {
          channel,
          template: msg.template,
          recipientMasked: maskContact(msg.to) ?? '—',
          status,
          providerMessageId: providerMessageId ?? null,
          attempts: 1,
          error: error ?? null,
          occurrenceId: opts.occurrenceId ?? null,
        },
      });
    }
    if (status === 'FAILED') throw Errors.unavailable('The message could not be delivered. Try again later.');
    return { providerMessageId };
  }
}
