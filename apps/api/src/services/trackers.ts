import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import {
  BOARDS,
  isOpenStage,
  mentions,
  quietFor,
  stageOf,
  type BoardKey,
  type TrackerItemDTO,
  type TrackerSuggestions,
  type TrackerUpdateDTO,
  type TrackerUpdateInput,
  type TrackerUpdateKind,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { phoneKey } from './calls.ts'
import { distanceExpr } from './nearby.ts'
import { canonicalWorkplace } from './workplace.ts'

/**
 * Trackers: job applications, candidates, deals. Each item's next step is an
 * ordinary plan linked to it — with its reminder and its place in the day —
 * so nothing here needs a reminder system of its own.
 */

const t = schema.trackerItems
const c = schema.commitments
const i = schema.interactions
const p = schema.places
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

/** The latest visit or call logged on each item. */
async function lastUpdates(itemIds: string[]) {
  const out = new Map<string, NonNullable<TrackerItemDTO['lastUpdate']>>()
  if (itemIds.length === 0) return out
  const rows = await db
    .selectDistinctOn([i.trackerItemId], { itemId: i.trackerItemId, kind: i.channel, outcome: i.outcome, at: i.startedAt })
    .from(i)
    .where(inArray(i.trackerItemId, itemIds))
    .orderBy(i.trackerItemId, desc(i.startedAt))
  for (const r of rows) {
    if (r.itemId) out.set(r.itemId, { kind: r.kind as TrackerUpdateKind, outcome: r.outcome, at: r.at.toISOString() })
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
      contactPhone: schema.contacts.phone,
      contactEmail: schema.contacts.email,
      valuePaise: t.valuePaise,
      closeReason: t.closeReason,
      expectedCloseOn: t.expectedCloseOn,
      placeId: t.placeId,
      placeName: p.name,
      placeAddress: p.address,
      placeLat: p.lat,
      placeLng: p.lng,
      link: t.link,
      notes: t.notes,
      stageChangedAt: t.stageChangedAt,
      closedAt: t.closedAt,
      createdAt: t.createdAt,
    })
    .from(t)
    .leftJoin(schema.contacts, eq(schema.contacts.id, t.contactId))
    .leftJoin(p, eq(p.id, t.placeId))
}

type Row = Awaited<ReturnType<ReturnType<typeof select>['where']>>[number]

