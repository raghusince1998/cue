import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createTrackerItemInput,
  editTrackerUpdateInput,
  trackerBoardParam,
  trackerUpdateInput,
  updateTrackerItemInput,
} from '@cue/shared'
import { scope } from '../auth.ts'
import {
  addUpdate,
  boardItems,
  createItem,
  deleteItem,
  editUpdate,
  itemById,
  itemHistory,
  openCounts,
  removeUpdate,
  suggestions,
  updateItem,
} from '../services/trackers.ts'
import { attachVoiceNotes } from './voiceNotes.ts'

const idParam = z.object({ id: z.string().uuid() })
const updateParam = z.object({ id: z.string().uuid(), updateId: z.string().uuid() })

export async function trackerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** How many are open on each board. */
  app.get('/trackers', async (req) => openCounts(scope(req).sub))

  app.get('/trackers/:board', async (req) => {
    const { board } = trackerBoardParam.parse(req.params)
    return boardItems(scope(req).sub, board)
  })

  /** What is typed most on this board, for one-tap filling. */
  app.get('/trackers/:board/suggestions', async (req) => {
    const { board } = trackerBoardParam.parse(req.params)
    return suggestions(scope(req).sub, board)
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

  /** A visit or a call on it: who, how it went, what was said. */
  app.post('/tracker-items/:id/updates', async (req, reply) => {
    const { orgId, sub } = scope(req)
    const { id } = idParam.parse(req.params)
    const body = trackerUpdateInput.parse(req.body)
    const saved = await addUpdate(orgId, sub, id, body)
    if (saved === 'not_found') return reply.code(404).send({ error: 'not_found' })
    const clips = body.voiceNoteIds ?? []
    await attachVoiceNotes(orgId, saved.update.id, clips)
    return reply.code(201).send({ ...saved, update: { ...saved.update, voiceNotes: clips.length } })
  })

  app.patch('/tracker-items/:id/updates/:updateId', async (req, reply) => {
    const { id, updateId } = updateParam.parse(req.params)
    const done = await editUpdate(scope(req).sub, id, updateId, editTrackerUpdateInput.parse(req.body))
    return done ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/tracker-items/:id/updates/:updateId', async (req, reply) => {
    const { id, updateId } = updateParam.parse(req.params)
    return (await removeUpdate(scope(req).sub, id, updateId)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/tracker-items/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await deleteItem(scope(req).sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })
}
