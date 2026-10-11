import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createOwedInput, owedIdsInput, setOwedStatusInput, setSharesInput } from '@cue/shared'
import { scope } from '../auth.ts'
import { expenseById } from '../services/expenses.ts'
import { addOwed, deleteOwed, markAsked, owedPeople, setOwedStatus, setShares } from '../services/owed.ts'

const idParam = z.object({ id: z.string().uuid() })

export async function owedRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** Who owes you, most first. */
  app.get('/owed', async (req) => owedPeople(scope(req).sub))

  /** Money lent, or owed for anything else. */
  app.post('/owed', async (req, reply) => {
    const { orgId, sub } = scope(req)
    const id = await addOwed(orgId, sub, createOwedInput.parse(req.body))
    return id ? reply.code(201).send({ id }) : reply.code(400).send({ error: 'who_owes_it' })
  })

  /** Who pays back their part of an expense; the rest is claimed from the company. */
  app.put('/expenses/:id/shares', async (req, reply) => {
    const { orgId, sub } = scope(req)
    const { id } = idParam.parse(req.params)
    const outcome = await setShares(orgId, sub, id, setSharesInput.parse(req.body).shares)
    if (outcome === 'not_found') return reply.code(404).send({ error: 'not_found' })
    if (outcome === 'too_much') return reply.code(400).send({ error: 'shares_exceed_amount' })
    return expenseById(sub, id)
  })

  app.post('/owed/status', async (req) => {
    const { ids, status } = setOwedStatusInput.parse(req.body)
    return { changed: await setOwedStatus(scope(req).sub, ids, status) }
  })

  app.post('/owed/asked', async (req) => {
    const { ids } = owedIdsInput.parse(req.body)
    return { changed: await markAsked(scope(req).sub, ids) }
  })

  app.delete('/owed/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await deleteOwed(scope(req).sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })
}
