import { AuthSchemas } from '@labpass/contracts';
import { Controller, Inject, Injectable, Module, type OnModuleInit, Req, Res } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { API_ENV, type ApiEnv } from '../config/env';
import { NotificationService } from '../notifications/core/notification.service';
import { STUDENT_REFRESH_COOKIE, StudentTokensService } from '../platform/auth/student-tokens.service';
import { hashSecret } from '../platform/crypto/crypto';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { EventBus, OutboxService } from '../platform/outbox/outbox';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RealtimeService } from '../platform/realtime/realtime';
import { FileUrlService } from '../platform/storage/storage';
import { credentialDto, StudentsModule } from '../students/students.module';
import { localeOf } from '../students/otp.service';
import { EnrollmentService, type EnrollOutcome, type Tokens } from './enrollment.service';
import { PushService } from './push.service';

const PIN_REAUTH_MS = 5 * 60_000;

function refreshCookie(env: ApiEnv) {
  return {
    path: '/',
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    maxAge: 60 * 24 * 60 * 60,
  };
}

/** Web app: refresh token as an HttpOnly cookie. Android app: refresh token in the body (stored in the secure store). */
function deliver(tokens: Tokens, web: boolean, reply: FastifyReply, env: ApiEnv) {
  if (web) void reply.setCookie(STUDENT_REFRESH_COOKIE, tokens.refreshToken, refreshCookie(env));
  return {
    accessToken: tokens.accessToken,
    accessExpiresAt: tokens.accessExpiresAt.toISOString(),
    refreshToken: web ? null : tokens.refreshToken,
  };
}

function outcome(o: EnrollOutcome, web: boolean, reply: FastifyReply, env: ApiEnv) {
  return {
    status: o.status,
    credentialId: o.credentialId,
    pollToken: o.pollToken,
    tokens: o.tokens ? deliver(o.tokens, web, reply, env) : null,
  };
}

@Controller()
export class EnrollmentController {
  constructor(
    private readonly enrollment: EnrollmentService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Contract('enroll.start')
  start(@ContractInput() input: In<'enroll.start'>, @Req() req: LpRequest) {
    return this.enrollment.start(input.body, localeOf(req.headers['accept-language']));
  }

  @Contract('enroll.otp')
  otp(@ContractInput() input: In<'enroll.otp'>) {
    return this.enrollment.verifyOtp(input.body.sessionId, input.body.code);
  }

  @Contract('enroll.popNonce')
  popNonce(@ContractInput() input: In<'enroll.popNonce'>) {
    return this.enrollment.popNonce(input.body.sessionId);
  }

  @Contract('enroll.key')
  async key(@ContractInput() input: In<'enroll.key'>, @Res({ passthrough: true }) reply: FastifyReply) {
    return outcome(await this.enrollment.registerDeviceKey(input.body), false, reply, this.env);
  }

  @Contract('enroll.passkeyOptions')
  passkeyOptions(@ContractInput() input: In<'enroll.passkeyOptions'>) {
    return this.enrollment.passkeyOptions(input.body.sessionId);
  }

  @Contract('enroll.passkey')
  async passkey(@ContractInput() input: In<'enroll.passkey'>, @Res({ passthrough: true }) reply: FastifyReply) {
    return outcome(await this.enrollment.registerPasskey(input.body), true, reply, this.env);
  }

  @Contract('enroll.claim')
  async claim(@ContractInput() input: In<'enroll.claim'>, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.enrollment.claim(input.body.sessionId, input.body.pollToken);
    return { status: r.status, reason: r.reason, tokens: r.tokens ? deliver(r.tokens, r.web, reply, this.env) : null };
  }
}

@Controller()
export class StudentAuthController {
  constructor(
    private readonly tokens: StudentTokensService,
    private readonly enrollment: EnrollmentService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Contract('studentAuth.refresh')
  async refresh(
    @ContractInput() input: In<'studentAuth.refresh'>,
    @Req() req: LpRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const fromCookie = (req.cookies as Record<string, string | undefined>)[STUDENT_REFRESH_COOKIE];
    const token = input.body.refreshToken ?? fromCookie;
    if (!token) throw Errors.unauthenticated('Please sign in again.');
    return deliver(await this.tokens.rotate(token), !input.body.refreshToken, reply, this.env);
  }

  @Contract('studentAuth.passkeyOptions')
  passkeyOptions() {
    return this.enrollment.loginOptions();
  }

  @Contract('studentAuth.passkey')
  async passkey(@ContractInput() input: In<'studentAuth.passkey'>, @Res({ passthrough: true }) reply: FastifyReply) {
    return deliver(await this.enrollment.loginWithPasskey(input.body.assertion), true, reply, this.env);
  }

  @Contract('studentAuth.logout')
  async logout(@Req() req: LpRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.tokens.revokeFamily(req.student!.familyId);
    void reply.clearCookie(STUDENT_REFRESH_COOKIE, { path: '/' });
  }
}

@Controller()
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileUrlService,
    private readonly enrollment: EnrollmentService,
  ) {}

