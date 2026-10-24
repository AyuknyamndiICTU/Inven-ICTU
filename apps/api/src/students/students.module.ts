import { type AdminRole, maskContact, roleSatisfies } from '@labpass/contracts';
import { Controller, Inject, Injectable, Module, Req } from '@nestjs/common';
import type { CardBinding, Prisma } from '@prisma/client';
import { API_ENV, type ApiEnv } from '../config/env';
import { uidHmac } from '../platform/crypto/crypto';
import { Contract, ContractInput, type In } from '../platform/http/contract';
import { Errors } from '../platform/http/problem';
import type { LpRequest } from '../platform/http/request';
import { PrismaService, type Tx } from '../platform/prisma/prisma.service';
import { FileUrlService } from '../platform/storage/storage';
import { localeOf, OtpService } from './otp.service';

const LINK_TTL_MS = 10 * 60_000;

function credentialDto(c: {
  id: string;
  kind: 'DEVICE_KEY' | 'PASSKEY';
  platform: 'ANDROID_APP' | 'WEB';
  status: 'PENDING' | 'ACTIVE' | 'REVOKED' | 'REJECTED';
  deviceLabel: string | null;
  capabilities: Prisma.JsonValue;
  backedUp: boolean | null;
  createdAt: Date;
  revokedAt: Date | null;
}) {
  const caps = (c.capabilities ?? {}) as { hce?: boolean; scan?: boolean };
  return {
    id: c.id,
    kind: c.kind,
    platform: c.platform,
    status: c.status,
    deviceLabel: c.deviceLabel,
    capabilities: { hce: Boolean(caps.hce), scan: caps.scan !== false },
    backedUp: c.backedUp,
    createdAt: c.createdAt.toISOString(),
    revokedAt: c.revokedAt?.toISOString() ?? null,
  };
}
export { credentialDto };

