import { bytesToHex, hexToBytes } from '@labpass/contracts/tap';
import {
  authFirstApdu,
  DESFIRE,
  diversifyAn10922,
  ev2FirstAnswer,
  ev2FirstVerify,
  parseDesfireResponse,
  selectLabPassApdu,
} from '@labpass/contracts/tap-node';
import { Controller, Inject, Injectable, Logger, Module, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { API_ENV, type ApiEnv } from '../config/env';
import { IdentifyService } from '../lending/identify.service';
import { LendingModule } from '../lending/lending.module';
import { uidHmac } from '../platform/crypto/crypto';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RedisService } from '../platform/redis/redis.service';
import { SettingsModule, SettingsService } from '../settings/settings';

/** One relay step must complete within this time (a card held on the reader answers in milliseconds). */
export const CARD_AUTH_TTL_SEC = 5;

/** Port for the DESFire LAK master keys (Docker secret now; an HSM/SAM can implement it later). */
@Injectable()
export class CardKeyStore {
  private readonly logger = new Logger('CardKeyStore');
  private readonly keys = new Map<number, Uint8Array>();

  constructor(@Inject(API_ENV) env: ApiEnv) {
    let raw = env.DESFIRE_LAK_KEYS ?? '';
    if (!raw && existsSync(env.DESFIRE_KEYS_FILE)) raw = readFileSync(env.DESFIRE_KEYS_FILE, 'utf8');
    for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
      const m = /^(\d+):([0-9A-Fa-f]{32})$/.exec(part);
      if (!m) {
        this.logger.error('Ignoring a malformed DESFire key entry (expected "<version>:<32 hex>").');
        continue;
      }
      this.keys.set(Number(m[1]), hexToBytes(m[2]!));
    }
  }

  get configured() {
    return this.keys.size > 0;
  }

  get currentVersion(): number | null {
    return this.keys.size ? Math.max(...this.keys.keys()) : null;
  }

  /** The per-card LabPass authentication key. Derived on demand, never stored, logged or returned. */
  cardKey(uid: Uint8Array, version: number | null): Uint8Array | null {
    const v = version ?? this.currentVersion;
    const master = v === null ? undefined : this.keys.get(v);
    return master ? diversifyAn10922(master, uid) : null;
  }
}

type Phase = 'SELECT' | 'AUTH1' | 'AUTH2';
interface AuthSession {
  kioskId: string;
  bindingId: string;
  uid: string;
  keyVersion: number | null;
  phase: Phase;
  rndA?: string;
}

const hex = (b: Uint8Array) => bytesToHex(b).toUpperCase();

/**
 * Relayed DESFire EV3 AES authentication (ARCH §5 F1, card spec B4). The kiosk forwards APDUs; the server derives the
 * per-card key and runs SelectApplication → AuthenticateEV2First (2 frames). The card is trusted only if its RndA'
 * matches. Every step rotates the session id, so replayed or out-of-order steps fail.
 */
