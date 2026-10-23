import 'reflect-metadata';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadApiEnv } from '../src/config/env';

describe('API smoke', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(loadApiEnv({ NODE_ENV: 'test' }));
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
