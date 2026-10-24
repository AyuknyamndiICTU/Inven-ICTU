import type { ApiEnv } from '../../config/env';
import type { NotificationChannelPort, OutboundMessage } from '../core/notification.service';
import type { ProviderConfigService } from '../core/providers';
import { render, type TemplateData, type TemplateId } from '../core/templates';

/**
 * SMS through a configurable HTTP provider (decision gate Q5: any gateway that accepts a JSON POST with a bearer key),
 * or the in-memory mock in development and tests.
 */
export class SmsChannel implements NotificationChannelPort {
  readonly channel = 'SMS' as const;
  readonly provider = 'sms';
  /** Messages captured by the MOCK provider (development, tests). */
  readonly mockSent: Array<{ to: string; text: string; at: Date }> = [];

  constructor(
    private readonly cfg: ProviderConfigService,
    private readonly env: ApiEnv,
  ) {}

  async isConfigured() {
    return this.cfg.smsConfigured(await this.cfg.get());
  }

  async send(msg: OutboundMessage) {
    const c = (await this.cfg.get()).sms;
    const text = render(msg.template, msg.locale, msg.data).short;
    if (c.provider === 'MOCK') {
      if (this.env.NODE_ENV === 'production') throw new Error('The mock SMS provider cannot send in production.');
      this.mockSent.push({ to: msg.to, text, at: new Date() });
      return { providerMessageId: `mock-sms-${this.mockSent.length}` };
    }
    const res = await fetch(c.endpoint!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.open(c.apiKeySealed)}` },
      body: JSON.stringify({ to: msg.to, from: c.sender, message: text }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`SMS provider answered ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as { id?: string; messageId?: string };
    return { providerMessageId: body.id ?? body.messageId };
  }
}

type WaTemplate = { name: (configured: string) => string; params: (d: TemplateData) => string[]; copyCode?: boolean };

/** Pre-approved WhatsApp templates (docs/runbooks/whatsapp.md). Parameters are sent in this exact order. */
export const WHATSAPP_TEMPLATES: Partial<Record<TemplateId, WaTemplate>> = {
  low_stock: {
    name: (configured) => configured,
    params: (d) => [String(d.item), String(d.available), String(d.threshold)],
  },
  out_of_stock: { name: () => 'labpass_out_of_stock', params: (d) => [String(d.item)] },
  test: { name: () => 'labpass_test', params: () => [] },
  otp: { name: () => 'labpass_otp', params: (d) => [String(d.code)], copyCode: true },
};

/** WhatsApp Cloud API (Graph `/{phone-number-id}/messages`), template messages only. */
export class WhatsAppChannel implements NotificationChannelPort {
  readonly channel = 'WHATSAPP' as const;
  readonly provider = 'whatsapp-cloud';

  constructor(
    private readonly cfg: ProviderConfigService,
    private readonly env: ApiEnv,
  ) {}

  async isConfigured() {
    return this.cfg.whatsappConfigured(await this.cfg.get());
  }

  async send(msg: OutboundMessage) {
    const c = (await this.cfg.get()).whatsapp;
    const t = WHATSAPP_TEMPLATES[msg.template];
    if (!t) throw new Error(`No approved WhatsApp template for "${msg.template}".`);
    const params = t.params(msg.data ?? {});
    const components: unknown[] = params.length
      ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
      : [];
    if (t.copyCode)
      components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: params[0] }] });
    const res = await fetch(`${this.env.WHATSAPP_GRAPH_URL}/${encodeURIComponent(c.phoneNumberId!)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.open(c.accessTokenSealed)}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: msg.to.replace(/[^\d]/g, ''),
        type: 'template',
        template: { name: t.name(c.templateName), language: { code: msg.locale }, components },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string };
    };
    if (!res.ok)
      throw new Error(`WhatsApp API ${res.status}: ${body.error?.message ?? 'request failed'}`.slice(0, 300));
    return { providerMessageId: body.messages?.[0]?.id };
  }
}

/** Student push goes through PushService (Expo / Web Push); this entry only reports the channel status. */
export class PushStatusChannel implements NotificationChannelPort {
  readonly channel = 'PUSH' as const;
  readonly provider = 'expo+webpush';

  isConfigured() {
    return true;
  }

  send(): Promise<{ providerMessageId?: string }> {
    return Promise.reject(new Error('Push notifications are sent to student devices by PushService.'));
  }
}
