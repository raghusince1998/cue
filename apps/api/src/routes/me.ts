import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { USE_KEYS } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { sendNudgeTo } from '../services/dailyNudge.ts'
import { sendBriefTo } from '../services/morningBrief.ts'
import { sendReportReminderTo } from '../services/dailyReport.ts'
import { filledSections } from '../services/sections.ts'

/** "" from a cleared input means none. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v?.trim() || null))

const preferencesInput = z.object({
  /** IANA name, e.g. "Asia/Kolkata". The browser reports its own. */
  timezone: z.string().min(1).max(80).optional(),
  dailyNudgeEnabled: z.boolean().optional(),
  dailyNudgeHour: z.number().int().min(0).max(23).optional(),
  followupPrompts: z.boolean().optional(),
  prepPrompts: z.boolean().optional(),
  weeklyReviewEnabled: z.boolean().optional(),
  weeklyReviewHour: z.number().int().min(0).max(23).optional(),
  morningBriefEnabled: z.boolean().optional(),
  morningBriefHour: z.number().int().min(0).max(23).optional(),
  reportEnabled: z.boolean().optional(),
  reportHour: z.number().int().min(0).max(23).optional(),
  reportToName: optionalText(120),
  reportToEmail: optionalText(200).refine((v) => !v || z.string().email().safeParse(v).success, {
    message: 'That email address does not look right.',
  }),
  reportToPhone: optionalText(40),
  /** Where they live: plans in this city are not trips. */
  homeCity: optionalText(120),
  /** "name@okaxis": put in reminders to pay you back. */
  /** What they use Cue for; the order they were picked in is kept. */
  uses: z
    .array(z.enum(USE_KEYS))
    .max(USE_KEYS.length)
    .transform((v) => [...new Set(v)])
    .optional(),
  upiId: optionalText(120).refine((v) => !v || /^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(v), {
    message: 'A UPI ID looks like name@okaxis.',
  }),
  /** Work and personal kept apart: nagging reminders wait for their own time. */
  keepApart: z.boolean().optional(),
  /** The working week: 0 is Sunday. */
  workDays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .transform((v) => [...new Set(v)].sort())
    .optional(),
  workStartHour: z.number().int().min(0).max(23).optional(),
  workEndHour: z.number().int().min(1).max(24).optional(),
})

const selection = {
  timezone: schema.users.timezone,
  dailyNudgeEnabled: schema.users.dailyNudgeEnabled,
  dailyNudgeHour: schema.users.dailyNudgeHour,
  lastNudgeOn: schema.users.lastNudgeOn,
  followupPrompts: schema.users.followupPrompts,
  prepPrompts: schema.users.prepPrompts,
  weeklyReviewEnabled: schema.users.weeklyReviewEnabled,
  weeklyReviewHour: schema.users.weeklyReviewHour,
  morningBriefEnabled: schema.users.morningBriefEnabled,
  morningBriefHour: schema.users.morningBriefHour,
  reportEnabled: schema.users.reportEnabled,
  reportHour: schema.users.reportHour,
  reportToName: schema.users.reportToName,
  reportToEmail: schema.users.reportToEmail,
  reportToPhone: schema.users.reportToPhone,
  homeCity: schema.users.homeCity,
  upiId: schema.users.upiId,
  uses: schema.users.uses,
  keepApart: schema.users.keepApart,
  workDays: schema.users.workDays,
  workStartHour: schema.users.workStartHour,
  workEndHour: schema.users.workEndHour,
}

export async function meRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** Sections with something in them, asked again after something is added. */
  app.get('/me/filled', async (req) => ({ filled: await filledSections(scope(req).sub) }))

  app.get('/me/preferences', async (req) => {
    const { sub } = scope(req)
    const rows = await db.select(selection).from(schema.users).where(eq(schema.users.id, sub))
    return takeFirst(rows, 'preferences')
  })

  app.patch('/me/preferences', async (req, reply) => {
    const { sub } = scope(req)
    const body = preferencesInput.parse(req.body)

    if (body.workStartHour !== undefined || body.workEndHour !== undefined) {
      // A working day has to end after it starts — checked against what is
      // already saved when only one end of it is being changed.
      const [current] = await db
        .select({ start: schema.users.workStartHour, end: schema.users.workEndHour })
        .from(schema.users)
        .where(eq(schema.users.id, sub))
      const start = body.workStartHour ?? current?.start ?? 9
      const end = body.workEndHour ?? current?.end ?? 18
      if (start >= end) return reply.code(400).send({ error: 'work_hours_backwards' })
    }

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
        ...(body.followupPrompts !== undefined ? { followupPrompts: body.followupPrompts } : {}),
        ...(body.prepPrompts !== undefined ? { prepPrompts: body.prepPrompts } : {}),
        ...(body.weeklyReviewEnabled !== undefined
          ? { weeklyReviewEnabled: body.weeklyReviewEnabled }
          : {}),
        ...(body.weeklyReviewHour !== undefined ? { weeklyReviewHour: body.weeklyReviewHour } : {}),
        ...(body.morningBriefEnabled !== undefined
          ? { morningBriefEnabled: body.morningBriefEnabled }
          : {}),
        ...(body.morningBriefHour !== undefined ? { morningBriefHour: body.morningBriefHour } : {}),
        ...(body.reportEnabled !== undefined ? { reportEnabled: body.reportEnabled } : {}),
        ...(body.reportHour !== undefined ? { reportHour: body.reportHour } : {}),
        ...(body.reportToName !== undefined ? { reportToName: body.reportToName } : {}),
        ...(body.reportToEmail !== undefined ? { reportToEmail: body.reportToEmail } : {}),
        ...(body.reportToPhone !== undefined ? { reportToPhone: body.reportToPhone } : {}),
        ...(body.homeCity !== undefined ? { homeCity: body.homeCity } : {}),
        ...(body.upiId !== undefined ? { upiId: body.upiId } : {}),
        ...(body.uses !== undefined ? { uses: body.uses } : {}),
        ...(body.keepApart !== undefined ? { keepApart: body.keepApart } : {}),
        ...(body.workDays !== undefined ? { workDays: body.workDays } : {}),
        ...(body.workStartHour !== undefined ? { workStartHour: body.workStartHour } : {}),
        ...(body.workEndHour !== undefined ? { workEndHour: body.workEndHour } : {}),
      })
      .where(eq(schema.users.id, sub))

    const rows = await db.select(selection).from(schema.users).where(eq(schema.users.id, sub))
    return takeFirst(rows, 'preferences')
  })

  /** Today's report reminder, now, whatever the hour — to see what it says. */
  app.post('/me/preferences/test-report', async (req) => {
    const { sub } = scope(req)
    const sent = await sendReportReminderTo(sub)
    return sent ?? { delivered: 0, title: null, body: null, empty: true }
  })

  /**
   * This user's morning brief, now, whatever the hour — to see what it says.
   * Says so when there is nothing to send rather than sending nothing.
   */
  app.post('/me/preferences/test-brief', async (req) => {
    const { sub } = scope(req)
    const rows = await db
      .select({ timezone: schema.users.timezone })
      .from(schema.users)
      .where(eq(schema.users.id, sub))
    const sent = await sendBriefTo(sub, takeFirst(rows, 'user').timezone)
    return sent ?? { delivered: 0, title: null, body: null, empty: true }
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
