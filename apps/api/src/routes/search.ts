import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { scope } from '../auth.ts'
import { searchEverything } from '../services/search.ts'
import { findPeople } from '../services/memory.ts'
import { buildHistory, forgetHistoryEntry } from '../services/history.ts'

export async function searchRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** Everything, by any of the words attached to it. */
  app.get('/search', async (req) => {
    const { sub: userId, orgId } = scope(req)
    const { q } = z.object({ q: z.string().max(200) }).parse(req.query)
    return searchEverything(orgId, userId, q)
  })

  /** Everything that has already happened, in one timeline. */
  app.get('/history', async (req) => {
    const { sub: userId, orgId } = scope(req)
    return { entries: await buildHistory(orgId, userId) }
  })

  /** Take one line off the record, for good. See forgetHistoryEntry. */
  app.delete('/history/:kind/:id', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { kind, id } = z
      .object({
        kind: z.enum(['visit', 'done', 'cancelled', 'deleted']),
        id: z.string().uuid(),
      })
      .parse(req.params)

    const removed = await forgetHistoryEntry(userId, kind, id)
    if (!removed) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })

  /**
   * Who could be meant by a word — "plumber", "Ramesh", a phone number.
   *
   * Separate from the full search because the answer is a choice, not a list
   * of results: it is what the capture box asks when a word fits two people.
   */
  app.get('/people/match', async (req) => {
    const { orgId } = scope(req)
    const { q } = z.object({ q: z.string().max(100) }).parse(req.query)
    return { people: await findPeople(orgId, q) }
  })
}
