import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { BOARDS, isOpenStage, mentions, quietFor, stageOf, type BoardKey, type TrackerItemDTO } from '@cue/shared'
import { db, schema } from '../db/index.ts'

/**
 * Trackers: job applications, candidates, deals. Each item's next step is an
 * ordinary plan linked to it — with its reminder and its place in the day —
 * so nothing here needs a reminder system of its own.
 */

const t = schema.trackerItems
const c = schema.commitments
/** Plans that are still to happen or be done. */
const OPEN_PLAN = ['pending']

/** The soonest open plan for each item. */
async function nextSteps(itemIds: string[]) {
  const out = new Map<string, { id: string; title: string; dueAt: string }>()
  if (itemIds.length === 0) return out
  const rows = await db
    .select({ id: c.id, itemId: c.trackerItemId, title: c.title, dueAt: c.dueAt })
    .from(c)
    .where(and(inArray(c.trackerItemId, itemIds), inArray(c.status, OPEN_PLAN)))
    .orderBy(asc(c.dueAt))
  for (const r of rows) {
    if (r.itemId && !out.has(r.itemId)) out.set(r.itemId, { id: r.id, title: r.title, dueAt: r.dueAt.toISOString() })
  }
  return out
}

function select() {
  return db
    .select({
      id: t.id,
      board: t.board,
      title: t.title,
      detail: t.detail,
      stage: t.stage,
      contactId: t.contactId,
      contactName: schema.contacts.name,
      valuePaise: t.valuePaise,
      link: t.link,
      notes: t.notes,
      stageChangedAt: t.stageChangedAt,
      closedAt: t.closedAt,
      createdAt: t.createdAt,
    })
    .from(t)
    .leftJoin(schema.contacts, eq(schema.contacts.id, t.contactId))
}

type Row = Awaited<ReturnType<ReturnType<typeof select>['where']>>[number]

async function toDTOs(rows: Row[], now = new Date()): Promise<TrackerItemDTO[]> {
  const next = await nextSteps(rows.map((r) => r.id))
  return rows.map((r) => {
    const board = r.board as BoardKey
    const step = next.get(r.id) ?? null
    return {
      ...r,
      board,
      stageChangedAt: r.stageChangedAt.toISOString(),
      closedAt: r.closedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      next: step,
      quietDays: quietFor(board, { stage: r.stage, stageChangedAt: r.stageChangedAt, hasNextStep: Boolean(step) }, now),
    }
  })
}

/** A board's items: open ones by stage, then the closed, most recent first. */
export async function boardItems(userId: string, board: BoardKey, now = new Date()): Promise<TrackerItemDTO[]> {
  const rows = await select()
    .where(and(eq(t.userId, userId), eq(t.board, board)))
    .orderBy(asc(t.stageChangedAt))
  const items = await toDTOs(rows, now)
  const order = BOARDS[board].stages.map((s) => s.key)
  return items.sort((a, b) => {
    const open = Number(!isOpenStage(board, a.stage)) - Number(!isOpenStage(board, b.stage))
    if (open) return open
    if (!isOpenStage(board, a.stage)) return (b.closedAt ?? '').localeCompare(a.closedAt ?? '')
    return order.indexOf(a.stage) - order.indexOf(b.stage) || a.stageChangedAt.localeCompare(b.stageChangedAt)
  })
}

export async function itemById(userId: string, id: string): Promise<TrackerItemDTO | null> {
  const [row] = await select().where(and(eq(t.id, id), eq(t.userId, userId)))
  return row ? (await toDTOs([row]))[0]! : null
}

/** How it got here, and every plan that was part of it. */
export async function itemHistory(userId: string, id: string) {
  const [owned] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), eq(t.userId, userId)))
  if (!owned) return null
  const [events, plans] = await Promise.all([
    db
      .select({ from: schema.trackerEvents.fromStage, to: schema.trackerEvents.toStage, at: schema.trackerEvents.at })
      .from(schema.trackerEvents)
      .where(eq(schema.trackerEvents.itemId, id))
      .orderBy(asc(schema.trackerEvents.at)),
    db
      .select({ id: c.id, title: c.title, dueAt: c.dueAt, status: c.status })
      .from(c)
      .where(and(eq(c.trackerItemId, id), notInArray(c.status, ['deleted'])))
      .orderBy(asc(c.dueAt)),
  ])
  return {
    events: events.map((e) => ({ ...e, at: e.at.toISOString() })),
    plans: plans.map((p) => ({ ...p, dueAt: p.dueAt.toISOString() })),
  }
}

