import type { FastifyInstance } from 'fastify'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { encryptSecret, secretsConfigured } from '../secrets.ts'
import { FeedError, hintFor, importIcs, syncFeed } from '../services/calendarFeed.ts'

type FeedRow = typeof schema.calendarFeeds.$inferSelect

/** The URL never comes back out — only what is needed to recognise it. */
function toDTO(row: FeedRow) {
  return {
    id: row.id,
    label: row.label,
    source: row.source,
    fileName: row.fileName,
    historyDays: row.historyDays,
    urlHint: row.urlHint,
    remind: row.remind,
    status: row.status,
    calendarName: row.calendarName,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    lastError: row.lastError,
    lastEventCount: row.lastEventCount,
    lastSkippedCount: row.lastSkippedCount,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Null is meaningful — it means "no lower bound", not "unset". */
const historyDays = z.number().int().min(0).max(7300).nullable()

const createInput = z.object({
  label: z.string().min(1).max(100).default('Google Calendar'),
  url: z.string().min(10).max(2000),
  remind: z.boolean().default(true),
  historyDays: historyDays.optional(),
})

/** A year of a busy calendar is well under a megabyte of text. */
const MAX_ICS_BYTES = 8 * 1024 * 1024

const uploadQuery = z.object({
  label: z.string().min(1).max(100).default('My calendar'),
  fileName: z.string().max(255).optional(),
  remind: z.coerce.boolean().default(true),
  /** "all" is how a query string says "no lower bound". */
  historyDays: z
    .union([z.literal('all'), z.coerce.number().int().min(0).max(7300)])
    .optional()
    .transform((v) => (v === 'all' ? null : v)),
  /** Re-uploading into an existing subscription instead of making a new one. */
  feedId: z.string().uuid().optional(),
})

export async function calendarFeedRoutes(app: FastifyInstance) {
  /**
   * The .ics arrives as a raw body: it is one file with no other fields, so
   * multipart would mean a dependency and a parser for no benefit. Mirrors how
   * voice notes are uploaded.
   */
  app.addContentTypeParser(
    ['text/calendar', 'text/plain', 'application/octet-stream'],
    { parseAs: 'string', bodyLimit: MAX_ICS_BYTES },
    (_req, body, done) => done(null, body),
  )

  app.addHook('onRequest', app.authenticate)

  async function own(id: string, userId: string): Promise<FeedRow | null> {
    const [row] = await db
      .select()
      .from(schema.calendarFeeds)
      .where(and(eq(schema.calendarFeeds.id, id), eq(schema.calendarFeeds.userId, userId)))
      .limit(1)
    return row ?? null
  }

  app.get('/calendar-feeds', async (req) => {
    const { sub: userId } = scope(req)
    const rows = await db
      .select()
      .from(schema.calendarFeeds)
      .where(eq(schema.calendarFeeds.userId, userId))
      .orderBy(asc(schema.calendarFeeds.createdAt))
    return { feeds: rows.map(toDTO), encryptionReady: secretsConfigured() }
  })

  /**
   * Subscribing. The first sync runs inline rather than on the timer, because
   * a wrong URL should be reported while the user is still looking at it — not
   * silently an hour later.
   */
  app.post('/calendar-feeds', async (req, reply) => {
    const { sub: userId, orgId } = scope(req)
    const input = createInput.parse(req.body)

    if (!secretsConfigured()) {
      return reply.code(400).send({
        error: 'encryption_key_required',
        message: 'Set ENCRYPTION_KEY before storing a calendar address.',
      })
    }

    const url = input.url.trim()
    const row = takeFirst(
      await db
        .insert(schema.calendarFeeds)
        .values({
          orgId,
          userId,
          label: input.label,
          urlEncrypted: encryptSecret(url),
          urlHint: hintFor(url),
          remind: input.remind,
          historyDays: input.historyDays === undefined ? 365 : input.historyDays,
        })
        .returning(),
      'calendar feed',
    )

    try {
      const report = await syncFeed(row)
      const updated = takeFirst(
        await db
          .update(schema.calendarFeeds)
          .set({
            lastSyncedAt: new Date(),
            lastError: null,
            lastEventCount: report.imported + report.updated + report.repeating,
            lastSkippedCount: report.skipped,
            calendarName: report.calendarName,
          })
          .where(eq(schema.calendarFeeds.id, row.id))
          .returning(),
        'calendar feed',
      )
      return reply.code(201).send({ feed: toDTO(updated), report })
    } catch (err) {
      // A subscription that has never worked is not worth keeping: leaving it
      // behind would mean an error row the user has to find and delete.
      await db.delete(schema.calendarFeeds).where(eq(schema.calendarFeeds.id, row.id))
      const message = err instanceof FeedError ? err.message : (err as Error).message
      return reply
        .code(400)
        .send({ error: err instanceof FeedError ? err.code : 'sync_failed', message })
    }
  })

  /**
   * Importing from an exported .ics file.
   *
   * The path that always works. A Workspace admin can switch off external
   * sharing, which removes the secret iCal address altogether, and a calendar
   * you do not own never had one — but anyone can export a file. Re-uploading
   * a fresh export updates in place rather than duplicating, because the
   * dedupe key is the event UID, not how the file arrived.
   */
  app.post('/calendar-feeds/upload', async (req, reply) => {
    const { sub: userId, orgId } = scope(req)
    const { label, remind, fileName, feedId, historyDays } = uploadQuery.parse(req.query)

    // parseAs 'string' above means the body is already text.
    const text = typeof req.body === 'string' ? req.body : null
    if (!text || !text.includes('BEGIN:VCALENDAR')) {
      return reply.code(400).send({
        error: 'not_a_calendar',
        message: 'That file is not an iCalendar export — it should end in .ics.',
      })
    }

    // Re-uploading into an existing subscription keeps its history and id.
    const existing = feedId ? await own(feedId, userId) : null
    if (feedId && !existing) return reply.code(404).send({ error: 'not_found' })

    const row =
      existing ??
      takeFirst(
        await db
          .insert(schema.calendarFeeds)
          .values({
            orgId,
            userId,
            label,
            source: 'file',
            fileName: fileName ?? null,
            urlEncrypted: null,
            urlHint: null,
            remind,
            historyDays: historyDays === undefined ? 365 : historyDays,
          })
          .returning(),
        'calendar feed',
      )

    // A re-upload may be widening the window; apply that before reading.
    const active =
      existing && historyDays !== undefined && existing.historyDays !== historyDays
        ? takeFirst(
            await db
              .update(schema.calendarFeeds)
              .set({ historyDays })
              .where(eq(schema.calendarFeeds.id, row.id))
              .returning(),
            'calendar feed',
          )
        : row

    try {
      const report = await importIcs(active, text)
      const updated = takeFirst(
        await db
          .update(schema.calendarFeeds)
          .set({
            lastSyncedAt: new Date(),
            lastError: null,
            lastEventCount: report.imported + report.updated + report.repeating,
            lastSkippedCount: report.skipped,
            calendarName: report.calendarName,
            fileName: fileName ?? row.fileName,
          })
          .where(eq(schema.calendarFeeds.id, row.id))
          .returning(),
        'calendar feed',
      )
      return reply.code(existing ? 200 : 201).send({ feed: toDTO(updated), report })
    } catch (err) {
      // Only tear down a subscription this call created; never one that was
      // already working before a bad re-upload.
      if (!existing) {
        await db.delete(schema.calendarFeeds).where(eq(schema.calendarFeeds.id, row.id))
      }
      return reply.code(400).send({ error: 'import_failed', message: (err as Error).message })
    }
  })

  app.post('/calendar-feeds/:id/sync', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)

    const feed = await own(id, userId)
    if (!feed) return reply.code(404).send({ error: 'not_found' })

    try {
      const report = await syncFeed(feed)
      const updated = takeFirst(
        await db
          .update(schema.calendarFeeds)
          .set({
            lastSyncedAt: new Date(),
            lastError: null,
            lastEventCount: report.imported + report.updated + report.repeating,
            lastSkippedCount: report.skipped,
            calendarName: report.calendarName,
          })
          .where(eq(schema.calendarFeeds.id, id))
          .returning(),
        'calendar feed',
      )
      return { feed: toDTO(updated), report }
    } catch (err) {
      const message = err instanceof FeedError ? err.message : (err as Error).message
      await db
        .update(schema.calendarFeeds)
        .set({ lastSyncedAt: new Date(), lastError: message })
        .where(eq(schema.calendarFeeds.id, id))
      return reply
        .code(400)
        .send({ error: err instanceof FeedError ? err.code : 'sync_failed', message })
    }
  })

  app.patch('/calendar-feeds/:id', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const input = z
      .object({
        label: z.string().min(1).max(100).optional(),
        remind: z.boolean().optional(),
        historyDays: historyDays.optional(),
      })
      .parse(req.body)

    if (!(await own(id, userId))) return reply.code(404).send({ error: 'not_found' })

    const row = takeFirst(
      await db
        .update(schema.calendarFeeds)
        .set(input)
        .where(eq(schema.calendarFeeds.id, id))
        .returning(),
      'calendar feed',
    )
    return { feed: toDTO(row) }
  })

  /**
   * Unsubscribing takes the mirrored events with it — they only ever existed
   * as a copy, and leaving orphans behind would be worse than removing them.
   */
  app.delete('/calendar-feeds/:id', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)

    if (!(await own(id, userId))) return reply.code(404).send({ error: 'not_found' })

    await db.delete(schema.calendarFeeds).where(eq(schema.calendarFeeds.id, id))
    return { ok: true }
  })
}
