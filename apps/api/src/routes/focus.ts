import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { scope } from '../auth.ts'
import { endFocus, startFocus } from '../services/focus.ts'

/** Focus time. See services/focus.ts. */
export async function focusRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  app.post('/focus', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const body = z
      .object({
        minutes: z.number().int().min(10).max(240),
        startAt: z.string().datetime().optional(),
        title: z.string().max(200).nullable().optional(),
        allowConflict: z.boolean().optional(),
      })
      .parse(req.body)
    const result = await startFocus(orgId, userId, {
      minutes: body.minutes,
      startAt: body.startAt ? new Date(body.startAt) : undefined,
      title: body.title,
      allowConflict: body.allowConflict,
    })
    if (!result.ok) return reply.code(409).send({ error: 'time_conflict', conflicts: result.conflicts })
    return reply.code(201).send({
      id: result.id,
      startsAt: result.startsAt.toISOString(),
      endsAt: result.endsAt.toISOString(),
    })
  })

  /** End early (or call off one that has not started); held reminders go at once. */
  app.post('/focus/:id/end', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const result = await endFocus(userId, id)
    if (!result) return reply.code(404).send({ error: 'not_found' })
    return result
  })
}
