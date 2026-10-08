import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createScheduleInput } from '@cue/shared'
import { scope } from '../auth.ts'
import { createSchedule, listSchedules, stopSchedule } from '../services/schedules.ts'

/** Schedules: steps at set distances from one date. See services/schedules.ts. */
export async function scheduleRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  app.get('/schedules', async (req) => {
    const { sub: userId } = scope(req)
    return { schedules: await listSchedules(userId) }
  })

  app.post('/schedules', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const input = createScheduleInput.parse(req.body)
    return reply.code(201).send(await createSchedule(orgId, userId, input))
  })

  app.delete('/schedules/:id', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const removed = await stopSchedule(userId, id)
    if (removed === null) return reply.code(404).send({ error: 'not_found' })
    return { removed }
  })
}
