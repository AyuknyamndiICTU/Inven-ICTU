import { routes, type RouteSpec } from '@labpass/contracts';
import {
  type CanActivate,
  type DynamicModule,
  type ExecutionContext,
  Global,
  Injectable,
  Module,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { API_ENV, type ApiEnv } from '../config/env';
import {
  EmailChannel,
  MockChannel,
  NOTIFICATION_CHANNELS,
  NotificationService,
} from '../notifications/core/notification.service';
import { AdminSessionService } from './auth/admin-session.service';
import { AuthGuard } from './auth/auth.guard';
import { StudentTokensService } from './auth/student-tokens.service';
import { AuditInterceptor, AuditService, ContractResponseInterceptor } from './audit/audit';
import { SecretBox, TokenSigner } from './crypto/crypto';
import { routeIdOf } from './http/contract';
import { ProblemFilter } from './http/problem.filter';
import type { LpRequest } from './http/request';
import { IdempotencyService, idempotencyKeyOf } from './idempotency/idempotency.service';
import { EventBus, InboxService, OutboxRelay, OutboxService } from './outbox/outbox';
import { PrismaService } from './prisma/prisma.service';
import { RateLimitGuard, RateLimitService } from './rate-limit/rate-limit';
import { AdminGateway, KioskGateway, RealtimeService } from './realtime/realtime';
import { RedisService } from './redis/redis.service';
import { FilesController, FileUrlService, LocalDiskStorage, OBJECT_STORAGE } from './storage/storage';

/** Rejects idempotent routes without an `Idempotency-Key` header before any work is done. */
@Injectable()
export class IdempotencyHeaderGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const id = routeIdOf(ctx);
    if (id && (routes[id] as RouteSpec).idempotent) idempotencyKeyOf(ctx.switchToHttp().getRequest<LpRequest>());
    return true;
  }
}

const SERVICES = [
  PrismaService,
  RedisService,
  AdminSessionService,
  StudentTokensService,
  RateLimitService,
  AuditService,
  IdempotencyService,
  OutboxService,
  InboxService,
  EventBus,
  OutboxRelay,
  RealtimeService,
  FileUrlService,
  NotificationService,
];

@Global()
@Module({})
export class PlatformModule {
  static forRoot(env: ApiEnv, opts: { http?: boolean } = {}): DynamicModule {
    const http = opts.http ?? true;
    return {
      module: PlatformModule,
      controllers: http ? [FilesController] : [],
      providers: [
        { provide: API_ENV, useValue: env },
        { provide: 'LOG_INTERNAL_ERRORS', useValue: env.NODE_ENV !== 'test' },
        { provide: TokenSigner, useFactory: () => new TokenSigner(env.APP_SECRET) },
        { provide: SecretBox, useFactory: () => new SecretBox(env.DATA_KEY) },
        { provide: OBJECT_STORAGE, useFactory: () => new LocalDiskStorage(env.STORAGE_DIR) },
        {
          provide: NOTIFICATION_CHANNELS,
          useFactory: () => [
            new EmailChannel(env),
            new MockChannel('SMS'),
            new MockChannel('WHATSAPP'),
            new MockChannel('PUSH'),
          ],
        },
        ...SERVICES,
        ...(http
          ? [
              AdminGateway,
              KioskGateway,
              { provide: APP_GUARD, useClass: AuthGuard },
              { provide: APP_GUARD, useClass: RateLimitGuard },
              { provide: APP_GUARD, useClass: IdempotencyHeaderGuard },
              { provide: APP_FILTER, useClass: ProblemFilter },
              { provide: APP_INTERCEPTOR, useClass: ContractResponseInterceptor },
              { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
            ]
          : []),
      ],
      exports: [API_ENV, TokenSigner, SecretBox, OBJECT_STORAGE, NOTIFICATION_CHANNELS, ...SERVICES],
    };
  }
}