async function toDTOs(rows: Row[], now = new Date()): Promise<TrackerItemDTO[]> {
  const ids = rows.map((r) => r.id)
  const [next, last] = await Promise.all([nextSteps(ids), lastUpdates(ids)])
  return rows.map(({ placeId, placeName, placeAddress, placeLat, placeLng, ...r }) => {
    const board = r.board as BoardKey
    const step = next.get(r.id) ?? null
    const update = last.get(r.id) ?? null
    // A visit or a call is a step too: quiet counts from whichever came later.
    const since = update && Date.parse(update.at) > r.stageChangedAt.getTime() ? update.at : r.stageChangedAt
    return {
      ...r,
      board,
      stageChangedAt: r.stageChangedAt.toISOString(),
      closedAt: r.closedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      place:
        placeId && placeName !== null && placeLat !== null && placeLng !== null
          ? { id: placeId, name: placeName, address: placeAddress, lat: placeLat, lng: placeLng }
          : null,
      lastUpdate: update,
      next: step,
      quietDays: quietFor(board, { stage: r.stage, stageChangedAt: since, hasNextStep: Boolean(step) }, now),
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

/** How it got here, every plan that was part of it, and every visit and call. */
export async function itemHistory(userId: string, id: string) {
  const [owned] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), eq(t.userId, userId)))
  if (!owned) return null
  const [events, plans, updates] = await Promise.all([
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
    db
      .select({
        id: i.id,
        kind: i.channel,
        outcome: i.outcome,
        notes: i.notes,
        at: i.startedAt,
        contactId: i.contactId,
        contactName: schema.contacts.name,
        voiceNotes: sql<number>`(select count(*)::int from ${schema.voiceNotes} where ${schema.voiceNotes.interactionId} = ${i.id})`,
      })
      .from(i)
      .leftJoin(schema.contacts, eq(schema.contacts.id, i.contactId))
      .where(and(eq(i.trackerItemId, id), eq(i.userId, userId)))
      .orderBy(desc(i.startedAt)),
  ])
  return {
    events: events.map((e) => ({ ...e, at: e.at.toISOString() })),
    plans: plans.map((p) => ({ ...p, dueAt: p.dueAt.toISOString() })),
    updates: updates.map((u): TrackerUpdateDTO => ({ ...u, kind: u.kind as TrackerUpdateKind, at: u.at.toISOString() })),
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
  closeReason?: string | null
  expectedCloseOn?: string | null
  person?: { name: string; phone?: string; email?: string }
  placeId?: string | null
  here?: Here
}

interface Here {
  lat: number
  lng: number
  address?: string
}

/**
 * The person an item is with, when they are not picked from People: found
 * there by phone, then by name, or saved there now — so a deal never needs
 * the contact made first, and the same person is never added twice. For a
 * client or a company, they are saved as working there.
 */
async function personFor(
  orgId: string,
  workplace: string | null,
  person: NonNullable<Fields['person']>,
): Promise<{ id: string; created: boolean }> {
  const name = person.name.trim().replace(/\s+/g, ' ')
  const phone = person.phone?.trim() || null
  const email = person.email?.trim() || null

  if (phone && phoneKey(phone).length >= 6) {
    const [byPhone] = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.orgId, orgId),
          sql`right(regexp_replace(coalesce(${schema.contacts.phone}, ''), '[^0-9]', '', 'g'), 10) = ${phoneKey(phone)}`,
        ),
      )
      .limit(1)
    if (byPhone) return { id: byPhone.id, created: false }
  }

  const byName = await db
    .select({ id: schema.contacts.id, phone: schema.contacts.phone, email: schema.contacts.email })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), sql`lower(btrim(${schema.contacts.name})) = ${name.toLowerCase()}`))
    .limit(2)
  // Exactly one with that name and no phone that says otherwise: the same person.
  if (byName.length === 1 && (!phone || !byName[0]!.phone)) {
    const found = byName[0]!
    const fill: Partial<typeof schema.contacts.$inferInsert> = {}
    if (phone && !found.phone) fill.phone = phone
    if (email && !found.email) fill.email = email
    if (Object.keys(fill).length) await db.update(schema.contacts).set(fill).where(eq(schema.contacts.id, found.id))
    return { id: found.id, created: false }
  }

  // Their workplace, unless the item is named after them (a candidate, a client who is a person).
  const organization =
    workplace && workplace.trim().toLowerCase() !== name.toLowerCase() ? await canonicalWorkplace(orgId, workplace) : null
  const [made] = await db
    .insert(schema.contacts)
    .values({ orgId, name, phone, email, organization: organization ?? null })
    .returning({ id: schema.contacts.id })
  return { id: made!.id, created: true }
}

/**
 * Where an item is, from where you stand: a place of the same name already
 * saved close by is that place; otherwise it is saved now, named after the
 * item — so it is in Places, with directions, for the next visit.
 */
async function placeFor(orgId: string, name: string, here: Here): Promise<string> {
  const distance = distanceExpr(here.lat, here.lng)
  const address = here.address?.trim() || null
  const [near] = await db
    .select({ id: p.id, address: p.address })
    .from(p)
    .where(and(eq(p.orgId, orgId), sql`lower(btrim(${p.name})) = ${name.trim().toLowerCase()}`, sql`${distance} <= 500`))
    .orderBy(sql`${distance} asc`)
    .limit(1)
  if (near) {
    if (address && !near.address) await db.update(p).set({ address }).where(eq(p.id, near.id))
    return near.id
  }
  const [made] = await db
    .insert(p)
    .values({ orgId, name: name.trim(), address, lat: here.lat, lng: here.lng })
    .returning({ id: p.id })
  return made!.id
}