interface Fields {
  title?: string
  detail?: string | null
  stage?: string
  contactId?: string | null
  valuePaise?: number | null
  link?: string | null
  notes?: string | null
}

/** A contact of this org's, or nothing. */
async function ownContact(orgId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const [row] = await db
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, orgId)))
  return row?.id ?? null
}

export async function createItem(
  orgId: string,
  userId: string,
  board: BoardKey,
  input: Fields & { title: string },
): Promise<TrackerItemDTO | 'unknown_stage'> {
  const stage = input.stage ?? BOARDS[board].startStage
  if (!stageOf(board, stage)) return 'unknown_stage'
  const closed = !isOpenStage(board, stage)
  const [row] = await db
    .insert(t)
    .values({
      orgId,
      userId,
      board,
      title: input.title.trim(),
      detail: input.detail?.trim() || null,
      stage,
      contactId: await ownContact(orgId, input.contactId),
      valuePaise: input.valuePaise ?? null,
      link: input.link?.trim() || null,
      notes: input.notes?.trim() || null,
      closedAt: closed ? new Date() : null,
    })
    .returning({ id: t.id })
  await db.insert(schema.trackerEvents).values({ itemId: row!.id, fromStage: null, toStage: stage })
  return (await itemById(userId, row!.id))!
}

export async function updateItem(
  orgId: string,
  userId: string,
  id: string,
  input: Fields,
): Promise<TrackerItemDTO | 'not_found' | 'unknown_stage'> {
  const [current] = await db
    .select({ board: t.board, stage: t.stage })
    .from(t)
    .where(and(eq(t.id, id), eq(t.userId, userId)))
  if (!current) return 'not_found'
  const board = current.board as BoardKey

  const set: Partial<typeof t.$inferInsert> = {}
  if (input.title !== undefined) set.title = input.title.trim()
  if (input.detail !== undefined) set.detail = input.detail?.trim() || null
  if (input.contactId !== undefined) set.contactId = await ownContact(orgId, input.contactId)
  if (input.valuePaise !== undefined) set.valuePaise = input.valuePaise
  if (input.link !== undefined) set.link = input.link?.trim() || null
  if (input.notes !== undefined) set.notes = input.notes?.trim() || null

  const moved = input.stage !== undefined && input.stage !== current.stage
  if (moved) {
    if (!stageOf(board, input.stage!)) return 'unknown_stage'
    set.stage = input.stage!
    set.stageChangedAt = new Date()
    set.closedAt = isOpenStage(board, input.stage!) ? null : new Date()
  }
  await db.transaction(async (tx) => {
    if (Object.keys(set).length) await tx.update(t).set(set).where(and(eq(t.id, id), eq(t.userId, userId)))
    if (moved) await tx.insert(schema.trackerEvents).values({ itemId: id, fromStage: current.stage, toStage: input.stage! })
  })
  return (await itemById(userId, id))!
}

export async function deleteItem(userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(t).where(and(eq(t.id, id), eq(t.userId, userId))).returning({ id: t.id })
  return rows.length > 0
}

/** Whether this item is the user's, for linking a plan to it. */
export async function ownsItem(userId: string, id: string): Promise<boolean> {
  const [row] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), eq(t.userId, userId)))
  return Boolean(row)
}

/**
 * The one open item a line is about — "interview at Infosys friday" is about
 * the Infosys application — or null when none is, or more than one could be.
 */
export async function itemMentionedIn(
  userId: string,
  text: string,
): Promise<{ id: string; board: BoardKey; title: string; detail: string | null; stage: string } | null> {
  const rows = await db
    .select({ id: t.id, board: t.board, title: t.title, detail: t.detail, stage: t.stage })
    .from(t)
    .where(and(eq(t.userId, userId), isNull(t.closedAt)))
  const hits = rows.filter((r) => mentions(text, r.title))
  if (hits.length !== 1) return null
  const hit = hits[0]!
  return { ...hit, board: hit.board as BoardKey }
}

/** Every open item that has gone quiet, across boards, longest first. */
export async function quietItems(userId: string, now = new Date()): Promise<TrackerItemDTO[]> {
  const rows = await select().where(and(eq(t.userId, userId), isNull(t.closedAt)))
  return (await toDTOs(rows, now))
    .filter((i) => i.quietDays !== null)
    .sort((a, b) => b.quietDays! - a.quietDays!)
}

/** Open items by board, for a count beside each tab. */
export async function openCounts(userId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ board: t.board, n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.userId, userId), isNull(t.closedAt)))
    .groupBy(t.board)
  return Object.fromEntries(rows.map((r) => [r.board, r.n]))
}
