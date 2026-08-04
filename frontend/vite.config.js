import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Vite does not populate process.env from .env files, so load them explicitly
  // for config-time values like the dev proxy target.
  const env = loadEnv(mode, import.meta.dirname, '');

  return {
    plugins: [react()],

    resolve: {
      alias: {
        // `@/…` imports keep deep component paths readable and refactor-safe.
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },

    server: {
      port: 5173,
      strictPort: true,
      /**
       * Dev proxy: the frontend calls same-origin `/api/*`, Vite forwards to the
       * Express server. Production behind a single origin behaves the same way —
       * so no environment-specific API URL is baked into the bundle.
       */
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4000',
          changeOrigin: true,
        },
      },
    },

    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
