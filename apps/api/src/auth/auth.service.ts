import { Inject, Injectable } from '@nestjs/common';
import type { AdminUser } from '@prisma/client';
import { authenticator } from 'otplib';

// RFC 6238: accept the previous/next 30 s step to absorb phone clock drift; codes stay single-use (totp-used key).
authenticator.options = { window: 1 };
import { API_ENV, type ApiEnv } from '../config/env';
import { AdminSessionService } from '../platform/auth/admin-session.service';
import { SecretBox, verifySecret } from '../platform/crypto/crypto';
import { AppError, Errors } from '../platform/http/problem';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RedisService } from '../platform/redis/redis.service';

authenticator.options = { window: 1 };

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
/** Roles that must use TOTP (ARCH §7). Others may opt in. */
const TOTP_REQUIRED_ROLES = new Set(['SUPER_ADMIN', 'LAB_ADMIN']);

export type LoginResult =
  | { status: 'AUTHENTICATED'; user: AdminUser; sid: string }
  | { status: 'TOTP_REQUIRED'; sid: string }
  | { status: 'TOTP_SETUP_REQUIRED'; sid: string; otpauthUrl: string; secret: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AdminSessionService,
    private readonly box: SecretBox,
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private async recordFailure(user: AdminUser) {
    const failures = user.failedLogins + 1;
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data:
        failures >= MAX_FAILURES
          ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
          : { failedLogins: failures },
    });
  }

  private assertNotLocked(user: AdminUser | null) {
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw Errors.locked(
        'Too many failed attempts. Try again later.',
        Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
      );
    }
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
    this.assertNotLocked(user);
    const ok = await verifySecret(user?.passwordHash, password);
    if (!user || !ok || !user.active) {
      if (user) await this.recordFailure(user);
      throw Errors.unauthenticated('Email or password is incorrect.');
    }
    if (user.failedLogins > 0)
      await this.prisma.adminUser.update({ where: { id: user.id }, data: { failedLogins: 0 } });

    if (!user.totpEnabled && !TOTP_REQUIRED_ROLES.has(user.role)) {
      const sid = await this.sessions.create({ userId: user.id, stage: 'AUTH' });
      const updated = await this.prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      return { status: 'AUTHENTICATED', user: updated, sid };
    }
    if (user.totpEnabled) {
      return { status: 'TOTP_REQUIRED', sid: await this.sessions.create({ userId: user.id, stage: 'PENDING_TOTP' }) };
    }
    const secret = authenticator.generateSecret();
    const sid = await this.sessions.create({
      userId: user.id,
      stage: 'PENDING_TOTP',
      pendingTotpSecret: this.box.seal(secret),
    });
    return {
      status: 'TOTP_SETUP_REQUIRED',
      sid,
      secret,
      otpauthUrl: authenticator.keyuri(user.email, 'ICTU LabPass', secret),
    };
  }

  async verifyTotp(sid: string | undefined, code: string): Promise<{ user: AdminUser; sid: string }> {
    const session = await this.sessions.get(sid);
    if (!sid || !session || session.stage !== 'PENDING_TOTP')
      throw Errors.unauthenticated('Sign in with your password first.');
    const user = await this.prisma.adminUser.findUnique({ where: { id: session.userId } });
    if (!user || !user.active) throw Errors.unauthenticated();
    this.assertNotLocked(user);
    const sealed = session.pendingTotpSecret ?? user.totpSecretEnc;
    if (!sealed) throw Errors.unauthenticated('Sign in with your password first.');
    const secret = this.box.open(sealed);
    // A code can be used once (replay protection within its validity window).
    const fresh = await this.redis.client.set(`totp-used:${user.id}:${code}`, '1', 'EX', 120, 'NX');
    if (!fresh || !authenticator.check(code, secret)) {
      await this.recordFailure(user);
      throw new AppError(401, 'INVALID_CODE', 'Not signed in', 'The code is incorrect or has already been used.');
    }
    const updated = await this.prisma.adminUser.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        failedLogins: 0,
        ...(session.pendingTotpSecret ? { totpSecretEnc: session.pendingTotpSecret, totpEnabled: true } : {}),
      },
    });
    const newSid = await this.sessions.rotate(sid, { userId: user.id, stage: 'AUTH' });
    return { user: updated, sid: newSid };
  }

  async changePassword(userId: string, current: string, next: string, hash: (s: string) => Promise<string>) {
    const user = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifySecret(user.passwordHash, current)))
      throw Errors.forbidden('INVALID_PASSWORD', 'Current password is incorrect.');
    await this.prisma.adminUser.update({ where: { id: userId }, data: { passwordHash: await hash(next) } });
    await this.sessions.destroyAllForUser(userId);
  }

  /** Test helper only: current TOTP code for a secret. */
  static generateCode(secret: string) {
    return authenticator.generate(secret);
  }

  get cookieSecure() {
    return this.env.COOKIE_SECURE;
  }
}
