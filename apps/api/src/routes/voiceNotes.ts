import type { FastifyInstance } from 'fastify'
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db/index.ts'
import { takeFirst, type Executor } from '../db/util.ts'
import { scope } from '../auth.ts'

/** Roughly three minutes of opus. Long enough for a debrief, small enough to POST. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024

const ALLOWED_MIME = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/aac',
]

const uploadQuery = z.object({
  durationMs: z.coerce.number().int().min(0).max(30 * 60_000).optional(),
  interactionId: z.string().uuid().optional(),
})

function baseMime(contentType: string): string {
  // MediaRecorder sends things like `audio/webm;codecs=opus`.
  return (contentType.split(';')[0] ?? '').trim().toLowerCase()
}

export async function voiceNoteRoutes(app: FastifyInstance) {
  /**
   * Audio arrives as a raw body rather than multipart — it is a single blob
   * with no other fields, so multipart would add a dependency and a parser for
   * no benefit.
   */
  app.addContentTypeParser(
    ALLOWED_MIME,
    { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES },
    (_req, body, done) => done(null, body),
  )

  app.addHook('onRequest', app.authenticate)

  app.post('/voice-notes', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const query = uploadQuery.parse(req.query)

    const mimeType = baseMime(req.headers['content-type'] ?? '')
    if (!ALLOWED_MIME.includes(mimeType)) {
      return reply.code(415).send({ error: 'unsupported_audio_type', got: mimeType })
    }

    const audio = req.body
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      return reply.code(400).send({ error: 'empty_audio' })
    }

    if (query.interactionId) {
      const owned = await db
        .select({ id: schema.interactions.id })
        .from(schema.interactions)
        .where(
          and(
            eq(schema.interactions.id, query.interactionId),
            eq(schema.interactions.orgId, orgId),
          ),
        )
        .limit(1)
      if (owned.length === 0) return reply.code(404).send({ error: 'interaction_not_found' })
    }

    const note = takeFirst(
      await db
        .insert(schema.voiceNotes)
        .values({
          orgId,
          userId,
          interactionId: query.interactionId ?? null,
          mimeType,
          durationMs: query.durationMs ?? null,
          sizeBytes: audio.length,
          audio,
        })
        .returning({
          id: schema.voiceNotes.id,
          mimeType: schema.voiceNotes.mimeType,
          durationMs: schema.voiceNotes.durationMs,
          sizeBytes: schema.voiceNotes.sizeBytes,
          createdAt: schema.voiceNotes.createdAt,
        }),
      'voice note',
    )

    return reply.code(201).send({ ...note, createdAt: note.createdAt.toISOString() })
  })

  /** Metadata only — never the bytes, so lists stay cheap. */
  app.get('/voice-notes', async (req) => {
    const { orgId } = scope(req)
    const { interactionId } = z
      .object({ interactionId: z.string().uuid() })
      .parse(req.query)

    const rows = await db
      .select({
        id: schema.voiceNotes.id,
        mimeType: schema.voiceNotes.mimeType,
        durationMs: schema.voiceNotes.durationMs,
        sizeBytes: schema.voiceNotes.sizeBytes,
        transcript: schema.voiceNotes.transcript,
        createdAt: schema.voiceNotes.createdAt,
      })
      .from(schema.voiceNotes)
      .where(
        and(
          eq(schema.voiceNotes.orgId, orgId),
          eq(schema.voiceNotes.interactionId, interactionId),
        ),
      )
      .orderBy(asc(schema.voiceNotes.createdAt))

    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
  })

  /**
   * The bytes. An <audio src> cannot carry an Authorization header, so the
   * client fetches this and turns it into a blob URL rather than pointing the
   * element straight at it.
   */
  app.get('/voice-notes/:id/audio', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }

    const rows = await db
      .select({ audio: schema.voiceNotes.audio, mimeType: schema.voiceNotes.mimeType })
      .from(schema.voiceNotes)
      .where(and(eq(schema.voiceNotes.id, id), eq(schema.voiceNotes.orgId, orgId)))
      .limit(1)

    const note = rows[0]
    if (!note) return reply.code(404).send({ error: 'not_found' })

    return reply
      .header('content-type', note.mimeType)
      .header('cache-control', 'private, max-age=3600')
      .send(note.audio)
  })

  /** Used to attach a browser-dictated transcript after the fact. */
  app.patch('/voice-notes/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    const body = z
      .object({ transcript: z.string().max(20_000).nullable() })
      .parse(req.body)

    const result = await db
      .update(schema.voiceNotes)
      .set({ transcript: body.transcript })
      .where(and(eq(schema.voiceNotes.id, id), eq(schema.voiceNotes.orgId, orgId)))
      .returning({ id: schema.voiceNotes.id })

    if (result.length === 0) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })

  app.delete('/voice-notes/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }

    const result = await db
      .delete(schema.voiceNotes)
      .where(and(eq(schema.voiceNotes.id, id), eq(schema.voiceNotes.orgId, orgId)))
      .returning({ id: schema.voiceNotes.id })

    if (result.length === 0) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })
}

/**
 * Clips are uploaded as they are recorded, so a visit the user abandons leaves
 * audio behind with nothing pointing at it. Swept hourly by the reminder worker.
 */
export async function purgeOrphanedVoiceNotes(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000)
  const deleted = await db
    .delete(schema.voiceNotes)
    .where(
      and(isNull(schema.voiceNotes.interactionId), lt(schema.voiceNotes.createdAt, cutoff)),
    )
    .returning({ id: schema.voiceNotes.id })
  return deleted.length
}

/**
 * Attaches freshly uploaded clips to the visit they were recorded for.
 *
 * `exec` must be the caller's open transaction: the interaction row is not
 * committed yet, so running this on a separate connection trips the foreign
 * key.
 */
export async function attachVoiceNotes(
  orgId: string,
  interactionId: string,
  voiceNoteIds: string[],
  exec: Executor = db,
): Promise<void> {
  if (voiceNoteIds.length === 0) return
  await exec
    .update(schema.voiceNotes)
    .set({ interactionId })
    .where(
      and(
        eq(schema.voiceNotes.orgId, orgId),
        isNull(schema.voiceNotes.interactionId),
        // inArray, not a raw `= any(...)` fragment: a raw array parameter is
        // sent as a string and Postgres rejects it as a malformed array literal.
        inArray(schema.voiceNotes.id, voiceNoteIds),
      ),
    )
}
