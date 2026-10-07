import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { sendNudgeTo } from '../services/dailyNudge.ts'

const preferencesInput = z.object({
  /** IANA name, e.g. "Asia/Kolkata". The browser reports its own. */
  timezone: z.string().min(1).max(80).optional(),
  dailyNudgeEnabled: z.boolean().optional(),
  dailyNudgeHour: z.number().int().min(0).max(23).optional(),
})

const selection = {
  timezone: schema.users.timezone,
  dailyNudgeEnabled: schema.users.dailyNudgeEnabled,
  dailyNudgeHour: schema.users.dailyNudgeHour,
  lastNudgeOn: schema.users.lastNudgeOn,
}

export async function meRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  app.get('/me/preferences', async (req) => {
    const { sub } = scope(req)
    const rows = await db.select(selection).from(schema.users).where(eq(schema.users.id, sub))
    return takeFirst(rows, 'preferences')
  })

  app.patch('/me/preferences', async (req, reply) => {
    const { sub } = scope(req)
    const body = preferencesInput.parse(req.body)

    if (body.timezone) {
      // Reject nonsense before it reaches SQL: an unknown zone name would make
      // `now() at time zone ...` throw inside the nudge worker every tick.
      try {
        new Intl.DateTimeFormat('en', { timeZone: body.timezone })
      } catch {
        return reply.code(400).send({ error: 'unknown_timezone' })
      }
    }

    await db
      .update(schema.users)
      .set({
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.dailyNudgeEnabled !== undefined
          ? { dailyNudgeEnabled: body.dailyNudgeEnabled }
          : {}),
        ...(body.dailyNudgeHour !== undefined ? { dailyNudgeHour: body.dailyNudgeHour } : {}),
      })
      .where(eq(schema.users.id, sub))

    const rows = await db.select(selection).from(schema.users).where(eq(schema.users.id, sub))
    return takeFirst(rows, 'preferences')
  })

  /**
   * Fires this user's evening nudge immediately, ignoring the clock, so the
   * wiring can be checked without waiting until 7pm. Deliberately targets the
   * caller only, and touches no preferences — an earlier version reset the
   * chosen hour and would have nudged every other user who happened to be due.
   */
  app.post('/me/preferences/test-nudge', async (req) => {
    const { sub } = scope(req)
    const rows = await db
      .select({ timezone: schema.users.timezone })
      .from(schema.users)
      .where(eq(schema.users.id, sub))

    return sendNudgeTo(sub, takeFirst(rows, 'user').timezone)
  })
}
