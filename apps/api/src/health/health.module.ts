import { Controller, Inject, Module } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../config/env';
import { Contract } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RedisService } from '../platform/redis/redis.service';
import { SettingsModule, SettingsService } from '../settings/settings';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Contract('meta.health')
  health() {
    return { status: 'ok' as const };
  }

  @Contract('meta.ready')
  async ready() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const redis = await this.redis.ping();
    if (!db || !redis) throw Errors.unavailable(`Dependencies not ready (db: ${db}, redis: ${redis}).`);
    return { status: 'ready' as const, db, redis };
  }

  @Contract('meta.appConfig')
  async appConfig() {
    const s = await this.settings.get();
    return {
      minSupportedVersion: s.minSupportedAppVersion,
      androidApk: s.androidApk,
      webauthnRpId: this.env.WEBAUTHN_RP_ID,
      labels: s.labels,
    };
  }
}

@Module({ imports: [SettingsModule], controllers: [HealthController] })
export class HealthModule {}
