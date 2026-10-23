import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app';
import { loadApiEnv } from './config/env';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildDbUrl } = require('../scripts/db-url.cjs') as { buildDbUrl: (db?: string) => string };
process.env.DATABASE_URL ??= buildDbUrl();
process.env.LABPASS_PROCESS = 'worker';

/** Background worker: outbox relay + durable consumers (alerts, notifications). Run with WORKER_MODE=separate on the API. */
async function bootstrap() {
  const env = loadApiEnv({ ...process.env, WORKER_MODE: 'separate' });
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(env, { http: false }), {
    logger: ['error', 'warn'],
  });
  ctx.enableShutdownHooks();
  console.warn('LabPass worker started');
}

void bootstrap();
