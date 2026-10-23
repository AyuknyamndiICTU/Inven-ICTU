import { b64urlDecode, b64urlEncode } from '@labpass/contracts/tap';
import { passkeyChallenge } from '@labpass/contracts/tap-node';
import { Controller, Inject, Injectable, Module, Req, Res } from '@nestjs/common';
import { type AuthenticationResponseJSON, generateAuthenticationOptions } from '@simplewebauthn/server';
import type { FastifyReply } from 'fastify';
import { API_ENV, type ApiEnv } from '../config/env';
import { InventoryModule } from '../inventory/inventory.module';
import { KiosksModule } from '../kiosks/kiosks.module';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { idempotencyKeyOf } from '../platform/idempotency/idempotency.service';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RealtimeService } from '../platform/realtime/realtime';
import { RedisService } from '../platform/redis/redis.service';
import { SettingsModule } from '../settings/settings';
import { localeOf } from '../students/otp.service';
import { StudentsModule } from '../students/students.module';
import { IdentifyService } from './identify.service';
import { LendingService } from './lending.service';

/** Scan-the-Kiosk from the student app (ARCH §5 F3): the phone proves itself, the kiosk receives `identified`. */
@Injectable()
export class ScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identify: IdentifyService,
    private readonly realtime: RealtimeService,
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private async kiosk(kioskId: string) {
    const k = await this.prisma.kiosk.findUnique({ where: { id: kioskId } });
    if (!k || k.status !== 'ACTIVE')
      throw Errors.unprocessable('NOT_RECOGNISED', 'This kiosk code is not valid. Scan the code on the screen again.');
    return k;
  }

  private nonceBytes(nonce: string) {
    try {
      const b = b64urlDecode(nonce);
      if (b.length !== 16) throw new Error('length');
      return b;
    } catch {
      throw Errors.unprocessable('NOT_RECOGNISED', 'This kiosk code is not valid. Scan the code on the screen again.');
    }
  }

  async options(credentialId: string, kioskId: string, nonce: string) {
    await this.kiosk(kioskId);
    const cred = await this.prisma.mobileCredential.findUniqueOrThrow({ where: { id: credentialId } });
    if (cred.kind !== 'PASSKEY' || !cred.webauthnCredentialId)
      throw Errors.badRequest('NOT_A_PASSKEY', 'This device signs kiosk codes with its own key.');
    const bytes = this.nonceBytes(nonce);
    if (!(await this.redis.client.exists(`kc:${kioskId}:${b64urlEncode(bytes)}`))) {
      throw Errors.unprocessable('NOT_RECOGNISED', 'This kiosk code has expired. Scan the code on the screen again.');
    }
    const options = await generateAuthenticationOptions({
      rpID: this.env.WEBAUTHN_RP_ID,
      challenge: passkeyChallenge(kioskId, bytes) as Uint8Array<ArrayBuffer>,
      allowCredentials: [{ id: cred.webauthnCredentialId, transports: cred.transports as never }],
      userVerification: 'required',
      timeout: 60_000,
    });
    return { options: options as unknown as Record<string, unknown> };
  }

  async scan(studentCredentialId: string, body: In<'me.scan'>['body']) {
    const kiosk = await this.kiosk(body.kioskId);
    const nonce = this.nonceBytes(body.nonce);
    const cred = await this.prisma.mobileCredential.findUniqueOrThrow({
      where: { id: studentCredentialId },
      include: { student: true },
    });
    if (body.kind === 'DEVICE_KEY') {
      let signature: Uint8Array;
      try {
        signature = b64urlDecode(body.signature);
      } catch {
        throw Errors.unprocessable('NOT_RECOGNISED', 'We could not verify this. Try again, or use your matricule.');
      }
      await this.identify.verifyDeviceKeyScan(kiosk.id, cred.id, nonce, body.ts, signature);
    } else {
      if (cred.kind !== 'PASSKEY')
        throw Errors.unprocessable('NOT_RECOGNISED', 'We could not verify this. Try again, or use your matricule.');
      await this.identify.verifyPasskeyScan(
        kiosk.id,
        cred,
        nonce,
        body.assertion as unknown as AuthenticationResponseJSON,
      );
    }
    const result = await this.identify.identified(kiosk.id, cred.student, 'SCAN', null);
    await this.realtime.toKiosk(kiosk.id, 'identified', result);
    return { status: 'IDENTIFIED' as const, kioskName: kiosk.name };
  }
}

