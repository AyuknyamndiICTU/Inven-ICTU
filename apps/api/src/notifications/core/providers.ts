import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { API_ENV, type ApiEnv } from '../../config/env';
import { SecretBox } from '../../platform/crypto/crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';

const KEY = '_notificationProviders';
const CACHE_MS = 5_000;

export interface StoredProviders {
  sms: { provider: 'MOCK' | 'HTTP'; endpoint: string | null; sender: string | null; apiKeySealed: string | null };
  whatsapp: {
    enabled: boolean;
    phoneNumberId: string | null;
    templateName: string;
    accessTokenSealed: string | null;
    appSecretSealed: string | null;
    verifyTokenSealed: string | null;
  };
}

const DEFAULTS: StoredProviders = {
  sms: { provider: 'MOCK', endpoint: null, sender: null, apiKeySealed: null },
  whatsapp: {
    enabled: false,
    phoneNumberId: null,
    templateName: 'labpass_low_stock',
    accessTokenSealed: null,
    appSecretSealed: null,
    verifyTokenSealed: null,
  },
};

export interface ProvidersUpdate {
  sms?: { provider: 'MOCK' | 'HTTP'; endpoint?: string; sender?: string; apiKey?: string };
  whatsapp?: {
    enabled: boolean;
    phoneNumberId?: string;
    accessToken?: string;
    appSecret?: string;
    verifyToken?: string;
    templateName?: string;
  };
}

/** SMS / WhatsApp provider settings. Secrets are sealed with AES-256-GCM and never leave the API (S07 task 7). */
@Injectable()
export class ProviderConfigService {
  private cache?: { value: StoredProviders; at: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async get(): Promise<StoredProviders> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const v = (row?.value ?? {}) as Partial<StoredProviders>;
    const value = { sms: { ...DEFAULTS.sms, ...v.sms }, whatsapp: { ...DEFAULTS.whatsapp, ...v.whatsapp } };
    this.cache = { value, at: Date.now() };
    return value;
  }

  open(sealed: string | null): string | null {
    return sealed ? this.box.open(sealed) : null;
  }

  invalidate() {
    this.cache = undefined;
  }

  async update(body: ProvidersUpdate, actorId: string) {
    const cur = await this.get();
    const seal = (plain: string | undefined, prev: string | null) => (plain ? this.box.seal(plain) : prev);
    const next: StoredProviders = {
      sms: body.sms
        ? {
            provider: body.sms.provider,
            endpoint: body.sms.endpoint ?? cur.sms.endpoint,
            sender: body.sms.sender ?? cur.sms.sender,
            apiKeySealed: seal(body.sms.apiKey, cur.sms.apiKeySealed),
          }
        : cur.sms,
      whatsapp: body.whatsapp
        ? {
            enabled: body.whatsapp.enabled,
            phoneNumberId: body.whatsapp.phoneNumberId ?? cur.whatsapp.phoneNumberId,
            templateName: body.whatsapp.templateName ?? cur.whatsapp.templateName,
            accessTokenSealed: seal(body.whatsapp.accessToken, cur.whatsapp.accessTokenSealed),
            appSecretSealed: seal(body.whatsapp.appSecret, cur.whatsapp.appSecretSealed),
            verifyTokenSealed: seal(body.whatsapp.verifyToken, cur.whatsapp.verifyTokenSealed),
          }
        : cur.whatsapp,
    };
    const value = next as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({
      where: { key: KEY },
      update: { value, updatedById: actorId },
      create: { key: KEY, value, updatedById: actorId },
    });
    this.cache = undefined;
  }

  /** The mock SMS provider only counts as configured outside production, so it can never silently swallow real alerts. */
  smsConfigured(c: StoredProviders) {
    if (c.sms.provider === 'MOCK') return this.env.NODE_ENV !== 'production';
    return Boolean(c.sms.endpoint && c.sms.apiKeySealed);
  }

  whatsappConfigured(c: StoredProviders) {
    return c.whatsapp.enabled && Boolean(c.whatsapp.phoneNumberId && c.whatsapp.accessTokenSealed);
  }
}
