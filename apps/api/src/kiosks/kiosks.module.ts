import { b64urlDecode, b64urlEncode } from '@labpass/contracts/tap';
import { Controller, Inject, Injectable, Module, Req } from '@nestjs/common';
import type { Kiosk } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { API_ENV, type ApiEnv } from '../config/env';
import { hmacB64, randomCode, randomToken, sha256Hex } from '../platform/crypto/crypto';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RealtimeService } from '../platform/realtime/realtime';
import { RedisService } from '../platform/redis/redis.service';
import { kioskConfigOf, SettingsModule, SettingsService } from '../settings/settings';

const REGISTRATION_TTL_MS = 10 * 60_000;
const ONLINE_WINDOW_MS = 90_000;
export const CHALLENGE_TTL_SEC = 60;

export function toKioskDto(k: Kiosk) {
  return {
    id: k.id,
    name: k.name,
    location: k.location,
    status: k.status,
    lastSeenAt: k.lastSeenAt?.toISOString() ?? null,
    appVersion: k.appVersion,
    readerStatus: k.readerStatus,
    online: k.status === 'ACTIVE' && Boolean(k.lastSeenAt && Date.now() - k.lastSeenAt.getTime() < ONLINE_WINDOW_MS),
  };
}

/** Server-issued, single-use, kiosk-bound nonces for phone tap and Scan-the-Kiosk (ARCH §5, §6). */
@Injectable()
export class ChallengeService {
  constructor(private readonly redis: RedisService) {}

  private key(kioskId: string, nonce: string) {
    return `kc:${kioskId}:${nonce}`;
  }

  async issue(kioskId: string, count = 3): Promise<Array<{ nonce: string; expiresAt: string }>> {
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SEC * 1000).toISOString();
    const nonces = Array.from({ length: count }, () => b64urlEncode(randomBytes(16)));
    const multi = this.redis.client.multi();
    for (const n of nonces) multi.set(this.key(kioskId, n), '1', 'EX', CHALLENGE_TTL_SEC);
    await multi.exec();
    return nonces.map((nonce) => ({ nonce, expiresAt }));
  }

  /** Atomically consumes a challenge. True only once, only for the kiosk it was issued to, only within the TTL. */
  async consume(kioskId: string, nonce: Uint8Array | string): Promise<boolean> {
    const text = typeof nonce === 'string' ? nonce : b64urlEncode(nonce);
    if (typeof nonce === 'string' && b64urlDecode(nonce).length !== 16) return false;
    return (await this.redis.client.getdel(this.key(kioskId, text))) !== null;
  }
}

@Injectable()
export class KiosksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private codeHash(code: string) {
    return hmacB64(
      this.env.APP_SECRET,
      `kreg:${code
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')}`,
    );
  }

  private async withCode(kiosk: Kiosk) {
    const code = randomCode();
    const expiresAt = new Date(Date.now() + REGISTRATION_TTL_MS);
    const updated = await this.prisma.kiosk.update({
      where: { id: kiosk.id },
      data: { registrationCodeHash: this.codeHash(code), registrationExpiresAt: expiresAt },
    });
    return { kiosk: toKioskDto(updated), registrationCode: code, expiresAt: expiresAt.toISOString() };
  }

  async create(name: string, location?: string) {
    return this.withCode(await this.prisma.kiosk.create({ data: { name, location: location ?? null } }));
  }

  async newCode(id: string) {
    const k = await this.prisma.kiosk.findUnique({ where: { id } });
    if (!k) throw Errors.notFound('Kiosk');
    if (k.status === 'REVOKED')
      throw Errors.conflict('KIOSK_REVOKED', 'Create a new kiosk instead of re-registering a revoked one.');
    return this.withCode(k);
  }

  async register(code: string, appVersion: string) {
    const kiosk = await this.prisma.kiosk.findFirst({
      where: { registrationCodeHash: this.codeHash(code), status: { not: 'REVOKED' } },
    });
    if (!kiosk || !kiosk.registrationExpiresAt || kiosk.registrationExpiresAt < new Date()) {
      throw Errors.unauthenticated('This registration code is invalid or has expired.');
    }
    const token = randomToken(32);
    await this.prisma.kiosk.update({
      where: { id: kiosk.id },
      data: {
        tokenHash: sha256Hex(token),
        status: 'ACTIVE',
        registrationCodeHash: null,
        registrationExpiresAt: null,
        appVersion,
        lastSeenAt: new Date(),
      },
    });
    return { kioskId: kiosk.id, token };
  }

  async revoke(id: string) {
    const k = await this.prisma.kiosk.update({
      where: { id },
      data: { status: 'REVOKED', tokenHash: null, registrationCodeHash: null },
    });
    await this.realtime.toKiosk(id, 'kiosk.revoked', {});
    return toKioskDto(k);
  }

  async heartbeat(kioskId: string, body: In<'kiosk.heartbeat'>['body']) {
    const k = await this.prisma.kiosk.update({
      where: { id: kioskId },
      data: { appVersion: body.appVersion, readerStatus: body.readerStatus, lastSeenAt: new Date() },
    });
    await this.realtime.toAdmins('kiosk.status', {
      kioskId,
      online: true,
      readerStatus: k.readerStatus,
      lastSeenAt: k.lastSeenAt?.toISOString() ?? null,
    });
    return { serverTime: new Date().toISOString(), config: kioskConfigOf(await this.settings.get()) };
  }
}

@Controller()
export class KiosksAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kiosks: KiosksService,
  ) {}

  @Contract('kiosks.list')
  async list() {
    return (await this.prisma.kiosk.findMany({ orderBy: { createdAt: 'asc' } })).map(toKioskDto);
  }

  @Contract('kiosks.create')
  create(@ContractInput() input: In<'kiosks.create'>) {
    return this.kiosks.create(input.body.name, input.body.location);
  }

  @Contract('kiosks.newCode')
  newCode(@ContractInput() input: In<'kiosks.newCode'>) {
    return this.kiosks.newCode(input.params.id);
  }

  @Contract('kiosks.revoke')
  revoke(@ContractInput() input: In<'kiosks.revoke'>) {
    return this.kiosks.revoke(input.params.id);
  }
}

@Controller()
export class KioskDeviceController {
  constructor(
    private readonly kiosks: KiosksService,
    private readonly challenges: ChallengeService,
    private readonly settings: SettingsService,
  ) {}

  @Contract('kiosk.register')
  register(@ContractInput() input: In<'kiosk.register'>) {
    return this.kiosks.register(input.body.code, input.body.appVersion);
  }

  @Contract('kiosk.heartbeat')
  heartbeat(@ContractInput() input: In<'kiosk.heartbeat'>, @Req() req: LpRequest) {
    return this.kiosks.heartbeat(req.kiosk!.id, input.body);
  }

  @Contract('kiosk.config')
  async config() {
    return kioskConfigOf(await this.settings.get());
  }

  @Contract('kiosk.challenges')
  async challengesFor(@Req() req: LpRequest) {
    return { kioskId: req.kiosk!.id, challenges: await this.challenges.issue(req.kiosk!.id) };
  }
}

@Module({
  imports: [SettingsModule],
  controllers: [KiosksAdminController, KioskDeviceController],
  providers: [KiosksService, ChallengeService],
  exports: [ChallengeService, KiosksService],
})
export class KiosksModule {}
