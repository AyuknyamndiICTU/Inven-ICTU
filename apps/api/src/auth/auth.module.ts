import { AuthSchemas } from '@labpass/contracts';
import { Controller, Inject, Injectable, Module, Req, Res } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { API_ENV, type ApiEnv } from '../config/env';
import { NotificationService } from '../notifications/core/notification.service';
import { ADMIN_COOKIE, AdminSessionService } from '../platform/auth/admin-session.service';
import { codeHash, hashSecret, randomOtp, safeEqual } from '../platform/crypto/crypto';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RedisService } from '../platform/redis/redis.service';
import { toAdminUserDto } from './admin-user.dto';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: AdminSessionService,
    private readonly prisma: PrismaService,
  ) {}

  @Contract('auth.login')
  async login(@ContractInput() input: In<'auth.login'>, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.auth.login(input.body.email, input.body.password);
    void reply.setCookie(ADMIN_COOKIE, r.sid, this.sessions.cookieOptions());
    if (r.status === 'AUTHENTICATED') return { status: r.status, user: toAdminUserDto(r.user) };
    if (r.status === 'TOTP_REQUIRED') return { status: r.status };
    return { status: r.status, otpauthUrl: r.otpauthUrl, secret: r.secret };
  }

  @Contract('auth.totp')
  async totp(
    @ContractInput() input: In<'auth.totp'>,
    @Req() req: LpRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const sid = (req.cookies as Record<string, string | undefined>)[ADMIN_COOKIE];
    const r = await this.auth.verifyTotp(sid, input.body.code);
    void reply.setCookie(ADMIN_COOKIE, r.sid, this.sessions.cookieOptions());
    return { status: 'AUTHENTICATED' as const, user: toAdminUserDto(r.user) };
  }

  @Contract('auth.logout')
  async logout(@Req() req: LpRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.destroy(req.admin!.sessionId);
    void reply.clearCookie(ADMIN_COOKIE, { path: '/' });
  }

  @Contract('auth.me')
  async me(@Req() req: LpRequest) {
    return toAdminUserDto(await this.prisma.adminUser.findUniqueOrThrow({ where: { id: req.admin!.id } }));
  }

  @Contract('auth.changePassword')
  async changePassword(@ContractInput() input: In<'auth.changePassword'>, @Req() req: LpRequest) {
    await this.auth.changePassword(req.admin!.id, input.body.currentPassword, input.body.newPassword, hashSecret);
    return { ok: true as const };
  }
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AdminSessionService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async startPhoneVerification(userId: string, channel: 'SMS' | 'WHATSAPP', phone: string, locale: 'en' | 'fr') {
    const parsed = parsePhoneNumberFromString(phone, 'CM');
    if (!parsed?.isValid())
      throw Errors.badRequest('INVALID_PHONE', 'Enter a valid phone number, e.g. +237 6XX XX XX XX.');
    const e164 = parsed.number;
    const code = randomOtp();
    const key = `pv:${userId}:${channel}`;
    await this.redis.client.set(
      key,
      JSON.stringify({ phone: e164, hash: codeHash(this.env.APP_SECRET, 'pv', userId, code), attempts: 0 }),
      'EX',
      600,
    );
    await this.notifications.sendNow(channel, { to: e164, template: 'otp', locale, data: { code } });
    return { destination: e164.slice(0, 5) + '*'.repeat(Math.max(0, e164.length - 7)) + e164.slice(-2) };
  }

  async confirmPhoneVerification(userId: string, channel: 'SMS' | 'WHATSAPP', code: string) {
    const key = `pv:${userId}:${channel}`;
    const raw = await this.redis.client.get(key);
    if (!raw) throw Errors.badRequest('CODE_EXPIRED', 'The code has expired. Request a new one.');
    const state = JSON.parse(raw) as { phone: string; hash: string; attempts: number };
    if (state.attempts >= 5) {
      await this.redis.client.del(key);
      throw Errors.badRequest('CODE_EXPIRED', 'Too many attempts. Request a new code.');
    }
    if (!safeEqual(state.hash, codeHash(this.env.APP_SECRET, 'pv', userId, code))) {
      await this.redis.client.set(key, JSON.stringify({ ...state, attempts: state.attempts + 1 }), 'KEEPTTL');
      throw Errors.badRequest('INVALID_CODE', 'The code is incorrect.');
    }
    await this.redis.client.del(key);
    return this.prisma.adminUser.update({
      where: { id: userId },
      data:
        channel === 'SMS'
          ? { phoneE164: state.phone, phoneVerifiedAt: new Date() }
          : { whatsappE164: state.phone, whatsappVerifiedAt: new Date() },
    });
  }

  async revokeSessions(userId: string) {
    await this.sessions.destroyAllForUser(userId);
  }
}

