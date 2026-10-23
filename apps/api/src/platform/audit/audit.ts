import { routes, type RouteSpec } from '@labpass/contracts';
import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { type Observable, mergeMap } from 'rxjs';
import { API_ENV, type ApiEnv, validateResponses } from '../../config/env';
import { routeIdOf } from '../http/contract';
import { AppError } from '../http/problem';
import { type Actor, actorOf, type LpRequest } from '../http/request';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const SENSITIVE = /password|pin|secret|token|code|key|uid|signature|spki|attestation|registration|assertion|otp/i;

/** Removes secrets and personal identifiers from an audit diff (I4). */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return { bytes: value.length };
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactForAudit(v, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE.test(k) ? '[redacted]' : redactForAudit(v, depth + 1),
      ]),
    );
  }
  return value;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    entry: { actor: Actor; action: string; entity: string; entityId?: string | null; diff?: unknown; ip?: string },
    db: Tx | PrismaService = this.prisma,
  ) {
    await db.auditLog.create({
      data: {
        actorType: entry.actor.type,
        actorId: entry.actor.id,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        diff: (redactForAudit(entry.diff) ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: entry.ip ?? null,
      },
    });
  }
}

/** Writes an audit entry for every successful `audited` contract route (invariant I7). */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const id = ctx.getType() === 'http' ? routeIdOf(ctx) : undefined;
    const spec = id ? (routes[id] as RouteSpec) : undefined;
    if (!id || !spec?.audited) return next.handle();
    const req = ctx.switchToHttp().getRequest<LpRequest>();
    return next.handle().pipe(
      mergeMap(async (result) => {
        const params = req.params as Record<string, string> | undefined;
        const resultId = (result as { id?: unknown } | null)?.id;
        await this.audit.record({
          actor: actorOf(req),
          action: id,
          entity: spec.tag,
          entityId: params?.id ?? (typeof resultId === 'string' ? resultId : null),
          diff: { params: req.params, body: req.body },
          ip: req.ip,
        });
        return result;
      }),
    );
  }
}

/** Validates JSON responses against the contract outside production (catches drift early, invariant I3). */
@Injectable()
export class ContractResponseInterceptor implements NestInterceptor {
  private readonly enabled: boolean;
  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.enabled = validateResponses(env);
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const id = ctx.getType() === 'http' ? routeIdOf(ctx) : undefined;
    const spec = id ? (routes[id] as RouteSpec) : undefined;
    if (!this.enabled || !spec?.response) return next.handle();
    return next.handle().pipe(
      mergeMap(async (result) => {
        const res = spec.response!.safeParse(result);
        if (!res.success) {
          throw new AppError(
            500,
            'CONTRACT_VIOLATION',
            'Response does not match the contract',
            `${id}: ${res.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')}`,
          );
        }
        return result;
      }),
    );
  }
}
