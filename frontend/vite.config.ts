import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: the REST client uses base URL "/api".
// The backend (Fastify) serves routes WITHOUT an /api prefix, so we strip
// the leading /api before forwarding to http://localhost:3001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
