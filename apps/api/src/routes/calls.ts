import type { FastifyInstance } from 'fastify'
import { logCallInput } from '@cue/shared'
import { scope } from '../auth.ts'
import { logCall } from '../services/calls.ts'

export async function callRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** A call, just ended: how it went, and what happens next. */
  app.post('/calls', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const body = logCallInput.parse(req.body)
    return reply.code(201).send(await logCall(orgId, userId, body))
  })
}
