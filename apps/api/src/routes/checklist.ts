import type { FastifyInstance } from 'fastify'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db/index.ts'
import { scope } from '../auth.ts'

/**
 * The list attached to a plan.
 *
 * Every route checks the parent commitment belongs to the caller before
 * touching an item, because an item id on its own says nothing about who owns
 * the thing it hangs off.
 */
async function ownsCommitment(orgId: string, commitmentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.commitments.id })
    .from(schema.commitments)
    .where(and(eq(schema.commitments.id, commitmentId), eq(schema.commitments.orgId, orgId)))
    .limit(1)
  return Boolean(row)
}

export async function checklistRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  app.get('/commitments/:id/checklist', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    if (!(await ownsCommitment(orgId, id))) return reply.code(404).send({ error: 'not_found' })

    return {
      items: await db
        .select()
        .from(schema.checklistItems)
        .where(eq(schema.checklistItems.commitmentId, id))
        .orderBy(asc(schema.checklistItems.position), asc(schema.checklistItems.createdAt)),
    }
  })

  app.post('/commitments/:id/checklist', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const { items } = z
      .object({ items: z.array(z.string().min(1).max(200)).min(1).max(50) })
      .parse(req.body)

    if (!(await ownsCommitment(orgId, id))) return reply.code(404).send({ error: 'not_found' })

    // Appended after whatever is already there, so adding to a half-ticked
    // list does not shuffle what somebody is reading.
    const [last] = await db
      .select({ max: sql<number>`coalesce(max(${schema.checklistItems.position}), -1)` })
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.commitmentId, id))

    const start = (last?.max ?? -1) + 1
    const created = await db
      .insert(schema.checklistItems)
      .values(items.map((text, i) => ({ orgId, commitmentId: id, text, position: start + i })))
      .returning()

    return reply.code(201).send({ items: created })
  })

  /** Ticking one item. The commonest write in the whole feature. */
  app.patch('/checklist/:itemId', async (req, reply) => {
    const { orgId } = scope(req)
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(req.params)
    const body = z
      .object({ done: z.boolean().optional(), text: z.string().min(1).max(200).optional() })
      .parse(req.body)

    const [updated] = await db
      .update(schema.checklistItems)
      .set({
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.done !== undefined ? { done: body.done, doneAt: body.done ? new Date() : null } : {}),
      })
      .where(and(eq(schema.checklistItems.id, itemId), eq(schema.checklistItems.orgId, orgId)))
      .returning()

    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { item: updated }
  })

  app.delete('/checklist/:itemId', async (req, reply) => {
    const { orgId } = scope(req)
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(req.params)

    const removed = await db
      .delete(schema.checklistItems)
      .where(and(eq(schema.checklistItems.id, itemId), eq(schema.checklistItems.orgId, orgId)))
      .returning({ id: schema.checklistItems.id })

    if (removed.length === 0) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })
}
