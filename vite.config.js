import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// EchoVault is a static, client-only app (no backend). `base: './'` keeps the
// build portable so it can be dropped into any static host or wrapped by
// Capacitor for mobile later. The PWA plugin makes it installable and
// offline-capable — a natural fit for a local-first vault.
export default defineConfig({
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
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'maskable-512.png'],
      manifest: {
        name: 'EchoVault — music visualizer & spectral vault',
        short_name: 'EchoVault',
        description: 'Measure what you hear and record a spectral fingerprint of it — a music visualizer and personal spectral vault.',
        theme_color: '#05060a',
        background_color: '#05060a',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
})
