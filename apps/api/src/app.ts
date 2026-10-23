import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DestinationStream } from 'pino';
import { AuthModule } from './auth/auth.module';
import { type ApiEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { KiosksModule } from './kiosks/kiosks.module';
import { createLogger } from './platform/logging/logger';
import { PlatformModule } from './platform/platform.module';
import { SettingsModule } from './settings/settings';

/** Feature modules, in dependency order. Later steps (S05–S11.5) append theirs here. */
export const FEATURE_MODULES: Array<Type<unknown>> = [HealthModule, SettingsModule, AuthModule, KiosksModule];

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv, opts: { http?: boolean } = {}): DynamicModule {
    return { module: AppModule, imports: [PlatformModule.forRoot(env, opts), ...FEATURE_MODULES] };
  }
}

const BINARY_TYPES = [
  'application/octet-stream',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
];
/** Upload limit for student/card imports (ARCH §9). JSON bodies stay at 1 MB. */
const UPLOAD_LIMIT = 20 * 1024 * 1024;

export async function createApp(
  env: ApiEnv,
  opts: { logStream?: DestinationStream } = {},
): Promise<NestFastifyApplication> {
  const logger = createLogger(env.NODE_ENV === 'test' && !opts.logStream ? 'silent' : env.LOG_LEVEL, opts.logStream);
  const adapter = new FastifyAdapter({ loggerInstance: logger, trustProxy: env.TRUST_PROXY, bodyLimit: 1024 * 1024 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    rawBody: true,
    abortOnError: false,
    logger: env.NODE_ENV === 'test' ? false : ['error', 'warn'],
  });
  await app.register(fastifyCookie as never);
  await app.register(
    fastifyHelmet as never,
    { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } } as never,
  );
  const fastify = app.getHttpAdapter().getInstance();
  for (const type of BINARY_TYPES) {
    fastify.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: UPLOAD_LIMIT }, (_req, body, done) =>
      done(null, body),
    );
  }
  app.enableShutdownHooks();
  await app.init();
  return app;
}
