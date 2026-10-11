import type { FastifyInstance } from 'fastify'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  DEFAULT_DURATION_MINUTES,
  parseWhen,
  normalizeHinglish,
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
  spentWhen,
  formatRupees,
  EXPENSE_CATEGORIES,
  type CommitmentKind,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
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
} from '../services/memory.ts'
import { planWishes } from '../services/wishes.ts'
import { createExpense, tripOn } from '../services/expenses.ts'
import { addOwed } from '../services/owed.ts'
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
    const { text } = quickInput.parse(req.body)
    return enrich(userId, orgId, text, await interpret(userId, orgId, text))
  })

  app.post('/quick', async (req, reply) => {
    const { sub: userId, orgId } = scope(req)
    const body = quickInput.parse(req.body)
    const { text, allowConflict } = body
    const plan = await enrich(userId, orgId, text, await interpret(userId, orgId, text))

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
      const created = await db.transaction(async (tx) => {
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
              hour: plan.hour!,
              minute: plan.minute!,
              freq: plan.rule!.freq,
              interval: plan.rule!.interval,
              byWeekday: plan.rule!.byWeekday ?? null,
              byMonthDay: plan.rule!.byMonthDay ?? null,
              byMonth: plan.rule!.byMonth ?? null,
              setPos: plan.rule!.setPos ?? null,
              untilOn: plan.rule!.until ?? null,
              count: plan.rule!.count ?? null,
            })
            .returning(),
          'recurrence',
        )
        await materialise(row, {}, tx)
        return row
      })
      return reply.code(201).send({ ...plan, id: created.id })
    }

    // ------------------------------------------------------- a single plan
    const dueAt = new Date(plan.dueAt!)

    if (!allowConflict && plan.flexibility === 'fixed') {
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

    const row = await db.transaction(async (tx) => {
      let tripId = tripLink?.existing?.id ?? null
      if (makeTrip) {
        const trip = takeFirst(
          await tx
            .insert(schema.trips)
            .values({
              orgId,
              userId,
              placeLabel: tripLink.placeLabel,
              startsOn: tripLink.day,
              endsOn: tripLink.day,
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
            notes: plan.notes ?? null,
            placeLabel: plan.placeLabel ?? null,
            placeId: plan.placeId ?? null,
            contactId: contactId ?? null,
            tripId,
            flexibility: plan.flexibility,
            preferredWindow: plan.preferredWindow ?? null,
          })
          .returning(),
        'commitment',
      )
      await scheduleFirstReminder({ orgId, commitmentId: created.id, fireAt: dueAt }, tx)
      return created
    })

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

    return reply.code(201).send({
      ...plan,
      id: row.id,
      savedTrip:
        tripLink && row.tripId
          ? {
              id: row.tripId,
              placeLabel: tripLink.placeLabel,
              startsOn: tripLink.existing?.startsOn ?? tripLink.day,
              endsOn: tripLink.existing?.endsOn ?? tripLink.day,
              created: Boolean(makeTrip),
            }
          : null,
      waiting: tripLink && row.tripId ? tripLink.waiting : [],
    })
  })

  /** Undo, for when the one-tap save was the wrong tap. */
  app.delete('/quick/:kind/:id', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { kind, id } = z
      .object({
        kind: z.enum(['commitment', 'intention', 'trip', 'recurrence', 'expense', 'owed']),
        id: z.string().uuid(),
      })
      .parse(req.params)

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
  startsOn: string | null
  endsOn: string | null
  hour: number | null
  minute: number | null
  rule: ReturnType<typeof parseRecurrence> extends null
    ? never
    : NonNullable<ReturnType<typeof parseRecurrence>>['rule'] | null
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
  /** Plain-words account of every assumption made, shown before and after saving. */
  assumptions: string[]
  /** Why the app could not tell, when it could not. */
  problem: string | null
  summary: string
}

/**
 * What the sentence already knows about: people, places and accounts it seems
 * to name, and — for a plan in another city — the trip it belongs to. A single
 * certain person is attached; everything else is offered, never assumed.
 */
/** A sentence that starts by saying money is still to go out is a to-do. */
const TO_PAY = /^\s*(?:pay|send|transfer|give|buy|book|renew|deposit|collect|get|withdraw)\b/i

