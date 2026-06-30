import { defineConfig } from 'vite'

// EchoVault is a static, client-only app (no backend). `base: './'` keeps the
// build portable so it can be dropped into any static host or wrapped by
// Capacitor for mobile later.
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
})
