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
          // Store screenshots are for the install sheet and the Play listing,
          // not for working offline: a megabyte nobody needs cached.
          globIgnores: ['store/**'],
        },
        // Without this the service worker is dead in `vite dev`, and push is the
        // whole point of the skeleton.
        devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
        manifest: {
          // A stable identity, so the installed app (and the Play Store
          // wrapper around it) stays the same app if start_url ever moves.
          id: '/',
          name: 'Cue — say it once, Cue remembers the rest',
          short_name: 'Cue',
          description:
            'A planner that remembers for you. Type a plan in one line, or let Cue find train tickets, parcels, bills and renewals in your email — each with a reminder at the right time.',
          categories: ['productivity', 'lifestyle', 'travel'],
          // Shown in the richer install sheet on Android and desktop Chrome.
          screenshots: [
            { src: '/store/phone-1.png', sizes: '1080x1920', type: 'image/png', form_factor: 'narrow', label: 'Plan in one line' },
            { src: '/store/phone-2.png', sizes: '1080x1920', type: 'image/png', form_factor: 'narrow', label: 'Your day, work and personal' },
            { src: '/store/phone-3.png', sizes: '1080x1920', type: 'image/png', form_factor: 'narrow', label: 'A trip, day by day' },
            { src: '/store/phone-4.png', sizes: '1080x1920', type: 'image/png', form_factor: 'narrow', label: 'Bills and renewals, on time' },
            { src: '/store/wide-1.png', sizes: '1920x1080', type: 'image/png', form_factor: 'wide', label: 'Cue on a bigger screen' },
          ],
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          // Long-press the icon on the home screen. Each opens Today ready
          // for that one thing, so capture starts from outside the app.
          shortcuts: [
            {
              name: 'Speak a reminder',
              short_name: 'Speak',
              description: 'Say it, and it is planned',
              url: '/?capture=voice',
              icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Add something',
              short_name: 'Add',
              description: 'One line: call Dr. Mehta tomorrow 4pm',
              url: '/?capture=1',
              icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Log a call',
              short_name: 'Log a call',
              description: 'How it went, and what happens next',
              url: '/?logcall=1',
              icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
            },
          ],
          // In the share sheet of other apps: WhatsApp, Gmail, Messages. What
          // is shared arrives in the box on Today (see lib/share.ts).
          share_target: {
            action: '/share',
            method: 'GET',
            enctype: 'application/x-www-form-urlencoded',
            params: { title: 'title', text: 'text', url: 'url' },
          },
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
