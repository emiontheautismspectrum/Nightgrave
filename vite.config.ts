import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** dist/_headers: the CSP's connect-src gets the API origin from VITE_API_BASE (or nothing when offline). */
function headers(apiBase: string): Plugin {
  return {
    name: 'nightgrave-headers',
    apply: 'build',
    closeBundle() {
      let origin = '';
      try {
        origin = apiBase ? new URL(apiBase).origin : '';
      } catch {
        origin = '';
      }
      const src = readFileSync(resolve(__dirname, 'public/_headers'), 'utf8');
      writeFileSync(resolve(__dirname, 'dist/_headers'), src.replace("connect-src 'self' __API_ORIGIN__", origin ? `connect-src 'self' ${origin}` : "connect-src 'self'"));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
    plugins: [headers(env.VITE_API_BASE ?? process.env.VITE_API_BASE ?? '')],
    test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  };
});