async function enrich(userId: string, orgId: string, raw: string, plan: QuickPlan): Promise<QuickPlan> {
  if (plan.kind === 'intention' && plan.placeLabel) {
    return { ...plan, upcomingTrip: await upcomingTripTo(userId, plan.placeLabel) }
  }
  if (plan.kind !== 'commitment' && plan.kind !== 'needsTime' && plan.kind !== 'expense' && plan.kind !== 'owed') {
    return plan
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
      title: `${who} owes you ${formatRupees(plan.owed.amountPaise)}`,
      summary: `${formatRupees(plan.owed.amountPaise)} from ${who}${plan.owed.note ? ` · ${plan.owed.note}` : ''}`,
      links: { ...links, places: [], accounts: [] },
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

/** "2 – 4 Nov", "30 Oct – 2 Nov", "2 Nov": dates as a person writes them. */
function tripSpan(from: string, to: string): string {
  const day = (s: string) => new Date(`${s}T00:00:00`)
  const a = day(from)
  const b = day(to)
  const month = (d: Date) => d.toLocaleDateString('en-IN', { month: 'short' })
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
export async function interpret(userId: string, orgId: string, raw: string): Promise<QuickPlan> {
  const now = new Date()
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
    links: { people: [], places: [], accounts: [] },
    trip: null,
    upcomingTrip: null,
    wishes: null,
    expense: null,
    owed: null,
    assumptions,
    problem: null,
    summary: '',
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
          ? `No date: they wait until you plan a trip to ${place}, then go on it together.`
          : 'No date and no place: add them to any plan from its details, whenever it suits.',
      ],
      summary: place
        ? `${n} things saved for ${place}: ${wishList.titles.join(', ')}`
        : `${n} things on your wishlist: ${wishList.titles.join(', ')}`,
    }
  }

  // Money owed to you: "Ravi owes me ₹500 for tickets", "lent ₹2,000 to Priya".
  // Before spending, which would read "lent ₹2,000" as money gone.
  const lent = parseOwed(text)
  if (lent) {
    return {
      ...base,
      kind: 'owed',
      title: `${lent.name} owes you ${formatRupees(lent.amountPaise)}`,
      personName: lent.name,
      owed: lent,
      summary: `${formatRupees(lent.amountPaise)} from ${lent.name}${lent.note ? ` · ${lent.note}` : ''}`,
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
          ...(trip ? [`On your ${trip.placeLabel} trip.`] : []),
          ...(isToday ? [] : [`Spent on ${day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}.`]),
        ],
        summary: `${formatRupees(spend.amountPaise)} · ${category.label}${note ? ` · ${note}` : ''}`,
      }
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
      assumptions: [`No date — it waits until you plan a trip to ${asIntention.placeLabel}.`],
      summary: `"${asIntention.title}" saved for ${asIntention.placeLabel}`,
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
      summary: `Trip to ${asTrip.placeLabel}, ${tripSpan(asTrip.startsOn, asTrip.endsOn)}`,
    }
  }

  const asRepeat = parseRecurrence(text, now)
  if (asRepeat) {
    const rest = stripRecurrence(text, asRepeat)
    const when = parseWhen(rest, now)
    const hour = when ? when.date.getHours() : 9
    const minute = when ? when.date.getMinutes() : 0
    const title = when ? titleFrom(rest, when) : rest

    if (!title) {
      return {
        ...base,
        problem: 'That is all repeat and no plan — say what it is.',
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
      return { ...base, problem: 'That series has nothing left in it.', summary: '' }
    }

    const learned = await recallSimilar(userId, title, { now })
    if (learned?.because) assumptions.push(learned.because)
    if (!when) assumptions.push('No time given, so 9am.')

    return {
      ...base,
      kind: 'recurrence',
      title,
      commitmentKind: (learned?.kind as CommitmentKind) ?? 'task',
      durationMinutes: learned?.durationMinutes ?? 30,
      startsOn: ymd(firstAt),
      hour,
      minute,
      rule: asRepeat.rule,
      notes: originalIfInformative(stripRecurrence(text, asRepeat), title),
      assumptions,
      summary: `${title} — ${describeRecurrence(asRepeat.rule, { startsOn: firstAt, hour, minute })}, from ${firstAt.toLocaleDateString()}`,
    }
  }

  // "call Ravi after the standup" — relative to what is actually in the day.
  // Tried before the plain date parser, which would read "after the standup
  // tomorrow" as simply tomorrow and silently drop the anchor.
  if (checklist.length > 0) {
    assumptions.push(
      `${checklist.length} things to tick off: ${checklist.slice(0, 3).join(', ')}${checklist.length > 3 ? '…' : ''}`,
    )
  }

  const relative = parseRelative(text)
  if (relative) {
    const rest = stripRelative(text, relative)
    const onDay = parseWhen(text, now)
    const day = onDay?.date ?? now
    const resolved = await resolveAnchor(userId, relative, day)

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
          `${relative.relation === 'after' ? 'After' : 'Before'} "${resolved.anchorTitle}", which ${relative.relation === 'after' ? 'ends' : 'starts'} that day — ${gap} min ${relative.relation === 'after' ? 'later' : 'earlier'}.`,
          ...(learned?.because ? [learned.because] : []),
        ],
        summary: `${name} — ${resolved.at.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`,
      }
    }

    // The anchor is not in that day. Say so rather than inventing a time: a
    // reminder pinned to a meeting that does not exist looks like it worked.
    const what =
      relative.anchor.kind === 'named'
        ? `"${relative.anchor.text}"`
        : relative.anchor.kind === 'lastThing'
          ? 'anything'
          : 'anything'
    return {
      ...base,
      title: stripRelative(text, relative),
      problem: `I could not find ${what} in that day to go ${relative.relation}.`,
      summary: '',
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
      kind: 'Read as',
      person: 'Who',
      place: 'Where',
      subject: 'About',
    }
    const VALUE: Record<string, string | null> = {
      kind: roles.kind,
      person: roles.person,
      place: roles.place,
      subject: roles.subject,
    }
    const assumptionsFromRoles = roles.evidence
      .map((e) => {
        const value = VALUE[e.field]
        return value ? `${LABEL[e.field]}: ${value}` : null
      })
      .filter((x): x is string => x !== null)
    if (!roles.place && remembered) {
      assumptionsFromRoles.push(`You said ${roles.person} is in ${remembered} before.`)
    }
    if (only) {
      assumptionsFromRoles.push(
        `Matched ${only.name}${only.phone ? ` (${only.phone})` : ''} from your contacts.`,
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
    if (learned?.because) assumptionsFromRoles.push(learned.because)

    const kindMap: Record<string, CommitmentKind> = {
      appointment: 'meeting',
      meeting: 'meeting',
      call: 'callback',
      visit: 'meeting',
      demo: 'meeting',
      interview: 'meeting',
    }
    const commitmentKind = roles.kind ? (kindMap[roles.kind] ?? 'meeting') : 'meeting'

    // No date in the sentence is the one thing history cannot supply, so it is
    // the one thing worth asking about — rather than inventing a time.
    if (!whenPart) {
      if (!learned?.hour && !learned?.lastHour) {
        return {
          ...base,
          kind: 'needsTime',
          title: roles.title,
          commitmentKind,
          durationMinutes: learned?.durationMinutes ?? DEFAULT_DURATION_MINUTES[commitmentKind],
          placeLabel: place,
          personName: roles.person,
          assumptions: assumptionsFromRoles,
          summary: roles.title,
          problem: null,
        }
      }
    }

    const hour = learned?.hour ?? learned?.lastHour ?? 9
    const guess = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0)
    if (guess <= now) guess.setDate(guess.getDate() + 1)
    const dueAt = whenPart?.date ?? guess
    if (!whenPart && learned?.becauseHour) assumptionsFromRoles.push(learned.becauseHour)

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
      summary: `${roles.title} — ${dueAt.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`,
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
        assumptions: [learned.becauseHour ?? learned.because, 'No date given, so this is the next one.'].filter(
          Boolean,
        ) as string[],
        summary: `${likely} — ${guess.toLocaleString()}`,
      }
    }

    // No date, no history, but a perfectly clear intention. "Buy milk" is the
    // commonest thing anyone types into a planner, and refusing it because it
    // lacks a clock time is the app serving its data model rather than the
    // person. It becomes a flexible item for today — something that wants to
    // happen, with no slot claimed and nothing to clash with.
    if (likely && !problem?.message?.includes('could not read')) {
      const hour = now.getHours()
      const window = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
      const when = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.min(hour + 1, 20), 0)
      const late = hour >= 20
      if (late) when.setDate(when.getDate() + 1)

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
        assumptions: [
          `No time given, so it is filed for ${late ? 'tomorrow morning' : `this ${window}`} with no set slot.`,
        ],
        summary: `${likely} — ${late ? 'tomorrow morning' : `this ${window}`}, whenever suits`,
      }
    }

    return {
      ...base,
      title: likely,
      problem: problem?.message ?? 'I could not find a date or time in that.',
      summary: '',
    }
  }

  const title = titleFrom(text, when)
  if (!title) {
    return { ...base, problem: 'I got the time but not what it is for.', summary: '' }
  }

  const learned = await recallSimilar(userId, title, { now })
  const parsedPlace = placeFrom(text)

  if (learned?.because) assumptions.push(learned.because)
  if (when.timeAssumed && !when.window) assumptions.push('No time given, so 9am.')

  const ignored = findMalformedTime(text)
  if (ignored) assumptions.push(`I could not read "${ignored}" as a time.`)

  const kind = (learned?.kind as CommitmentKind) ?? 'task'
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
    dueAt: when.date.toISOString(),
    notes: originalIfInformative(text, title),
    assumptions,
    summary: `${title} — ${when.date.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`,
  }
}
