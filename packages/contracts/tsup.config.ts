import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'tap/index': 'src/tap/index.ts', 'tap/node': 'src/tap/node.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
