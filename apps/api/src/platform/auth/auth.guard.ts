import { roleSatisfies, routes, type RouteSpec } from '@labpass/contracts';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../../config/env';
import { sha256Hex, TokenSigner } from '../crypto/crypto';
import { routeIdOf } from '../http/contract';
import { Errors } from '../http/problem';
import type { LpRequest } from '../http/request';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_COOKIE, AdminSessionService } from './admin-session.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function bearer(req: LpRequest): string | undefined {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return undefined;
  const token = h.slice(7).trim();
  return token.length > 0 && token.length < 2048 ? token : undefined;
}

/** Global guard: authenticates according to the contract route's `auth` kind and enforces `minRole` (ARCH §7). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AdminSessionService,
    private readonly tokens: TokenSigner,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const id = routeIdOf(ctx);
    if (!id) return true;
    const spec = routes[id] as RouteSpec;
    const req = ctx.switchToHttp().getRequest<LpRequest>();

    switch (spec.auth) {
      case 'public':
        return true;
      case 'admin':
        return this.admin(req, spec);
      case 'kiosk':
        return this.kiosk(req);
      case 'student':
        return this.student(req);
    }
  }

  private async admin(req: LpRequest, spec: RouteSpec): Promise<boolean> {
    const sid = (req.cookies as Record<string, string | undefined> | undefined)?.[ADMIN_COOKIE];
    const session = await this.sessions.get(sid);
    if (!session || session.stage !== 'AUTH' || !sid) throw Errors.unauthenticated();
    // CSRF defence in depth (SameSite=Strict is the first layer): writes must come from an allowed origin.
    if (MUTATING.has(req.method) && !this.originAllowed(req.headers.origin)) {
      throw Errors.forbidden('ORIGIN_REJECTED', 'Request origin is not allowed.');
    }
    const user = await this.prisma.adminUser.findUnique({ where: { id: session.userId } });
    if (!user || !user.active) {
      await this.sessions.destroy(sid);
      throw Errors.unauthenticated();
    }
    if (!roleSatisfies(user.role, spec.minRole!)) {
      throw Errors.forbidden('ROLE_REQUIRED', `This action requires the ${spec.minRole} role.`, {
        requiredRole: spec.minRole,
      });
    }
    req.admin = { id: user.id, email: user.email, name: user.name, role: user.role, sessionId: sid };
    await this.sessions.touch(sid);
    return true;
  }

  originAllowed(origin: string | undefined): boolean {
    if (!origin) return false;
    return this.env.ADMIN_ORIGINS.includes(origin);
  }

  private async kiosk(req: LpRequest): Promise<boolean> {
    const token = bearer(req);
    if (!token) throw Errors.unauthenticated('Kiosk device token required.');
    const kiosk = await this.prisma.kiosk.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!kiosk || kiosk.status !== 'ACTIVE') throw Errors.unauthenticated('Unknown or revoked kiosk.');
    req.kiosk = { id: kiosk.id, name: kiosk.name };
    if (!kiosk.lastSeenAt || Date.now() - kiosk.lastSeenAt.getTime() > 30_000) {
      await this.prisma.kiosk.update({ where: { id: kiosk.id }, data: { lastSeenAt: new Date() } });
    }
    return true;
  }

  private async student(req: LpRequest): Promise<boolean> {
    const claims = this.tokens.verify<{ sub: string; cid: string; fam: string; iat?: number }>('sat', bearer(req));
    if (!claims) throw Errors.unauthenticated('Student access token missing or expired.');
    const cred = await this.prisma.mobileCredential.findUnique({
      where: { id: claims.cid },
      select: { status: true, studentId: true, student: { select: { status: true } } },
    });
    if (!cred || cred.status !== 'ACTIVE' || cred.studentId !== claims.sub) {
      throw Errors.unauthenticated('This LabPass credential is no longer active.');
    }
    if (cred.student.status === 'INACTIVE')
      throw Errors.forbidden('STUDENT_INACTIVE', 'Your student account is not active.');
    req.student = {
      studentId: claims.sub,
      credentialId: claims.cid,
      familyId: claims.fam,
      issuedAt: (claims.iat ?? 0) * 1000,
    };
    return true;
  }
}
