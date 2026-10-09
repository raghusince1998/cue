import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { scope } from '../auth.ts'
import { dayReport, previousWorkingDay } from '../services/dailyReport.ts'

export async function reportRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /**
   * One day, written up. `standup` reports the last working day instead, with
   * today as what is next: yesterday, today, and what is blocking.
   */
  app.get('/report/day', async (req) => {
    const { sub: userId } = scope(req)
    const { date, standup } = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        standup: z.enum(['1']).optional(),
      })
      .parse(req.query)
    const now = new Date()
    if (standup) return dayReport(userId, await previousWorkingDay(userId, now), now, { next: now })
    const day = date
      ? new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
      : now
    return dayReport(userId, day, now)
  })
}
