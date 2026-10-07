import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { sql } from 'drizzle-orm'
import { ZodError } from 'zod'
import { db } from './db/index.ts'
import { env, pushConfigured } from './env.ts'
import { registerAuth } from './auth.ts'
import { authRoutes } from './routes/auth.ts'
import { placeRoutes } from './routes/places.ts'
import { contactRoutes } from './routes/contacts.ts'
import { visitRoutes } from './routes/visits.ts'
import { commitmentRoutes } from './routes/commitments.ts'
import { pushRoutes } from './routes/push.ts'
import { voiceNoteRoutes, purgeOrphanedVoiceNotes } from './routes/voiceNotes.ts'
import { meRoutes } from './routes/me.ts'
import { aiRoutes } from './routes/ai.ts'
import { tripRoutes } from './routes/trips.ts'
import { recurrenceRoutes } from './routes/recurrences.ts'
import { calendarFeedRoutes } from './routes/calendarFeeds.ts'
import { oauthRoutes } from './routes/oauth.ts'
import { insightRoutes } from './routes/insights.ts'
import { quickAddRoutes } from './routes/quickAdd.ts'
import { searchRoutes } from './routes/search.ts'
import { checklistRoutes } from './routes/checklist.ts'
import { intentionRoutes } from './routes/intentions.ts'
import { startNudgeWorker } from './services/dailyNudge.ts'
import { startReminderWorker } from './worker/reminders.ts'
import { sweep } from './services/recurrence.ts'
import { syncAllFeeds } from './services/calendarFeed.ts'

const app = Fastify({ logger: { level: 'info' } })

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: 'invalid_input', issues: err.issues })
  }
  const status = err.statusCode ?? 500
  if (status >= 500) app.log.error(err)
  return reply.code(status).send({ error: err.message || 'internal_error' })
})

await app.register(cors, {
  // The Capacitor Android build later loads from capacitor://localhost, so the
  // allow-list is a list rather than a single origin from the start.
  origin: [env.webOrigin, 'capacitor://localhost', 'http://localhost'],
  credentials: true,
})

await registerAuth(app)

// Left unprefixed: load balancers and uptime checks expect /health.
app.get('/health', async () => ({ ok: true, push: pushConfigured }))

await app.register(authRoutes, { prefix: '/api' })
await app.register(placeRoutes, { prefix: '/api' })
await app.register(contactRoutes, { prefix: '/api' })
await app.register(visitRoutes, { prefix: '/api' })
await app.register(commitmentRoutes, { prefix: '/api' })
await app.register(pushRoutes, { prefix: '/api' })
await app.register(voiceNoteRoutes, { prefix: '/api' })
await app.register(meRoutes, { prefix: '/api' })
await app.register(aiRoutes, { prefix: '/api' })
await app.register(tripRoutes, { prefix: '/api' })
await app.register(recurrenceRoutes, { prefix: '/api' })
await app.register(calendarFeedRoutes, { prefix: '/api' })
await app.register(oauthRoutes, { prefix: '/api' })
await app.register(insightRoutes, { prefix: '/api' })
await app.register(quickAddRoutes, { prefix: '/api' })
await app.register(searchRoutes, { prefix: '/api' })
await app.register(checklistRoutes, { prefix: '/api' })
await app.register(intentionRoutes, { prefix: '/api' })

/**
 * In production the API also serves the built frontend, so the whole thing is
 * one process on one port with one URL. That removes CORS entirely, and means
 * a deployment is a single service rather than two that have to agree about
 * each other's addresses.
 *
 * In development this directory does not exist and Vite serves the frontend
 * instead, so the block simply does nothing.
 */
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
if (existsSync(join(webDist, 'index.html'))) {
  await app.register(fastifyStatic, { root: webDist })

  // Single-page app: anything that is not a file and not /api is a route the
  // client router owns, so hand it index.html and let the browser sort it out.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.method !== 'GET') {
      return reply.code(404).send({ error: 'not_found' })
    }
    return reply.sendFile('index.html')
  })
  app.log.info(`serving the built web app from ${webDist}`)
} else {
  app.log.info('no web build found — run npm run build to serve the app from here')
}

// Check the database once at startup. Without this the first failure surfaces
// as a stack trace from the reminder worker every 20 seconds, which buries the
// actual problem (usually "you have not run db:push yet").
try {
  await db.execute(sql`select 1`)
  app.log.info('database connection ok')
} catch (err) {
  const code = (err as { code?: string }).code
  const hint =
    code === '28P01'
      ? 'password authentication failed — check DATABASE_URL in .env'
      : code === '3D000'
        ? 'that database does not exist yet — create it, then run: npm run db:push'
        : (err as Error).message
  app.log.error(`Cannot reach the database: ${hint}`)
  app.log.error('The API will serve /health but every real request will fail.')
}

// Runs in-process for now. Splitting it into its own container is a one-line
// change later — the SKIP LOCKED claim already makes it safe to run N copies.
const stopWorker = startReminderWorker()
const stopNudges = startNudgeWorker()

// Keeps the rolling window of generated occurrences topped up. Hourly is ample
// for a 120-day horizon, and it runs once at boot so a series created while the
// server was down still gets its reminders queued.
const sweepRecurrences = () => {
  void sweep()
    .then((n) => n > 0 && app.log.info(`generated ${n} recurring occurrence(s)`))
    .catch((err) => app.log.warn({ err }, 'recurrence sweep failed'))
}
sweepRecurrences()
const recurrenceTimer = setInterval(sweepRecurrences, 60 * 60_000)

// Subscribed calendars, re-read on a timer. Google refreshes its secret iCal
// feed slowly — often hours behind — so polling faster than this would only
// burn requests without seeing anything new.
const syncFeeds = () => {
  void syncAllFeeds()
    .then((n) => n > 0 && app.log.info(`synced ${n} calendar feed(s)`))
    .catch((err) => app.log.warn({ err }, 'calendar sync failed'))
}
syncFeeds()
const feedTimer = setInterval(syncFeeds, 30 * 60_000)

// Audio recorded for a visit that was never saved has nothing pointing at it.
const purgeTimer = setInterval(
  () => {
    void purgeOrphanedVoiceNotes()
      .then((n) => n > 0 && app.log.info(`purged ${n} orphaned voice note(s)`))
      .catch((err) => app.log.warn({ err }, 'voice note purge failed'))
  },
  60 * 60_000,
)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    stopWorker()
    stopNudges()
    clearInterval(recurrenceTimer)
    clearInterval(feedTimer)
    clearInterval(purgeTimer)
    await app.close()
    process.exit(0)
  })
}

await app.listen({ port: env.port, host: '0.0.0.0' })

if (!pushConfigured) {
  app.log.warn('VAPID keys not set — reminders will fire but no push will be delivered.')
  app.log.warn('Generate them with: npm run vapid')
}
