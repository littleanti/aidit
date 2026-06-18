import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// L2 Content-Security-Policy. This is the primary key-exfiltration mitigation:
// connect-src is locked to same-origin (REST /api + SSE) plus the Google
// Generative Language endpoint that the BYOK client calls directly.
//
// We inject this ONLY into the production-built index.html. In dev, Vite needs
// inline scripts, eval, and a websocket connection for HMR, which a strict CSP
// would block — so dev is left untouched.
const CSP_PRODUCTION = [
  "default-src 'self'",
  "connect-src 'self' https://generativelanguage.googleapis.com",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

function cspInjectionPlugin(): Plugin {
  return {
    name: 'aidit-csp-injection',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: CSP_PRODUCTION,
            },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

// Dev proxy: the REST client uses base URL "/api".
// The backend (Fastify) serves routes WITHOUT an /api prefix, so we strip
// the leading /api before forwarding to http://localhost:3001.
export default defineConfig({
  plugins: [
    react(),
    cspInjectionPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'maskable-512.png'],
      manifest: {
        name: 'Aidit',
        short_name: 'Aidit',
        description: 'Reddit-style community where every post is a shared AI chat thread.',
        theme_color: '#7c3aed',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the built app shell. Navigation requests fall back to
        // index.html so the installed PWA opens offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        // Never let the SW intercept API or SSE traffic — those must always
        // hit the network (and SSE must not be cached/buffered).
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: {
        // Keep the SW disabled in dev so it never interferes with HMR.
        enabled: false,
      },
    }),
  ],
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
