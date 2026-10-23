// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * I5: animation values must come from @labpass/motion (no raw durations/springs in UI code).
 * Matches object properties such as `duration: 0.3` or `stiffness: 400` written as numeric literals.
 */
const noRawMotion = {
  selector:
    'Property[key.name=/^(duration|delay|stiffness|damping|mass|staggerChildren|delayChildren)$/] > Literal[value>0]',
  message: 'I5: use tokens from @labpass/motion instead of raw motion values.',
};

/**
 * I6: domain code depends on ports only. Adapters/infra live in `infra/` or `adapters/` folders.
 */
const domainBoundary = {
  patterns: [
    {
      group: ['@prisma/client', '.prisma/*', 'nodemailer', 'ioredis', 'bullmq', 'web-push', 'electron', '@pokusew/*'],
      message: 'I6: domain code must not import infrastructure SDKs. Depend on a port and inject an adapter.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      '**/.expo/**',
      '**/android/**',
      '**/ios/**',
      'spikes/**',
      '**/*.config.*',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/api/src/**/domain/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', domainBoundary] },
  },
  {
    files: [
      'packages/ui/src/**/*.{ts,tsx}',
      'apps/admin/src/**/*.{ts,tsx}',
      'apps/kiosk/src/renderer/**/*.{ts,tsx}',
      'apps/mobile/src/**/*.{ts,tsx}',
    ],
    rules: { 'no-restricted-syntax': ['error', noRawMotion] },
  },
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      // NestJS DI needs runtime class imports for constructor parameter metadata.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/test/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs}'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
