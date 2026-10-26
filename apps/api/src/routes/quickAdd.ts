import type { FastifyInstance } from 'fastify'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  DEFAULT_DURATION_MINUTES,
  happeningKind,
  isHappening,
  parseWhen,
  mealTime,
  allClockTimes,
  clockLabel,
  type ParsedWhen,
  normalizeHinglish,
  HINDI_LEFTOVER,
  sphereOf,
  type Sphere,
  titleFrom,
  placeFrom,
  parseIntention,
  parseTrip,
  parseRecurrence,
  stripRecurrence,
  parseChecklist,
  parseRelative,
  stripRelative,
  extractRoles,
  expandRecurrence,
  describeRecurrence,
  originalIfInformative,
  findMalformedTime,
  diagnose,
  parseWishList,
  parseExpense,
  parseOwed,
  parseTrackerLine,
  parseExamLine,
  examLabel,
  examStage,
  EXAM_STEPS,
  type ParsedExamLine,
  parseBill,
  parseInsurance,
  parseVehicleNotice,
  parseFastag,
  parseChallan,
  serviceAsBooking,
  vehicleNoticeName,
  parseDelivery,
  parseBooking,
  leadLabel,
  findCity,
  DELIVERY_STATUS_LABEL,
  type ParsedDelivery,
  dueLabel,
  REPEATS,
  type ParsedBill,
  isLaterStage,
  type BoardKey,
  spentWhen,
  formatRupees,
  EXPENSE_CATEGORIES,
  STAGE_HI,
  STEP_HI,
  boardLabel,
  deliveryStatusLabel,
  expenseCategoryLabel,
  repeatLabel,
  trackerStageLabel,
  type CommitmentKind,
  type Lang,
  TIME_WINDOWS,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { langOf, msg, t } from '../i18n.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { scheduleFirstReminder } from '../services/reminders.ts'
import { checkConflicts } from '../services/scheduling.ts'
import { materialise } from '../services/recurrence.ts'
import {
  findPeople,
  frequentTitles,
  matchKnownPerson,
  placeOfPerson,
  recallSimilar,
  rememberPerson,
  resolveAnchor,
  type Learned,
} from '../services/memory.ts'
import { planWishes } from '../services/wishes.ts'
import { createExpense, tripOn } from '../services/expenses.ts'
import { addOwed } from '../services/owed.ts'
import { createItem, itemMentionedIn, updateItem } from '../services/trackers.ts'
import { deleteExam, localAt, saveExamLine, trackedExam } from '../services/exams.ts'
import { createBill } from '../services/bills.ts'
import { recordDelivery } from '../services/deliveries.ts'
import { bookingReminderTimes, webCheckInAt } from '../services/bookings.ts'
import { cachedReading, captureAiEnabled, readWithAi, type AiPart, type AiReading } from '../services/captureAi.ts'
import { isWayHome, tripForBooking } from '../services/tripAssembly.ts'
import {
  APPOINTMENT_WORD,
  CONTACT_VERB,
  PRONOUN,
  recentPeople,
  suggestionsFor,
  timeChoices,
  type Choice,
  type Suggestion,
} from '../services/suggest.ts'
import {
  findLinks,
  knownPlaces,
  tripLinkFor,
  upcomingTripTo,
  waitingFor,
  type Links,
  type TripLink,
} from '../services/captureLinks.ts'

/**
 * One sentence in, one thing planned.
 *
 * The capture screen had seventeen controls. Every one of them was a question
 * the app could usually answer — how long a dentist appointment runs, where it
 * is, what kind of thing it is — and asking anyway turned "dentist friday 6pm"
 * into a form-filling exercise. A personal assistant that costs more time than
 * it saves is not one.
 *
 * So the whole flow collapses into a single call: parse the sentence, fill the
 * gaps from what this person has done before, save it, and report back exactly
 * what was assumed so none of it is a surprise. Anything genuinely ambiguous is
 * still handed to the full form rather than guessed at.
 */

const quickInput = z.object({
  text: z.string().min(1).max(1000),
  /** Set when the user has seen a clash and chosen to book anyway. */
  allowConflict: z.boolean().optional(),
  /**
   * What the person decided about what the preview offered. A contact id
   * attaches that person; null is "not them". Absent leaves the preview's own
   * choice, which is only ever a certain match.
   */
  contactId: z.string().uuid().nullable().optional(),
  placeId: z.string().uuid().nullable().optional(),
  /** A clinic or company named in part: it becomes where the plan is. */
  accountName: z.string().max(200).nullable().optional(),
  /** A plan in another city: make it a trip there, or not. */
  trip: z.enum(['add', 'skip']).optional(),
  /** A "when I go to …" with a trip there already coming: put it on that trip. */
  onTrip: z.boolean().optional(),
  /**
   * Preview only: the person has paused, so a line the rules were unsure of
   * may be read by the AI. Never on every keystroke.
   */
  careful: z.boolean().optional(),
  /** The suggestions the person accepted, by id. */
  accept: z.array(z.enum(['start-early', 'gift', 'prepare', 'move-after-trip', 'book-cab'])).max(5).optional(),
  /** Work or personal, flipped by the person from what the preview read. */
  sphere: z.enum(['work', 'personal']).optional(),
  /**
   * What the person changed in the preview before saving — the title, the day
   * and time, how long. It wins over what the words said.
   */
  edits: z
    .object({
      title: z.string().trim().min(1).max(300).optional(),
      dueAt: z.string().datetime().optional(),
      durationMinutes: z.number().int().min(5).max(480).optional(),
      flexibility: z.enum(['fixed', 'flexible']).optional(),
      preferredWindow: z.enum(TIME_WINDOWS).nullable().optional(),
    })
    .optional(),
})

export type QuickKind =
  | 'commitment'
  | 'intention'
  | 'trip'
  | 'recurrence'
  /** Money spent: "₹450 cab to Mehta Physio". */
  | 'expense'
  /** Money owed to you: "Ravi owes me ₹500". */
  | 'owed'
  /** Something to track: "applied to Infosys for data analyst". */
  | 'tracker'
  /** An exam applied for, or one of its dates: "applied for RRB NTPC, reg no …". */
  | 'exam'
  /** A bill or a renewal: "rent ₹15,000 on the 1st every month". */
  | 'bill'
  /** A shop's or courier's message about a parcel. */
  | 'delivery'
  /** Understood, but it needs a time before it can be saved. */
  | 'needsTime'
  /** Understood, but more than one person could be meant. */
  | 'needsPerson'
  | 'unclear'

