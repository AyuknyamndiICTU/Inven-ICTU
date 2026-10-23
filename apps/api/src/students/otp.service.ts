import { maskContact } from '@labpass/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/env';
import { NotificationService } from '../notifications/core/notification.service';
import { codeHash, randomOtp, safeEqual } from '../platform/crypto/crypto';

export type OtpChannel = 'EMAIL' | 'SMS';

export function localeOf(acceptLanguage: string | string[] | undefined): 'en' | 'fr' {
  const v = Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage;
  return v?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

/** One-time codes sent to the contact registered in the school system (never to a contact typed by the user). */
@Injectable()
export class OtpService {
  constructor(
    private readonly notifications: NotificationService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  hash(purpose: string, subject: string, code: string) {
    return codeHash(this.env.APP_SECRET, purpose, subject, code);
  }

  matches(stored: string | null | undefined, purpose: string, subject: string, code: string) {
    return Boolean(stored) && safeEqual(stored!, this.hash(purpose, subject, code));
  }

  /** Sends a code to the SIS email (preferred) or phone. Returns null when the student has no contact on record. */
  async send(
    purpose: string,
    subject: string,
    contact: { email: string | null; phone: string | null },
    locale: 'en' | 'fr',
  ) {
    const channel: OtpChannel | null = contact.email ? 'EMAIL' : contact.phone ? 'SMS' : null;
    if (!channel) return null;
    const to = (channel === 'EMAIL' ? contact.email : contact.phone)!;
    const code = randomOtp();
    await this.notifications.sendNow(channel, { to, template: 'otp', locale, data: { code } });
    return { channel, destination: maskContact(to)!, hash: this.hash(purpose, subject, code) };
  }
}
