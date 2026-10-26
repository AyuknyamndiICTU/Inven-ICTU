import { b64urlDecode, b64urlEncode, parseResponseQr, TapProtocolError } from '@labpass/contracts/tap';
import { passkeyChallenge, verifyHceEvidence, verifyScanEvidence } from '@labpass/contracts/tap-node';
import { Inject, Injectable } from '@nestjs/common';
import type { MobileCredential, Student } from '@prisma/client';
import { type AuthenticationResponseJSON, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { randomUUID } from 'node:crypto';
import { API_ENV, type ApiEnv } from '../config/env';
import { ChallengeService } from '../kiosks/kiosks.module';
import { TokenSigner, uidHmac, verifySecret } from '../platform/crypto/crypto';
import { Errors } from '../platform/http/problem';
import { PrismaService, type Tx } from '../platform/prisma/prisma.service';
import { RedisService } from '../platform/redis/redis.service';
import { FileUrlService } from '../platform/storage/storage';
import { SettingsService } from '../settings/settings';
import { OtpService } from '../students/otp.service';

export const KIOSK_SESSION_TTL_SEC = 120;
const LOOKUP_TTL_SEC = 300;
const MAX_LOOKUP_ATTEMPTS = 5;
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 15 * 60_000;
/** Tap protocol §5: clock skew limits. */
const HCE_SKEW_MS = 30_000;
const SCAN_SKEW_MS = 120_000;

export type Method = 'CARD' | 'HCE' | 'SCAN' | 'MANUAL';
export type Verification = 'PIN' | 'OTP' | 'ASSISTANT' | 'OPEN';
export type Flag = 'MANUAL' | 'UID_ONLY' | 'OFFLINE';

export interface KioskSessionClaims {
  k: string;
  s: string;
  m: Method;
  v: Verification | null;
  f: Flag[];
}

interface Lookup {
  kioskId: string;
  studentId: string;
  attempts: number;
  otpHash?: string;
}

/** One message for every failed phone or code identification, so nothing about credentials leaks. */
const notRecognised = () =>
  Errors.unprocessable('NOT_RECOGNISED', 'We could not verify this. Try again, or use your matricule.');

/** Identification at the kiosk (ARCH §5 F1–F4) and the student state shown after it. */
@Injectable()
export class IdentifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly challenges: ChallengeService,
    private readonly settings: SettingsService,
    private readonly otp: OtpService,
    private readonly signer: TokenSigner,
    private readonly files: FileUrlService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ───────────── Student state ─────────────

  async openLines(studentId: string, db: Tx | PrismaService = this.prisma) {
    const loans = await db.loan.findMany({
      where: { studentId, status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
      include: { lines: { include: { equipment: { select: { code: true, name: true } } } } },
    });
    const now = Date.now();
    return loans.flatMap((l) =>
      l.lines
        .map((ln) => ({ ln, outstanding: ln.qtyIssued - ln.qtyReturned - ln.qtyDamaged - ln.qtyLost }))
        .filter((x) => x.outstanding > 0 && !x.ln.needsReview)
        .map(({ ln, outstanding }) => ({
          loanLineId: ln.id,
          loanId: l.id,
          equipmentId: ln.equipmentId,
          equipmentCode: ln.equipment.code,
          equipmentName: ln.equipment.name,
          outstanding,
          dueAt: l.dueAt.toISOString(),
          overdue: l.dueAt.getTime() < now,
        })),
    );
  }

  async eligibility(
    student: Pick<Student, 'id' | 'status'>,
    lines?: Array<{ outstanding: number; overdue: boolean }>,
    db: Tx | PrismaService = this.prisma,
  ) {
    const s = await this.settings.get();
    const open = lines ?? (await this.openLines(student.id, db));
    const outstanding = open.reduce((n, l) => n + l.outstanding, 0);
    const reasons: Array<'INACTIVE' | 'SUSPENDED' | 'OVERDUE' | 'LIMIT_REACHED'> = [];
    if (student.status === 'INACTIVE') reasons.push('INACTIVE');
    if (student.status === 'SUSPENDED') reasons.push('SUSPENDED');
    if (s.blockWhenOverdue && open.some((l) => l.overdue)) reasons.push('OVERDUE');
    if (s.maxItemsPerStudent !== null && outstanding >= s.maxItemsPerStudent) reasons.push('LIMIT_REACHED');
    return {
      canBorrow: reasons.length === 0,
      canReturn: open.length > 0,
      reasons,
      remainingItems: s.maxItemsPerStudent === null ? null : Math.max(0, s.maxItemsPerStudent - outstanding),
    };
  }

  summary(s: Student) {
    return {
      id: s.id,
      matricule: s.matricule,
      firstName: s.firstName,
      lastName: s.lastName,
      program: s.program,
      level: s.level,
      photoUrl: this.files.url(s.photoKey),
      status: s.status,
    };
  }

  /** Builds the IDENTIFIED result and the 2-minute kiosk session bound to kiosk + student (ARCH §5 F1 step 3). */
  async identified(
    kioskId: string,
    student: Student,
    method: Method,
    verification: Verification | null,
    flags: Flag[] = [],
  ) {
    const openLines = await this.openLines(student.id);
    const session = this.signer.sign(
      'ksess',
      { k: kioskId, s: student.id, m: method, v: verification, f: flags } satisfies KioskSessionClaims,
      KIOSK_SESSION_TTL_SEC,
    );
    return {
      status: 'IDENTIFIED' as const,
      method,
      session: { token: session.token, expiresAt: session.expiresAt.toISOString() },
      student: this.summary(student),
      eligibility: await this.eligibility(student, openLines),
      openLines,
      flags,
    };
  }

  /** Validates a kiosk session for Sign In/Out. The session is bound to the kiosk that identified the student. */
  session(kioskId: string, token: string): KioskSessionClaims {
    const claims = this.signer.verify<KioskSessionClaims>('ksess', token);
    if (!claims || claims.k !== kioskId) throw Errors.unauthenticated('This session has expired. Identify again.');
    return claims;
  }

  // ───────────── Identify ─────────────

  async identify(
    kioskId: string,
    body:
      | { method: 'CARD'; uid: string }
      | { method: 'HCE'; credentialId: string; nonce: string; ts: number; signature: string }
      | { method: 'SCAN'; payload: string }
      | { method: 'MANUAL'; matricule: string },
  ) {
    switch (body.method) {
      case 'CARD':
        return this.byCard(kioskId, body.uid);
      case 'HCE':
        return this.byHce(kioskId, body);
      case 'SCAN':
        return this.byScanPayload(kioskId, body.payload);
      case 'MANUAL':
        return this.byMatricule(kioskId, body.matricule);
    }
  }

  private async byCard(kioskId: string, uid: string) {
    const upper = uid.toUpperCase();
    const binding = await this.prisma.cardBinding.findFirst({
      where: { uidHmac: uidHmac(this.env.UID_PEPPER, upper), status: 'ACTIVE' },
      include: { student: true },
    });
    if (!binding) return { status: 'UNKNOWN_CARD' as const, uidSuffix: upper.slice(-4) };
    const mode = (await this.settings.get()).cardAuthMode;
    if (mode === 'DESFIRE_REQUIRED' && binding.cardTech === 'DESFIRE_EV3') {
      throw Errors.forbidden('CARD_AUTH_REQUIRED', 'This card must be verified securely. Hold it on the reader again.');
    }
    return this.identified(kioskId, binding.student, 'CARD', null, mode === 'UID' ? [] : ['UID_ONLY']);
  }

  private async activeCredential(id: string, kind: 'DEVICE_KEY' | 'PASSKEY') {
    const cred = await this.prisma.mobileCredential.findUnique({ where: { id }, include: { student: true } });
    if (!cred || cred.status !== 'ACTIVE' || cred.kind !== kind) throw notRecognised();
    return cred;
  }

  private async byHce(kioskId: string, b: { credentialId: string; nonce: string; ts: number; signature: string }) {
    const cred = await this.activeCredential(b.credentialId, 'DEVICE_KEY');
    if (!(cred.capabilities as { hce?: boolean }).hce || !cred.publicKeySpki) throw notRecognised();
    if (Math.abs(Date.now() - b.ts) > HCE_SKEW_MS) throw notRecognised();
    let nonce: Uint8Array;
    let signature: Uint8Array;
    try {
      nonce = b64urlDecode(b.nonce);
      signature = b64urlDecode(b.signature);
    } catch {
      throw notRecognised();
    }
    if (
      !verifyHceEvidence(new Uint8Array(cred.publicKeySpki), {
        credentialId: cred.id,
        nonce,
        kioskId,
        ts: b.ts,
        signature,
      })
    )
      throw notRecognised();
    // Verified first, consumed second: garbage cannot burn a live challenge, and a valid signature works once.
    if (!(await this.challenges.consume(kioskId, nonce))) throw notRecognised();
    await this.rememberNonce(cred.id, b.nonce);
    return this.identified(kioskId, cred.student, 'HCE', null);
  }

  /** Durable record of nonces phones have signed, so a captured signature cannot back an offline sync later. */
  private async rememberNonce(credentialId: string, nonce: string) {
    await this.prisma.usedEvidenceNonce.createMany({ data: [{ credentialId, nonce }], skipDuplicates: true });
  }

  /** Offline phone fallback: the kiosk webcam reads the phone's response QR (LPR1 device key / LPR2 passkey). */
  private async byScanPayload(kioskId: string, payload: string) {
    let qr;
    try {
      qr = parseResponseQr(payload);
    } catch (e) {
      if (e instanceof TapProtocolError) throw notRecognised();
      throw e;
    }
    if (qr.kind === 'DEVICE_KEY') {
      const cred = await this.verifyDeviceKeyScan(kioskId, qr.credentialId, qr.nonce, qr.ts, qr.signature);
      return this.identified(kioskId, cred.student, 'SCAN', null);
    }
    const cred = await this.activeCredential(qr.credentialId, 'PASSKEY');
    await this.verifyPasskeyScan(kioskId, cred, qr.nonce, {
      id: cred.webauthnCredentialId!,
      rawId: cred.webauthnCredentialId!,
      type: 'public-key',
      response: {
        authenticatorData: b64urlEncode(qr.authenticatorData),
        clientDataJSON: b64urlEncode(qr.clientDataJSON),
        signature: b64urlEncode(qr.signature),
      },
      clientExtensionResults: {},
    });
    return this.identified(kioskId, cred.student, 'SCAN', null);
  }

  async verifyDeviceKeyScan(
    kioskId: string,
    credentialId: string,
    nonce: Uint8Array,
    ts: number,
    signature: Uint8Array,
  ) {
    const cred = await this.activeCredential(credentialId, 'DEVICE_KEY');
    if ((cred.capabilities as { scan?: boolean }).scan === false || !cred.publicKeySpki) throw notRecognised();
    if (Math.abs(Date.now() - ts) > SCAN_SKEW_MS) throw notRecognised();
    if (!verifyScanEvidence(new Uint8Array(cred.publicKeySpki), { credentialId, nonce, kioskId, ts, signature }))
      throw notRecognised();
    if (!(await this.challenges.consume(kioskId, nonce))) throw notRecognised();
    await this.rememberNonce(credentialId, b64urlEncode(nonce));
    return cred;
  }

  /** WebAuthn assertion whose challenge is SHA-256("ICTU-LP1-PK" ‖ kioskId ‖ nonce) (tap protocol §3.3). */
  async verifyPasskeyScan(
    kioskId: string,
    cred: MobileCredential,
    nonce: Uint8Array,
    assertion: AuthenticationResponseJSON,
  ) {
    if (!cred.cosePublicKey || !cred.webauthnCredentialId || assertion.id !== cred.webauthnCredentialId)
      throw notRecognised();
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: b64urlEncode(passkeyChallenge(kioskId, nonce)),
        expectedOrigin: this.env.STUDENT_ORIGINS,
        expectedRPID: this.env.WEBAUTHN_RP_ID,
        credential: {
          id: cred.webauthnCredentialId,
          publicKey: new Uint8Array(cred.cosePublicKey),
          counter: cred.signCount,
          transports: cred.transports as never,
        },
        requireUserVerification: true,
      });
    } catch {
      throw notRecognised();
    }
    if (!result.verified) throw notRecognised();
    if (!(await this.challenges.consume(kioskId, nonce))) throw notRecognised();
    await this.prisma.mobileCredential.update({
      where: { id: cred.id },
      data: { signCount: result.authenticationInfo.newCounter },
    });
  }

  // ───────────── Manual matricule (F4) ─────────────

  private lookupKey(id: string) {
    return `ml:${id}`;
  }

  private async byMatricule(kioskId: string, matricule: string) {
    const student = await this.prisma.student.findUnique({ where: { matricule: matricule.trim().toUpperCase() } });
    if (!student)
      throw Errors.unprocessable(
        'NOT_RECOGNISED',
        'We could not find this matricule. Check it, or ask a lab assistant.',
      );
    const policy = (await this.settings.get()).manualEntryPolicy;
    if (policy === 'OPEN') return this.identified(kioskId, student, 'MANUAL', 'OPEN', ['MANUAL']);
    const lookupId = randomUUID();
    await this.redis.client.set(
      this.lookupKey(lookupId),
      JSON.stringify({ kioskId, studentId: student.id, attempts: 0 } satisfies Lookup),
      'EX',
      LOOKUP_TTL_SEC,
    );
    const options: Array<'PIN' | 'ASSISTANT' | 'OTP'> =
      policy === 'PIN_OR_ASSISTANT'
        ? [...(student.manualPinHash ? (['PIN'] as const) : []), 'ASSISTANT']
        : policy === 'OTP'
          ? [...(student.email || student.phone ? (['OTP'] as const) : []), 'ASSISTANT']
          : ['ASSISTANT'];
    return {
      status: 'VERIFICATION_REQUIRED' as const,
      lookupId,
      student: { firstName: student.firstName, lastName: student.lastName, photoUrl: this.files.url(student.photoKey) },
      options,
    };
  }

  private async lookup(kioskId: string, lookupId: string): Promise<Lookup> {
    const raw = await this.redis.client.get(this.lookupKey(lookupId));
    const l = raw ? (JSON.parse(raw) as Lookup) : null;
    if (!l || l.kioskId !== kioskId)
      throw Errors.badRequest('LOOKUP_EXPIRED', 'This entry has expired. Type the matricule again.');
    if (l.attempts >= MAX_LOOKUP_ATTEMPTS) {
      await this.redis.client.del(this.lookupKey(lookupId));
      throw Errors.badRequest('LOOKUP_EXPIRED', 'Too many attempts. Type the matricule again.');
    }
    return l;
  }

  private async saveLookup(lookupId: string, l: Lookup) {
    await this.redis.client.set(this.lookupKey(lookupId), JSON.stringify(l), 'KEEPTTL');
  }

  async sendManualOtp(kioskId: string, lookupId: string, locale: 'en' | 'fr') {
    const l = await this.lookup(kioskId, lookupId);
    if ((await this.settings.get()).manualEntryPolicy !== 'OTP')
      throw Errors.badRequest('OTP_NOT_ALLOWED', 'Codes are not used for matricule entry here.');
    const student = await this.prisma.student.findUniqueOrThrow({ where: { id: l.studentId } });
    const sent = await this.otp.send('manual', lookupId, student, locale);
    if (!sent) throw Errors.unprocessable('NO_CONTACT', 'There is no email or phone on record. Ask a lab assistant.');
    await this.saveLookup(lookupId, { ...l, otpHash: sent.hash });
    return { destination: sent.destination };
  }

  async verifyManual(
    kioskId: string,
    body:
      | { lookupId: string; method: 'PIN'; pin: string }
      | { lookupId: string; method: 'ASSISTANT'; assistantPin: string }
      | { lookupId: string; method: 'OTP'; code: string },
  ) {
    const l = await this.lookup(kioskId, body.lookupId);
    const policy = (await this.settings.get()).manualEntryPolicy;
    const allowed =
      policy === 'PIN_OR_ASSISTANT' ? ['PIN', 'ASSISTANT'] : policy === 'OTP' ? ['OTP', 'ASSISTANT'] : ['ASSISTANT'];
    if (!allowed.includes(body.method))
      throw Errors.badRequest('METHOD_NOT_ALLOWED', 'This verification method is not allowed here.');
    const student = await this.prisma.student.findUniqueOrThrow({ where: { id: l.studentId } });
    const fail = async (detail: string) => {
      await this.saveLookup(body.lookupId, { ...l, attempts: l.attempts + 1 });
      return Errors.badRequest('VERIFICATION_FAILED', detail);
    };

    if (body.method === 'PIN') {
      if (student.pinLockedUntil && student.pinLockedUntil > new Date()) {
        throw Errors.locked(
          'Too many wrong PINs. Ask a lab assistant.',
          Math.ceil((student.pinLockedUntil.getTime() - Date.now()) / 1000),
        );
      }
      if (!(await verifySecret(student.manualPinHash, body.pin))) {
        const failures = student.pinFailures + 1;
        await this.prisma.student.update({
          where: { id: student.id },
          data:
            failures >= PIN_MAX_FAILURES
              ? { pinFailures: 0, pinLockedUntil: new Date(Date.now() + PIN_LOCK_MS) }
              : { pinFailures: failures },
        });
        throw await fail('The PIN is incorrect.');
      }
      if (student.pinFailures)
        await this.prisma.student.update({ where: { id: student.id }, data: { pinFailures: 0 } });
    } else if (body.method === 'OTP') {
      if (!this.otp.matches(l.otpHash, 'manual', body.lookupId, body.code)) throw await fail('The code is incorrect.');
    } else {
      const assistants = await this.prisma.adminUser.findMany({
        where: { active: true, role: { not: 'VIEWER' }, assistantPinHash: { not: null } },
        select: { id: true, assistantPinHash: true },
      });
      let ok = false;
      for (const a of assistants) if (await verifySecret(a.assistantPinHash, body.assistantPin)) ok = true;
      if (!ok) throw await fail('The assistant PIN is incorrect.');
    }
    await this.redis.client.del(this.lookupKey(body.lookupId));
    return this.identified(kioskId, student, 'MANUAL', body.method, ['MANUAL']);
  }
}
