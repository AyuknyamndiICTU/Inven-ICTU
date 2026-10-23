import { Inject, Injectable } from '@nestjs/common';
import { API_ENV, type ApiEnv } from '../../config/env';
import { randomToken } from '../crypto/crypto';
import { RedisService } from '../redis/redis.service';

export const ADMIN_COOKIE = 'lp_admin';
const IDLE_TTL_SEC = 2 * 60 * 60; // 2 h idle
const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // 12 h absolute
const PENDING_TTL_SEC = 10 * 60; // password OK, waiting for TOTP

export interface AdminSession {
  userId: string;
  stage: 'PENDING_TOTP' | 'AUTH';
  /** Present while a first-time TOTP enrolment is in progress (sealed with the data key). */
  pendingTotpSecret?: string;
  createdAt: number;
}

@Injectable()
export class AdminSessionService {
  constructor(
    private readonly redis: RedisService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private key(sid: string) {
    return `as:${sid}`;
  }

  async create(session: Omit<AdminSession, 'createdAt'>): Promise<string> {
    const sid = randomToken(32);
    const value: AdminSession = { ...session, createdAt: Date.now() };
    const ttl = session.stage === 'AUTH' ? IDLE_TTL_SEC : PENDING_TTL_SEC;
    await this.redis.client
      .multi()
      .set(this.key(sid), JSON.stringify(value), 'EX', ttl)
      .sadd(`asu:${session.userId}`, sid)
      .exec();
    return sid;
  }

  async get(sid: string | undefined): Promise<AdminSession | null> {
    if (!sid || sid.length > 100) return null;
    const raw = await this.redis.client.get(this.key(sid));
    if (!raw) return null;
    const s = JSON.parse(raw) as AdminSession;
    if (Date.now() - s.createdAt > ABSOLUTE_TTL_MS) {
      await this.destroy(sid);
      return null;
    }
    return s;
  }

  async touch(sid: string): Promise<void> {
    await this.redis.client.expire(this.key(sid), IDLE_TTL_SEC);
  }

  /** Issues a fresh session id after a privilege change (prevents session fixation). */
  async rotate(sid: string, next: Omit<AdminSession, 'createdAt'>): Promise<string> {
    await this.destroy(sid);
    return this.create(next);
  }

  async destroy(sid: string): Promise<void> {
    const s = await this.redis.client.get(this.key(sid));
    const multi = this.redis.client.multi().del(this.key(sid));
    if (s) multi.srem(`asu:${(JSON.parse(s) as AdminSession).userId}`, sid);
    await multi.exec();
  }

  async destroyAllForUser(userId: string): Promise<void> {
    const sids = await this.redis.client.smembers(`asu:${userId}`);
    if (sids.length) await this.redis.client.del(...sids.map((s) => this.key(s)));
    await this.redis.client.del(`asu:${userId}`);
  }

  cookieOptions(maxAgeSec = IDLE_TTL_SEC) {
    return {
      path: '/',
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict' as const,
      maxAge: maxAgeSec,
    };
  }
}
