import type { FastifyInstance } from 'fastify'
import { and, desc, eq, ilike, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createContactInput, updateContactInput, type ContactDTO } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'

/** Empty strings from HTML inputs should clear a column, not store "". */
function blankToNull(value: string | undefined | null): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export async function contactRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  const selection = {
    id: schema.contacts.id,
    name: schema.contacts.name,
    role: schema.contacts.role,
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
      .where(eq(schema.interactions.orgId, orgId))
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

    return {
      ...toDTO(contact),
      visitCount: visits.length,
      lastSeenAt: visits[0]?.startedAt.toISOString() ?? null,
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
          phone: blankToNull(body.phone) ?? null,
          email: blankToNull(body.email) ?? null,
          notes: blankToNull(body.notes) ?? null,
          placeId: body.placeId ?? null,
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
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, orgId)))
      .limit(1)
    if (existing.length === 0) return reply.code(404).send({ error: 'not_found' })

    await db
      .update(schema.contacts)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.role !== undefined ? { role: blankToNull(body.role) ?? null } : {}),
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
