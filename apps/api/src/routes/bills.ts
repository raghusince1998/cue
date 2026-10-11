import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createBillInput, payBillInput, updateBillInput } from '@cue/shared'
import { scope } from '../auth.ts'
import { billPaymentsOf, createBill, deleteBill, listBills, payBill, undoPayment, updateBill } from '../services/bills.ts'

const idParam = z.object({ id: z.string().uuid() })

export async function billRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  app.get('/bills', async (req) => listBills(scope(req).sub))

  app.post('/bills', async (req, reply) => {
    const { orgId, sub } = scope(req)
    return reply.code(201).send(await createBill(orgId, sub, createBillInput.parse(req.body)))
  })

  app.patch('/bills/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const bill = await updateBill(scope(req).sub, id, updateBillInput.parse(req.body))
    return bill ?? reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/bills/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    return (await deleteBill(scope(req).sub, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })

  /** Paid, or renewed: on to the next due date. */
  app.post('/bills/:id/paid', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const bill = await payBill(scope(req).sub, id, payBillInput.parse(req.body ?? {}))
    return bill ?? reply.code(404).send({ error: 'not_found' })
  })

  app.post('/bills/:id/undo-paid', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const bill = await undoPayment(scope(req).sub, id)
    return bill ?? reply.code(404).send({ error: 'not_found' })
  })

  app.get('/bills/:id/payments', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const rows = await billPaymentsOf(scope(req).sub, id)
    return rows ?? reply.code(404).send({ error: 'not_found' })
  })
}
