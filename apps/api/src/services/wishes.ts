import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scheduleFirstReminder } from './reminders.ts'

/**
 * Wishes meeting plans.
 *
 * Several things to do in one place belong together: visiting Hawa Mahal and
 * buying lakh chudi are one afternoon in Jaipur, not two reminders. So wishes
 * become one plan with a checklist — a new one on a trip, or added to a plan
 * that already exists — and each is marked as on that plan.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The user's own wishes, still waiting, in the order asked for. */
async function waiting(userId: string, ids: string[], tx: Tx | typeof db = db) {
  const rows = await tx
    .select()
    .from(schema.intentions)
    .where(
      and(
        eq(schema.intentions.userId, userId),
        eq(schema.intentions.status, 'saved'),
        inArray(schema.intentions.id, ids),
      ),
    )
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r) => r !== undefined)
}

async function addToList(orgId: string, commitmentId: string, texts: string[], tx: Tx) {
  const [last] = await tx
    .select({ max: sql<number>`coalesce(max(${schema.checklistItems.position}), -1)::int` })
    .from(schema.checklistItems)
    .where(eq(schema.checklistItems.commitmentId, commitmentId))
  const start = (last?.max ?? -1) + 1
  await tx.insert(schema.checklistItems).values(
    texts.map((text, i) => ({ orgId, commitmentId, text: text.slice(0, 300), position: start + i })),
  )
}

/** Wishes onto a plan that already exists, as items on its list. Null if the plan is not theirs. */
export async function attachWishes(orgId: string, userId: string, commitmentId: string, ids: string[]) {
  const [plan] = await db
    .select({ id: schema.commitments.id })
    .from(schema.commitments)
    .where(and(eq(schema.commitments.id, commitmentId), eq(schema.commitments.userId, userId)))
  if (!plan) return null

  return db.transaction(async (tx) => {
    const wishes = await waiting(userId, ids, tx)
    if (wishes.length === 0) return { added: 0 }
    await addToList(orgId, commitmentId, wishes.map((w) => w.title), tx)
    await tx
      .update(schema.intentions)
      .set({ status: 'scheduled', commitmentId })
      .where(inArray(schema.intentions.id, wishes.map((w) => w.id)))
    return { added: wishes.length }
  })
}

/**
 * Wishes as one new plan with a checklist — "Things to do in Jaipur" on a day
 * of the trip — rather than a reminder each. One wish on its own keeps its own
 * name and needs no list.
 */
export async function planWishes(
  orgId: string,
  userId: string,
  input: { ids: string[]; dueAt: Date; tripId?: string | null; title?: string },
) {
  return db.transaction(async (tx) => {
    const wishes = await waiting(userId, input.ids, tx)
    if (wishes.length === 0) return null

    let tripPlace: string | null = null
    if (input.tripId) {
      const [trip] = await tx
        .select({ placeLabel: schema.trips.placeLabel })
        .from(schema.trips)
        .where(and(eq(schema.trips.id, input.tripId), eq(schema.trips.userId, userId)))
      if (!trip) return null
      tripPlace = trip.placeLabel
    }
    const place = tripPlace ?? wishes.find((w) => w.placeLabel)?.placeLabel ?? null
    const one = wishes.length === 1
    const title =
      input.title?.trim() || (one ? wishes[0]!.title : place ? `Things to do in ${place}` : 'Things to do')

    const created = takeFirst(
      await tx
        .insert(schema.commitments)
        .values({
          orgId,
          userId,
          title,
          kind: 'task',
          dueAt: input.dueAt,
          // Room for all of it, without claiming the whole day.
          durationMinutes: Math.min(240, Math.max(60, wishes.length * 45)),
          tripId: input.tripId ?? null,
          placeLabel: place,
          // Wants an afternoon, not 3:00 PM sharp.
          flexibility: 'flexible',
          notes: one ? wishes[0]!.notes : null,
        })
        .returning(),
      'commitment',
    )
    await scheduleFirstReminder({ orgId, commitmentId: created.id, fireAt: input.dueAt }, tx)
    if (!one) await addToList(orgId, created.id, wishes.map((w) => w.title), tx)
    await tx
      .update(schema.intentions)
      .set({ status: 'scheduled', commitmentId: created.id })
      .where(inArray(schema.intentions.id, wishes.map((w) => w.id)))
    return { commitmentId: created.id, title, items: wishes.length }
  })
}
