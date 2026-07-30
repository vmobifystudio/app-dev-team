import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `npm run dev` serves the UI on 5174 and proxies the data plane to `server.mjs` on 4174.
 *
 * The proxy matters for more than convenience: it keeps the browser's Origin same-origin, so the
 * dev server exercises the SAME CSRF path as production instead of a relaxed one. A dev setup that
 * bypasses the guard is a dev setup where the guard is never tested.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/state': 'http://127.0.0.1:4174',
      '/action': 'http://127.0.0.1:4174',
      '/events': { target: 'http://127.0.0.1:4174', changeOrigin: false, ws: false },
    },
  },
  build: {
    outDir: 'dist',
    // One page, no network fetches at runtime beyond this server's own endpoints.
    sourcemap: false,
  },
});
