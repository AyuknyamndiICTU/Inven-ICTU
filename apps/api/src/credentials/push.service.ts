import { Inject, Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { API_ENV, type ApiEnv } from '../config/env';
import { NotificationService } from '../notifications/core/notification.service';
import { type Locale, render, type TemplateData, type TemplateId } from '../notifications/core/templates';
import { PrismaService } from '../platform/prisma/prisma.service';

/** Push notifications to students: Expo (Android app) and Web Push (web app). Best-effort, never blocks a request. */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
      webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  }

  async toStudent(studentId: string, template: TemplateId, locale: Locale = 'en', data: TemplateData = {}) {
    const tokens = await this.prisma.pushToken.findMany({ where: { studentId } });
    if (!tokens.length) return 0;
    const r = render(template, locale, data);
    let sent = 0;
    for (const t of tokens) {
      try {
        if (this.env.NODE_ENV === 'test') {
          this.notifications.sentForTest.push({ channel: 'PUSH', to: t.kind, template, locale, data });
        } else if (t.kind === 'EXPO') {
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${this.env.EXPO_ACCESS_TOKEN}` } : {}),
            },
            body: JSON.stringify({ to: t.token, title: r.subject, body: r.short }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) throw new Error(`Expo push ${res.status}`);
        } else if (this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY) {
          await webpush.sendNotification(
            JSON.parse(t.token) as webpush.PushSubscription,
            JSON.stringify({ title: r.subject, body: r.short }),
            { TTL: 3600 },
          );
        } else continue;
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await this.prisma.pushToken.delete({ where: { id: t.id } }).catch(() => undefined);
        else this.logger.warn(`push failed (${t.kind}): ${(e as Error).message}`);
      }
    }
    return sent;
  }
}
