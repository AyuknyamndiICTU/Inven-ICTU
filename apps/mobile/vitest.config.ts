import { defineConfig } from 'vitest/config';

// Unit tests for platform-independent logic only (src/lib). UI is tested with Playwright (web) and Maestro (Android) in S12.
export default defineConfig({
  test: { include: ['src/lib/**/*.test.ts'], environment: 'node' },
});
