/// <reference types="vitest/config" />
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { serviceWorker } from './plugins/serviceWorker.ts';

const outDir = resolve(import.meta.dirname, '../server/dist');

/** emptyOutDir removes server/dist/.gitkeep, which keeps the Go embed pattern valid in a fresh checkout. */
const keepGitkeep: Plugin = {
  name: 'keep-gitkeep',
  apply: 'build',
  closeBundle() {
    writeFileSync(resolve(outDir, '.gitkeep'), '');
  },
};

export default defineConfig({
  plugins: [
    react(),
    // Home screen icons are fetched once by the OS, not by the running app.
    serviceWorker({ exclude: /^(icon-.*|apple-touch-icon)\.png$/ }),
    keepGitkeep,
  ],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    include: ['src/**/*.test.ts', 'plugins/**/*.test.ts'],
    environment: 'node',
  },
});