export async function quickAddRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** What this person adds often, for one-tap capture with nothing typed. */
  app.get('/quick/suggestions', async (req) => {
    const { sub: userId } = scope(req)
    return { frequent: await frequentTitles(userId) }
  })

  /**
   * A dry run: what would happen, without writing anything.
   *
   * The screen calls this as the user types so it can show the interpretation
   * before they commit. Save then repeats the work rather than trusting a
   * client-supplied plan, because a round trip is cheap and a forged one is not.
   */
  app.post('/quick/preview', async (req) => {
    const { sub: userId, orgId } = scope(req)
    const { text, careful } = quickInput.parse(req.body)
    const lang = await langOf(userId)
    return withSuggestions(
      userId,
      text,
      await enrich(userId, orgId, text, await read(userId, orgId, text, careful ? 'careful' : 'preview', lang), lang),
      lang,
    )
  })

  app.post('/quick', async (req, reply) => {
    const { sub: userId, orgId } = scope(req)
    const body = quickInput.parse(req.body)
    const { text, allowConflict } = body
    const lang = await langOf(userId)
    const plan = await withSuggestions(userId, text, await enrich(userId, orgId, text, await read(userId, orgId, text, 'save', lang), lang), lang)
    // Worked out again here rather than trusted from the screen, and only the
    // ones the person accepted are applied.
    const accepted = plan.suggestions.filter((s) => body.accept?.includes(s.id))
    if (body.sphere) plan.sphere = body.sphere
    const moved = accepted.find((s) => s.moveTo)
    if (moved && plan.kind === 'commitment') {
      plan.dueAt = moved.moveTo!
      plan.summary = `${plan.title} — ${new Date(plan.dueAt).toLocaleString(inLocale(lang, []), WHEN)}`
    }
    if (body.edits) applyEdits(plan, body.edits, lang)

    // What the person chose about what the preview offered.
    if (body.contactId === null) {
      plan.contactId = null
      plan.personName = null
    } else if (body.contactId) {
      const [c] = await db
        .select({ id: schema.contacts.id, name: schema.contacts.name })
        .from(schema.contacts)
        .where(and(eq(schema.contacts.id, body.contactId), eq(schema.contacts.orgId, orgId)))
      if (c) {
        plan.contactId = c.id
        plan.personName = c.name
      }
    }
    if (body.placeId === null) plan.placeId = null
    else if (body.placeId) {
      const [p] = await db
        .select({ id: schema.places.id })
        .from(schema.places)
        .where(and(eq(schema.places.id, body.placeId), eq(schema.places.orgId, orgId)))
      if (p) plan.placeId = p.id
    }
    if (body.accountName && plan.links.accounts.some((a) => a.name === body.accountName)) {
      plan.placeLabel = body.accountName
    }

    if (plan.kind === 'unclear') {
      return reply.code(422).send({ error: 'not_understood', ...plan })
    }

    // Understood, but it genuinely has no time in it. Asking one short question
    // is honest; inventing an hour and hoping is not.
    if (plan.kind === 'needsTime') {
      return reply.code(428).send({ error: 'needs_time', plan })
    }

    // Several people answer to that word. Asking is one tap; guessing wrong
    // puts the plan against a stranger and offers their phone number.
    if (plan.kind === 'needsPerson') {
      return reply.code(300).send({ error: 'needs_person', plan })
    }

    if (plan.kind === 'delivery' && plan.delivery) {
      const { delivery, created } = await recordDelivery(orgId, userId, plan.delivery)
      return reply.code(201).send({ ...plan, id: delivery.id, updated: !created })
    }

    if (plan.kind === 'bill' && plan.bill) {
      const saved = await createBill(orgId, userId, plan.bill)
      return reply.code(201).send({ ...plan, id: saved.id })
    }

    if (plan.kind === 'exam' && plan.exam) {
      const saved = await saveExamLine(orgId, userId, plan.exam)
      return reply.code(201).send({
        ...plan,
        id: saved.examId,
        // Added to an exam already tracked: undo takes back the new dates, not the exam.
        ...(saved.created ? {} : { ids: [] }),
        extras: saved.planIds.map((id) => ({ kind: 'commitment', id })),
      })
    }

    if (plan.kind === 'tracker' && plan.tracker) {
      const item = await createItem(orgId, userId, plan.tracker.board, {
        title: plan.tracker.title,
        detail: plan.tracker.detail,
        stage: plan.tracker.stage,
      })
      if (item === 'unknown_stage') return reply.code(400).send({ error: 'unknown_stage' })
      return reply.code(201).send({ ...plan, id: item.id })
    }

    if (plan.kind === 'owed' && plan.owed) {
      const id = await addOwed(orgId, userId, {
        contactId: plan.contactId,
        personName: plan.owed.name,
        amountPaise: plan.owed.amountPaise,
        note: plan.owed.note,
      })
      return reply.code(201).send({ ...plan, id })
    }

    if (plan.kind === 'expense' && plan.expense) {
      const account =
        body.accountName && plan.links.accounts.some((a) => a.name === body.accountName) ? body.accountName : null
      const saved = await createExpense(orgId, userId, {
        ...plan.expense,
        contactId: plan.contactId,
        account,
      })
      return reply.code(201).send({ ...plan, id: saved.id })
    }

    if (plan.kind === 'intention') {
      // One wish, or several from one line: "Jaipur: visit Hawa Mahal, buy
      // lakh chudi". Each is its own wish, kept together by their place.
      const rows = await db
        .insert(schema.intentions)
        .values(
          (plan.wishes ?? [plan.title]).map((title) => ({
            orgId,
            userId,
            placeLabel: plan.placeLabel,
            title,
            notes: plan.wishes ? null : (plan.notes ?? null),
          })),
        )
        .returning({ id: schema.intentions.id })
      const ids = rows.map((r) => r.id)

      // A trip there is already coming: they go straight onto it, together,
      // as one plan for an evening of it rather than a reminder each.
      const trip = body.onTrip ? plan.upcomingTrip : null
      if (trip) {
        const [y, m, d] = trip.startsOn.split('-').map(Number)
        await planWishes(orgId, userId, { ids, dueAt: new Date(y!, m! - 1, d!, 18, 0), tripId: trip.id })
        return reply.code(201).send({ ...plan, id: ids[0], ids, scheduledOnTrip: trip })
      }
      return reply.code(201).send({ ...plan, id: ids[0], ids })
    }

    if (plan.kind === 'trip') {
      const row = takeFirst(
        await db
          .insert(schema.trips)
          .values({
            orgId,
            userId,
            placeLabel: plan.placeLabel!,
            startsOn: plan.startsOn!,
            endsOn: plan.endsOn!,
            notes: plan.notes ?? null,
          })
          .returning(),
        'trip',
      )
      // Making a trip is when things saved for there become relevant.
      return reply.code(201).send({
        ...plan,
        id: row.id,
        savedTrip: { id: row.id, placeLabel: row.placeLabel, startsOn: row.startsOn, endsOn: row.endsOn },
        waiting: await waitingFor(userId, row.placeLabel),
      })
    }

    if (plan.kind === 'recurrence') {
      // One series per time of day: "9am and 9pm" is two reminders a day,
      // each kept, moved and stopped on its own.
      const created = await db.transaction(async (tx) => {
        const rows = []
        for (const at of [{ hour: plan.hour!, minute: plan.minute! }, ...plan.alsoAt]) {
          const row = takeFirst(
            await tx
              .insert(schema.recurrences)
              .values({
                orgId,
                userId,
                title: plan.title,
                kind: plan.commitmentKind,
                notes: plan.notes ?? null,
                durationMinutes: plan.durationMinutes,
                startsOn: plan.startsOn!,
                hour: at.hour,
                minute: at.minute,
                freq: plan.rule!.freq,
                interval: plan.rule!.interval,
                byWeekday: plan.rule!.byWeekday ?? null,
                byMonthDay: plan.rule!.byMonthDay ?? null,
                byMonth: plan.rule!.byMonth ?? null,
                setPos: plan.rule!.setPos ?? null,
                untilOn: plan.rule!.until ?? null,
                count: plan.rule!.count ?? null,
                // Stored only when the person flipped it: otherwise read from the words.
                sphere: body.sphere ?? null,
              })
              .returning(),
            'recurrence',
          )
          await materialise(row, {}, tx)
          rows.push(row)
        }
        return rows
      })
      const extras = await addExtras(orgId, userId, accepted)
      return reply.code(201).send({ ...plan, id: created[0]!.id, ids: created.map((r) => r.id), extras })
    }

    // ------------------------------------------------------- a single plan
    const dueAt = new Date(plan.dueAt!)

    if (!allowConflict && plan.flexibility === 'fixed' && !plan.allDay) {
      const report = await checkConflicts(userId, {
        startsAt: dueAt,
        durationMinutes: plan.durationMinutes,
      })
      if (report.conflicts.length > 0) {
        return reply.code(409).send({ error: 'time_conflict', plan, ...report })
      }
    }

    // A person named in the sentence becomes a real contact, with where they
    // are remembered against them — so "the dentist in Sirsi" only ever has to
    // be said once.
    let contactId = plan.contactId
    if (!contactId && plan.personName) {
      const remembered = await rememberPerson(orgId, userId, plan.personName, plan.placeLabel)
      contactId = remembered.contactId
    }

    // In another city: part of the trip already there, or a new one-day trip.
    const tripLink = plan.trip
    const makeTrip = tripLink && !tripLink.existing && body.trip === 'add'

    let bookingTrip: Awaited<ReturnType<typeof tripForBooking>> = null
    const row = await db.transaction(async (tx) => {
      let tripId = tripLink?.existing?.id ?? null
      if (plan.booking && body.trip !== 'skip') {
        // A journey or a stay: the trip it is part of, found or started and
        // stretched to hold it — the way out, the hotel and the way home as one.
        bookingTrip = await tripForBooking(
          orgId,
          userId,
          {
            type: plan.booking.type,
            startsAt: dueAt,
            endsOn: plan.booking.endsOn,
            city: plan.booking.city,
            fromCity: plan.booking.fromCity,
          },
          tx,
        )
        tripId = bookingTrip?.tripId ?? null
      } else if (makeTrip) {
        const trip = takeFirst(
          await tx
            .insert(schema.trips)
            .values({
              orgId,
              userId,
              placeLabel: tripLink.placeLabel,
              startsOn: tripLink.day,
              // A hotel stay is a trip to its check-out day.
              endsOn: plan.booking?.endsOn && plan.booking.endsOn > tripLink.day ? plan.booking.endsOn : tripLink.day,
            })
            .returning(),
          'trip',
        )
        tripId = trip.id
      }
      const created = takeFirst(
        await tx
          .insert(schema.commitments)
          .values({
            orgId,
            userId,
            title: plan.title,
            kind: plan.commitmentKind,
            dueAt,
            durationMinutes: plan.durationMinutes,
            allDay: Boolean(plan.allDay),
            // A whole day runs to its close, as one added by hand does.
            endsAt: plan.allDay ? new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate(), 23, 59, 59) : null,
            notes: plan.notes ?? null,
            placeLabel: plan.placeLabel ?? null,
            placeId: plan.placeId ?? null,
            contactId: contactId ?? null,
            tripId,
            flexibility: plan.flexibility,
            preferredWindow: plan.preferredWindow ?? null,
            trackerItemId: plan.trackerItem?.id ?? null,
            // Stored only when the person flipped it: otherwise read from the words.
            sphere: body.sphere ?? null,
            booking: plan.booking
              ? {
                  type: plan.booking.type,
                  ref: plan.booking.ref,
                  from: plan.booking.from,
                  city: plan.booking.city,
                  provider: plan.booking.provider,
                  remindBeforeMinutes: plan.booking.remindBeforeMinutes,
                  fromCity: plan.booking.fromCity,
                  endsOn: plan.booking.endsOn,
                }
              : null,
          })
          .returning(),
        'commitment',
      )
      if (plan.booking) {
        for (const at of bookingReminderTimes(dueAt, plan.booking.type, plan.booking.remindBeforeMinutes)) {
          await scheduleFirstReminder({ orgId, commitmentId: created.id, fireAt: at }, tx)
        }
      } else {
        await scheduleFirstReminder({ orgId, commitmentId: created.id, fireAt: dueAt }, tx)
      }
      return created
    })

    // A flight: web check-in opens about two days ahead, and is its own job.
    let checkInId: string | null = null
    if (plan.booking?.type === 'flight') {
      const opens = webCheckInAt(dueAt)
      if (opens) {
        const checkIn = takeFirst(
          await db
            .insert(schema.commitments)
            .values({
              orgId,
              userId,
              title: `Web check-in: ${plan.title}`,
              kind: 'task',
              dueAt: opens,
              durationMinutes: 15,
              notes: plan.notes ?? null,
              tripId: row.tripId,
              flexibility: 'flexible',
            })
            .returning(),
          'commitment',
        )
        await scheduleFirstReminder({ orgId, commitmentId: checkIn.id, fireAt: opens })
        checkInId = checkIn.id
      }
    }

    // "interview at Infosys friday": the application is at interview now.
    if (plan.trackerItem?.moveTo) {
      await updateItem(orgId, userId, plan.trackerItem.id, { stage: plan.trackerItem.moveTo })
    }

    if (plan.checklist.length > 0) {
      await db.insert(schema.checklistItems).values(
        plan.checklist.map((item, i) => ({
          orgId,
          commitmentId: row.id,
          text: item,
          position: i,
        })),
      )
    }

    // What the person accepted alongside: a start reminder, an hour to prepare.
    const extras = await addExtras(orgId, userId, accepted)

    // The trip as it stands now: a booking may have stretched it.
    const found = bookingTrip as Awaited<ReturnType<typeof tripForBooking>>
    const [tripNow] = row.tripId
      ? await db
          .select({ placeLabel: schema.trips.placeLabel, startsOn: schema.trips.startsOn, endsOn: schema.trips.endsOn })
          .from(schema.trips)
          .where(eq(schema.trips.id, row.tripId))
      : []

    return reply.code(201).send({
      ...plan,
      id: row.id,
      // Undo takes the check-in with it, and anything accepted alongside.
      ...(checkInId ? { ids: [row.id, checkInId] } : {}),
      extras,
      savedTrip:
        tripNow && row.tripId
          ? {
              id: row.tripId,
              placeLabel: tripNow.placeLabel,
              startsOn: tripNow.startsOn,
              endsOn: tripNow.endsOn,
              created: found ? found.created : Boolean(makeTrip),
            }
          : null,
      waiting: tripNow ? (found ? await waitingFor(userId, tripNow.placeLabel) : (tripLink?.waiting ?? [])) : [],
    })
  })

  /** Undo, for when the one-tap save was the wrong tap. */
  app.delete('/quick/:kind/:id', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { kind, id } = z
      .object({
        kind: z.enum(['commitment', 'intention', 'trip', 'recurrence', 'expense', 'owed', 'tracker', 'bill', 'delivery', 'exam']),
        id: z.string().uuid(),
      })
      .parse(req.params)

    // An exam goes with its dates still to come.
    if (kind === 'exam') return (await deleteExam(userId, id)) ? { ok: true } : reply.code(404).send({ error: 'not_found' })

    const table =
      kind === 'commitment'
        ? schema.commitments
        : kind === 'intention'
          ? schema.intentions
          : kind === 'trip'
            ? schema.trips
            : kind === 'expense'
              ? schema.expenses
              : kind === 'owed'
                ? schema.moneyOwed
                : kind === 'tracker'
                  ? schema.trackerItems
                  : kind === 'bill'
                    ? schema.bills
                    : kind === 'delivery'
                      ? schema.deliveries
                      : schema.recurrences

    // Scoped to the owner in the same statement as the delete. Checking after
    // the fact, or not at all, would let any signed-in account remove another's
    // row by guessing an id.
    const removed = await db
      .delete(table)
      .where(and(eq(table.id, id), eq(table.userId, userId)))
      .returning({ id: table.id })

    if (removed.length === 0) return reply.code(404).send({ error: 'not_found' })

    // A trip made only for this plan goes with it — unless something else
    // has been put on it since.
    const { alsoTrip } = z.object({ alsoTrip: z.string().uuid().optional() }).parse(req.query)
    if (alsoTrip && kind === 'commitment') {
      const [left] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.commitments)
        .where(eq(schema.commitments.tripId, alsoTrip))
      if ((left?.n ?? 0) === 0) {
        await db.delete(schema.trips).where(and(eq(schema.trips.id, alsoTrip), eq(schema.trips.userId, userId)))
      }
    }
    return { ok: true }
  })
}

