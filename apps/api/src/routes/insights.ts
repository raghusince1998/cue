import type { FastifyInstance } from 'fastify'
import { scope } from '../auth.ts'
import { buildInsights, buildSummary } from '../services/insights.ts'
import { clearSampleDay, hasSampleDay, loadSampleDay } from '../services/sampleDay.ts'
import { applyPlan, planTomorrow } from '../services/planTomorrow.ts'
import { applyTriage, buildTriage } from '../services/triage.ts'
import { z } from 'zod'

export async function insightRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /**
   * What the app has noticed, and the numbers behind it.
   *
   * One call rather than two, because the dashboard shows them together and a
   * half-loaded header is worse than a slightly slower one.
   */
  app.get('/insights', async (req) => {
    const { sub: userId } = scope(req)
    const now = new Date()
    const [insights, summary] = await Promise.all([
      buildInsights(userId, now),
      buildSummary(userId, now),
    ])
    return { insights, summary, sample: await hasSampleDay(scope(req).orgId, userId) }
  })

  /**
   * Fills the account with a realistic week.
   *
   * Not a gimmick: every judgement the app makes needs data before it has
   * anything to say, so an empty account makes a reasoning tool look like an
   * empty list. Marked throughout and removable in one call.
   */
  app.post('/sample-day', async (req, reply) => {
    const { sub: userId, orgId } = scope(req)
    const report = await loadSampleDay(orgId, userId)
    return reply.code(201).send({ report })
  })

  /** What tomorrow could look like. Writes nothing. */
  app.get('/plan/tomorrow', async (req) => {
    const { sub: userId } = scope(req)
    return planTomorrow(userId)
  })

  /** Accepts a plan. Only the rows named, and only ones still unscheduled. */
  app.post('/plan/tomorrow', async (req) => {
    const { sub: userId } = scope(req)
    const { proposals } = z
      .object({
        proposals: z
          .array(z.object({ commitmentId: z.string().uuid(), at: z.string().datetime() }))
          .max(50),
      })
      .parse(req.body)
    return { applied: await applyPlan(userId, proposals) }
  })

  /** What has stopped moving, and why the app thinks so. Writes nothing. */
  app.get('/triage', async (req) => {
    const { sub: userId } = scope(req)
    const { all } = z.object({ all: z.string().optional() }).parse(req.query)
    return buildTriage(userId, new Date(), { all: all === '1' })
  })

  /** Applies what was decided about each stuck item. */
  app.post('/triage', async (req) => {
    const { sub: userId } = scope(req)
    const { decisions } = z
      .object({
        decisions: z
          .array(
            z.object({
              id: z.string().uuid(),
              action: z.enum(['done', 'reschedule', 'someday', 'drop']),
              at: z.string().datetime().optional(),
            }),
          )
          .max(100),
      })
      .parse(req.body)
    return applyTriage(userId, decisions)
  })

  app.delete('/sample-day', async (req) => {
    const { sub: userId, orgId } = scope(req)
    return { removed: await clearSampleDay(orgId, userId) }
  })
}
