import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { scope } from '../auth.ts'
import { availability } from '../services/availability.ts'

/** Free times to offer someone. See services/availability.ts. */
export async function availabilityRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  app.get('/availability', async (req) => {
    const { sub: userId } = scope(req)
    const q = z
      .object({
        minutes: z.coerce.number().int().min(15).max(240).default(30),
        range: z.enum(['soon', 'week', 'next']).default('soon'),
        part: z.enum(['any', 'morning', 'afternoon']).default('any'),
        count: z.coerce.number().int().min(1).max(10).default(6),
      })
      .parse(req.query)
    const slots = await availability(userId, q)
    return { minutes: q.minutes, slots: slots.map((s) => s.toISOString()) }
  })
}
