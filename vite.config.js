import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// EchoVault is a static, client-only app (no backend). `base: './'` keeps the
// build portable so it can be dropped into any static host or wrapped by
// Capacitor for mobile later. The PWA plugin makes it installable and
// offline-capable — a natural fit for a local-first vault.
//
// `--mode lan` (npm run dev:lan) serves over HTTPS with a self-signed cert so
// the mic/System capture (which need a secure context) work when you open the
// LAN URL on a phone. Plain `npm run dev` stays HTTP on localhost.
export default defineConfig(({ mode }) => ({
  base: './',
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  plugins: [
    ...(mode === 'lan' ? [basicSsl()] : []),
    VitePWA({
      // Prompt (not autoUpdate) so a long-lived session can offer the user a
      // reload when a new version ships. injectRegister:false because we register
      // manually in main.js — an injected inline script would violate our CSP.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon-192.png', 'icon-512.png', 'maskable-512.png'],
      manifest: {
        id: '/',
        name: 'EchoVault — music visualizer & spectral vault',
        short_name: 'EchoVault',
        description: 'Measure what you hear and record a spectral fingerprint of it — a music visualizer and personal spectral vault.',
        theme_color: '#05060a',
        background_color: '#05060a',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        categories: ['music', 'entertainment', 'utilities'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Include json so the starter reference pack is available offline.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2,json}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
}))
