import type { StudentTokens } from '@labpass/contracts';
import { Injectable } from '@nestjs/common';
import { randomToken, sha256Hex, TokenSigner } from '../crypto/crypto';
import { Errors } from '../http/problem';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const ACCESS_TTL_SEC = 10 * 60;
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export const STUDENT_REFRESH_COOKIE = 'lp_srt';

/** Short-lived access tokens + rotating refresh tokens with reuse detection (ARCH §7). */
@Injectable()
export class StudentTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: TokenSigner,
  ) {}

  async issue(studentId: string, credentialId: string, familyId: string, db: Tx | PrismaService = this.prisma) {
    const access = this.signer.sign(
      'sat',
      { sub: studentId, cid: credentialId, fam: familyId, iat: Math.floor(Date.now() / 1000) },
      ACCESS_TTL_SEC,
    );
    const refresh = randomToken(32);
    await db.studentRefreshToken.create({
      data: {
        studentId,
        credentialId,
        familyId,
        tokenHash: sha256Hex(refresh),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { accessToken: access.token, accessExpiresAt: access.expiresAt, refreshToken: refresh };
  }

  toDto(
    t: { accessToken: string; accessExpiresAt: Date; refreshToken: string },
    includeRefresh: boolean,
  ): StudentTokens {
    return {
      accessToken: t.accessToken,
      accessExpiresAt: t.accessExpiresAt.toISOString(),
      refreshToken: includeRefresh ? t.refreshToken : null,
    };
  }

  /** Rotates a refresh token. Re-use of an already-used token revokes the whole family (token theft signal). */
  async rotate(refreshToken: string) {
    const row = await this.prisma.studentRefreshToken.findUnique({ where: { tokenHash: sha256Hex(refreshToken) } });
    if (!row || row.revokedAt || row.expiresAt < new Date()) throw Errors.unauthenticated('Please sign in again.');
    if (row.usedAt) {
      await this.revokeFamily(row.familyId);
      throw Errors.unauthenticated('Please sign in again.');
    }
    const cred = await this.prisma.mobileCredential.findUnique({
      where: { id: row.credentialId },
      select: { status: true },
    });
    if (!cred || cred.status !== 'ACTIVE') throw Errors.unauthenticated('This LabPass credential is no longer active.');
    return this.prisma.tx(async (tx) => {
      const marked = await tx.studentRefreshToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (marked.count === 0) {
        await tx.studentRefreshToken.updateMany({
          where: { familyId: row.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        throw Errors.unauthenticated('Please sign in again.');
      }
      return this.issue(row.studentId, row.credentialId, row.familyId, tx);
    });
  }

  async revokeFamily(familyId: string, db: Tx | PrismaService = this.prisma) {
    await db.studentRefreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeCredential(credentialId: string, db: Tx | PrismaService = this.prisma) {
    await db.studentRefreshToken.updateMany({
      where: { credentialId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
