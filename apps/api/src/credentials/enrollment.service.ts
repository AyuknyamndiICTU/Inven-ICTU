import { b64urlDecode, b64urlEncode, uuidToBytes } from '@labpass/contracts/tap';
import { isP256Spki, verifyPopSignature } from '@labpass/contracts/tap-node';
import { Inject, Injectable } from '@nestjs/common';
import type { EnrollmentSession, Prisma } from '@prisma/client';
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { randomBytes, randomUUID } from 'node:crypto';
import { API_ENV, type ApiEnv } from '../config/env';
import { normalizeName } from '../directory/parse';
import { StudentTokensService } from '../platform/auth/student-tokens.service';
import { randomToken, sha256Hex, safeEqual } from '../platform/crypto/crypto';
import { Errors } from '../platform/http/problem';
import { OutboxService } from '../platform/outbox/outbox';
import { PrismaService, type Tx } from '../platform/prisma/prisma.service';
import { RedisService } from '../platform/redis/redis.service';
import { OtpService } from '../students/otp.service';
import { coseEc2ToSpki } from './cose';

const SESSION_TTL_MS = 15 * 60_000;
const MAX_OTP_ATTEMPTS = 5;
const ES256 = -7;

type NewCredential = {
  kind: 'DEVICE_KEY' | 'PASSKEY';
  platform: 'ANDROID_APP' | 'WEB';
  publicKeySpki: Uint8Array;
  capabilities: { hce: boolean; scan: boolean };
  deviceLabel?: string;
  attestation?: string[];
  webauthnCredentialId?: string;
  cosePublicKey?: Uint8Array;
  signCount?: number;
  backupEligible?: boolean;
  backedUp?: boolean;
  transports?: string[];
};

export type Tokens = { accessToken: string; accessExpiresAt: Date; refreshToken: string };
export type EnrollOutcome = {
  status: 'ACTIVE' | 'PENDING';
  credentialId: string;
  pollToken: string | null;
  tokens: Tokens | null;
};

