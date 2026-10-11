import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createTrackerItemInput, trackerBoardParam, updateTrackerItemInput } from '@cue/shared'
import { scope } from '../auth.ts'
import { boardItems, createItem, deleteItem, itemById, itemHistory, openCounts, updateItem } from '../services/trackers.ts'

const idParam = z.object({ id: z.string().uuid() })

export async function trackerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** How many are open on each board. */
  app.get('/trackers', async (req) => openCounts(scope(req).sub))

  app.get('/trackers/:board', async (req) => {
    const { board } = trackerBoardParam.parse(req.params)
    return boardItems(scope(req).sub, board)
  })

  app.post('/trackers/:board', async (req, reply) => {
    const { orgId, sub } = scope(req)
    const { board } = trackerBoardParam.parse(req.params)
    const item = await createItem(orgId, sub, board, createTrackerItemInput.parse(req.body))
    if (item === 'unknown_stage') return reply.code(400).send({ error: 'unknown_stage' })
    return reply.code(201).send(item)
  })

  /** One item, with how it got here and the plans that were part of it. */
  app.get('/tracker-items/:id', async (req, reply) => {
    const { sub } = scope(req)
    const { id } = idParam.parse(req.params)
    const [item, history] = await Promise.all([itemById(sub, id), itemHistory(sub, id)])
    if (!item || !history) return reply.code(404).send({ error: 'not_found' })
    return { ...item, ...history }
  })

  app.patch('/tracker-items/:id', async (req, reply) => {
    const { orgId, sub } = scope(req)
    const { id } = idParam.parse(req.params)
    const item = await updateItem(orgId, sub, id, updateTrackerItemInput.parse(req.body))
    if (item === 'not_found') return reply.code(404).send({ error: 'not_found' })
    if (item === 'unknown_stage') return reply.code(400).send({ error: 'unknown_stage' })
    return item
  })

  app.delete('/tracker-items/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await deleteItem(scope(req).sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })
}
