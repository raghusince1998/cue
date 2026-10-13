import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createExamInput, examDateInput, examDayInput, readAdmitCard, updateExamInput } from '@cue/shared'
import { scope } from '../auth.ts'
import { addExamDate, createExam, deleteExam, examById, listExams, saveExamDay, updateExam } from '../services/exams.ts'
import { pdfText } from '../services/pdfText.ts'

/** An admit card is a page or two; this is a ceiling, not a target. */
const MAX_CARD_BYTES = 5 * 1024 * 1024
const idParam = z.object({ id: z.string().uuid() })

export async function examRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: MAX_CARD_BYTES }, (_req, body, done) => done(null, body))
  app.addHook('onRequest', app.authenticate)

  app.get('/exams', async (req) => listExams(scope(req).sub))

  app.post('/exams', async (req, reply) => {
    const { orgId, sub } = scope(req)
    const made = await createExam(orgId, sub, createExamInput.parse(req.body))
    if (made === 'unknown_stage') return reply.code(400).send({ error: 'unknown_stage' })
    return reply.code(201).send(made.exam)
  })

  app.get('/exams/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await examById(scope(req).sub, id)) ?? reply.code(404).send({ error: 'not_found' })
  })

  app.patch('/exams/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const row = await updateExam(scope(req).sub, id, updateExamInput.parse(req.body))
    if (row === 'unknown_stage') return reply.code(400).send({ error: 'unknown_stage' })
    return row ?? reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/exams/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await deleteExam(scope(req).sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  /** One more date: the last day to apply, the exam, the result. */
  app.post('/exams/:id/dates', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const added = await addExamDate(scope(req).sub, id, examDateInput.parse(req.body))
    if (!added) return reply.code(404).send({ error: 'not_found' })
    return reply.code(added.planId ? 201 : 200).send({ ...added, exam: await examById(scope(req).sub, id) })
  })

  /**
   * An admit card read, nothing saved: a PDF as the body, or its text pasted
   * in as { text }. The PDF is read in memory and dropped. What comes back is
   * for the person to check before anything is made of it.
   */
  app.post('/exams/admit-card', async (req, reply) => {
    const text = Buffer.isBuffer(req.body)
      ? await pdfText(new Uint8Array(req.body), 3)
      : z.object({ text: z.string().max(20_000) }).parse(req.body).text
    if (!text?.trim()) {
      return reply.code(422).send({ problem: 'That PDF has no text to read. A scanned or locked one cannot be read; type the details instead.' })
    }
    const card = readAdmitCard(text)
    if (!card) return reply.code(422).send({ problem: 'That does not read as an admit card. Type the details instead.' })
    return { card }
  })

  /** The day itself, from a card as checked: the plan, what to carry, and the trip if it is away. */
  app.post('/exams/day', async (req, reply) => {
    const { orgId, sub } = scope(req)
    const saved = await saveExamDay(orgId, sub, examDayInput.parse(req.body))
    if (saved === 'not_found') return reply.code(404).send({ error: 'not_found' })
    return reply.code(201).send({ ...saved, exam: await examById(sub, saved.examId) })
  })
}