/**
 * The preview, changed by the person before saving: their title, day, time
 * and length win over the words. A plan the words gave no time to becomes an
 * ordinary plan once a time is set; a day moved off the trip it was read
 * against is no longer that trip's.
 */
export function applyEdits(plan: QuickPlan, edits: NonNullable<z.infer<typeof quickInput>['edits']>, lang: Lang): void {
  if (plan.kind !== 'commitment' && plan.kind !== 'needsTime') return
  if (edits.title) plan.title = edits.title
  if (edits.durationMinutes) plan.durationMinutes = edits.durationMinutes
  if (edits.dueAt) {
    const before = plan.dueAt ? new Date(plan.dueAt) : null
    const at = new Date(edits.dueAt)
    plan.kind = 'commitment'
    if (plan.allDay && before && before.getTime() !== at.getTime()) plan.allDay = false
    plan.dueAt = at.toISOString()
    plan.flexibility = edits.flexibility ?? 'fixed'
    plan.preferredWindow = plan.flexibility === 'flexible' ? (edits.preferredWindow ?? plan.preferredWindow ?? null) : null
    if (plan.trip && (!before || before.toDateString() !== at.toDateString())) plan.trip = null
  }
  if (plan.dueAt) plan.summary = summaryOf(plan.title, new Date(plan.dueAt), Boolean(plan.allDay), lang)
}

export interface QuickPlan {
  kind: QuickKind
  title: string
  commitmentKind: CommitmentKind
  durationMinutes: number
  flexibility: 'fixed' | 'flexible'
  preferredWindow: string | null
  notes: string | null
  placeLabel: string | null
  placeId: string | null
  contactId: string | null
  /** The person the sentence named, before they are looked up or created. */
  personName: string | null
  /** Everyone that name or role could mean, when it is more than one. */
  people: { id: string; name: string; role: string | null; phone: string | null; placeLabel: string | null }[]
  /** Things to tick off once this is under way. */
  checklist: string[]
  dueAt: string | null
  /** A festival or an occasion with no time said: the whole day, reminded at its start. */
  allDay?: boolean
  startsOn: string | null
  endsOn: string | null
  hour: number | null
  minute: number | null
  rule: ReturnType<typeof parseRecurrence> extends null
    ? never
    : NonNullable<ReturnType<typeof parseRecurrence>>['rule'] | null
  /** More times of day for the same repeat: "medicine at 9am and 9pm". */
  alsoAt: { hour: number; minute: number }[]
  /** People, places and accounts the sentence seems to mean: attach or not. */
  links: Links
  /** In a city that is not home: the trip this belongs to, or would. */
  trip: TripLink | null
  /** For "when I go to …": the next trip there, if one is already planned. */
  upcomingTrip: { id: string; placeLabel: string; startsOn: string; endsOn: string } | null
  /** Several wishes from one line, saved together: "Jaipur: a, b". */
  wishes: string[] | null
  /** Money spent, read from the line. */
  expense: { amountPaise: number; category: string; note: string | null; spentOn: string } | null
  /** Money owed to you, read from the line. */
  owed: { amountPaise: number; name: string; note: string | null } | null
  /** A bill or a renewal, read from the line. */
  bill: ParsedBill | null
  /** A parcel, read from a shop's or courier's message. */
  delivery: ParsedDelivery | null
  /** A booking confirmation behind this plan: a train, a flight, a hotel, a show. */
  booking: {
    type: string
    ref: string | null
    from: string | null
    city: string | null
    provider: string | null
    remindBeforeMinutes: number
    endsOn: string | null
    /** Where a journey leaves from: how the way home joins its trip. */
    fromCity: string | null
  } | null
  /** A new job application, candidate or deal, read from the line. */
  tracker: { board: BoardKey; stage: string; title: string; detail: string | null } | null
  /** An exam, or one of its dates, read from the line; trackedId when it adds to one already tracked. */
  exam: (ParsedExamLine & { trackedId: string | null }) | null
  /** The tracked item a plan is the next step of, and the stage it moves it to. */
  trackerItem: { id: string; board: BoardKey; title: string; stage: string; moveTo: string | null } | null
  /** Plain-words account of every assumption made, shown before and after saving. */
  assumptions: string[]
  /** The rules read this, but would be guessing: a line for the AI, when it is on. */
  unsure: boolean
  /** Who read it: the rules, or the AI for a line the rules were unsure of. */
  readBy: 'rules' | 'ai'
  /** Set when the AI is on and could read this line better, once typing pauses. */
  canReadCarefully?: boolean
  /** When it is a question instead of a plan: what to ask. */
  question: string | null
  /** Answers to tap: each sets the line to how it reads with that answer. */
  choices: Choice[]
  /** "before 31 July", "by Friday": a date to finish by, not to start at. */
  deadline: boolean
  /** Better plans on offer, each applied on save only if accepted. */
  suggestions: Suggestion[]
  /** Work or personal, as read from the words; null when they say neither. */
  sphere: Sphere | null
  /** Why the app could not tell, when it could not. */
  problem: string | null
  summary: string
}

/**
 * What the sentence already knows about: people, places and accounts it seems
 * to name, and — for a plan in another city — the trip it belongs to. A single
 * certain person is attached; everything else is offered, never assumed.
 */
/** What the preview shows for a line: read, then linked to what it mentions. */
export async function enrichForTest(userId: string, orgId: string, raw: string, lang: Lang = 'en'): Promise<QuickPlan> {
  return enrich(userId, orgId, raw, await interpret(userId, orgId, raw, new Date(), lang), lang)
}

/**
 * The rules' reading, or — for a line they were unsure of, with the AI on —
 * the AI's.
 *
 * A preview while typing never waits on the AI: it says a careful reading is
 * possible, and the screen asks for one when typing pauses. Save uses only a
 * reading the preview already showed (it is cached), so what is saved is what
 * was seen.
 */
async function read(
  userId: string,
  orgId: string,
  text: string,
  mode: 'preview' | 'careful' | 'save',
  lang: Lang = 'en',
): Promise<QuickPlan> {
  const now = new Date()
  const plan = await interpret(userId, orgId, text, now, lang)
  // Hindi left in the title ("sabzi lana", "call karna hai") means the rules
  // read the time and not the rest: worth a careful look too.
  const halfRead =
    (plan.kind === 'commitment' || plan.kind === 'recurrence' || plan.kind === 'needsTime') && HINDI_LEFTOVER.test(plan.title)
  if (!(plan.unsure || halfRead) || !captureAiEnabled()) return plan

  let reading = cachedReading(userId, text, lang)
  if (!reading && mode === 'careful') {
    const [user] = await db.select({ isDemo: schema.users.isDemo }).from(schema.users).where(eq(schema.users.id, userId))
    reading = await readWithAi(userId, text, now, { isDemo: user?.isDemo, lang })
  }
  if (!reading) return mode === 'preview' ? { ...plan, canReadCarefully: true } : plan
  return planFromAi(plan, reading, now, text, lang)
}

/** `read` for the tests, which have no HTTP server to go through. */
export const readForTest = read

const PART_HOUR: Record<AiPart, number> = { morning: 9, afternoon: 14, evening: 18, night: 20 }

/**
 * The AI's reading as a plan, through the same shapes the rules produce. Where
 * it cannot be used — a date gone by, a trip with no place — the rules'
 * reading stands rather than a broken one.
 */
