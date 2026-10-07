import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// .env lives at the monorepo root so the API and the web app share one file.
const envDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '')

  return {
    envDir,
    plugins: [
      react(),
      VitePWA({
        // injectManifest (not generateSW) because we hand-write the service
        // worker: it needs push and notificationclick handlers Workbox won't add.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        },
        // Without this the service worker is dead in `vite dev`, and push is the
        // whole point of the skeleton.
        devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
        manifest: {
          name: 'Cue — your day, prompted',
          short_name: 'Cue',
          description: 'Plans, trips and the things you meant to do there.',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
    server: {
      port: Number(env.WEB_PORT) || 5173,
      // Fail loudly instead of silently hopping to the next free port — a
      // silent hop would break WEB_ORIGIN and produce confusing CORS errors.
      strictPort: true,
      // Lets you open the PWA from your phone on the same wifi to test GPS.
      host: true,
    },
  }
})
