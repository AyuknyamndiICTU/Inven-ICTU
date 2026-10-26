import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // Bundle the runtime dependencies so the installer ships no node_modules (electron-builder.yml).
    // Only Electron, Node built-ins and the optional native PC/SC binding (loaded at runtime) stay external.
    plugins: [externalizeDepsPlugin({ exclude: ['@labpass/contracts', 'zod', 'hash-wasm'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // PC/SC runs in its own utilityProcess (ADR-0002).
          'reader-host': resolve(__dirname, 'src/main/reader/reader-host.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    server: { port: 3101, strictPort: true },
    plugins: [react(), tailwindcss()],
    build: {
      minify: 'esbuild',
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