/** Mobile enrollment and auto-approval (ARCH §5 F7). */
@Injectable()
export class EnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: StudentTokensService,
    private readonly outbox: OutboxService,
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async start(
    body: { matricule: string; firstName: string; lastName: string; dateOfBirth: string; platform: string },
    locale: 'en' | 'fr',
  ) {
    const matricule = body.matricule.trim().toUpperCase();
    const student = await this.prisma.student.findUnique({ where: { matricule } });
    if (!student)
      throw Errors.unprocessable(
        'UNKNOWN_MATRICULE',
        'We could not find this matricule. Check it, or see a lab assistant.',
      );
    const match = {
      matricule: true,
      firstName: normalizeName(student.firstName) === normalizeName(body.firstName),
      lastName: normalizeName(student.lastName) === normalizeName(body.lastName),
      dateOfBirth: student.dateOfBirth.toISOString().slice(0, 10) === body.dateOfBirth,
      hasContact: Boolean(student.email || student.phone),
      studentActive: student.status === 'ACTIVE',
    };
    const allMatch = match.firstName && match.lastName && match.dateOfBirth && match.studentActive;
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const session = await this.prisma.enrollmentSession.create({
      data: { matricule, studentId: student.id, submitted: body, matchResult: match, allMatch, expiresAt },
    });
    if (allMatch && match.hasContact) {
      const sent = await this.otp.send('enroll', session.id, student, locale);
      if (sent) {
        await this.prisma.enrollmentSession.update({
          where: { id: session.id },
          data: {
            otpHash: sent.hash,
            otpChannel: sent.channel,
            otpDestinationMasked: sent.destination,
            otpSentAt: new Date(),
            status: 'OTP_SENT',
          },
        });
        return {
          sessionId: session.id,
          next: 'OTP' as const,
          otp: { channel: sent.channel, destination: sent.destination },
          expiresAt: expiresAt.toISOString(),
        };
      }
    }
    await this.prisma.enrollmentSession.update({ where: { id: session.id }, data: { status: 'REVIEW' } });
    return { sessionId: session.id, next: 'CREDENTIAL' as const, otp: null, expiresAt: expiresAt.toISOString() };
  }

  private async live(sessionId: string): Promise<EnrollmentSession> {
    const s = await this.prisma.enrollmentSession.findUnique({ where: { id: sessionId } });
    if (!s) throw Errors.notFound('Enrollment');
    if (s.expiresAt < new Date())
      throw Errors.badRequest('ENROLLMENT_EXPIRED', 'This enrollment has expired. Start again.');
    if (s.status === 'COMPLETED') throw Errors.conflict('ENROLLMENT_USED', 'This enrollment was already completed.');
    return s;
  }

  async verifyOtp(sessionId: string, code: string) {
    const s = await this.live(sessionId);
    if (s.status !== 'OTP_SENT') throw Errors.badRequest('NO_CODE_PENDING', 'No code is waiting for this enrollment.');
    if (s.otpAttempts >= MAX_OTP_ATTEMPTS) throw Errors.badRequest('CODE_EXPIRED', 'Too many attempts. Start again.');
    if (!this.otp.matches(s.otpHash, 'enroll', s.id, code)) {
      await this.prisma.enrollmentSession.update({ where: { id: s.id }, data: { otpAttempts: { increment: 1 } } });
      throw Errors.badRequest('INVALID_CODE', 'The code is incorrect.');
    }
    const popNonce = b64urlEncode(randomBytes(32));
    // OTP state is invalidated after use.
    await this.prisma.enrollmentSession.update({
      where: { id: s.id },
      data: { otpHash: null, otpVerifiedAt: new Date(), popNonce, status: 'OTP_VERIFIED' },
    });
    return { popNonce };
  }

  /** Review enrollments (details mismatch or no contact on record) get a proof-of-possession nonce without an OTP. */
  async popNonce(sessionId: string) {
    const s = await this.live(sessionId);
    if (s.status === 'OTP_VERIFIED' && s.popNonce) return { popNonce: s.popNonce };
    if (s.status !== 'REVIEW') throw Errors.badRequest('OTP_REQUIRED', 'Verify the code sent to you first.');
    const popNonce = s.popNonce ?? b64urlEncode(randomBytes(32));
    if (!s.popNonce) await this.prisma.enrollmentSession.update({ where: { id: s.id }, data: { popNonce } });
    return { popNonce };
  }

  private async ready(sessionId: string) {
    const s = await this.live(sessionId);
    if (!s.popNonce || (s.status !== 'OTP_VERIFIED' && s.status !== 'REVIEW')) {
      throw Errors.badRequest('POP_NONCE_REQUIRED', 'Request a proof-of-possession nonce first.');
    }
    return s;
  }

  async registerDeviceKey(body: {
    sessionId: string;
    spki: string;
    popSignature: string;
    deviceLabel?: string;
    capabilities: { hce: boolean; scan: boolean };
    attestation?: string[];
  }) {
    const s = await this.ready(body.sessionId);
    const spki = b64urlDecode(body.spki);
    if (!isP256Spki(spki)) throw Errors.badRequest('INVALID_KEY', 'The device key must be an ECDSA P-256 public key.');
    if (!verifyPopSignature(spki, s.id, b64urlDecode(s.popNonce!), b64urlDecode(body.popSignature))) {
      throw Errors.badRequest('INVALID_PROOF', 'The device could not prove it holds the key.');
    }
    return this.finalize(s, {
      kind: 'DEVICE_KEY',
      platform: 'ANDROID_APP',
      publicKeySpki: spki,
      capabilities: body.capabilities,
      deviceLabel: body.deviceLabel,
      attestation: body.attestation,
    });
  }

  async passkeyOptions(sessionId: string) {
    const s = await this.ready(sessionId);
    const options = await generateRegistrationOptions({
      rpName: this.env.WEBAUTHN_RP_NAME,
      rpID: this.env.WEBAUTHN_RP_ID,
      userName: s.matricule,
      userDisplayName: s.matricule,
      userID: uuidToBytes(s.studentId!) as Uint8Array<ArrayBuffer>,
      challenge: b64urlDecode(s.popNonce!) as Uint8Array<ArrayBuffer>,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      supportedAlgorithmIDs: [ES256],
      timeout: 120_000,
    });
    return { options: options as unknown as Record<string, unknown> };
  }

  async registerPasskey(body: { sessionId: string; registration: Record<string, unknown>; deviceLabel?: string }) {
    const s = await this.ready(body.sessionId);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.registration as unknown as RegistrationResponseJSON,
        expectedChallenge: s.popNonce!,
        expectedOrigin: this.env.STUDENT_ORIGINS,
        expectedRPID: this.env.WEBAUTHN_RP_ID,
        requireUserVerification: true,
        supportedAlgorithmIDs: [ES256],
      });
    } catch {
      throw Errors.badRequest('INVALID_PASSKEY', 'The passkey could not be verified.');
    }
    if (!verification.verified || !verification.registrationInfo)
      throw Errors.badRequest('INVALID_PASSKEY', 'The passkey could not be verified.');
    const info = verification.registrationInfo;
    const spki = coseEc2ToSpki(info.credential.publicKey);
    if (!spki) throw Errors.badRequest('INVALID_PASSKEY', 'Only ES256 (P-256) passkeys are supported.');
    return this.finalize(s, {
      kind: 'PASSKEY',
      platform: 'WEB',
      publicKeySpki: spki,
      capabilities: { hce: false, scan: true },
      deviceLabel: body.deviceLabel,
      webauthnCredentialId: info.credential.id,
      cosePublicKey: info.credential.publicKey,
      signCount: info.credential.counter,
      backupEligible: info.credentialDeviceType === 'multiDevice',
      backedUp: info.credentialBackedUp,
      transports: info.credential.transports ?? [],
    });
  }

  /** Revokes a student's ACTIVE credentials (and their refresh tokens) under the caller's row lock. */
  async revokeActive(tx: Tx, studentId: string, reason: string) {
    const old = await tx.mobileCredential.findMany({ where: { studentId, status: 'ACTIVE' }, select: { id: true } });
    if (!old.length) return [];
    const ids = old.map((o) => o.id);
    await tx.mobileCredential.updateMany({
      where: { id: { in: ids } },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason },
    });
    await tx.studentRefreshToken.updateMany({
      where: { credentialId: { in: ids }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    for (const id of ids) await this.outbox.add(tx, 'CredentialRevoked', { credentialId: id, studentId, reason });
    return ids;
  }

  private async finalize(s: EnrollmentSession, cred: NewCredential): Promise<EnrollOutcome> {
    const autoApprove = s.status === 'OTP_VERIFIED' && s.allMatch && Boolean(s.otpVerifiedAt);
    const studentId = s.studentId!;
    return this.prisma.tx(async (tx) => {
      // Single use: only one credential can complete a session, even under concurrent requests.
      const claimed = await tx.enrollmentSession.updateMany({
        where: { id: s.id, status: s.status, credentialId: null },
        data: { status: 'COMPLETED' },
      });
      if (claimed.count === 0) throw Errors.conflict('ENROLLMENT_USED', 'This enrollment was already completed.');
      if (
        cred.webauthnCredentialId &&
        (await tx.mobileCredential.count({ where: { webauthnCredentialId: cred.webauthnCredentialId } }))
      ) {
        throw Errors.conflict('PASSKEY_EXISTS', 'This passkey is already registered.');
      }
      await tx.$queryRaw`SELECT id FROM students WHERE id = ${studentId}::uuid FOR UPDATE`;
      const data = {
        studentId,
        kind: cred.kind,
        platform: cred.platform,
        capabilities: cred.capabilities,
        deviceLabel: cred.deviceLabel ?? null,
        publicKeySpki: Buffer.from(cred.publicKeySpki),
        attestation: (cred.attestation ?? undefined) as Prisma.InputJsonValue | undefined,
        webauthnCredentialId: cred.webauthnCredentialId ?? null,
        cosePublicKey: cred.cosePublicKey ? Buffer.from(cred.cosePublicKey) : null,
        signCount: cred.signCount ?? 0,
        backupEligible: cred.backupEligible ?? null,
        backedUp: cred.backedUp ?? null,
        transports: cred.transports ?? [],
      };
      if (autoApprove) {
        await this.revokeActive(tx, studentId, 'Replaced by a new device');
        const familyId = randomUUID();
        const created = await tx.mobileCredential.create({
          data: { ...data, status: 'ACTIVE', activatedAt: new Date(), tokenFamilyId: familyId },
        });
        const request = await tx.credentialRequest.create({
          data: {
            enrollmentSessionId: s.id,
            credentialId: created.id,
            studentId,
            decision: 'AUTO_APPROVED',
            matchResult: s.matchResult as Prisma.InputJsonValue,
            decidedAt: new Date(),
          },
        });
        await tx.enrollmentSession.update({ where: { id: s.id }, data: { credentialId: created.id } });
        await this.outbox.add(tx, 'CredentialRequested', { id: request.id, decision: 'AUTO_APPROVED', studentId });
        const tokens = await this.tokens.issue(studentId, created.id, familyId, tx);
        return { status: 'ACTIVE', credentialId: created.id, pollToken: null, tokens };
      }
      const created = await tx.mobileCredential.create({ data: { ...data, status: 'PENDING' } });
      const request = await tx.credentialRequest.create({
        data: {
          enrollmentSessionId: s.id,
          credentialId: created.id,
          studentId,
          decision: 'PENDING',
          matchResult: s.matchResult as Prisma.InputJsonValue,
        },
      });
      const pollToken = randomToken(24);
      await tx.enrollmentSession.update({
        where: { id: s.id },
        data: { credentialId: created.id, pollTokenHash: sha256Hex(pollToken) },
      });
      await this.outbox.add(tx, 'CredentialRequested', {
        id: request.id,
        decision: 'PENDING',
        studentId,
        matricule: s.matricule,
      });
      return { status: 'PENDING', credentialId: created.id, pollToken, tokens: null };
    });
  }

  /** The app polls a PENDING enrollment; tokens are released once, after approval. */
  async claim(
    sessionId: string,
    pollToken: string,
  ): Promise<{
    status: 'PENDING' | 'ACTIVE' | 'REJECTED';
    reason: string | null;
    tokens: Tokens | null;
    web: boolean;
  }> {
    const s = await this.prisma.enrollmentSession.findUnique({ where: { id: sessionId } });
    if (!s?.pollTokenHash || !s.credentialId || !safeEqual(s.pollTokenHash, sha256Hex(pollToken)))
      throw Errors.notFound('Enrollment');
    const cred = await this.prisma.mobileCredential.findUniqueOrThrow({
      where: { id: s.credentialId },
      include: { request: true },
    });
    const web = cred.platform === 'WEB';
    if (cred.status === 'PENDING') return { status: 'PENDING', reason: null, tokens: null, web };
    if (cred.status !== 'ACTIVE')
      return { status: 'REJECTED', reason: cred.request?.reason ?? cred.revokedReason ?? null, tokens: null, web };
    const cleared = await this.prisma.enrollmentSession.updateMany({
      where: { id: s.id, pollTokenHash: s.pollTokenHash },
      data: { pollTokenHash: null },
    });
    if (cleared.count === 0) throw Errors.notFound('Enrollment');
    const tokens = await this.tokens.issue(cred.studentId, cred.id, cred.tokenFamilyId ?? randomUUID());
    return { status: 'ACTIVE', reason: null, tokens, web };
  }

  // ───────────── Passkey sign-in (web app lost its tokens) ─────────────

  async loginOptions() {
    const options = await generateAuthenticationOptions({
      rpID: this.env.WEBAUTHN_RP_ID,
      userVerification: 'required',
      timeout: 120_000,
    });
    await this.redis.client.set(`pkl:${options.challenge}`, '1', 'EX', 300);
    return { options: options as unknown as Record<string, unknown> };
  }

  async loginWithPasskey(assertion: Record<string, unknown>): Promise<Tokens> {
    const a = assertion as unknown as AuthenticationResponseJSON;
    const cred =
      typeof a.id === 'string'
        ? await this.prisma.mobileCredential.findUnique({ where: { webauthnCredentialId: a.id } })
        : null;
    if (!cred || cred.status !== 'ACTIVE' || !cred.cosePublicKey)
      throw Errors.unauthenticated('This passkey is not registered with LabPass.');
    let challenge = '';
    try {
      challenge = (
        JSON.parse(Buffer.from(a.response.clientDataJSON, 'base64url').toString('utf8')) as { challenge: string }
      ).challenge;
    } catch {
      throw Errors.unauthenticated('Invalid passkey response.');
    }
    if (!(await this.redis.client.getdel(`pkl:${challenge}`)))
      throw Errors.unauthenticated('This sign-in request has expired. Try again.');
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: a,
        expectedChallenge: challenge,
        expectedOrigin: this.env.STUDENT_ORIGINS,
        expectedRPID: this.env.WEBAUTHN_RP_ID,
        credential: {
          id: cred.webauthnCredentialId!,
          publicKey: new Uint8Array(cred.cosePublicKey),
          counter: cred.signCount,
          transports: cred.transports as never,
        },
        requireUserVerification: true,
      });
    } catch {
      throw Errors.unauthenticated('The passkey could not be verified.');
    }
    if (!result.verified) throw Errors.unauthenticated('The passkey could not be verified.');
    await this.prisma.mobileCredential.update({
      where: { id: cred.id },
      data: { signCount: result.authenticationInfo.newCounter },
    });
    return this.tokens.issue(cred.studentId, cred.id, randomUUID());
  }
}
