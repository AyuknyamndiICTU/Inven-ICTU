import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['react', 'react-dom', 'motion', 'motion/react'],
  // Components use hooks; Next.js needs the client boundary on the bundle.
  banner: { js: "'use client';" },
});
