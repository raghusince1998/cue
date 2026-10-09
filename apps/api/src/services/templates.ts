import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { STARTER_TEMPLATES, type MessageTemplateDTO } from '@cue/shared'
import { db, schema } from '../db/index.ts'

/**
 * Quick messages, one person's own. The ones actually sent come first, so
 * the one you want is nearly always the first chip.
 */

const t = schema.messageTemplates

const toDTO = (r: typeof t.$inferSelect): MessageTemplateDTO => ({ id: r.id, title: r.title, body: r.body, uses: r.uses })

export async function listTemplates(userId: string): Promise<MessageTemplateDTO[]> {
  const rows = await db
    .select()
    .from(t)
    .where(eq(t.userId, userId))
    .orderBy(desc(t.uses), sql`${t.lastUsedAt} desc nulls last`, asc(t.createdAt))
  return rows.map(toDTO)
}

export async function createTemplate(orgId: string, userId: string, input: { title: string; body: string }) {
  const [row] = await db.insert(t).values({ orgId, userId, ...input }).returning()
  return toDTO(row!)
}

/** Null when it is not theirs. */
export async function updateTemplate(userId: string, id: string, input: { title: string; body: string }) {
  const [row] = await db
    .update(t)
    .set(input)
    .where(and(eq(t.id, id), eq(t.userId, userId)))
    .returning()
  return row ? toDTO(row) : null
}

export async function deleteTemplate(userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(t).where(and(eq(t.id, id), eq(t.userId, userId))).returning({ id: t.id })
  return rows.length > 0
}

export async function markUsed(userId: string, id: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(t)
    .set({ uses: sql`${t.uses} + 1`, lastUsedAt: now })
    .where(and(eq(t.id, id), eq(t.userId, userId)))
    .returning({ id: t.id })
  return rows.length > 0
}

/** The starters, minus any already there by title: pressing it twice adds nothing twice. */
export async function addStarters(orgId: string, userId: string): Promise<MessageTemplateDTO[]> {
  const have = new Set((await listTemplates(userId)).map((x) => x.title.trim().toLowerCase()))
  const missing = STARTER_TEMPLATES.filter((s) => !have.has(s.title.toLowerCase()))
  if (missing.length) await db.insert(t).values(missing.map((s) => ({ orgId, userId, ...s })))
  return listTemplates(userId)
}