@Controller()
export class AdminUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: AdminUsersService,
  ) {}

  @Contract('adminUsers.list')
  async list() {
    return (await this.prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } })).map(toAdminUserDto);
  }

  @Contract('adminUsers.create')
  async create(@ContractInput() input: In<'adminUsers.create'>) {
    const email = input.body.email.toLowerCase();
    if (await this.prisma.adminUser.findUnique({ where: { email } }))
      throw Errors.conflict('EMAIL_TAKEN', 'An admin with this email already exists.');
    const user = await this.prisma.adminUser.create({
      data: {
        email,
        name: input.body.name,
        role: input.body.role,
        passwordHash: await hashSecret(input.body.password),
      },
    });
    return toAdminUserDto(user);
  }

  @Contract('adminUsers.update')
  async update(@ContractInput() input: In<'adminUsers.update'>, @Req() req: LpRequest) {
    const { password, ...rest } = input.body;
    if (input.params.id === req.admin!.id && (rest.role !== undefined || rest.active === false)) {
      throw Errors.badRequest('CANNOT_CHANGE_SELF', 'You cannot change your own role or deactivate yourself.');
    }
    const data: Prisma.AdminUserUpdateInput = { ...rest };
    if (password) data.passwordHash = await hashSecret(password);
    const user = await this.prisma.adminUser.update({ where: { id: input.params.id }, data });
    if (password || rest.active === false || rest.role !== undefined) await this.users.revokeSessions(user.id);
    return toAdminUserDto(user);
  }

  @Contract('adminUsers.resetTotp')
  async resetTotp(@ContractInput() input: In<'adminUsers.resetTotp'>) {
    await this.prisma.adminUser.update({
      where: { id: input.params.id },
      data: { totpEnabled: false, totpSecretEnc: null },
    });
    await this.users.revokeSessions(input.params.id);
    return { ok: true as const };
  }

  @Contract('adminUsers.prefs')
  async prefs(@ContractInput() input: In<'adminUsers.prefs'>, @Req() req: LpRequest) {
    const prefs = AuthSchemas.NotificationPrefs.parse(input.body);
    const me = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: req.admin!.id } });
    if (prefs.sms && !me.phoneVerifiedAt)
      throw Errors.badRequest('PHONE_NOT_VERIFIED', 'Verify your phone number before enabling SMS alerts.');
    if (prefs.whatsapp && !me.whatsappVerifiedAt)
      throw Errors.badRequest('PHONE_NOT_VERIFIED', 'Verify your WhatsApp number before enabling WhatsApp alerts.');
    return toAdminUserDto(
      await this.prisma.adminUser.update({ where: { id: req.admin!.id }, data: { notificationPrefs: prefs } }),
    );
  }

  @Contract('adminUsers.verifyPhoneStart')
  async verifyPhoneStart(@ContractInput() input: In<'adminUsers.verifyPhoneStart'>, @Req() req: LpRequest) {
    const me = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: req.admin!.id } });
    const locale = AuthSchemas.NotificationPrefs.parse(me.notificationPrefs ?? {}).locale;
    return this.users.startPhoneVerification(me.id, input.body.channel, input.body.phone, locale);
  }

  @Contract('adminUsers.verifyPhoneConfirm')
  async verifyPhoneConfirm(@ContractInput() input: In<'adminUsers.verifyPhoneConfirm'>, @Req() req: LpRequest) {
    return toAdminUserDto(
      await this.users.confirmPhoneVerification(req.admin!.id, input.body.channel, input.body.code),
    );
  }

  @Contract('adminUsers.assistantPin')
  async assistantPin(@ContractInput() input: In<'adminUsers.assistantPin'>, @Req() req: LpRequest) {
    await this.prisma.adminUser.update({
      where: { id: req.admin!.id },
      data: { assistantPinHash: await hashSecret(input.body.pin) },
    });
    return { ok: true as const };
  }
}

@Module({
  controllers: [AuthController, AdminUsersController],
  providers: [AuthService, AdminUsersService],
  exports: [AuthService],
})
export class AuthModule {}