  @Contract('me.get')
  async me(@Req() req: LpRequest) {
    const s = await this.prisma.student.findUniqueOrThrow({ where: { id: req.student!.studentId } });
    const c = await this.prisma.mobileCredential.findUniqueOrThrow({ where: { id: req.student!.credentialId } });
    return {
      student: {
        id: s.id,
        matricule: s.matricule,
        firstName: s.firstName,
        lastName: s.lastName,
        program: s.program,
        level: s.level,
        photoUrl: this.files.url(s.photoKey),
      },
      credential: credentialDto(c),
      hasPin: Boolean(s.manualPinHash),
    };
  }

  @Contract('me.pin')
  async pin(@ContractInput() input: In<'me.pin'>, @Req() req: LpRequest) {
    if (Date.now() - req.student!.issuedAt > PIN_REAUTH_MS)
      throw Errors.unauthenticated('For security, confirm your identity again before setting a PIN.');
    await this.prisma.student.update({
      where: { id: req.student!.studentId },
      data: { manualPinHash: await hashSecret(input.body.pin), pinFailures: 0, pinLockedUntil: null },
    });
    return { ok: true as const };
  }

  @Contract('me.pushToken')
  async pushToken(@ContractInput() input: In<'me.pushToken'>, @Req() req: LpRequest) {
    const b = input.body;
    const token = b.kind === 'EXPO' ? b.token : JSON.stringify(b.subscription);
    await this.prisma.pushToken.upsert({
      where: { token },
      update: { studentId: req.student!.studentId, lastSeenAt: new Date() },
      create: { studentId: req.student!.studentId, kind: b.kind, token, platform: b.platform },
    });
    return { ok: true as const };
  }

