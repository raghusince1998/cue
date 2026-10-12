import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { updateDeliveryInput } from '@cue/shared'
import { scope } from '../auth.ts'
import { activeDeliveries, deleteDelivery, updateDelivery } from '../services/deliveries.ts'

const idParam = z.object({ id: z.string().uuid() })

export async function deliveryRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** Parcels on their way, and any that arrived in the last few hours. */
  app.get('/deliveries', async (req) => activeDeliveries(scope(req).sub))

  /** "Got it", a new date, a better name for what it is. */
  app.patch('/deliveries/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const row = await updateDelivery(scope(req).sub, id, updateDeliveryInput.parse(req.body))
    return row ?? reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/deliveries/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await deleteDelivery(scope(req).sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })
}
