import type { FastifyInstance } from 'fastify'
import { and, desc, eq, ilike, ne } from 'drizzle-orm'
import {
  DEFAULT_DURATION_MINUTES,
  logVisitInput,
  updateVisitInput,
  type VisitDTO,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { scheduleFirstReminder } from '../services/reminders.ts'
import { checkConflicts } from '../services/scheduling.ts'
import { attachVoiceNotes } from './voiceNotes.ts'

export async function visitRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /**
   * The capture flow lands here as one write. Place creation, the interaction,
   * the commitment and its first reminder all share a transaction, so a visit
   * can never be recorded without the follow-up it promised.
   */
  app.post('/visits', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const body = logVisitInput.parse(req.body)

    // No place requirement: a phone call, a video meeting or a task has no
    // location, and demanding one made every non-visit entry awkward.

    // Replay of something already accepted: return what we stored rather than
    // creating a second visit. Checked before the conflict guard too, or a
    // retry would report a clash with the copy it created itself.
    if (body.clientId) {
      const existing = await db
        .select({ interaction: schema.interactions })
        .from(schema.interactions)
        .where(
          and(
            eq(schema.interactions.orgId, orgId),
            eq(schema.interactions.clientId, body.clientId),
          ),
        )
        .limit(1)

      const already = existing[0]
      if (already) {
        const commitment = await db
          .select()
          .from(schema.commitments)
          .where(eq(schema.commitments.interactionId, already.interaction.id))
          .limit(1)
        return reply
          .code(200)
          .send({ interaction: already.interaction, commitment: commitment[0] ?? null, replayed: true })
      }
    }

    // Checked before the transaction opens: a clash is the user's decision to
    // make, not a database error, so nothing should be written until they have
    // chosen to double-book or move something.
    if (body.commitment && !body.allowConflict) {
      const durationMinutes =
        body.commitment.durationMinutes ?? DEFAULT_DURATION_MINUTES[body.commitment.kind]
      const report = await checkConflicts(userId, {
        startsAt: new Date(body.commitment.dueAt),
        durationMinutes,
      })
      if (report.conflicts.length > 0) {
        return reply.code(409).send({ error: 'time_conflict', ...report })
      }
    }

    const result = await db.transaction(async (tx) => {
      let placeId = body.placeId ?? null

      if (!placeId && body.newPlace) {
        const place = takeFirst(
          await tx.insert(schema.places).values({ ...body.newPlace, orgId }).returning(),
          'place',
        )
        placeId = place.id
      }

      if (placeId) {
        const owned = await tx
          .select({ id: schema.places.id })
          .from(schema.places)
          .where(and(eq(schema.places.id, placeId), eq(schema.places.orgId, orgId)))
          .limit(1)
        if (owned.length === 0) {
          throw Object.assign(new Error('place_not_found'), { statusCode: 404 })
        }
      }

      // A phone number captured in the field is the most perishable thing in
      // this flow, so a new contact is created in the same transaction rather
      // than left as free text to be re-entered later.
      let contactId = body.contactId ?? null

      if (!contactId && body.newContact) {
        const name = body.newContact.name.trim()
        const role = body.newContact.role?.trim() || null
        const phone = body.newContact.phone?.trim() || null

        // Reuse the person if they are already here. Inserting blindly meant
        // logging two visits with the same plumber left two plumbers, each
        // half-filled, and neither findable as "the" one.
        const [existing] = await tx
          .select({
            id: schema.contacts.id,
            role: schema.contacts.role,
            phone: schema.contacts.phone,
            placeId: schema.contacts.placeId,
          })
          .from(schema.contacts)
          .where(and(eq(schema.contacts.orgId, orgId), ilike(schema.contacts.name, name)))
          .limit(1)

        if (existing) {
          // Only fill gaps. A detail already recorded was entered deliberately
          // and should not be replaced by whatever was typed this time.
          const fill = {
            ...(existing.role ? {} : role ? { role } : {}),
            ...(existing.phone ? {} : phone ? { phone } : {}),
            ...(existing.placeId ? {} : placeId ? { placeId } : {}),
          }
          if (Object.keys(fill).length > 0) {
            await tx.update(schema.contacts).set(fill).where(eq(schema.contacts.id, existing.id))
          }
          contactId = existing.id
        } else {
          const contact = takeFirst(
            await tx
              .insert(schema.contacts)
              .values({ orgId, placeId, name, role, phone })
              .returning(),
            'contact',
          )
          contactId = contact.id
        }
      }

      if (contactId) {
        const owned = await tx
          .select({ id: schema.contacts.id })
          .from(schema.contacts)
          .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.orgId, orgId)))
          .limit(1)
        if (owned.length === 0) {
          throw Object.assign(new Error('contact_not_found'), { statusCode: 404 })
        }
      }

      const interaction = takeFirst(
        await tx
          .insert(schema.interactions)
          .values({
            orgId,
            userId,
            placeId,
            contactId,
            clientId: body.clientId ?? null,
            purpose: body.purpose,
            contactName: body.newContact?.name.trim() ?? body.contactName ?? null,
            outcome: body.outcome ?? null,
            notes: body.notes ?? null,
            lat: body.lat ?? null,
            lng: body.lng ?? null,
            accuracyM: body.accuracyM ?? null,
            startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
          })
          .returning(),
        'interaction',
      )

      await attachVoiceNotes(orgId, interaction.id, body.voiceNoteIds ?? [], tx)

      if (!body.commitment) return { interaction, commitment: null }

      const dueAt = new Date(body.commitment.dueAt)
      const commitment = takeFirst(
        await tx
          .insert(schema.commitments)
          .values({
            orgId,
            userId,
            interactionId: interaction.id,
            placeId,
            contactId,
            title: body.commitment.title,
            kind: body.commitment.kind,
            dueAt,
            durationMinutes:
              body.commitment.durationMinutes ??
              DEFAULT_DURATION_MINUTES[body.commitment.kind],
          })
          .returning(),
        'commitment',
      )

      await scheduleFirstReminder({ orgId, commitmentId: commitment.id, fireAt: dueAt }, tx)
      return { interaction, commitment }
    })

    return reply.code(201).send(result)
  })

  function toDTO(
    interaction: typeof schema.interactions.$inferSelect,
    placeName: string | null,
    contact?: { name: string | null; phone: string | null } | null,
  ) {
    return {
      id: interaction.id,
      placeId: interaction.placeId,
      placeName,
      purpose: interaction.purpose as VisitDTO['purpose'],
      contactId: interaction.contactId,
      contactName: contact?.name ?? interaction.contactName,
      contactPhone: contact?.phone ?? null,
      outcome: interaction.outcome,
      notes: interaction.notes,
      lat: interaction.lat,
      lng: interaction.lng,
      startedAt: interaction.startedAt.toISOString(),
      createdAt: interaction.createdAt.toISOString(),
    } satisfies VisitDTO
  }

  app.get('/visits', async (req) => {
    const { orgId } = scope(req)
    const rows = await db
      .select({
        interaction: schema.interactions,
        placeName: schema.places.name,
        contactName: schema.contacts.name,
        contactPhone: schema.contacts.phone,
      })
      .from(schema.interactions)
      .leftJoin(schema.places, eq(schema.places.id, schema.interactions.placeId))
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.interactions.contactId))
      .where(eq(schema.interactions.orgId, orgId))
      .orderBy(desc(schema.interactions.startedAt))
      .limit(100)

    return rows.map((r) =>
      toDTO(r.interaction, r.placeName, { name: r.contactName, phone: r.contactPhone }),
    )
  })

  async function owned(orgId: string, id: string) {
    const rows = await db
      .select({
        interaction: schema.interactions,
        placeName: schema.places.name,
        contactName: schema.contacts.name,
        contactPhone: schema.contacts.phone,
      })
      .from(schema.interactions)
      .leftJoin(schema.places, eq(schema.places.id, schema.interactions.placeId))
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.interactions.contactId))
      .where(and(eq(schema.interactions.id, id), eq(schema.interactions.orgId, orgId)))
      .limit(1)
    return rows[0]
  }

  /** Single visit plus anything it committed you to, for the edit form. */
  app.get('/visits/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }

    const row = await owned(orgId, id)
    if (!row) return reply.code(404).send({ error: 'not_found' })

    const commitments = await db
      .select()
      .from(schema.commitments)
      .where(
        and(
          eq(schema.commitments.interactionId, id),
          eq(schema.commitments.orgId, orgId),
          ne(schema.commitments.status, 'deleted'),
        ),
      )
      .orderBy(desc(schema.commitments.dueAt))

    return {
      ...toDTO(row.interaction, row.placeName, {
        name: row.contactName,
        phone: row.contactPhone,
      }),
      commitments: commitments.map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        dueAt: c.dueAt.toISOString(),
        durationMinutes: c.durationMinutes,
        status: c.status,
        escalationCount: c.escalationCount,
        placeId: c.placeId,
        placeName: row.placeName,
        contactId: c.contactId,
        contactName: row.contactName ?? row.interaction.contactName,
        contactPhone: row.contactPhone,
        notes: row.interaction.notes,
        createdAt: c.createdAt.toISOString(),
      })),
    }
  })

  app.patch('/visits/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    const body = updateVisitInput.parse(req.body)

    if (!(await owned(orgId, id))) return reply.code(404).send({ error: 'not_found' })

    if (body.placeId) {
      const place = await db
        .select({ id: schema.places.id })
        .from(schema.places)
        .where(and(eq(schema.places.id, body.placeId), eq(schema.places.orgId, orgId)))
        .limit(1)
      if (place.length === 0) return reply.code(404).send({ error: 'place_not_found' })
    }

    await db
      .update(schema.interactions)
      .set({
        ...(body.placeId !== undefined ? { placeId: body.placeId } : {}),
        ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
        ...(body.purpose !== undefined ? { purpose: body.purpose } : {}),
        ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
        ...(body.outcome !== undefined ? { outcome: body.outcome } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.startedAt !== undefined ? { startedAt: new Date(body.startedAt) } : {}),
      })
      .where(eq(schema.interactions.id, id))

    const updated = await owned(orgId, id)
    return toDTO(updated!.interaction, updated!.placeName, {
      name: updated!.contactName,
      phone: updated!.contactPhone,
    })
  })

  /**
   * Deletes the visit record only. Commitments it created survive with a null
   * interactionId — a promise you made does not stop existing because you
   * deleted the note about the meeting.
   */
  app.delete('/visits/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    if (!(await owned(orgId, id))) return reply.code(404).send({ error: 'not_found' })

    await db.delete(schema.interactions).where(eq(schema.interactions.id, id))
    return { ok: true }
  })
}
