import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { startGreetingsInput } from '@cue/shared'
import { scope } from '../auth.ts'
import {
  greetingRun,
  greetingRuns,
  markGreeted,
  startGreetings,
  upcomingOccasions,
} from '../services/occasions.ts'

export async function occasionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** Birthdays and anniversaries coming up, soonest first. */
  app.get('/occasions/upcoming', async (req) => {
    const { orgId } = scope(req)
    const { days } = z.object({ days: z.coerce.number().int().min(0).max(366).default(30) }).parse(req.query)
    return upcomingOccasions(orgId, days)
  })

  app.get('/greetings', async (req) => greetingRuns(scope(req).sub))

  /** A round of greetings: one occasion, one message, a list of people. */
  app.post('/greetings', async (req, reply) => {
    const { orgId, sub } = scope(req)
    const run = await startGreetings(orgId, sub, startGreetingsInput.parse(req.body))
    if (!run) return reply.code(400).send({ error: 'nobody_to_greet' })
    return reply.code(201).send(await greetingRun(sub, run.id))
  })

  app.get('/greetings/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    return (await greetingRun(scope(req).sub, id)) ?? reply.code(404).send({ error: 'not_found' })
  })

  app.post('/greetings/:id/sent', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const { contactId } = z.object({ contactId: z.string().uuid() }).parse(req.body)
    return (await markGreeted(scope(req).sub, id, contactId)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })
}