@Controller()
export class KioskLendingController {
  constructor(
    private readonly identify: IdentifyService,
    private readonly lending: LendingService,
  ) {}

  @Contract('kiosk.identify')
  identifyStudent(@ContractInput() input: In<'kiosk.identify'>, @Req() req: LpRequest) {
    return this.identify.identify(req.kiosk!.id, input.body);
  }

  @Contract('kiosk.manualVerify')
  manualVerify(@ContractInput() input: In<'kiosk.manualVerify'>, @Req() req: LpRequest) {
    return this.identify.verifyManual(req.kiosk!.id, input.body);
  }

  @Contract('kiosk.manualOtp')
  manualOtp(@ContractInput() input: In<'kiosk.manualOtp'>, @Req() req: LpRequest) {
    return this.identify.sendManualOtp(req.kiosk!.id, input.body.lookupId, localeOf(req.headers['accept-language']));
  }

  @Contract('kiosk.signIn')
  signIn(@ContractInput() input: In<'kiosk.signIn'>, @Req() req: LpRequest) {
    return this.lending.signIn(req.kiosk!.id, input.body, idempotencyKeyOf(req));
  }

  @Contract('kiosk.signOut')
  signOut(@ContractInput() input: In<'kiosk.signOut'>, @Req() req: LpRequest) {
    return this.lending.signOut(req.kiosk!.id, input.body, idempotencyKeyOf(req));
  }
}

@Controller()
export class LoansController {
  constructor(private readonly lending: LendingService) {}

  @Contract('loans.list')
  list(@ContractInput() input: In<'loans.list'>) {
    return this.lending.list(input.query);
  }

  @Contract('loans.export')
  async export(@ContractInput() input: In<'loans.export'>, @Res({ passthrough: true }) reply: FastifyReply) {
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="labpass-loans-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
    return this.lending.exportCsv(input.query);
  }

  @Contract('loans.get')
  get(@ContractInput() input: In<'loans.get'>) {
    return this.lending.get(input.params.id);
  }

  @Contract('loans.forceReturn')
  forceReturn(@ContractInput() input: In<'loans.forceReturn'>, @Req() req: LpRequest) {
    return this.lending.forceReturn(input.params.id, input.body, req.admin!.id, idempotencyKeyOf(req));
  }
}

@Controller()
export class MeLendingController {
  constructor(
    private readonly lending: LendingService,
    private readonly scans: ScanService,
  ) {}

  @Contract('me.loans')
  loans(@Req() req: LpRequest) {
    return this.lending.myLoans(req.student!.studentId);
  }

  @Contract('me.scanOptions')
  scanOptions(@ContractInput() input: In<'me.scanOptions'>, @Req() req: LpRequest) {
    return this.scans.options(req.student!.credentialId, input.body.kioskId, input.body.nonce);
  }

  @Contract('me.scan')
  scan(@ContractInput() input: In<'me.scan'>, @Req() req: LpRequest) {
    return this.scans.scan(req.student!.credentialId, input.body);
  }
}

@Module({
  imports: [SettingsModule, KiosksModule, StudentsModule, InventoryModule],
  controllers: [KioskLendingController, LoansController, MeLendingController],
  providers: [IdentifyService, LendingService, ScanService],
  exports: [IdentifyService, LendingService],
})
export class LendingModule {}
