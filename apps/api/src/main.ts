import 'reflect-metadata';
import { createApp } from './app';
import { loadApiEnv } from './config/env';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildDbUrl } = require('../scripts/db-url.cjs') as { buildDbUrl: (db?: string) => string };
process.env.DATABASE_URL ??= buildDbUrl();

async function bootstrap() {
  const env = loadApiEnv();
  const app = await createApp(env);
  await app.listen({ port: env.PORT, host: env.HOST });
  console.warn(`LabPass API listening on http://${env.HOST}:${env.PORT} (worker mode: ${env.WORKER_MODE})`);
}

void bootstrap();
