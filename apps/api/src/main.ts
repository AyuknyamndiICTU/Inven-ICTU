import 'reflect-metadata';
import { createApp } from './app';
import { loadApiEnv } from './config/env';

async function bootstrap() {
  const env = loadApiEnv();
  const app = await createApp(env);
  await app.listen({ port: env.PORT, host: env.HOST });
  console.warn(`LabPass API listening on http://${env.HOST}:${env.PORT}`);
}

void bootstrap();
