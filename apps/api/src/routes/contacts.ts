import type { FastifyInstance } from 'fastify'
import { and, desc, eq, ilike, isNotNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createContactInput, updateContactInput, type ContactDTO } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { keepInTouch } from '../services/keepInTouch.ts'
import { blankToNull, canonicalWorkplace } from '../services/workplace.ts'

const DAY_MS = 86_400_000


export async function contactRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  const selection = {
    id: schema.contacts.id,
    name: schema.contacts.name,
    role: schema.contacts.role,
    organization: schema.contacts.organization,
    keepInTouchDays: schema.contacts.keepInTouchDays,
    birthday: schema.contacts.birthday,
    anniversary: schema.contacts.anniversary,
    phone: schema.contacts.phone,
    email: schema.contacts.email,
    notes: schema.contacts.notes,
    placeId: schema.contacts.placeId,
    placeName: schema.places.name,
    createdAt: schema.contacts.createdAt,
  }

  function toDTO(row: {
    id: string
    name: string
    role: string | null
    organization: string | null
    keepInTouchDays: number | null
    birthday: string | null
    anniversary: string | null
    phone: string | null
    email: string | null
    notes: string | null
    placeId: string | null
    placeName: string | null
    createdAt: Date
  }): ContactDTO {
    return { ...row, createdAt: row.createdAt.toISOString() }
  }

  /**
   * The people list. Visit counts come from one grouped subquery rather than a
   * query per contact — this is the screen most likely to grow to hundreds of
   * rows.
   */
  app.get('/contacts', async (req) => {
    const { orgId } = scope(req)

    const visitStats = db
      .select({
        contactId: schema.interactions.contactId,
        visitCount: sql<number>`count(*)::int`.as('visit_count'),
        lastSeenAt: sql<Date>`max(${schema.interactions.startedAt})`.as('last_seen_at'),
      })
      .from(schema.interactions)
      // Visits only: calls have their own place on the person's page, and
      // "3 meetings" for three phone calls would be wrong.
      .where(and(eq(schema.interactions.orgId, orgId), eq(schema.interactions.channel, 'visit')))
      .groupBy(schema.interactions.contactId)
      .as('visit_stats')

    const rows = await db
      .select({
        ...selection,
        visitCount: visitStats.visitCount,
        lastSeenAt: visitStats.lastSeenAt,
      })
      .from(schema.contacts)
      .leftJoin(schema.places, eq(schema.places.id, schema.contacts.placeId))
      .leftJoin(visitStats, eq(visitStats.contactId, schema.contacts.id))
      .where(eq(schema.contacts.orgId, orgId))
      .orderBy(schema.contacts.name)

    return rows.map((r) => ({
      ...toDTO(r),
      visitCount: r.visitCount ?? 0,
      lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : null,
    }))
  })

  /**
   * Names people work at, for suggestions while typing one: what has been
   * typed before, and saved places. "ABC Clinic" and "abc clinic " should not
   * become two workplaces because one was typed in a hurry.
   */
  app.get('/contacts/organizations', async (req) => {
    const { orgId } = scope(req)
    const [fromPeople, fromPlaces] = await Promise.all([
      db
        .selectDistinct({ name: schema.contacts.organization })
        .from(schema.contacts)
        .where(and(eq(schema.contacts.orgId, orgId), isNotNull(schema.contacts.organization))),
      db
        .select({ name: schema.places.name })
        .from(schema.places)
        .where(eq(schema.places.orgId, orgId)),
    ])
    const names = new Map<string, string>()
    for (const { name } of [...fromPeople, ...fromPlaces]) {
      const clean = name?.trim().replace(/\s+/g, ' ')
      if (clean && !names.has(clean.toLowerCase())) names.set(clean.toLowerCase(), clean)
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b)).slice(0, 300)
  })

  /** Everyone you mean to keep in touch with, longest overdue first. */
  app.get('/people/keep-in-touch', async (req) => {
    const { orgId, sub: userId } = scope(req)
    const list = await keepInTouch(orgId, userId)
    return {
      due: list.filter((p) => p.due).length,
      people: list.map((p) => ({
        ...p,
        lastTouch: p.lastTouch?.toISOString() ?? null,
        dueAt: p.dueAt.toISOString(),
        snoozedUntil: p.snoozedUntil?.toISOString() ?? null,
      })),
    }
  })

  /** "Talked today": contact that happened outside Cue, on a call or a chat. */
  app.post('/contacts/:id/touched', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const rows = await db
      .update(schema.contacts)
      .set({ lastContactedAt: new Date(), touchSnoozedUntil: null })
      .where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, orgId)))
      .returning({ id: schema.contacts.id })
    if (rows.length === 0) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })

  /** "Not now": quiet about this person for a while, without pretending you talked. */
  app.post('/contacts/:id/touch-later', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const { days } = z
      .object({ days: z.number().int().min(1).max(90).default(7) })
      .parse(req.body ?? {})
    const rows = await db
      .update(schema.contacts)
      .set({ touchSnoozedUntil: new Date(Date.now() + days * DAY_MS) })
      .where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, orgId)))
      .returning({ id: schema.contacts.id })
    if (rows.length === 0) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })

  /** One person's profile: who they are, what is open with them, and history. */
  app.get('/contacts/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }

    const rows = await db
      .select(selection)
      .from(schema.contacts)
      .leftJoin(schema.places, eq(schema.places.id, schema.contacts.placeId))
      .where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, orgId)))
      .limit(1)

    const contact = rows[0]
    if (!contact) return reply.code(404).send({ error: 'not_found' })

    const [visits, commitments] = await Promise.all([
      db
        .select()
        .from(schema.interactions)
        .where(
          and(eq(schema.interactions.contactId, id), eq(schema.interactions.orgId, orgId)),
        )
        .orderBy(desc(schema.interactions.startedAt))
        .limit(50),
      db
        .select()
        .from(schema.commitments)
        .where(
          and(
            eq(schema.commitments.contactId, id),
            eq(schema.commitments.orgId, orgId),
            ne(schema.commitments.status, 'deleted'),
          ),
        )
        .orderBy(desc(schema.commitments.dueAt))
        .limit(50),
    ])

    const inPerson = visits.filter((v) => v.channel === 'visit')
    return {
      ...toDTO(contact),
      visitCount: inPerson.length,
      lastSeenAt: inPerson[0]?.startedAt.toISOString() ?? null,
      visits: visits.map((v) => ({
        id: v.id,
        purpose: v.purpose,
        outcome: v.outcome,
        notes: v.notes,
        startedAt: v.startedAt.toISOString(),
      })),
      commitments: commitments.map((c) => ({
        id: c.id,
        title: c.title,
        dueAt: c.dueAt.toISOString(),
        status: c.status,
      })),
    }
  })

  /**
   * People picked from the phone's own contact chooser.
   *
   * The valuable half is matching rather than inserting. Anyone named in a
   * sentence already became a contact here, with no phone number — which is
   * exactly why the Call button never appeared. Importing the same person
   * should fill that gap in, not sit a duplicate next to it.
   *
   * Only ever adds detail: an existing number is never overwritten, because
   * the one already here was typed deliberately and the phone's may be an old
   * landline nobody has removed.
   */
  app.post('/contacts/import', async (req) => {
    const { orgId } = scope(req)
    const { contacts } = z
      .object({
        contacts: z
          .array(
            z.object({
              name: z.string().min(1).max(200),
              phone: z.string().max(60).nullable().optional(),
              email: z.string().max(200).nullable().optional(),
            }),
          )
          .max(200),
      })
      .parse(req.body)

    let added = 0
    let updated = 0
    let unchanged = 0

    for (const picked of contacts) {
      const name = picked.name.trim()
      const [existing] = await db
        .select({
          id: schema.contacts.id,
          phone: schema.contacts.phone,
          email: schema.contacts.email,
        })
        .from(schema.contacts)
        .where(and(eq(schema.contacts.orgId, orgId), ilike(schema.contacts.name, name)))
        .limit(1)

      if (!existing) {
        await db.insert(schema.contacts).values({
          orgId,
          name,
          phone: blankToNull(picked.phone ?? null) ?? null,
          email: blankToNull(picked.email ?? null) ?? null,
        })
        added += 1
        continue
      }

      const fill = {
        ...(existing.phone ? {} : { phone: blankToNull(picked.phone ?? null) ?? null }),
        ...(existing.email ? {} : { email: blankToNull(picked.email ?? null) ?? null }),
      }
      const fills = Object.values(fill).filter(Boolean).length
      if (fills === 0) {
        unchanged += 1
        continue
      }

      await db.update(schema.contacts).set(fill).where(eq(schema.contacts.id, existing.id))
      updated += 1
    }

    return { added, updated, unchanged }
  })

  app.post('/contacts', async (req, reply) => {
    const { orgId } = scope(req)
    const body = createContactInput.parse(req.body)

    const contact = takeFirst(
      await db
        .insert(schema.contacts)
        .values({
          orgId,
          name: body.name.trim(),
          role: blankToNull(body.role) ?? null,
          organization: (await canonicalWorkplace(orgId, body.organization)) ?? null,
          phone: blankToNull(body.phone) ?? null,
          email: blankToNull(body.email) ?? null,
          notes: blankToNull(body.notes) ?? null,
          placeId: body.placeId ?? null,
          keepInTouchDays: body.keepInTouchDays ?? null,
          keepInTouchSince: body.keepInTouchDays ? new Date() : null,
          birthday: body.birthday ?? null,
          anniversary: body.anniversary ?? null,
        })
        .returning(),
      'contact',
    )

    return reply.code(201).send(contact)
  })

  app.patch('/contacts/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    const body = updateContactInput.parse(req.body)

    const existing = await db
      .select({ id: schema.contacts.id, keepInTouchDays: schema.contacts.keepInTouchDays })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, orgId)))
      .limit(1)
    if (existing.length === 0) return reply.code(404).send({ error: 'not_found' })

    // Starting to keep in touch starts the clock; changing the rhythm keeps
    // it; stopping clears it, so starting again later is a fresh start.
    const wasTracked = existing[0]!.keepInTouchDays !== null
    const touch =
      body.keepInTouchDays === undefined
        ? {}
        : body.keepInTouchDays === null
          ? { keepInTouchDays: null, keepInTouchSince: null, touchSnoozedUntil: null }
          : wasTracked
            ? { keepInTouchDays: body.keepInTouchDays }
            : { keepInTouchDays: body.keepInTouchDays, keepInTouchSince: new Date(), touchSnoozedUntil: null }

    await db
      .update(schema.contacts)
      .set({
        ...touch,
        ...(body.birthday !== undefined ? { birthday: body.birthday } : {}),
        ...(body.anniversary !== undefined ? { anniversary: body.anniversary } : {}),
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.role !== undefined ? { role: blankToNull(body.role) ?? null } : {}),
        ...(body.organization !== undefined
          ? { organization: (await canonicalWorkplace(orgId, body.organization)) ?? null }
          : {}),
        ...(body.phone !== undefined ? { phone: blankToNull(body.phone) ?? null } : {}),
        ...(body.email !== undefined ? { email: blankToNull(body.email) ?? null } : {}),
        ...(body.notes !== undefined ? { notes: blankToNull(body.notes) ?? null } : {}),
        ...(body.placeId !== undefined ? { placeId: body.placeId } : {}),
      })
      .where(eq(schema.contacts.id, id))

    const rows = await db
      .select(selection)
      .from(schema.contacts)
      .leftJoin(schema.places, eq(schema.places.id, schema.contacts.placeId))
      .where(eq(schema.contacts.id, id))
      .limit(1)

    return toDTO(takeFirst(rows, 'contact'))
  })

  /**
   * Visits and commitments referencing this person survive with a null
   * contactId — deleting someone from your address book should not erase the
   * record that you met them.
   */
  app.delete('/contacts/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }

    const existing = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, orgId)))
      .limit(1)
    if (existing.length === 0) return reply.code(404).send({ error: 'not_found' })

    await db.delete(schema.contacts).where(eq(schema.contacts.id, id))
    return { ok: true }
  })
}