export function planFromAi(rules: QuickPlan, r: AiReading, now: Date, line: string, lang: Lang = 'en'): QuickPlan {
  const note = t(lang, 'Read carefully by Cue’s AI, as the usual rules were not sure.')
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = r.date ? new Date(`${r.date}T00:00:00`) : today
  if (day < today) return rules
  const common: QuickPlan = {
    ...rules,
    readBy: 'ai',
    unsure: false,
    problem: null,
    title: r.title,
    personName: r.person ?? rules.personName,
    commitmentKind: r.planKind as CommitmentKind,
    durationMinutes: DEFAULT_DURATION_MINUTES[r.planKind as CommitmentKind] ?? rules.durationMinutes,
    assumptions: [...r.assumptions, note],
  }
  const clock = (fallback: number) =>
    r.time
      ? { hour: Number(r.time.slice(0, 2)), minute: Number(r.time.slice(3)), said: true }
      : { hour: r.partOfDay ? PART_HOUR[r.partOfDay] : fallback, minute: 0, said: false }

  switch (r.kind) {
    case 'not_a_plan':
      return {
        ...rules,
        readBy: 'ai',
        unsure: false,
        kind: 'unclear',
        problem: t(lang, 'That does not look like something to plan. Say what, and when.'),
        summary: '',
      }

    case 'ask':
      // Understood, bar one thing: ask exactly that, with answers to tap.
      return {
        ...common,
        kind: 'needsTime',
        question: r.question ?? t(lang, 'When is it?'),
        choices: r.choices.map((c) => ({ label: c, line: `${line.trim()} ${c}` })),
        assumptions: r.assumptions,
        summary: r.title,
      }

    case 'wish':
      if (!r.place) return rules
      return {
        ...common,
        kind: 'intention',
        placeLabel: r.place,
        assumptions: [t(lang, 'No date — it waits until you plan a trip to {place}.', { place: r.place }), note],
        summary: t(lang, '"{title}" saved for {place}', { title: r.title, place: r.place }),
      }

    case 'trip': {
      if (!r.place || !r.date) return rules
      const endsOn = r.endDate && r.endDate >= r.date ? r.endDate : r.date
      return {
        ...common,
        kind: 'trip',
        title: r.place,
        placeLabel: r.place,
        startsOn: r.date,
        endsOn,
        summary: t(lang, 'Trip to {place}, {dates}', { place: r.place, dates: tripSpan(r.date, endsOn, lang) }),
      }
    }

    case 'repeat': {
      const p = r.repeat!
      const rule: NonNullable<QuickPlan['rule']> = { freq: p.freq, interval: p.interval }
      if (p.freq === 'weekly' && p.weekdays.length) rule.byWeekday = p.weekdays
      if (p.freq === 'monthly' && p.monthDay) rule.byMonthDay = p.monthDay
      if (p.freq === 'yearly') {
        if (!r.date) return rules
        rule.byMonth = day.getMonth()
        rule.byMonthDay = day.getDate()
      }
      const { hour, minute, said } = clock(9)
      const horizon = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate())
      const [first] = expandRecurrence(rule, { startsOn: now, hour, minute }, { from: now, to: horizon })
      if (!first) return rules
      return {
        ...common,
        kind: 'recurrence',
        startsOn: ymd(first),
        hour,
        minute,
        rule,
        alsoAt: [],
        assumptions: [...(said || r.partOfDay ? [] : [t(lang, 'No time given, so 9am.')]), ...common.assumptions],
        summary: t(lang, '{title} — {repeat}, from {date}', {
          title: r.title,
          repeat: describeRecurrence(rule, { startsOn: first, hour, minute }, lang),
          date: startDay(first, lang),
        }),
      }
    }

    case 'plan': {
      // A day and no time: today, whenever suits; another day, at nine.
      const isToday = day.getTime() === today.getTime()
      const fallback = isToday ? Math.min(now.getHours() + 1, 20) : 9
      const { hour, minute, said } = clock(fallback)
      const due = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
      const flexible = !said
      if (due <= now) {
        // A time already gone today: tomorrow if no day was said, otherwise
        // the next hour for something flexible, and the rules if fixed.
        if (!r.date) due.setDate(due.getDate() + 1)
        else if (flexible) due.setTime(now.getTime() + 3_600_000 - (now.getTime() % 3_600_000))
        else return rules
      }
      const window = flexible ? (r.partOfDay ?? (isToday ? (now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening') : null)) : null
      return {
        ...common,
        kind: 'commitment',
        dueAt: due.toISOString(),
        flexibility: flexible && window ? 'flexible' : 'fixed',
        preferredWindow: flexible ? window : null,
        assumptions: [
          ...(said || r.partOfDay || isToday ? [] : [t(lang, 'No time given, so 9am.')]),
          ...(flexible && isToday && !r.partOfDay
            ? [t(lang, 'No time given, so {when}, whenever suits.', { when: t(lang, THIS_WINDOW[window ?? ''] ?? `this ${window}`) })]
            : []),
          ...common.assumptions,
        ],
        summary: `${r.title} — ${due.toLocaleString(inLocale(lang, []), WHEN)}`,
      }
    }
  }
}

/** A sentence that starts by saying money is still to go out is a to-do. */
const TO_PAY = /^\s*(?:pay|send|transfer|give|buy|book|renew|deposit|collect|get|withdraw)\b/i

async function enrich(userId: string, orgId: string, raw: string, plan: QuickPlan, lang: Lang = 'en'): Promise<QuickPlan> {
  if (plan.kind === 'intention' && plan.placeLabel) {
    return { ...plan, upcomingTrip: await upcomingTripTo(userId, plan.placeLabel) }
  }
  if (plan.kind !== 'commitment' && plan.kind !== 'needsTime' && plan.kind !== 'expense' && plan.kind !== 'owed') {
    return plan
  }

  // A booking: the names in it are passengers, not people to link; the city it
  // takes you to is the trip.
  if (plan.booking) {
    const next: QuickPlan = { ...plan, links: { people: [], places: [], accounts: [] } }
    // The way home is part of the trip it ends, not a trip to home.
    const home =
      plan.dueAt !== null &&
      (await isWayHome(userId, { city: plan.booking.city, fromCity: plan.booking.fromCity, startsAt: new Date(plan.dueAt) }))
    if (plan.booking.city && plan.dueAt && !home) {
      const trip = await tripLinkFor(userId, plan.booking.city, plan.booking.city, new Date(plan.dueAt))
      if (trip) next.trip = trip
    }
    return next
  }

  const links = await findLinks(orgId, raw, { contactId: plan.contactId })
  const certain = links.people.filter((p) => p.certain)
  const next = { ...plan, links }
  if (!next.contactId && certain.length === 1) {
    next.contactId = certain[0]!.id
    next.personName = certain[0]!.name
  }

  // An expense is linked to whom it was for, not turned into a trip.
  if (plan.kind === 'expense') return { ...next, links: { ...links, places: [] } }
  // Owed by a person: the people are the only question worth asking.
  if (plan.kind === 'owed' && plan.owed) {
    const who = next.contactId && next.personName ? next.personName : plan.owed.name
    return {
      ...next,
      title: t(lang, '{name} owes you {amount}', { name: who, amount: formatRupees(plan.owed.amountPaise) }),
      summary: `${t(lang, '{amount} from {name}', { amount: formatRupees(plan.owed.amountPaise), name: who })}${plan.owed.note ? ` · ${plan.owed.note}` : ''}`,
      links: { ...links, places: [], accounts: [] },
    }
  }

  // The next step of something being tracked: "interview at Infosys friday".
  if (plan.kind === 'commitment') {
    const item = await itemMentionedIn(userId, raw)
    if (item) {
      const interview = /\binterview/i.test(raw) && (item.board === 'jobs' || item.board === 'hiring')
      const moveTo = interview && isLaterStage(item.board, item.stage, 'interview') ? 'interview' : null
      const label = item.board === 'jobs' ? 'application' : item.board === 'hiring' ? 'candidate' : 'deal'
      next.trackerItem = { id: item.id, board: item.board, title: item.title, stage: item.stage, moveTo }
      next.assumptions = [...next.assumptions, t(lang, PART_OF[label][moveTo ? 1 : 0], { title: item.title })]
    }
  }

  if (plan.kind === 'commitment' && plan.dueAt) {
    const trip = await tripLinkFor(userId, raw, plan.placeLabel, new Date(plan.dueAt))
    if (trip) {
      next.trip = trip
      // "client meeting pune friday" never said "in": where it is, it is.
      if (!next.placeLabel) next.placeLabel = trip.placeLabel
    }
  }
  return next
}

type Repeat = NonNullable<ReturnType<typeof parseRecurrence>> & { yearlyOccasion?: boolean }

/**
 * A capitalised name after the first word — "call Ravi and tell him" — that is
 * not a day or a month. With one, "him" has someone to be.
 */
const NAMES_SOMEONE =
  /(?<=\S\s+)(?!(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun|I|EOD|PR)\b)[A-Z][a-z]{2,}\b/

/**
 * Suggestions worked out for a plan, from what it has become after linking,
 * and which half of life it reads as.
 */
async function withSuggestions(userId: string, line: string, plan: QuickPlan, lang: Lang = 'en'): Promise<QuickPlan> {
  return {
    ...plan,
    suggestions: await suggestionsFor(userId, plan, line, new Date(), lang),
    sphere: sphereOf(plan.title, { kind: plan.commitmentKind, booking: Boolean(plan.booking), board: plan.tracker?.board ?? null }),
  }
}

/**
 * What accepting a suggestion adds: a plan of its own, or a yearly reminder.
 * Returned with their kinds, so Undo can take them away again too.
 */
async function addExtras(
  orgId: string,
  userId: string,
  accepted: Suggestion[],
): Promise<{ kind: 'commitment' | 'recurrence'; id: string }[]> {
  const out: { kind: 'commitment' | 'recurrence'; id: string }[] = []
  for (const s of accepted) {
    if (s.extra) {
      const dueAt = new Date(s.extra.dueAt)
      const row = takeFirst(
        await db
          .insert(schema.commitments)
          .values({
            orgId,
            userId,
            title: s.extra.title,
            kind: s.extra.kind,
            dueAt,
            durationMinutes: s.extra.durationMinutes,
            flexibility: s.extra.flexible ? 'flexible' : 'fixed',
            preferredWindow: s.extra.flexible ? 'morning' : null,
          })
          .returning(),
        'commitment',
      )
      await scheduleFirstReminder({ orgId, commitmentId: row.id, fireAt: dueAt })
      out.push({ kind: 'commitment', id: row.id })
    }
    if (s.yearly) {
      const row = takeFirst(
        await db
          .insert(schema.recurrences)
          .values({
            orgId,
            userId,
            title: s.yearly.title,
            kind: 'task',
            durationMinutes: 15,
            startsOn: ymd(new Date()),
            hour: s.yearly.hour,
            minute: s.yearly.minute,
            freq: 'yearly',
            interval: 1,
            byMonth: s.yearly.byMonth,
            byMonthDay: s.yearly.byMonthDay,
          })
          .returning(),
        'recurrence',
      )
      await materialise(row, {})
      out.push({ kind: 'recurrence', id: row.id })
    }
  }
  return out
}

/**
 * The question for an appointment with no time, and the free times that
 * answer it: that day's when a day was said, the next few days' when not.
 */
async function askWhatTime(
  userId: string,
  line: string,
  title: string,
  now: Date,
  day: Date | null,
  lang: Lang,
): Promise<{ question: string; choices: Choice[] }> {
  const choices = await timeChoices(userId, line.trim(), DEFAULT_DURATION_MINUTES.meeting, now, day, lang)
  const question = day
    ? t(lang, 'What time is “{title}” on {day}?', {
        title,
        day: day.toLocaleDateString(inLocale(lang, 'en-IN'), { weekday: 'long', day: 'numeric', month: 'short' }),
      })
    : t(lang, 'When is “{title}”?', { title })
  return { question: choices.length ? `${question} ${t(lang, 'You’re free at:')}` : question, choices }
}

/**
 * A journey's first reminder, by where it sends you: with the reference to
 * hand, or with the details. Said with t(lang, line).
 */
const LEAVING_FOR: Record<string, [string, string]> = {
  flight: [
    msg('A reminder at {time} to leave for the airport, {lead}, with the reference to hand.'),
    msg('A reminder at {time} to leave for the airport, {lead}, with the details to hand.'),
  ],
  train: [
    msg('A reminder at {time} to leave for the station, {lead}, with the reference to hand.'),
    msg('A reminder at {time} to leave for the station, {lead}, with the details to hand.'),
  ],
  bus: [
    msg('A reminder at {time} to leave for the bus, {lead}, with the reference to hand.'),
    msg('A reminder at {time} to leave for the bus, {lead}, with the details to hand.'),
  ],
}

/** Day and time in a summary, as they have always been written. */
const WHEN: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }
const DAY: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }

/**
 * What kind of plan a line is. An occasion when its words name one — they win
 * over history; otherwise what lines like it were before — but never an
 * occasion the words no longer name: "buy diwali sweets" is not Diwali.
 */
function kindFrom(title: string, learned: string | null | undefined, otherwise: CommitmentKind): CommitmentKind {
  const reads = happeningKind(title)
  if (reads) return reads
  if (learned && !isHappening(learned)) return learned as CommitmentKind
  return otherwise
}

/** "Diwali — Sun 1 Nov, all day", "Dentist — Fri 30 Oct, 5:00 pm". */
function summaryOf(title: string, at: Date, allDay: boolean, lang: Lang): string {
  return allDay
    ? `${title} — ${t(lang, '{day}, all day', { day: at.toLocaleDateString(inLocale(lang, []), DAY) })}`
    : `${title} — ${at.toLocaleString(inLocale(lang, []), WHEN)}`
}

/** The locale a date is written in: the one it always was, or Hindi's day and month names. */
function inLocale(lang: Lang, en?: string | string[]): string | string[] | undefined {
  return lang === 'hi' ? 'hi-IN' : en
}

/** When a series starts: "18 अक्तू॰" in Hindi; English as it always was. */
function startDay(d: Date, lang: Lang): string {
  return lang === 'hi' ? d.toLocaleDateString('hi-IN', { day: 'numeric', month: 'short' }) : d.toLocaleDateString()
}

/** " and " between times, in the person's language. */
const andWord = (lang: Lang) => (lang === 'hi' ? ' और ' : ' and ')

/** Part of the day, for a plan filed with no set slot. Said with t(lang, …). */
const THIS_WINDOW: Record<string, string> = {
  morning: msg('this morning'),
  afternoon: msg('this afternoon'),
  evening: msg('this evening'),
}

/** "No time given, so lunch time, 1 pm." — a line per meal, as Hindi says each its own way. */
const MEAL_NOTE: Record<string, string> = {
  breakfast: msg('No time given, so breakfast time, {time}.'),
  brunch: msg('No time given, so brunch time, {time}.'),
  lunch: msg('No time given, so lunch time, {time}.'),
  dinner: msg('No time given, so dinner time, {time}.'),
}

function mealNote(meal: string, time: string, lang: Lang): string {
  const line = MEAL_NOTE[meal]
  return line ? t(lang, line, { time }) : `No time given, so ${meal} time, ${time}.`
}