/** A place of this org's, or nothing. */
async function ownPlace(orgId: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const [row] = await db.select({ id: p.id }).from(p).where(and(eq(p.id, id), eq(p.orgId, orgId)))
  return row?.id ?? null
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
): Promise<(TrackerItemDTO & { contactCreated: boolean }) | 'unknown_stage'> {
  const stage = input.stage ?? BOARDS[board].startStage
  if (!stageOf(board, stage)) return 'unknown_stage'
  const closed = !isOpenStage(board, stage)
  let contactId = await ownContact(orgId, input.contactId)
  let contactCreated = false
  if (!contactId && input.person) {
    const found = await personFor(orgId, board === 'hiring' ? null : input.title, input.person)
    contactId = found.id
    contactCreated = found.created
  }
  const placeId =
    (await ownPlace(orgId, input.placeId)) ?? (input.here ? await placeFor(orgId, input.title, input.here) : null)
  const [row] = await db
    .insert(t)
    .values({
      orgId,
      userId,
      board,
      title: input.title.trim(),
      detail: input.detail?.trim() || null,
      stage,
      contactId,
      valuePaise: input.valuePaise ?? null,
      link: input.link?.trim() || null,
      notes: input.notes?.trim() || null,
      closedAt: closed ? new Date() : null,
      closeReason: closed ? input.closeReason?.trim() || null : null,
      expectedCloseOn: input.expectedCloseOn ?? null,
      placeId,
    })
    .returning({ id: t.id })
  await db.insert(schema.trackerEvents).values({ itemId: row!.id, fromStage: null, toStage: stage })
  return { ...(await itemById(userId, row!.id))!, contactCreated }
}

export async function updateItem(
  orgId: string,
  userId: string,
  id: string,
  input: Fields,
): Promise<(TrackerItemDTO & { contactCreated: boolean }) | 'not_found' | 'unknown_stage'> {
  const [current] = await db
    .select({ board: t.board, stage: t.stage, title: t.title })
    .from(t)
    .where(and(eq(t.id, id), eq(t.userId, userId)))
  if (!current) return 'not_found'
  const board = current.board as BoardKey

  const set: Partial<typeof t.$inferInsert> = {}
  if (input.title !== undefined) set.title = input.title.trim()
  if (input.detail !== undefined) set.detail = input.detail?.trim() || null
  let contactCreated = false
  if (input.contactId !== undefined) set.contactId = await ownContact(orgId, input.contactId)
  if (input.person && !set.contactId) {
    const found = await personFor(orgId, board === 'hiring' ? null : (input.title ?? current.title), input.person)
    set.contactId = found.id
    contactCreated = found.created
  }
  if (input.expectedCloseOn !== undefined) set.expectedCloseOn = input.expectedCloseOn
  if (input.placeId !== undefined) set.placeId = await ownPlace(orgId, input.placeId)
  if (input.here) set.placeId = await placeFor(orgId, input.title ?? current.title, input.here)
  if (input.closeReason !== undefined) set.closeReason = input.closeReason?.trim() || null
  if (input.valuePaise !== undefined) set.valuePaise = input.valuePaise
  if (input.link !== undefined) set.link = input.link?.trim() || null
  if (input.notes !== undefined) set.notes = input.notes?.trim() || null

  const moved = input.stage !== undefined && input.stage !== current.stage
  if (moved) {
    if (!stageOf(board, input.stage!)) return 'unknown_stage'
    set.stage = input.stage!
    set.stageChangedAt = new Date()
    set.closedAt = isOpenStage(board, input.stage!) ? null : new Date()
    // Opened again: why it closed no longer stands.
    if (isOpenStage(board, input.stage!)) set.closeReason = null
  }
  await db.transaction(async (tx) => {
    if (Object.keys(set).length) await tx.update(t).set(set).where(and(eq(t.id, id), eq(t.userId, userId)))
    if (moved) await tx.insert(schema.trackerEvents).values({ itemId: id, fromStage: current.stage, toStage: input.stage! })
  })
  return { ...(await itemById(userId, id))!, contactCreated }
}

/**
 * A visit or a call on an item: saved with the rest of the visits and calls,
 * linked to it. The first person met becomes who it is with, and where you
 * stood — when asked — where it is.
 */