function cardDto(c: CardBinding) {
  return {
    id: c.id,
    uidSuffix: c.uidSuffix,
    cardTech: c.cardTech,
    status: c.status,
    createdVia: c.createdVia,
    authFailures: c.authFailures,
    keyVersion: c.keyVersion,
    createdAt: c.createdAt.toISOString(),
    revokedAt: c.revokedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileUrlService,
    private readonly otp: OtpService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  hmac(uid: string) {
    return uidHmac(this.env.UID_PEPPER, uid.toUpperCase());
  }

  async list(q: In<'students.list'>['query']) {
    const where: Prisma.StudentWhereInput = q.status ? { status: q.status } : {};
    let ids: string[] | undefined;
    let total: number;
    if (q.search) {
      const term = `%${q.search.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      const status = q.status ?? null;
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM students
        WHERE (lower("firstName" || ' ' || "lastName") LIKE ${term} OR lower(matricule) LIKE ${term}
               OR lower("lastName" || ' ' || "firstName") LIKE ${term})
          AND (${status}::text IS NULL OR status::text = ${status})
        ORDER BY "lastName", "firstName"
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
      const [{ count }] = (await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM students
        WHERE (lower("firstName" || ' ' || "lastName") LIKE ${term} OR lower(matricule) LIKE ${term}
               OR lower("lastName" || ' ' || "firstName") LIKE ${term})
          AND (${status}::text IS NULL OR status::text = ${status})`) as [{ count: bigint }];
      ids = rows.map((r) => r.id);
      total = Number(count);
    } else {
      total = await this.prisma.student.count({ where });
    }
    const students = await this.prisma.student.findMany({
      where: ids ? { id: { in: ids } } : where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      ...(ids ? {} : { skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      include: {
        cards: { where: { status: 'ACTIVE' }, select: { id: true } },
        credentials: { where: { status: 'ACTIVE' }, select: { id: true } },
        _count: { select: { loans: { where: { status: 'OPEN' } } } },
      },
    });
    return {
      items: students.map((s) => ({
        id: s.id,
        matricule: s.matricule,
        firstName: s.firstName,
        lastName: s.lastName,
        program: s.program,
        level: s.level,
        status: s.status,
        hasCard: s.cards.length > 0,
        hasCredential: s.credentials.length > 0,
        openLoans: s._count.loans,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(id: string, role: AdminRole) {
    const s = await this.prisma.student.findUnique({
      where: { id },
      include: {
        cards: { orderBy: { createdAt: 'desc' } },
        credentials: { orderBy: { createdAt: 'desc' } },
        _count: { select: { loans: { where: { status: 'OPEN' } } } },
      },
    });
    if (!s) throw Errors.notFound('Student');
    const full = roleSatisfies(role, 'LAB_ADMIN');
    return {
      id: s.id,
      matricule: s.matricule,
      firstName: s.firstName,
      lastName: s.lastName,
      program: s.program,
      level: s.level,
      status: s.status,
      hasCard: s.cards.some((c) => c.status === 'ACTIVE'),
      hasCredential: s.credentials.some((c) => c.status === 'ACTIVE'),
      openLoans: s._count.loans,
      // ARCH §7: contacts are masked and the date of birth hidden below LAB_ADMIN.
      email: full ? s.email : maskContact(s.email),
      phone: full ? s.phone : maskContact(s.phone),
      dateOfBirth: full ? s.dateOfBirth.toISOString().slice(0, 10) : null,
      photoUrl: this.files.url(s.photoKey),
      hasPin: Boolean(s.manualPinHash),
      pinLocked: Boolean(s.pinLockedUntil && s.pinLockedUntil > new Date()),
      cards: s.cards.map(cardDto),
      credentials: s.credentials.map(credentialDto),
      createdAt: s.createdAt.toISOString(),
      syncedAt: s.syncedAt?.toISOString() ?? null,
    };
  }

  /** Binds a card to a student, replacing the student's current card. A card can belong to one student only. */
  async bind(tx: Tx, studentId: string, uid: string, via: 'ADMIN' | 'OTP' | 'SIS' | 'SUPPLIER_FILE') {
    const hmac = this.hmac(uid);
    const taken = await tx.cardBinding.findFirst({ where: { uidHmac: hmac, status: 'ACTIVE' } });
    if (taken && taken.studentId !== studentId)
      throw Errors.conflict('CARD_IN_USE', 'This card is already linked to another student.');
    if (taken) return taken;
    await tx.cardBinding.updateMany({
      where: { studentId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    return tx.cardBinding.create({
      data: {
        studentId,
        uidHmac: hmac,
        uidSuffix: uid.slice(-4).toUpperCase(),
        createdVia: via,
        cardTech: via === 'SUPPLIER_FILE' ? 'DESFIRE_EV3' : 'OTHER',
      },
    });
  }

  // ───────────── Kiosk "link this card" (ARCH §5 F1) ─────────────

  async startLink(kioskId: string, uid: string, matricule: string, locale: 'en' | 'fr') {
    const hmac = this.hmac(uid);
    if (await this.prisma.cardBinding.count({ where: { uidHmac: hmac, status: 'ACTIVE' } })) {
      throw Errors.conflict('CARD_ALREADY_LINKED', 'This card is already linked. Tap it again to sign in.');
    }
    const student = await this.prisma.student.findUnique({ where: { matricule: matricule.trim().toUpperCase() } });
    const base = {
      uidHmac: hmac,
      uidSuffix: uid.slice(-4).toUpperCase(),
      matricule: matricule.trim().toUpperCase(),
      kioskId,
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    };
    if (student?.status === 'ACTIVE') {
      const req = await this.prisma.cardLinkRequest.create({
        data: { ...base, studentId: student.id, status: 'PENDING_OTP' },
      });
      const sent = await this.otp.send('card-link', req.id, student, locale);
      if (sent) {
        await this.prisma.cardLinkRequest.update({ where: { id: req.id }, data: { otpHash: sent.hash } });
        return { requestId: req.id, verification: 'OTP' as const, destination: sent.destination };
      }
      await this.prisma.cardLinkRequest.update({ where: { id: req.id }, data: { status: 'PENDING_REVIEW' } });
      return { requestId: req.id, verification: 'REVIEW' as const, destination: null };
    }
    // Unknown or inactive matricule: same answer shape, admin review (no enumeration).
    const req = await this.prisma.cardLinkRequest.create({
      data: { ...base, studentId: student?.id ?? null, status: 'PENDING_REVIEW' },
    });
    return { requestId: req.id, verification: 'REVIEW' as const, destination: null };
  }

  async confirmLink(kioskId: string, requestId: string, code: string) {
    const req = await this.prisma.cardLinkRequest.findUnique({ where: { id: requestId } });
    if (!req || req.kioskId !== kioskId || req.status !== 'PENDING_OTP' || !req.studentId)
      throw Errors.notFound('Link request');
    if (req.expiresAt < new Date() || req.otpAttempts >= 5) {
      await this.prisma.cardLinkRequest.update({ where: { id: requestId }, data: { status: 'EXPIRED' } });
      throw Errors.badRequest('CODE_EXPIRED', 'The code has expired. Start again.');
    }
    if (!this.otp.matches(req.otpHash, 'card-link', req.id, code)) {
      await this.prisma.cardLinkRequest.update({ where: { id: requestId }, data: { otpAttempts: { increment: 1 } } });
      throw Errors.badRequest('INVALID_CODE', 'The code is incorrect.');
    }
    await this.prisma.tx(async (tx) => {
      const taken = await tx.cardBinding.findFirst({ where: { uidHmac: req.uidHmac, status: 'ACTIVE' } });
      if (taken) throw Errors.conflict('CARD_IN_USE', 'This card is already linked to a student.');
      await tx.cardBinding.updateMany({
        where: { studentId: req.studentId!, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await tx.cardBinding.create({
        data: { studentId: req.studentId!, uidHmac: req.uidHmac, uidSuffix: req.uidSuffix, createdVia: 'OTP' },
      });
      await tx.cardLinkRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', otpHash: null, decidedAt: new Date() },
      });
    });
    return { status: 'LINKED' as const };
  }

  async decideLink(id: string, approve: boolean, adminId: string) {
    const req = await this.prisma.cardLinkRequest.findUnique({ where: { id } });
    if (!req) throw Errors.notFound('Link request');
    if (req.status !== 'PENDING_REVIEW' && req.status !== 'PENDING_OTP')
      throw Errors.conflict('ALREADY_DECIDED', 'This request was already decided.');
    if (!approve) {
      await this.prisma.cardLinkRequest.update({
        where: { id },
        data: { status: 'REJECTED', decidedById: adminId, decidedAt: new Date() },
      });
    } else {
      const student = req.studentId
        ? await this.prisma.student.findUnique({ where: { id: req.studentId } })
        : await this.prisma.student.findUnique({ where: { matricule: req.matricule } });
      if (!student) throw Errors.conflict('NO_STUDENT', 'No student has this matricule. Import the student first.');
      await this.prisma.tx(async (tx) => {
        const taken = await tx.cardBinding.findFirst({ where: { uidHmac: req.uidHmac, status: 'ACTIVE' } });
        if (taken && taken.studentId !== student.id)
          throw Errors.conflict('CARD_IN_USE', 'This card is already linked to another student.');
        if (!taken) {
          await tx.cardBinding.updateMany({
            where: { studentId: student.id, status: 'ACTIVE' },
            data: { status: 'REVOKED', revokedAt: new Date() },
          });
          await tx.cardBinding.create({
            data: { studentId: student.id, uidHmac: req.uidHmac, uidSuffix: req.uidSuffix, createdVia: 'ADMIN' },
          });
        }
        await tx.cardLinkRequest.update({
          where: { id },
          data: { status: 'APPROVED', studentId: student.id, decidedById: adminId, decidedAt: new Date() },
        });
      });
    }
    return this.linkDto(id);
  }

  async linkDto(id: string) {
    const r = await this.prisma.cardLinkRequest.findUniqueOrThrow({ where: { id } });
    const s = r.studentId ? await this.prisma.student.findUnique({ where: { id: r.studentId } }) : null;
    return {
      id: r.id,
      matricule: r.matricule,
      uidSuffix: r.uidSuffix,
      status: r.status,
      student: s ? { id: s.id, firstName: s.firstName, lastName: s.lastName } : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

@Controller()
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Contract('students.list')
  list(@ContractInput() input: In<'students.list'>) {
    return this.students.list(input.query);
  }

  @Contract('students.get')
  get(@ContractInput() input: In<'students.get'>, @Req() req: LpRequest) {
    return this.students.detail(input.params.id, req.admin!.role);
  }

  @Contract('students.resetPin')
  async resetPin(@ContractInput() input: In<'students.resetPin'>) {
    await this.prisma.student.update({
      where: { id: input.params.id },
      data: { manualPinHash: null, pinFailures: 0, pinLockedUntil: null },
    });
    return { ok: true as const };
  }

  @Contract('students.bindCard')
  async bindCard(@ContractInput() input: In<'students.bindCard'>) {
    const student = await this.prisma.student.findUnique({ where: { id: input.params.id } });
    if (!student) throw Errors.notFound('Student');
    const b = await this.prisma.tx((tx) => this.students.bind(tx, student.id, input.body.uid.toUpperCase(), 'ADMIN'));
    return cardDto(b);
  }

  @Contract('cards.revoke')
  async revokeCard(@ContractInput() input: In<'cards.revoke'>) {
    const b = await this.prisma.cardBinding.update({
      where: { id: input.params.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    return cardDto(b);
  }

  @Contract('cardLinks.list')
  async links() {
    const rows = await this.prisma.cardLinkRequest.findMany({
      where: { status: { in: ['PENDING_REVIEW', 'PENDING_OTP'] } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return Promise.all(rows.map((r) => this.students.linkDto(r.id)));
  }

  @Contract('cardLinks.approve')
  approve(@ContractInput() input: In<'cardLinks.approve'>, @Req() req: LpRequest) {
    return this.students.decideLink(input.params.id, true, req.admin!.id);
  }

  @Contract('cardLinks.reject')
  reject(@ContractInput() input: In<'cardLinks.reject'>, @Req() req: LpRequest) {
    return this.students.decideLink(input.params.id, false, req.admin!.id);
  }
}

@Controller()
export class KioskCardLinkController {
  constructor(private readonly students: StudentsService) {}

  @Contract('kiosk.cardLink')
  start(@ContractInput() input: In<'kiosk.cardLink'>, @Req() req: LpRequest) {
    return this.students.startLink(
      req.kiosk!.id,
      input.body.uid,
      input.body.matricule,
      localeOf(req.headers['accept-language']),
    );
  }

  @Contract('kiosk.cardLinkConfirm')
  confirm(@ContractInput() input: In<'kiosk.cardLinkConfirm'>, @Req() req: LpRequest) {
    return this.students.confirmLink(req.kiosk!.id, input.body.requestId, input.body.code);
  }
}

@Module({
  controllers: [StudentsController, KioskCardLinkController],
  providers: [StudentsService, OtpService],
  exports: [StudentsService, OtpService],
})
export class StudentsModule {}