/** A plan that is the next step of something tracked: what it is part of, and whether it moves on. */
const PART_OF: Record<'application' | 'candidate' | 'deal', [string, string]> = {
  application: [msg('Part of your {title} application.'), msg('Part of your {title} application; it moves to Interviewing.')],
  candidate: [msg('Part of your {title} candidate.'), msg('Part of your {title} candidate; it moves to Interviewing.')],
  deal: [msg('Part of your {title} deal.'), msg('Part of your {title} deal; it moves to Interviewing.')],
}

/** An anchor not found: named or not, that day or the next week, before or after it. */
const NOT_FOUND = {
  named: {
    day: {
      before: msg('I could not find "{anchor}" that day to go before, so: when?'),
      after: msg('I could not find "{anchor}" that day to go after, so: when?'),
    },
    week: {
      before: msg('I could not find "{anchor}" in the next week to go before, so: when?'),
      after: msg('I could not find "{anchor}" in the next week to go after, so: when?'),
    },
  },
  anything: {
    day: {
      before: msg('I could not find anything that day to go before, so: when?'),
      after: msg('I could not find anything that day to go after, so: when?'),
    },
    week: {
      before: msg('I could not find anything in the next week to go before, so: when?'),
      after: msg('I could not find anything in the next week to go after, so: when?'),
    },
  },
}

/** The kinds of appointment the role reader names, for "Read as: …". */
const KIND_WORD: Record<string, string> = {
  appointment: msg('appointment'),
  meeting: msg('meeting'),
  call: msg('call'),
  visit: msg('visit'),
  demo: msg('demo'),
  interview: msg('interview'),
}

/**
 * Why history suggested what it did, in the person's language. memory.ts says
 * it in English; for Hindi the same facts are said again, whole.
 */
function learnedWhy(learned: Learned | null, lang: Lang): string {
  const because = learned?.because ?? ''
  if (lang === 'en' || !learned || !because) return because
  const place = learned.placeLabel && because.includes(`at ${learned.placeLabel}`) ? learned.placeLabel : null
  if (learned.timesSeen === 1) return place ? t(lang, 'Last time this was at {place}.', { place }) : because
  const n = learned.timesSeen
  const min = /— usually (\d+) min\b/.exec(because)?.[1]
  if (min && place) return t(lang, 'You have done this {n} times — usually {min} min, at {place}.', { n, min, place })
  if (min) return t(lang, 'You have done this {n} times — usually {min} min.', { n, min })
  if (place) return t(lang, 'You have done this {n} times — at {place}.', { n, place })
  return because
}

/** The time history supplied, said the same way. */
function learnedHourWhy(learned: Learned | null, lang: Lang): string | null {
  const because = learned?.becauseHour ?? null
  if (lang === 'en' || !learned || !because) return because
  if (learned.hour !== null) return t(lang, 'You usually do this around {time}.', { time: clockLabel(learned.hour, 0) })
  if (learned.lastHour !== null) {
    return t(lang, 'Last time this was at {time}.', { time: clockLabel(learned.lastHour, learned.lastMinute ?? 0) })
  }
  return because
}