export async function addUpdate(
  orgId: string,
  userId: string,
  itemId: string,
  input: TrackerUpdateInput,
): Promise<{ update: TrackerUpdateDTO; contactCreated: boolean; placeSaved: boolean } | 'not_found'> {
  const [item] = await db
    .select({ board: t.board, title: t.title, contactId: t.contactId, placeId: t.placeId })
    .from(t)
    .where(and(eq(t.id, itemId), eq(t.userId, userId)))
  if (!item) return 'not_found'
  const board = item.board as BoardKey

  // Nobody said: whoever the item is with.
  let contactId = input.contactId === undefined && !input.person ? item.contactId : await ownContact(orgId, input.contactId)
  let contactCreated = false
  if (!contactId && input.person) {
    const found = await personFor(orgId, board === 'hiring' ? null : item.title, input.person)
    contactId = found.id
    contactCreated = found.created
  }

  const fix = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null
  let placeId = item.placeId
  let placeSaved = false
  if (!placeId && input.savePlace && fix && board !== 'hiring') {
    placeId = await placeFor(orgId, item.title, fix)
    placeSaved = true
  }

  const [row] = await db
    .insert(i)
    .values({
      orgId,
      userId,
      trackerItemId: itemId,
      placeId: input.kind === 'visit' ? placeId : null,
      contactId,
      purpose: board === 'jobs' ? 'personal' : 'business',
      channel: input.kind,
      connected: input.connected ?? true,
      outcome: input.outcome?.trim() || null,
      notes: input.note?.trim() || null,
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      accuracyM: input.accuracyM ?? null,
      startedAt: input.at ? new Date(input.at) : new Date(),
    })
    .returning({ id: i.id, kind: i.channel, outcome: i.outcome, notes: i.notes, at: i.startedAt, contactId: i.contactId })

  const set: Partial<typeof t.$inferInsert> = {}
  if (contactId && !item.contactId) set.contactId = contactId
  if (placeSaved) set.placeId = placeId
  if (Object.keys(set).length) await db.update(t).set(set).where(eq(t.id, itemId))

  const [who] = contactId
    ? await db.select({ name: schema.contacts.name }).from(schema.contacts).where(eq(schema.contacts.id, contactId))
    : []
  return {
    update: {
      ...row!,
      kind: row!.kind as TrackerUpdateKind,
      at: row!.at.toISOString(),
      contactName: who?.name ?? null,
      voiceNotes: 0,
    },
    contactCreated,
    placeSaved,
  }
}

/** What was said, or how it went, put right after it was logged. */
export async function editUpdate(
  userId: string,
  itemId: string,
  updateId: string,
  input: { outcome?: string | null; note?: string | null },
): Promise<boolean> {
  const set: Partial<typeof i.$inferInsert> = {}
  if (input.outcome !== undefined) set.outcome = input.outcome?.trim() || null
  if (input.note !== undefined) set.notes = input.note?.trim() || null
  const mine = and(eq(i.id, updateId), eq(i.userId, userId), eq(i.trackerItemId, itemId))
  const rows = Object.keys(set).length
    ? await db.update(i).set(set).where(mine).returning({ id: i.id })
    : await db.select({ id: i.id }).from(i).where(mine)
  return rows.length > 0
}

export async function removeUpdate(userId: string, itemId: string, updateId: string): Promise<boolean> {
  const rows = await db
    .delete(i)
    .where(and(eq(i.id, updateId), eq(i.userId, userId), eq(i.trackerItemId, itemId)))
    .returning({ id: i.id })
  return rows.length > 0
}

/**
 * What is typed most on a board — what deals are for, what the next step
 * usually is — most used first, so the next one is a tap.
 */
export async function suggestions(userId: string, board: BoardKey): Promise<TrackerSuggestions> {
  const [details, steps] = await Promise.all([
    db
      .select({ text: sql<string>`(array_agg(${t.detail} order by ${t.createdAt} desc))[1]` })
      .from(t)
      .where(and(eq(t.userId, userId), eq(t.board, board), sql`btrim(coalesce(${t.detail}, '')) <> ''`))
      .groupBy(sql`lower(btrim(${t.detail}))`)
      .orderBy(sql`count(*) desc`, sql`max(${t.createdAt}) desc`)
      .limit(8),
    db
      .select({ text: sql<string>`(array_agg(${c.title} order by ${c.createdAt} desc))[1]` })
      .from(c)
      .innerJoin(t, eq(t.id, c.trackerItemId))
      .where(and(eq(t.userId, userId), eq(t.board, board), notInArray(c.status, ['deleted'])))
      .groupBy(sql`lower(btrim(${c.title}))`)
      .orderBy(sql`count(*) desc`, sql`max(${c.createdAt}) desc`)
      .limit(6),
  ])
  return { details: details.map((r) => r.text.trim()), nextSteps: steps.map((r) => r.text.trim()) }
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
