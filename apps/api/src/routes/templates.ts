import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { saveTemplateInput } from '@cue/shared'
import { scope } from '../auth.ts'
import {
  addStarters,
  createTemplate,
  deleteTemplate,
  listTemplates,
  markUsed,
  updateTemplate,
} from '../services/templates.ts'

const idParam = z.object({ id: z.string().uuid() })

export async function templateRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  app.get('/templates', async (req) => listTemplates(scope(req).sub))

  app.post('/templates', async (req, reply) => {
    const { orgId, sub } = scope(req)
    return reply.code(201).send(await createTemplate(orgId, sub, saveTemplateInput.parse(req.body)))
  })

  /** Declared before /templates/:id so the literal segment wins. */
  app.post('/templates/starters', async (req) => {
    const { orgId, sub } = scope(req)
    return addStarters(orgId, sub)
  })

  app.patch('/templates/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const row = await updateTemplate(scope(req).sub, id, saveTemplateInput.parse(req.body))
    return row ?? reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/templates/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await deleteTemplate(scope(req).sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  /** Sent: it moves up the list. */
  app.post('/templates/:id/used', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await markUsed(scope(req).sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })
}