/** Birthdays and anniversaries come round every year, whether or not the line says so. */
const OCCASION = /\b(?:birthday|bday|b'day|anniversary)\b/i
const DAY_AND_MONTH =
  /\b(?:on\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:on\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/i

/** "Riya's birthday on 3 Nov": a yearly repeat on that day, not a one-off. */
function occasionRepeat(text: string, now: Date): Repeat | null {
  if (!OCCASION.test(text)) return null
  const said = DAY_AND_MONTH.exec(text)
  const day = said ? parseWhen(said[0], now) : null
  if (!said || !day) return null
  return {
    rule: { freq: 'yearly', interval: 1, byMonth: day.date.getMonth(), byMonthDay: day.date.getDate() },
    matches: [said[0]],
    yearlyOccasion: true,
  }
}

/** What the date reader decided on its own, said plainly so it can be checked. */
function timeNotes(when: ParsedWhen, now: Date, lang: Lang): string[] {
  const notes: string[] = []
  if (when.halfGuessed) {
    const other = clockLabel((when.date.getHours() + 12) % 24, when.date.getMinutes())
    notes.push(t(lang, 'Read as {time}. Say {other} if you meant that.', { time: clockLabel(when.date.getHours(), when.date.getMinutes()), other }))
  }
  if (when.deadline) {
    const date = when.date.toLocaleDateString(inLocale(lang, 'en-IN'), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: when.date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    })
    notes.push(t(lang, 'Due by {date}.', { date }))
  }
  if (when.meal) notes.push(mealNote(when.meal, clockLabel(when.date.getHours(), when.date.getMinutes()), lang))
  return notes
}

/** Getting ready for something on a day: "slides for Monday's board meeting". */
const PREP = /\b(?:prepare|prep|ready|slides|deck|presentation|notes|agenda|report|draft|finish|review|read|print|practice|rehearse|pack|iron)\b/i
/** Work, which is ready on a working day. */
const WORK_PREP = /\b(?:slides|deck|presentation|agenda|report|draft|review)\b/i

/**
 * When something done for an event on a day is due: the day before, at five,
 * so it is ready in time. Null when that has already gone.
 */
function dayBefore(event: Date, now: Date, workingDay: boolean): Date | null {
  const due = new Date(event.getFullYear(), event.getMonth(), event.getDate() - 1, 17, 0)
  // Slides for Monday's meeting are ready on Friday, not on a Sunday nobody
  // works. Packing for Sunday's trip is fine on Saturday.
  if (workingDay) while (due.getDay() === 0 || due.getDay() === 6) due.setDate(due.getDate() - 1)
  return due > now ? due : null
}

/**
 * "Slides for Monday's board meeting": due before that day, not at 9am on it —
 * by then it is too late. Only when no time was said; a time said is kept.
 */
function prepDue(text: string, when: ParsedWhen, now: Date): Date | null {
  if (!when.possessive || !when.timeAssumed || !PREP.test(text)) return null
  return dayBefore(when.date, now, WORK_PREP.test(text))
}

function prepNote(due: Date, lang: Lang): string {
  const day = due.toLocaleDateString(inLocale(lang, 'en-IN'), { weekday: 'long' })
  return t(lang, 'Due {day} at 5 pm, so it is ready in time.', { day })
}

/** "2 – 4 Nov", "30 Oct – 2 Nov", "2 Nov": dates as a person writes them. */
function tripSpan(from: string, to: string, lang: Lang): string {
  const day = (s: string) => new Date(`${s}T00:00:00`)
  const a = day(from)
  const b = day(to)
  const month = (d: Date) => d.toLocaleDateString(inLocale(lang, 'en-IN'), { month: 'short' })
  if (from === to) return `${a.getDate()} ${month(a)}`
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.getDate()} ${month(b)}`
  return `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Reads a sentence into a plan, filling what it can from the person's history.
 *
 * Shared by preview and save so the two can never disagree — a preview that
 * promises one thing and a save that writes another is worse than no preview.
 */
export async function interpret(userId: string, orgId: string, raw: string, now = new Date(), lang: Lang = 'en'): Promise<QuickPlan> {
  const assumptions: string[] = []

  // The list comes off first, so every parser below sees "go shopping this
  // evening" rather than a sentence with five commas in it.
  const list = parseChecklist(raw)
  // Hindi time words become English before any parser sees them — "kal subah
  // 9 baje" is tomorrow morning at nine. Only the time words change; the place
  // and the activity pass through in the words that were used, so the title
  // that comes back is still theirs.
  const text = normalizeHinglish(list ? list.title : raw)
  const checklist = list?.items ?? []

  const base: QuickPlan = {
    kind: 'unclear',
    title: text.trim(),
    commitmentKind: 'task',
    durationMinutes: 30,
    flexibility: 'fixed',
    preferredWindow: null,
    notes: null,
    placeLabel: null,
    placeId: null,
    contactId: null,
    personName: null,
    people: [],
    checklist,
    dueAt: null,
    startsOn: null,
    endsOn: null,
    hour: null,
    minute: null,
    rule: null,
    alsoAt: [],
    links: { people: [], places: [], accounts: [] },
    trip: null,
    upcomingTrip: null,
    wishes: null,
    expense: null,
    owed: null,
    tracker: null,
    trackerItem: null,
    exam: null,
    bill: null,
    delivery: null,
    booking: null,
    assumptions,
    unsure: false,
    readBy: 'rules',
    question: null,
    choices: [],
    deadline: false,
    suggestions: [],
    sphere: null,
    problem: null,
    summary: '',
  }

  // A shop's or courier's message about a parcel, shared or pasted whole.
  // First, and from the line as it came: these messages are full of colons
  // and commas that the list readers below would split apart.
  const parcel = parseDelivery(raw, now)
  if (parcel) {
    const today = ymd(now)
    const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
    const when =
      parcel.status === 'delivered' || parcel.status === 'cancelled' || !parcel.expectedOn
        ? null
        : parcel.expectedOn === today
          ? t(lang, 'arriving today')
          : parcel.expectedOn === tomorrow
            ? t(lang, 'arriving tomorrow')
            : t(lang, 'expected {date}', {
                date: new Date(`${parcel.expectedOn}T00:00:00`).toLocaleDateString(inLocale(lang, 'en-IN'), { weekday: 'short', day: 'numeric', month: 'short' }),
              })
    return {
      ...base,
      kind: 'delivery',
      title: [parcel.store, parcel.item].filter(Boolean).join(' · ') || 'Parcel',
      checklist: [],
      delivery: parcel,
      summary: [
        parcel.store ?? t(lang, 'Parcel'),
        parcel.item,
        when ?? (lang === 'hi' ? deliveryStatusLabel(parcel.status, lang) : DELIVERY_STATUS_LABEL[parcel.status].toLowerCase()),
        parcel.codPaise ? t(lang, '{amount} cash on delivery', { amount: formatRupees(parcel.codPaise) }) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      assumptions: when ? [t(lang, 'A reminder on the morning it arrives.')] : [],
    }
  }

  // An exam applied for, or one of its dates: "applied for RRB NTPC 2026,
  // RRB Ajmer, reg no …", "SSC CGL tier 1 exam on 14 sep". From the line as
  // it came, before the list readers split it at its commas.
  const examSaid = parseExamLine(raw, now)
  if (examSaid) {
    const tracked = await trackedExam(userId, examSaid.examKey, examSaid.cycle)
    const label = examLabel({ name: examSaid.name, cycle: examSaid.cycle ?? tracked?.cycle ?? null })
    const day = (on: string) => localAt(on, null).toLocaleDateString(inLocale(lang, 'en-IN'), { weekday: 'short', day: 'numeric', month: 'short' })
    // A stage or a round, in Hindi when there is Hindi for it.
    const stageWord = (key: string) => (lang === 'hi' ? STAGE_HI[key] : undefined) ?? examStage(examSaid.examKey, key)?.label
    const dates = examSaid.dates.map((d) => {
      const what =
        d.step === 'exam' && d.round
          ? stageWord(d.round)
          : lang === 'hi'
            ? STEP_HI[d.step]
            : EXAM_STEPS.find((s) => s.key === d.step)?.label
      return `${what} ${day(d.on)}${d.at ? ` ${d.at}` : ''}`
    })
    return {
      ...base,
      kind: 'exam',
      title: label,
      checklist: [],
      exam: { ...examSaid, trackedId: tracked?.id ?? null },
      summary: [
        t(lang, 'Exams: {exam}', { exam: label }),
        examSaid.region,
        examSaid.stage ? stageWord(examSaid.stage) : null,
        examSaid.registrationNo ? t(lang, 'reg no {number}', { number: examSaid.registrationNo }) : null,
        examSaid.mock
          ? t(lang, 'mock {score}/{outOf} ({percent}%)', {
              score: examSaid.mock.score,
              outOf: examSaid.mock.outOf,
              percent: Math.round((examSaid.mock.score / examSaid.mock.outOf) * 100),
            })
          : null,
        ...dates,
      ]
        .filter(Boolean)
        .join(' · '),
      assumptions: [
        tracked ? t(lang, 'Added to the {exam} you are tracking.', { exam: label }) : null,
        examSaid.mock ? t(lang, 'Kept with your mock scores, on the exam’s page.') : null,
        examSaid.dates.some((d) => d.step === 'apply_by' || d.step === 'fee_by')
          ? t(lang, 'Reminders 3 days before the last date, the evening before, and on the day.')
          : null,
        examSaid.dates.some((d) => d.step === 'exam') ? t(lang, 'Reminders a week before the exam, the evening before, and that morning.') : null,
      ].filter((a): a is string => a !== null),
    }
  }

  // A booking confirmation: a train, a flight, a bus, a hotel, a show, an
  // appointment. A plan at the time it starts, reminded well ahead of it,
  // with the PNR or booking ID in its notes. Before the list readers, for the
  // same reason as parcels: these messages are all colons and commas.
  // A traffic challan pasted in: on Bills, to pay by its date.
  const challan = parseChallan(raw)
  if (challan?.status === 'issued') {
    const name = `Traffic challan${challan.vehicle ? ` · ${challan.vehicle}` : ''}${challan.offence ? ` · ${challan.offence}` : ''}`
    const issued = challan.issuedOn ? new Date(`${challan.issuedOn}T00:00:00`) : now
    const dueOn = challan.dueOn ?? ymd(new Date(issued.getFullYear(), issued.getMonth(), issued.getDate() + 30))
    return {
      ...base,
      kind: 'bill',
      title: name,
      checklist: [],
      bill: { name, kind: 'bill', category: 'vehicle', amountPaise: challan.amountPaise, dueOn, repeat: 'none' },
      summary: [name, challan.amountPaise ? formatRupees(challan.amountPaise) : null, dueLabel(dueOn, 'bill', now, lang)].filter(Boolean).join(' · '),
      assumptions: challan.dueOn ? [] : [t(lang, 'No date to pay by in the message, so a month from when it was issued.')],
    }
  }

  // A FASTag running low, pasted in: a to-do to recharge, soon.
  const tag = parseFastag(raw)
  if (tag?.status === 'low') {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0)
    const dueAt = at.getHours() >= 21 || at.getHours() < 8 ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() >= 8 ? 1 : 0), 9, 0) : at
    const title = `Recharge FASTag${tag.vehicle ? ` · ${tag.vehicle}` : ''}`
    return {
      ...base,
      kind: 'commitment',
      commitmentKind: 'task',
      title,
      dueAt: dueAt.toISOString(),
      durationMinutes: 10,
      flexibility: 'flexible',
      checklist: [],
      notes:
        tag.balancePaise !== null
          ? t(lang, 'Balance {amount}. Running out can mean paying double at the toll.', { amount: formatRupees(tag.balancePaise) })
          : t(lang, 'Low balance. Running out can mean paying double at the toll.'),
      summary: `${title} — ${dueAt.toLocaleString(inLocale(lang, 'en-IN'), { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`,
    }
  }

  // A vehicle's PUC or service reminder pasted in.
  const vehicle = parseVehicleNotice(raw)
  if (vehicle?.kind === 'puc') {
    const name = vehicleNoticeName(vehicle)
    return {
      ...base,
      kind: 'bill',
      title: name,
      checklist: [],
      bill: { name, kind: 'renewal', category: 'vehicle', amountPaise: null, dueOn: vehicle.dueOn, repeat: 'none' },
      summary: `${name} · ${dueLabel(vehicle.dueOn, 'renewal', now, lang)}`,
      assumptions: [t(lang, 'A reminder 10 days before it runs out.')],
    }
  }

  const booked = parseBooking(raw, now) ?? (vehicle?.kind === 'service' ? serviceAsBooking(vehicle) : null)
  if (booked) {
    if (booked.startsAt.getTime() < now.getTime() - 3_600_000) {
      return {
        ...base,
        kind: 'unclear',
        title: booked.title,
        problem: t(lang, 'That booking was for {when}, which has passed.', { when: booked.startsAt.toLocaleString(inLocale(lang, 'en-IN'), WHEN) }),
      }
    }
    const city =
      booked.city ?? (booked.type === 'hotel' || booked.type === 'bus' ? findCity(raw, await knownPlaces(userId)) : null)
    const webCheckIn = new Date(booked.startsAt.getTime() - 48 * 3_600_000)
    // A journey's reminder is the time to leave, so it says so, by the clock.
    const leaveAt = new Date(booked.startsAt.getTime() - booked.remindBeforeMinutes * 60_000)
    const leaving = LEAVING_FOR[booked.type]
    const lead = leadLabel(booked.remindBeforeMinutes, lang)
    const firstReminder =
      leaving && booked.timeKnown && leaveAt > now
        ? t(lang, leaving[booked.ref ? 0 : 1], { time: clockLabel(leaveAt.getHours(), leaveAt.getMinutes()), lead })
        : booked.ref
          ? t(lang, 'A reminder {lead}, with the reference to hand.', { lead })
          : t(lang, 'A reminder {lead}, with the details to hand.', { lead })
    return {
      ...base,
      kind: 'commitment',
      commitmentKind: 'task',
      title: booked.title,
      dueAt: booked.startsAt.toISOString(),
      durationMinutes: booked.durationMinutes,
      notes: booked.notes,
      placeLabel: booked.from,
      flexibility: 'fixed',
      checklist: [],
      booking: {
        type: booked.type,
        ref: booked.ref,
        from: booked.from,
        city,
        provider: booked.provider,
        remindBeforeMinutes: booked.remindBeforeMinutes,
        endsOn: booked.endsOn,
        fromCity: booked.fromCity ?? null,
      },
      assumptions: [
        firstReminder,
        ...(booked.type === 'flight' && webCheckIn > now ? [t(lang, 'A web check-in reminder 48 hours before.')] : []),
        ...(booked.timeKnown
          ? []
          : [t(lang, 'No time given, so {time}; change it if you know.', { time: clockLabel(booked.startsAt.getHours(), booked.startsAt.getMinutes()) })]),
      ],
      summary: `${booked.title} — ${booked.startsAt.toLocaleString(inLocale(lang, 'en-IN'), WHEN)}`,
    }
  }

  // Several wishes in one line — "Jaipur: visit Hawa Mahal, buy lakh chudi",
  // "wishlist: learn swimming, read Deep Work". Before the checklist is taken
  // as a plan's list: these have no date, and each is a wish of its own.
  const wishList = parseWishList(raw, await knownPlaces(userId))
  if (wishList) {
    const n = wishList.titles.length
    const place = wishList.placeLabel
    return {
      ...base,
      kind: 'intention',
      title: wishList.titles[0]!,
      placeLabel: place,
      wishes: wishList.titles,
      checklist: [],
      assumptions: [
        place
          ? t(lang, 'No date: they wait until you plan a trip to {place}, then go on it together.', { place })
          : t(lang, 'No date and no place: add them to any plan from its details, whenever it suits.'),
      ],
      summary: place
        ? t(lang, '{n} things saved for {place}: {list}', { n, place, list: wishList.titles.join(', ') })
        : t(lang, '{n} things on your wishlist: {list}', { n, list: wishList.titles.join(', ') }),
    }
  }

  // An insurer's message pasted in: the policy, by vehicle, renewed each year.
  const policy = parseInsurance(raw)
  if (policy) {
    return {
      ...base,
      kind: 'bill',
      title: policy.name,
      checklist: [],
      bill: {
        name: policy.name,
        kind: policy.kind,
        category: 'insurance',
        amountPaise: policy.amountPaise,
        dueOn: policy.dueOn,
        repeat: 'yearly',
      },
      summary: [
        policy.name,
        policy.amountPaise ? formatRupees(policy.amountPaise) : null,
        dueLabel(policy.dueOn, policy.kind, now, lang),
      ]
        .filter(Boolean)
        .join(' · '),
      assumptions: [
        policy.kind === 'renewal' ? t(lang, 'A reminder a month before it runs out.') : t(lang, 'A reminder a week before it is due.'),
      ],
    }
  }

  // A bill or a renewal: "rent ₹15,000 on the 1st every month", "passport
  // expires 12 march 2028". Before repeats, which would make rent a plan.
  const bill = parseBill(text, now)
  if (bill) {
    const repeat = REPEATS.find((r) => r.key === bill.repeat)!
    return {
      ...base,
      kind: 'bill',
      title: bill.name,
      bill,
      summary: [
        bill.name,
        bill.amountPaise ? formatRupees(bill.amountPaise) : null,
        dueLabel(bill.dueOn, bill.kind, now, lang),
        bill.repeat === 'none' ? null : lang === 'hi' ? repeatLabel(bill.repeat, lang) : repeat.label.toLowerCase(),
      ]
        .filter(Boolean)
        .join(' · '),
      assumptions:
        bill.kind === 'renewal'
          ? [t(lang, 'A reminder a month before it expires.')]
          : [bill.repeat === 'none' ? t(lang, 'A reminder 3 days before.') : t(lang, 'A reminder 3 days before, each time.')],
    }
  }

  // Something to track: "applied to Infosys for data analyst", "candidate
  // Priya for designer". "apply for … by friday" has a date, so it is a plan.
  const tracked = parseTrackerLine(text)
  if (tracked && (tracked.stage !== 'saved' || !parseWhen(text, now))) {
    return {
      ...base,
      kind: 'tracker',
      title: tracked.detail ? `${tracked.title} · ${tracked.detail}` : tracked.title,
      tracker: tracked,
      summary: `${boardLabel(tracked.board, lang)}: ${tracked.title}${tracked.detail ? `, ${tracked.detail}` : ''} · ${trackerStageLabel(tracked.board, tracked.stage, lang)}`,
    }
  }

  // Money owed to you: "Ravi owes me ₹500 for tickets", "lent ₹2,000 to Priya".
  // Before spending, which would read "lent ₹2,000" as money gone.
  const lent = parseOwed(text)
  if (lent) {
    return {
      ...base,
      kind: 'owed',
      title: t(lang, '{name} owes you {amount}', { name: lent.name, amount: formatRupees(lent.amountPaise) }),
      personName: lent.name,
      owed: lent,
      summary: `${t(lang, '{amount} from {name}', { amount: formatRupees(lent.amountPaise), name: lent.name })}${lent.note ? ` · ${lent.note}` : ''}`,
    }
  }

  // Money spent: "₹450 cab to Mehta Physio", "yesterday auto 120 rs". Not a
  // payment still to make — "pay ₹5,000 rent", or anything dated ahead — which
  // is a plan to pay, not something already spent.
  const spend = TO_PAY.test(text) ? null : parseExpense(text)
  if (spend) {
    // Read looking back first: "friday" in an expense is the one just gone.
    const past = spentWhen(spend.note, now)
    const when = past ? null : parseWhen(spend.note || text, now)
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    if (past || !when || when.date < endOfToday) {
      const day = past ? new Date(`${past.day}T12:00:00`) : now
      const note = (past ? past.note : when && spend.note ? titleFrom(spend.note, when) : spend.note) || null
      const category = EXPENSE_CATEGORIES.find((c) => c.key === spend.category)!
      const spentOn = ymd(day)
      const trip = await tripOn(userId, spentOn)
      const isToday = ymd(day) === ymd(now)
      return {
        ...base,
        kind: 'expense',
        title: note ?? category.label,
        expense: { amountPaise: spend.amountPaise, category: spend.category, note, spentOn },
        assumptions: [
          ...(trip ? [t(lang, 'On your {place} trip.', { place: trip.placeLabel })] : []),
          ...(isToday
            ? []
            : [t(lang, 'Spent on {date}.', { date: day.toLocaleDateString(inLocale(lang, 'en-IN'), { weekday: 'short', day: 'numeric', month: 'short' }) })]),
        ],
        summary: `${formatRupees(spend.amountPaise)} · ${expenseCategoryLabel(spend.category, lang)}${note ? ` · ${note}` : ''}`,
      }
    }
  }

  // "call him later", "remind her about the invoice": a person the line never
  // names. Guessing who is worse than asking, so ask — with the people this
  // account talks to most as the answers.
  const pronoun = PRONOUN.exec(text)
  if (pronoun && CONTACT_VERB.test(text) && !NAMES_SOMEONE.test(text) && !(await matchKnownPerson(orgId, text))) {
    const word = pronoun[1]!
    const people = await recentPeople(orgId)
    return {
      ...base,
      kind: 'needsPerson',
      title: text.trim(),
      commitmentKind: /\b(?:call|ring|phone)\b/i.test(text) ? 'callback' : 'task',
      personName: word,
      people,
      question: t(lang, 'Who is “{word}”?', { word }),
      choices: people.map((p) => ({ label: p.name, line: text.trim().replace(new RegExp(`\\b${word}\\b`, 'i'), p.name) })),
      summary: text.trim(),
    }
  }

  // Order matters and mirrors the capture screen: a sentence about a place has
  // no date in it, and one about a repeat contains a perfectly good single date.
  const asIntention = parseIntention(text)
  if (asIntention) {
    return {
      ...base,
      kind: 'intention',
      title: asIntention.title,
      placeLabel: asIntention.placeLabel,
      notes: originalIfInformative(text, asIntention.title),
      assumptions: [t(lang, 'No date — it waits until you plan a trip to {place}.', { place: asIntention.placeLabel })],
      summary: t(lang, '"{title}" saved for {place}', { title: asIntention.title, place: asIntention.placeLabel }),
    }
  }

  const asTrip = parseTrip(text)
  if (asTrip) {
    return {
      ...base,
      kind: 'trip',
      title: asTrip.placeLabel,
      placeLabel: asTrip.placeLabel,
      startsOn: asTrip.startsOn,
      endsOn: asTrip.endsOn,
      notes: originalIfInformative(text, asTrip.placeLabel),
      summary: t(lang, 'Trip to {place}, {dates}', { place: asTrip.placeLabel, dates: tripSpan(asTrip.startsOn, asTrip.endsOn, lang) }),
    }
  }

  const asRepeat: Repeat | null = parseRecurrence(text, now) ?? occasionRepeat(text, now)
  if (asRepeat) {
    // "medicine at 9am and 9pm every day" is one habit at two times. The
    // first is the series' own time; the others are series of their own.
    const times = allClockTimes(text)
    const rest = stripRecurrence(
      times.length > 1 ? times.reduce((line, t) => line.replace(t.text, ' '), text) : text,
      asRepeat,
    )
    const when = times.length > 1 ? null : parseWhen(rest, now)
    const meal = when ? null : mealTime(rest)
    const hour = times.length > 1 ? times[0]!.hour : when ? when.date.getHours() : (meal?.hour ?? 9)
    const minute = times.length > 1 ? times[0]!.minute : when ? when.date.getMinutes() : (meal?.minute ?? 0)
    const alsoAt = times.length > 1 ? times.slice(1).map(({ hour, minute }) => ({ hour, minute })) : []
    const title = when ? titleFrom(rest, when) : rest

    if (!title) {
      return {
        ...base,
        problem: t(lang, 'That is all repeat and no plan — say what it is.'),
        summary: '',
      }
    }

    const horizon = new Date(now.getTime())
    horizon.setFullYear(horizon.getFullYear() + 2)
    const [firstAt] = expandRecurrence(
      asRepeat.rule,
      { startsOn: now, hour, minute },
      { from: now, to: horizon },
    )
    if (!firstAt) {
      return { ...base, problem: t(lang, 'That series has nothing left in it.'), summary: '' }
    }

    const learned = await recallSimilar(userId, title, { now })
    if (learned?.because) assumptions.push(learnedWhy(learned, lang))
    if (asRepeat.yearlyOccasion) assumptions.push(t(lang, 'Every year, on the day.'))
    if (when) assumptions.push(...timeNotes(when, now, lang))
    else if (times.length > 1) {
      assumptions.push(t(lang, '{n} reminders a day: {times}.', { n: times.length, times: times.map((x) => clockLabel(x.hour, x.minute)).join(andWord(lang)) }))
    } else if (meal) assumptions.push(mealNote(meal.name, clockLabel(meal.hour, meal.minute), lang))
    else assumptions.push(t(lang, 'No time given, so 9am.'))

    const at = [{ hour, minute }, ...alsoAt].map((x) => clockLabel(x.hour, x.minute)).join(andWord(lang))
    const repeatWords = describeRecurrence(asRepeat.rule, { startsOn: firstAt, hour, minute }, lang)
    const from = startDay(firstAt, lang)
    return {
      ...base,
      kind: 'recurrence',
      title,
      commitmentKind: kindFrom(title, learned?.kind, 'task'),
      durationMinutes: learned?.durationMinutes ?? 30,
      startsOn: ymd(firstAt),
      hour,
      minute,
      rule: asRepeat.rule,
      alsoAt,
      notes: originalIfInformative(stripRecurrence(text, asRepeat), title),
      assumptions,
      summary:
        alsoAt.length > 0
          ? t(lang, '{title} — {repeat} at {times}, from {date}', { title, repeat: repeatWords.replace(/\s+at\s+[^,]+$/, ''), times: at, date: from })
          : t(lang, '{title} — {repeat}, from {date}', { title, repeat: repeatWords, date: from }),
    }
  }

  // "call Ravi after the standup" — relative to what is actually in the day.
  // Tried before the plain date parser, which would read "after the standup
  // tomorrow" as simply tomorrow and silently drop the anchor.
  if (checklist.length > 0) {
    assumptions.push(
      t(lang, '{n} things to tick off: {items}', {
        n: checklist.length,
        items: `${checklist.slice(0, 3).join(', ')}${checklist.length > 3 ? '…' : ''}`,
      }),
    )
  }

  const relative = parseRelative(text)
  // A clock time said outright wins over an anchor: "review the PR before
  // standup tomorrow 9am" is at nine, whatever the standup does. Not one that
  // names the anchor itself: "after the 3pm meeting" is still after it.
  const clockGiven = relative ? parseWhen(text, now) : null
  const anchorName = relative?.anchor.kind === 'named' ? relative.anchor.text.toLowerCase() : ''
  const clockSaid =
    clockGiven !== null &&
    !clockGiven.timeAssumed &&
    !clockGiven.window &&
    !(clockGiven.pieces ?? [clockGiven.matched]).some((p) => anchorName.includes(p.toLowerCase()))
  if (relative && !clockSaid) {
    const rest = stripRelative(text, relative)
    const onDay = parseWhen(text, now)
    const day = onDay?.date ?? now
    let resolved = await resolveAnchor(userId, relative, day)
    // No day said and none still to come today: the next one this week.
    // "Before standup" typed after today's standup means tomorrow's.
    if (!onDay && resolved && resolved.at <= now) resolved = null
    for (let ahead = 1; !resolved && !onDay && ahead <= 7; ahead++) {
      resolved = await resolveAnchor(userId, relative, new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead))
    }

    if (resolved) {
      const title = titleFrom(rest, parseWhen(rest, now) ?? { date: now, matched: '', timeAssumed: true })
      const name = title || rest
      const learned = await recallSimilar(userId, name, { now })
      const gap = relative.offsetMinutes
      return {
        ...base,
        kind: 'commitment',
        title: name,
        commitmentKind: (learned?.kind as CommitmentKind) ?? 'task',
        durationMinutes: learned?.durationMinutes ?? DEFAULT_DURATION_MINUTES.task,
        placeLabel: learned?.placeLabel ?? null,
        placeId: learned?.placeId ?? null,
        contactId: learned?.contactId ?? null,
        dueAt: resolved.at.toISOString(),
        notes: originalIfInformative(rest, name),
        assumptions: [
          relative.relation === 'after'
            ? t(lang, 'After "{anchor}", which ends that day — {n} min later.', { anchor: resolved.anchorTitle, n: gap })
            : t(lang, 'Before "{anchor}", which starts that day — {n} min earlier.', { anchor: resolved.anchorTitle, n: gap }),
          ...(learned?.because ? [learnedWhy(learned, lang)] : []),
        ],
        summary: `${name} — ${resolved.at.toLocaleString(inLocale(lang, []), WHEN)}`,
      }
    }

    // The anchor is not in the plan. Say so rather than inventing a time — a
    // reminder pinned to a meeting that does not exist looks like it worked —
    // and ask for the one thing missing. A time picked then wins over the
    // anchor (above), so the answer saves rather than asking again.
    const anchor = relative.anchor.kind === 'named' ? relative.anchor.text : ''
    const notFound = NOT_FOUND[relative.anchor.kind === 'named' ? 'named' : 'anything'][onDay ? 'day' : 'week'][relative.relation]
    return {
      ...base,
      kind: 'needsTime',
      title: rest,
      assumptions: [t(lang, notFound, { anchor })],
      summary: rest,
    }
  }

  // Roles before dates: "appointment for the dentist in Sirsi next Tuesday"
  // has both, and the date parser alone would keep the whole sentence as the
  // title and learn nothing about who or where.
  const roles = extractRoles(text)
  if (roles) {
    const whenPart = parseWhen(text, now)
    const learned = await recallSimilar(userId, roles.title, { now })

    // Somewhere already known for this person beats nothing; somewhere named
    // in the sentence beats both, because it is what they just said.
    // Who could be meant. One match is linked silently; several is a question,
    // because picking the wrong Ramesh is worse than asking.
    const candidates = roles.person ? await findPeople(orgId, roles.person) : []
    // No marker put a person in the sentence, but the contact list might
    // still recognise a name in it — which is what makes the Call button work.
    const known = roles.person ? null : await matchKnownPerson(orgId, text)
    const only = candidates.length === 1 ? candidates[0]! : known

    const remembered = only?.placeLabel ?? (roles.person ? await placeOfPerson(orgId, roles.person) : null)
    const place = roles.place ?? remembered ?? learned?.placeLabel ?? null

    // Phrased for a person, not for a log. "person: \"for dentist\"" is the
    // shape of the data; "Who: dentist" is what someone can actually check.
    const LABEL: Record<string, string> = {
      kind: msg('Read as: {value}'),
      person: msg('Who: {value}'),
      place: msg('Where: {value}'),
      subject: msg('About: {value}'),
    }
    const VALUE: Record<string, string | null> = {
      kind: roles.kind ? t(lang, KIND_WORD[roles.kind] ?? roles.kind) : null,
      person: roles.person,
      place: roles.place,
      subject: roles.subject,
    }
    const assumptionsFromRoles = roles.evidence
      .map((e) => {
        const value = VALUE[e.field]
        return value ? t(lang, LABEL[e.field] ?? '{value}', { value }) : null
      })
      .filter((x): x is string => x !== null)
    if (!roles.place && remembered) {
      assumptionsFromRoles.push(t(lang, 'You said {person} is in {place} before.', { person: String(roles.person), place: remembered }))
    }
    if (only) {
      assumptionsFromRoles.push(
        only.phone
          ? t(lang, 'Matched {name} ({phone}) from your contacts.', { name: only.name, phone: only.phone })
          : t(lang, 'Matched {name} from your contacts.', { name: only.name }),
      )
    }

    if (candidates.length > 1) {
      return {
        ...base,
        kind: 'needsPerson',
        title: roles.title,
        commitmentKind: 'meeting',
        placeLabel: roles.place ?? null,
        personName: roles.person,
        people: candidates,
        assumptions: assumptionsFromRoles,
        summary: roles.title,
      }
    }
    if (learned?.because) assumptionsFromRoles.push(learnedWhy(learned, lang))

    const kindMap: Record<string, CommitmentKind> = {
      appointment: 'meeting',
      meeting: 'meeting',
      call: 'callback',
      visit: 'meeting',
      demo: 'meeting',
      interview: 'meeting',
    }
    const commitmentKind = roles.kind ? (kindMap[roles.kind] ?? 'meeting') : (happeningKind(roles.title) ?? 'meeting')

    // No date in the sentence is the one thing history cannot supply, so it is
    // the one thing worth asking about — rather than inventing a time.
    // So is a meeting on a day with no time at all: "meeting with Ravi
    // tomorrow" at a 9am nobody said is a meeting Ravi will not be at.
    // Only a real appointment: a line that merely names a person ("follow up
    // with Priya in 2 days") is a task for that day, not a meeting to time.
    const appointment = ['appointment', 'meeting', 'demo', 'interview'].includes(roles.kind ?? '') || APPOINTMENT_WORD.test(roles.title)
    const meetingWithoutTime =
      whenPart !== null &&
      whenPart.timeAssumed &&
      !whenPart.window &&
      !whenPart.deadline &&
      !whenPart.meal &&
      appointment &&
      !PREP.test(text)
    if ((!whenPart || meetingWithoutTime) && !learned?.hour && !learned?.lastHour) {
      return {
        ...base,
        kind: 'needsTime',
        title: roles.title,
        commitmentKind,
        durationMinutes: learned?.durationMinutes ?? DEFAULT_DURATION_MINUTES[commitmentKind],
        placeLabel: place,
        personName: roles.person,
        assumptions: assumptionsFromRoles,
        ...(await askWhatTime(userId, text, roles.title, now, whenPart?.date ?? null, lang)),
        summary: roles.title,
        problem: null,
      }
    }

    const hour = learned?.hour ?? learned?.lastHour ?? 9
    const guess = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0)
    if (guess <= now) guess.setDate(guess.getDate() + 1)
    const prep = whenPart ? prepDue(text, whenPart, now) : null
    const dueAt = prep ?? whenPart?.date ?? guess
    if (!whenPart && learned?.becauseHour) assumptionsFromRoles.push(learnedHourWhy(learned, lang)!)
    if (prep) assumptionsFromRoles.push(prepNote(prep, lang))
    if (whenPart) assumptionsFromRoles.push(...timeNotes(whenPart, now, lang))

    return {
      ...base,
      kind: 'commitment',
      title: roles.title,
      commitmentKind,
      durationMinutes: learned?.durationMinutes ?? DEFAULT_DURATION_MINUTES[commitmentKind],
      placeLabel: place,
      personName: roles.person ?? only?.name ?? null,
      contactId: only?.id ?? null,
      flexibility: whenPart?.window ? 'flexible' : 'fixed',
      preferredWindow: whenPart?.window ?? null,
      dueAt: dueAt.toISOString(),
      notes: roles.subject && roles.subject !== roles.title ? roles.subject : null,
      assumptions: assumptionsFromRoles,
      summary: `${roles.title} — ${dueAt.toLocaleString(inLocale(lang, []), WHEN)}`,
      deadline: Boolean(whenPart?.deadline),
    }
  }

  const when = parseWhen(text, now)
  if (!when) {
    const problem = diagnose(text)
    // No date at all, but history may still know the usual time for this.
    const likely = problem?.likelyTitle ?? text.trim()
    const learned = await recallSimilar(userId, likely, { now })

    // A habit if there is one, otherwise whatever happened last time. Either
    // is a better answer than refusing to read a sentence the person clearly
    // meant, and both are shown and undoable.
    const knownHour = learned ? (learned.hour ?? learned.lastHour) : null
    if (learned && knownHour !== null) {
      // Keep the minutes too: an 11:30 stand-up moved to 11:00 is a small lie
      // that the person has to notice and correct.
      const knownMinute = learned.hour !== null ? 0 : (learned.lastMinute ?? 0)
      const guess = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        knownHour,
        knownMinute,
      )
      if (guess <= now) guess.setDate(guess.getDate() + 1)
      return {
        ...base,
        kind: 'commitment',
        title: likely,
        commitmentKind: (learned.kind as CommitmentKind) ?? 'task',
        durationMinutes: learned.durationMinutes ?? DEFAULT_DURATION_MINUTES.task,
        placeLabel: learned.placeLabel,
        placeId: learned.placeId,
        contactId: learned.contactId,
        dueAt: guess.toISOString(),
        notes: originalIfInformative(text, likely),
        assumptions: [learnedHourWhy(learned, lang) ?? learnedWhy(learned, lang), t(lang, 'No date given, so this is the next one.')].filter(
          Boolean,
        ) as string[],
        summary: `${likely} — ${guess.toLocaleString(inLocale(lang))}`,
      }
    }

    // No date, no history, but a perfectly clear intention. "Buy milk" is the
    // commonest thing anyone types into a planner, and refusing it because it
    // lacks a clock time is the app serving its data model rather than the
    // person. It becomes a flexible item for today — something that wants to
    // happen, with no slot claimed and nothing to clash with.
    // "doctor", "meeting with the CA": an appointment, which happens at a time
    // somebody else keeps too. Filing it for "this afternoon" is a guess that
    // is wrong more often than right, so ask — with the free times to tap.
    if (likely && APPOINTMENT_WORD.test(likely) && likely.split(/\s+/).length <= 4) {
      return {
        ...base,
        kind: 'needsTime',
        title: likely,
        commitmentKind: 'meeting',
        durationMinutes: DEFAULT_DURATION_MINUTES.meeting,
        ...(await askWhatTime(userId, text, likely, now, null, lang)),
        summary: likely,
      }
    }

    if (likely && !problem?.message?.includes('could not read')) {
      const hour = now.getHours()
      const window = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
      const when = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.min(hour + 1, 20), 0)
      const late = hour >= 20
      if (late) when.setDate(when.getDate() + 1)
      const slot = t(lang, late ? msg('tomorrow morning') : (THIS_WINDOW[window] ?? `this ${window}`))

      return {
        ...base,
        kind: 'commitment',
        title: likely,
        commitmentKind: 'task',
        durationMinutes: DEFAULT_DURATION_MINUTES.task,
        flexibility: 'flexible',
        preferredWindow: late ? 'morning' : window,
        dueAt: when.toISOString(),
        notes: originalIfInformative(text, likely),
        assumptions: [t(lang, 'No time given, so it is filed for {when} with no set slot.', { when: slot })],
        summary: t(lang, '{title} — {when}, whenever suits', { title: likely, when: slot }),
        // Nothing in the line said when, or even for sure what: the best the
        // rules can do, and worth a careful second reading.
        unsure: true,
      }
    }

    return {
      ...base,
      title: likely,
      problem: (lang === 'hi' ? diagnose(text, lang)?.message : problem?.message) ?? t(lang, 'I could not find a date or time in that.'),
      summary: '',
      unsure: true,
    }
  }

  const title = titleFrom(text, when)
  if (!title) {
    return { ...base, problem: t(lang, 'I got the time but not what it is for.'), summary: '' }
  }

  const learned = await recallSimilar(userId, title, { now })
  const parsedPlace = placeFrom(text)
  const prep = prepDue(text, when, now)
  const dueAt = prep ?? when.date

  // "meeting tomorrow", "dentist friday": a day, and an appointment, but no
  // time — and nothing in history says when these usually are. Ask, with the
  // times free that day, rather than book 9am and hope.
  if (
    when.timeAssumed &&
    !when.window &&
    !when.deadline &&
    !when.meal &&
    !prep &&
    APPOINTMENT_WORD.test(title) &&
    learned?.hour == null &&
    learned?.lastHour == null
  ) {
    return {
      ...base,
      kind: 'needsTime',
      title,
      commitmentKind: 'meeting',
      durationMinutes: learned?.durationMinutes ?? DEFAULT_DURATION_MINUTES.meeting,
      placeLabel: parsedPlace ?? learned?.placeLabel ?? null,
      ...(await askWhatTime(userId, text, title, now, when.date, lang)),
      summary: title,
    }
  }

  // "Diwali on Sunday", "Ravi's wedding on the 12th": an occasion, not a job —
  // and with no time said, the whole day, reminded at its start.
  const kind = kindFrom(title, learned?.kind, APPOINTMENT_WORD.test(title) ? 'meeting' : 'task')
  const allDay = isHappening(kind) && when.timeAssumed && !when.window && !when.deadline && !prep

  if (learned?.because) assumptions.push(learnedWhy(learned, lang))
  if (prep) assumptions.push(prepNote(prep, lang))
  else if (allDay) assumptions.push(t(lang, 'No time given, so all day, with a reminder that morning.'))
  else if (when.timeAssumed && !when.window) assumptions.push(t(lang, 'No time given, so 9am.'))
  assumptions.push(...timeNotes(when, now, lang))

  const ignored = findMalformedTime(text)
  if (ignored) assumptions.push(t(lang, 'I could not read "{time}" as a time.', { time: ignored }))

  // "meeting with the builder", "dentist": an appointment, an hour long and
  // somewhere to be, unless history says otherwise.
  const duration =
    when.durationMinutes ?? learned?.durationMinutes ?? DEFAULT_DURATION_MINUTES[kind]

  return {
    ...base,
    kind: 'commitment',
    title,
    commitmentKind: kind,
    durationMinutes: duration,
    flexibility: when.window ? 'flexible' : 'fixed',
    preferredWindow: when.window ?? null,
    placeLabel: parsedPlace ?? learned?.placeLabel ?? null,
    placeId: parsedPlace ? null : (learned?.placeId ?? null),
    contactId: parsedPlace ? null : (learned?.contactId ?? null),
    dueAt: dueAt.toISOString(),
    allDay,
    notes: originalIfInformative(text, title),
    assumptions,
    summary: summaryOf(title, dueAt, allDay, lang),
    // "meeting tomorrow": a day, a 9am nobody said, and a word or two. A
    // careful reading may well ask what time instead. "Diwali sunday" is sure.
    unsure: !allDay && when.timeAssumed && !when.window && !when.deadline && !prep && title.split(/\s+/).length <= 2,
    deadline: Boolean(when.deadline),
  }
}