  @Contract('me.revoke')
  async revoke(@Req() req: LpRequest) {
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM students WHERE id = ${req.student!.studentId}::uuid FOR UPDATE`;
      await this.enrollment.revokeActive(tx, req.student!.studentId, 'Revoked by the student (lost phone)');
    });
    return { ok: true as const };
  }
}

@Injectable()
export class CredentialRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollment: EnrollmentService,
    private readonly outbox: OutboxService,
  ) {}

  list(decision?: 'AUTO_APPROVED' | 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.query(decision ? { decision } : {});
  }

  private async query(where: Prisma.CredentialRequestWhereInput) {
    const rows = await this.prisma.credentialRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { credential: true, student: true },
    });
    const sessions = new Map(
      (
        await this.prisma.enrollmentSession.findMany({ where: { id: { in: rows.map((r) => r.enrollmentSessionId) } } })
      ).map((s) => [s.id, s]),
    );
    const reviewers = new Map(
      (
        await this.prisma.adminUser.findMany({
          where: { id: { in: rows.map((r) => r.reviewerId).filter((x): x is string => Boolean(x)) } },
        })
      ).map((u) => [u.id, u.name]),
    );
    return rows.map((r) => {
      const sub = (sessions.get(r.enrollmentSessionId)?.submitted ?? {}) as {
        matricule?: string;
        firstName?: string;
        lastName?: string;
        dateOfBirth?: string;
      };
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decision: r.decision,
        submitted: {
          matricule: sub.matricule ?? '',
          firstName: sub.firstName ?? '',
          lastName: sub.lastName ?? '',
          dateOfBirth: sub.dateOfBirth ?? '1900-01-01',
        },
        matchResult: r.matchResult as {
          matricule: boolean;
          firstName: boolean;
          lastName: boolean;
          dateOfBirth: boolean;
          hasContact: boolean;
          studentActive: boolean;
        },
        student: r.student
          ? {
              id: r.student.id,
              matricule: r.student.matricule,
              firstName: r.student.firstName,
              lastName: r.student.lastName,
            }
          : null,
        credential: { kind: r.credential.kind, platform: r.credential.platform, deviceLabel: r.credential.deviceLabel },
        reviewerName: r.reviewerId ? (reviewers.get(r.reviewerId) ?? null) : null,
        reason: r.reason,
      };
    });
  }

  private async one(id: string) {
    const [row] = await this.query({ id });
    if (!row) throw Errors.notFound('Request');
    return row;
  }

  async decide(id: string, adminId: string, approve: boolean, opts: { verifiedInPerson?: boolean; reason?: string }) {
    const r = await this.prisma.credentialRequest.findUnique({ where: { id }, include: { credential: true } });
    if (!r) throw Errors.notFound('Request');
    if (r.decision !== 'PENDING') throw Errors.conflict('ALREADY_DECIDED', 'This request was already decided.');
    const m = r.matchResult as Record<string, boolean>;
    const allMatch = m.firstName && m.lastName && m.dateOfBirth && m.studentActive;
    if (approve && !allMatch && !opts.verifiedInPerson) {
      throw Errors.badRequest(
        'IN_PERSON_REQUIRED',
        'The details do not match school records. Confirm you verified the student in person.',
      );
    }
    await this.prisma.tx(async (tx) => {
      const locked = await tx.credentialRequest.updateMany({
        where: { id, decision: 'PENDING' },
        data: {
          decision: approve ? 'APPROVED' : 'REJECTED',
          reviewerId: adminId,
          verifiedInPerson: Boolean(opts.verifiedInPerson),
          reason: opts.reason ?? null,
          decidedAt: new Date(),
        },
      });
      if (locked.count === 0) throw Errors.conflict('ALREADY_DECIDED', 'This request was already decided.');
      if (approve) {
        await tx.$queryRaw`SELECT id FROM students WHERE id = ${r.credential.studentId}::uuid FOR UPDATE`;
        await this.enrollment.revokeActive(tx, r.credential.studentId, 'Replaced by a new device');
        await tx.mobileCredential.update({
          where: { id: r.credentialId },
          data: { status: 'ACTIVE', activatedAt: new Date(), tokenFamilyId: randomUUID() },
        });
      } else {
        await tx.mobileCredential.update({
          where: { id: r.credentialId },
          data: { status: 'REJECTED', revokedReason: opts.reason ?? null },
        });
      }
      await this.outbox.add(tx, 'CredentialDecided', {
        id,
        studentId: r.credential.studentId,
        credentialId: r.credentialId,
        decision: approve ? 'APPROVED' : 'REJECTED',
        reason: opts.reason ?? null,
      });
    });
    return this.one(id);
  }
}

@Controller()
export class CredentialRequestsController {
  constructor(
    private readonly requests: CredentialRequestsService,
    private readonly prisma: PrismaService,
    private readonly enrollment: EnrollmentService,
  ) {}

  @Contract('credentialRequests.list')
  list(@ContractInput() input: In<'credentialRequests.list'>) {
    return this.requests.list(input.query.decision);
  }

  @Contract('credentialRequests.approve')
  approve(@ContractInput() input: In<'credentialRequests.approve'>, @Req() req: LpRequest) {
    return this.requests.decide(input.params.id, req.admin!.id, true, {
      verifiedInPerson: input.body.verifiedInPerson,
    });
  }

  @Contract('credentialRequests.reject')
  reject(@ContractInput() input: In<'credentialRequests.reject'>, @Req() req: LpRequest) {
    return this.requests.decide(input.params.id, req.admin!.id, false, { reason: input.body.reason });
  }

  @Contract('credentials.revoke')
  async revoke(@ContractInput() input: In<'credentials.revoke'>) {
    const c = await this.prisma.mobileCredential.findUnique({ where: { id: input.params.id } });
    if (!c) throw Errors.notFound('Credential');
    if (c.status === 'ACTIVE') {
      await this.prisma.tx(async (tx) => {
        await tx.$queryRaw`SELECT id FROM students WHERE id = ${c.studentId}::uuid FOR UPDATE`;
        await this.enrollment.revokeActive(tx, c.studentId, input.body.reason);
      });
    }
    return { ok: true as const };
  }
}

/** Reacts to credential events: realtime updates (best-effort) and notifications (durable, exactly once). */
@Injectable()
export class CredentialEvents implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.bus.onDirect(['CredentialRequested'], async (e) => {
      const p = e.payload as { id: string; decision: 'AUTO_APPROVED' | 'PENDING' };
      await this.realtime.toAdmins('credentialRequest.created', { id: p.id, decision: p.decision });
    });
    this.bus.onDirect(['CredentialRevoked'], async (e) => {
      await this.realtime.toKiosk(null, 'credential.revoked', {
        credentialId: (e.payload as { credentialId: string }).credentialId,
      });
    });
    this.bus.register('credential-notifications', ['CredentialRequested', 'CredentialDecided'], async (e) => {
      if (e.type === 'CredentialDecided') {
        const p = e.payload as { studentId: string; decision: 'APPROVED' | 'REJECTED'; reason: string | null };
        await this.push.toStudent(
          p.studentId,
          p.decision === 'APPROVED' ? 'credential_approved' : 'credential_rejected',
          'en',
          { reason: p.reason ?? '' },
        );
        return;
      }
      const p = e.payload as { decision: string; matricule?: string };
      if (p.decision !== 'PENDING') return;
      const admins = await this.prisma.adminUser.findMany({
        where: { active: true, role: { in: ['LAB_ADMIN', 'SUPER_ADMIN'] } },
      });
      for (const a of admins) {
        const prefs = AuthSchemas.NotificationPrefs.parse(a.notificationPrefs ?? {});
        if (!prefs.credentialRequests || !prefs.email) continue;
        await this.notifications
          .sendNow('EMAIL', {
            to: a.email,
            template: 'credential_pending',
            locale: prefs.locale,
            data: { matricule: p.matricule ?? '' },
          })
          .catch(() => undefined);
      }
    });
  }
}

@Module({
  imports: [StudentsModule],
  controllers: [EnrollmentController, StudentAuthController, MeController, CredentialRequestsController],
  providers: [EnrollmentService, PushService, CredentialRequestsService, CredentialEvents],
  exports: [EnrollmentService, PushService],
})
export class CredentialsModule {}
