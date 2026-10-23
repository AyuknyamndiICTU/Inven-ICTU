import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type ApiEnv } from './config/env';
import { HealthModule } from './health/health.module';

@Module({ imports: [HealthModule] })
export class AppModule {}

export async function createApp(_env: ApiEnv): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
    logger: ['error', 'warn'],
  });
  app.enableShutdownHooks();
  await app.init();
  return app;
}
