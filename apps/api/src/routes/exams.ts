import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createExamInput, examDateInput, examDayInput, mockScoreInput, readAdmitCard, studyPlanInput, updateExamInput } from '@cue/shared'
import { scope } from '../auth.ts'
import { findNumber, numbersIn } from '@cue/shared'
import {
  addExamDate,
  addMock,
  createExam,
  deleteExam,
  deleteMock,
  examById,
  examRowOf,
  listExams,
  makeStudyPlan,
  saveExamDay,
  stopStudy,
  updateExam,
} from '../services/exams.ts'
import { checkKeptLists } from '../services/noticeWatch.ts'
import { pdfPages, pdfText } from '../services/pdfText.ts'

/** An admit card is a page or two; a result list, hundreds. Ceilings, not targets. */
const MAX_CARD_BYTES = 5 * 1024 * 1024
const MAX_LIST_BYTES = 40 * 1024 * 1024
const idParam = z.object({ id: z.string().uuid() })

export async function examRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: MAX_LIST_BYTES }, (_req, body, done) => done(null, body))
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
    const body = updateExamInput.parse(req.body)
    const row = await updateExam(scope(req).sub, id, body)
    if (row === 'unknown_stage') return reply.code(400).send({ error: 'unknown_stage' })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    // A roll number added after its result came out: looked for in the lists already published.
    if (body.rollNo || body.registrationNo) {
      const exam = await examRowOf(scope(req).sub, id)
      if (exam && (await checkKeptLists(exam)) > 0) return examById(scope(req).sub, id)
    }
    return row
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
    if (Buffer.isBuffer(req.body) && req.body.length > MAX_CARD_BYTES) return reply.code(413).send({ problem: 'That PDF is too large for an admit card.' })
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

  /**
   * A result list the person has, looked through for their own roll (or
   * registration) number: which page it is on, or that it is not there.
   * Read in memory and dropped; nothing is kept but nothing is changed
   * either — they decide what it means.
   */
  app.post('/exams/:id/check-list', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const exam = await examRowOf(scope(req).sub, id)
    if (!exam) return reply.code(404).send({ error: 'not_found' })
    if (!exam.rollNo && !exam.registrationNo) return reply.code(422).send({ problem: 'Add your roll number first: it is what is looked for.' })
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'pdf_expected' })
    const pages = await pdfPages(new Uint8Array(req.body), 1000)
    const sets = (pages ?? []).map((p) => new Set(numbersIn(p)))
    if (sets.every((s) => s.size === 0)) {
      return reply.code(422).send({ problem: 'No roll numbers could be read from that PDF. A scanned list cannot be read: search it by eye.' })
    }
    return { page: findNumber(sets, [exam.rollNo, exam.registrationNo]), pages: sets.length }
  })

  /** A study plan: the subjects across the days chosen, and a weekly mock. Replaces the last one. */
  app.post('/exams/:id/study-plan', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const study = await makeStudyPlan(scope(req).sub, id, studyPlanInput.parse(req.body))
    return study ? reply.code(201).send({ study, exam: await examById(scope(req).sub, id) }) : reply.code(404).send({ error: 'not_found' })
  })

  /** The study plan stopped: what is to come goes, what was studied stays. */
  app.delete('/exams/:id/study-plan', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    if (!(await examRowOf(scope(req).sub, id))) return reply.code(404).send({ error: 'not_found' })
    return { stopped: await stopStudy(id) }
  })

  app.post('/exams/:id/mocks', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const mocks = await addMock(scope(req).sub, id, mockScoreInput.parse(req.body))
    return mocks ? reply.code(201).send({ mocks }) : reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/exams/:id/mocks/:mockId', async (req, reply) => {
    const { id, mockId } = z.object({ id: z.string().uuid(), mockId: z.string().uuid() }).parse(req.params)
    return (await deleteMock(scope(req).sub, id, mockId)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  /** The day itself, from a card as checked: the plan, what to carry, and the trip if it is away. */
  app.post('/exams/day', async (req, reply) => {
    const { orgId, sub } = scope(req)
    const saved = await saveExamDay(orgId, sub, examDayInput.parse(req.body))
    if (saved === 'not_found') return reply.code(404).send({ error: 'not_found' })
    return reply.code(201).send({ ...saved, exam: await examById(sub, saved.examId) })
  })
}