@Injectable()
export class CardAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly keys: CardKeyStore,
    private readonly settings: SettingsService,
    private readonly identify: IdentifyService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private async save(s: AuthSession) {
    const id = randomUUID();
    await this.redis.client.set(`cas:${id}`, JSON.stringify(s), 'EX', CARD_AUTH_TTL_SEC);
    return id;
  }

  async start(kioskId: string, uidHex: string) {
    const uid = uidHex.toUpperCase();
    const mode = (await this.settings.get()).cardAuthMode;
    if (mode === 'UID') return { status: 'UID_ONLY' as const, reason: 'MODE_UID' };
    const binding = await this.prisma.cardBinding.findFirst({
      where: { uidHmac: uidHmac(this.env.UID_PEPPER, uid), status: 'ACTIVE' },
    });
    if (!binding)
      return { status: 'DONE' as const, result: { status: 'UNKNOWN_CARD' as const, uidSuffix: uid.slice(-4) } };
    if (binding.cardTech !== 'DESFIRE_EV3') return { status: 'UID_ONLY' as const, reason: 'NOT_DESFIRE' };
    if (!this.keys.cardKey(hexToBytes(uid), binding.keyVersion))
      return { status: 'UID_ONLY' as const, reason: 'KEYS_NOT_CONFIGURED' };
    const sessionId = await this.save({
      kioskId,
      bindingId: binding.id,
      uid,
      keyVersion: binding.keyVersion,
      phase: 'SELECT',
    });
    return { status: 'CONTINUE' as const, sessionId, apdu: hex(selectLabPassApdu()) };
  }

  async step(kioskId: string, sessionId: string, responseHex: string) {
    const raw = await this.redis.client.getdel(`cas:${sessionId}`);
    const s = raw ? (JSON.parse(raw) as AuthSession) : null;
    if (!s || s.kioskId !== kioskId) throw Errors.notFound('Card authentication (hold the card on the reader again)');
    const resp = parseDesfireResponse(hexToBytes(responseHex));
    const key = this.keys.cardKey(hexToBytes(s.uid), s.keyVersion)!;

    if (s.phase === 'SELECT') {
      if (resp?.status !== DESFIRE.STATUS_OK) return this.fail(s, 'APPLICATION_NOT_FOUND');
      return {
        status: 'CONTINUE' as const,
        sessionId: await this.save({ ...s, phase: 'AUTH1' }),
        apdu: hex(authFirstApdu()),
      };
    }
    if (s.phase === 'AUTH1') {
      if (resp?.status !== DESFIRE.STATUS_MORE || resp.data.length !== 16) return this.fail(s, 'AUTH_FAILED');
      const { rndA, apdu } = ev2FirstAnswer(key, resp.data);
      return {
        status: 'CONTINUE' as const,
        sessionId: await this.save({ ...s, phase: 'AUTH2', rndA: hex(rndA) }),
        apdu: hex(apdu),
      };
    }
    if (resp?.status !== DESFIRE.STATUS_OK || !ev2FirstVerify(key, resp.data, hexToBytes(s.rndA!)).ok)
      return this.fail(s, 'AUTH_FAILED');
    const binding = await this.prisma.cardBinding.findUnique({
      where: { id: s.bindingId },
      include: { student: true },
    });
    if (!binding || binding.status !== 'ACTIVE') return this.fail(s, 'CARD_REVOKED');
    return {
      status: 'DONE' as const,
      result: await this.identify.identified(kioskId, binding.student, 'CARD', null, []),
    };
  }

  /** Counts the failure on the card; DESFIRE_REQUIRED refuses, DESFIRE_PREFERRED falls back to a flagged UID loan. */
  private async fail(s: AuthSession, reason: string) {
    await this.prisma.cardBinding
      .update({ where: { id: s.bindingId }, data: { authFailures: { increment: 1 } } })
      .catch(() => undefined);
    if ((await this.settings.get()).cardAuthMode === 'DESFIRE_REQUIRED') {
      throw Errors.forbidden('CARD_AUTH_FAILED', 'This card could not be verified. Ask a lab assistant.', { reason });
    }
    return { status: 'UID_ONLY' as const, reason };
  }
}

@Controller()
export class CardAuthController {
  constructor(private readonly cardAuth: CardAuthService) {}

  @Contract('kiosk.cardAuthStart')
  start(@ContractInput() input: In<'kiosk.cardAuthStart'>, @Req() req: LpRequest) {
    return this.cardAuth.start(req.kiosk!.id, input.body.uid);
  }

  @Contract('kiosk.cardAuthStep')
  step(@ContractInput() input: In<'kiosk.cardAuthStep'>, @Req() req: LpRequest) {
    return this.cardAuth.step(req.kiosk!.id, input.body.sessionId, input.body.response);
  }
}

@Module({
  imports: [SettingsModule, LendingModule],
  controllers: [CardAuthController],
  providers: [CardKeyStore, CardAuthService],
  exports: [CardKeyStore],
})
export class CardsModule {}
