import { createRequire } from 'node:module';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
const { buildDbUrl, buildRedisUrl } = require('./scripts/db-url.cjs') as {
  buildDbUrl: (db?: string) => string;
  buildRedisUrl: () => string;
};

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: buildDbUrl('labpass_test'),
      REDIS_URL: `${buildRedisUrl().replace(/\/\d*$/, '')}/1`,
    },
    // Integration tests share one test database, so files run one at a time.
    fileParallelism: false,
    // Generous limits: CI runners and student laptops can be slow; correctness, not speed, is asserted here.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
