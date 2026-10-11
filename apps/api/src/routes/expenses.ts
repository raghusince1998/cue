import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createExpenseInput, setClaimInput, updateExpenseInput } from '@cue/shared'
import { scope } from '../auth.ts'
import {
  awaitingPayment,
  createExpense,
  deleteExpense,
  expenseMonth,
  receiptOf,
  setClaim,
  setReceipt,
  unclaimed,
  updateExpense,
} from '../services/expenses.ts'

/** Photos are compressed on the phone first; this is a ceiling, not a target. */
const MAX_RECEIPT_BYTES = 3 * 1024 * 1024
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const idParam = z.object({ id: z.string().uuid() })

export async function expenseRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    RECEIPT_TYPES,
    { parseAs: 'buffer', bodyLimit: MAX_RECEIPT_BYTES },
    (_req, body, done) => done(null, body),
  )
  app.addHook('onRequest', app.authenticate)

  /** One month of expenses, with totals; this month when none is named. */
  app.get('/expenses', async (req) => {
    const { month } = z
      .object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() })
      .parse(req.query)
    const now = new Date()
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return expenseMonth(scope(req).sub, month ?? current)
  })

  /** Everything still to be claimed, whatever month it was spent in. */
  app.get('/expenses/unclaimed', async (req) => unclaimed(scope(req).sub))

  /** Claimed, still to be paid back. */
  app.get('/expenses/claimed', async (req) => awaitingPayment(scope(req).sub))

  app.post('/expenses', async (req, reply) => {
    const { orgId, sub } = scope(req)
    return reply.code(201).send(await createExpense(orgId, sub, createExpenseInput.parse(req.body)))
  })

  app.patch('/expenses/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const row = await updateExpense(scope(req).sub, id, updateExpenseInput.parse(req.body))
    return row ?? reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/expenses/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await deleteExpense(scope(req).sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  app.post('/expenses/claim', async (req) => {
    const { ids, status } = setClaimInput.parse(req.body)
    return { changed: await setClaim(scope(req).sub, ids, status) }
  })

  app.post('/expenses/:id/receipt', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    if (!RECEIPT_TYPES.includes(mime)) return reply.code(415).send({ error: 'unsupported_image_type' })
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(400).send({ error: 'empty_image' })
    return (await setReceipt(scope(req).sub, id, req.body, mime)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/expenses/:id/receipt', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await setReceipt(scope(req).sub, id, null, null)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  /** Only to its owner: a receipt can carry a card's last digits or an address. */
  app.get('/expenses/:id/receipt', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const r = await receiptOf(scope(req).sub, id)
    if (!r) return reply.code(404).send({ error: 'no_receipt' })
    return reply.header('content-type', r.mime).header('cache-control', 'private, max-age=86400').send(r.image)
  })
}
