import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { clockLabel, type CommitmentKind, type Lang } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { msg, t } from '../i18n.ts'
import { findFreeSlots } from './freeSlots.ts'
import { sameLabel } from './travel.ts'

/**
 * The assistant's half of the capture box: asking when a line is too vague
 * to plan, and suggesting a better plan when it can see one.
 *
 * Asking is for when a guess would be wrong too often — a meeting with no
 * time, "call him" with no him. The question comes with answers to tap,
 * taken from the person's own day: the times they are actually free, the
 * people they actually talk to.
 *
 * Suggestions are offers, never changes made quietly. Each says why in a
 * sentence and does one thing if accepted: an earlier start for a far-off
 * deadline, a gift reminder before a birthday, an hour to prepare for an
 * interview, a move off a day the person will be away. Save works them out
 * again from the line rather than trusting the screen, and applies only the
 * ones accepted, by id.
 */

// ------------------------------------------------------------------- asking

/** Things that happen at a time someone else also keeps: worth asking when. */
export const APPOINTMENT_WORD =
  /\b(?:meeting|meet|appointment|appt|doctor|dentist|dr|clinic|hospital|check-?up|interview|sync|standup|catch-?up|demo|presentation|salon|haircut|parlou?r|lawyer|consultation|session|class|tuition|viva)\b/i

export interface Choice {
  /** On the chip: "11 am", "Tomorrow 9 am", "Ravi Kumar". */
  label: string
  /** The line as it reads with this answer: what the box is set to on a tap. */
  line: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "11am", "4:30pm": a time as the date reader reads it back. */
function said(d: Date): string {
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12
  return `${h}${d.getMinutes() ? `:${pad(d.getMinutes())}` : ''}${d.getHours() >= 12 ? 'pm' : 'am'}`
}

const DAY_MONTH = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' }).toLowerCase()}`

/**
 * Times that are free, as answers to tap. On a day already named, the free
 * times that day; with no day, the next free times over the coming days. The
 * chips are in the person's language; the line a tap sets stays in words the
 * date reader reads.
 */
export async function timeChoices(
  userId: string,
  line: string,
  durationMinutes: number,
  now: Date,
  day: Date | null,
  lang: Lang = 'en',
): Promise<Choice[]> {
  const from = day ? new Date(Math.max(now.getTime(), new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0).getTime())) : now
  // A day named: three times on it. No day: a spread over the next few.
  const slots = await findFreeSlots(userId, durationMinutes, 3, { now: from, horizonDays: day ? 1 : 4, perDay: day ? 3 : 2 })
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return slots.map((at) => {
    const offset = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - today.getTime()) / 86_400_000)
    const clock = clockLabel(at.getHours(), at.getMinutes())
    if (day) return { label: clock, line: `${line} at ${said(at)}` }
    const dayWord = offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : null
    return dayWord
      ? {
          label: dayWord === 'today' ? t(lang, 'Today {time}', { time: clock }) : t(lang, 'Tomorrow {time}', { time: clock }),
          line: `${line} ${dayWord} ${said(at)}`,
        }
      : {
          label: `${at.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short' })} ${clock}`,
          line: `${line} on ${DAY_MONTH(at)} ${said(at)}`,
        }
  })
}

/** "call him", "remind her", "meet them": a person the line never named. */
export const PRONOUN = /\b(him|her|them)\b/i
export const CONTACT_VERB =
  /\b(?:call|ring|phone|meet|message|msg|text|whatsapp|email|mail|remind|ask|tell|ping|thank|pay|follow\s+up\s+with)\b/i

/** The people this account talks to most lately: answers to "who is him?". */
export async function recentPeople(orgId: string, limit = 4) {
  const c = schema.contacts
  return db
    .select({ id: c.id, name: c.name, role: c.role, phone: c.phone, placeLabel: sql<string | null>`null` })
    .from(c)
    .where(eq(c.orgId, orgId))
    .orderBy(sql`${c.lastContactedAt} desc nulls last`, desc(c.createdAt))
    .limit(limit)
}

// -------------------------------------------------------------- suggesting

export interface Suggestion {
  id: 'start-early' | 'gift' | 'prepare' | 'move-after-trip' | 'book-cab'
  /** Why, in a sentence: "Passport appointments can take weeks." */
  text: string
  /** The button: "Remind me Sun 1 Nov", "Move to Fri 6 Nov". */
  action: string
  /** A problem with the plan as it stands, not only a nicety. */
  warning?: boolean
  /** A plan to add alongside, when accepted. */
  extra?: { title: string; dueAt: string; kind: CommitmentKind; durationMinutes: number; flexible: boolean }
  /** A yearly reminder to add alongside, when accepted. */
  yearly?: { title: string; hour: number; minute: number; byMonth: number; byMonthDay: number }
  /** When accepted, the plan moves here (ISO). */
  moveTo?: string
}

/** What a plan looks like to the suggester: the parts of a QuickPlan it reads. */
export interface PlanShape {
  kind: string
  title: string
  dueAt: string | null
  commitmentKind: CommitmentKind
  placeLabel: string | null
  deadline: boolean
  booking: { type: string; remindBeforeMinutes: number } | null
  trip: unknown
  startsOn: string | null
  rule: { freq: string } | null
}

/** How much head start a deadline wants, by what it is. Said with t(lang, why). */
const LEADS: { pattern: RegExp; days: number; why: string }[] = [
  { pattern: /\b(?:passport|visa)\b/i, days: 30, why: msg('Passport and visa appointments can take weeks.') },
  { pattern: /\b(?:licen[cs]e|aadhaar|pan card|registration|rc transfer)\b/i, days: 14, why: msg('Paperwork like this can take a couple of weeks.') },
  { pattern: /\b(?:itr|income tax|tax return|gst|tds|audit)\b/i, days: 7, why: msg('Tax filing goes easier with the papers gathered a week ahead.') },
  {
    pattern: /\b(?:exam|thesis|assignment|dissertation|project|report|presentation|proposal|application|deck)\b/i,
    days: 7,
    why: msg('Work like this goes better started a week ahead.'),
  },
]

/** Events worth an hour of getting ready for. */
const PREP_EVENT = /\b(?:interview|presentation|pitch|demo|exam|viva|board meeting|appraisal|performance review|client meeting|speech|talk at)\b/i
/** Already the getting-ready: nothing to suggest. */
const IS_PREP = /^(?:prepare|prep|practice|rehearse|read|review|revise)\b|\bprepare\b/i
/** Birthdays and anniversaries: a gift wants sorting the evening before. */
const OCCASION = /\b(?:birthday|bday|b'day|anniversary)\b/i
/** Said to be remote: a day away does not stop it. */
const REMOTE = /\b(?:call|video|zoom|google meet|meet\.google|teams|online|virtual|phone|remote|whatsapp)\b/i

const dayName = (d: Date, lang: Lang = 'en') =>
  d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * Everything worth offering for this plan, most important first, said in the
 * person's language. The plans they add keep English titles, like any other.
 */
export async function suggestionsFor(userId: string, plan: PlanShape, line: string, now: Date, lang: Lang = 'en'): Promise<Suggestion[]> {
  const out: Suggestion[] = []

  if (plan.kind === 'commitment' && plan.dueAt && !plan.booking) {
    const due = new Date(plan.dueAt)
    const daysAway = (due.getTime() - now.getTime()) / 86_400_000

    // Away that day: an in-person plan cannot happen as typed.
    const inPerson = plan.commitmentKind === 'meeting' || Boolean(plan.placeLabel) || APPOINTMENT_WORD.test(plan.title)
    if (!plan.trip && inPerson && !REMOTE.test(line)) {
      const day = ymd(due)
      const trips = schema.trips
      const [away] = await db
        .select({ placeLabel: trips.placeLabel, startsOn: trips.startsOn, endsOn: trips.endsOn })
        .from(trips)
        .where(and(eq(trips.userId, userId), lte(trips.startsOn, day), gte(trips.endsOn, day)))
        .limit(1)
      if (away && !sameLabel(away.placeLabel, plan.placeLabel)) {
        const [y, m, d] = away.endsOn.split('-').map(Number)
        const back = new Date(y!, m! - 1, d! + 1, due.getHours(), due.getMinutes())
        const start = new Date(`${away.startsOn}T00:00:00`)
        const end = new Date(`${away.endsOn}T00:00:00`)
        const span = away.startsOn === away.endsOn ? dayName(start, lang) : `${dayName(start, lang)} – ${dayName(end, lang)}`
        out.push({
          id: 'move-after-trip',
          warning: true,
          text: t(lang, 'You’re in {place} {span}, so you won’t be here for this. Move it, or make it a call.', { place: away.placeLabel, span }),
          action: t(lang, 'Move to {day}', { day: dayName(back, lang) }),
          moveTo: back.toISOString(),
        })
      }
    }

    // A far-off deadline: a head start, so it is not a rush at the end.
    const lead = LEADS.find((l) => l.pattern.test(plan.title))
    if ((plan.deadline || lead) && daysAway >= 10) {
      const days = lead?.days ?? 7
      const start = new Date(due.getFullYear(), due.getMonth(), due.getDate() - days, 10, 0)
      if (start.getTime() > now.getTime() + 86_400_000 && days < daysAway) {
        out.push({
          id: 'start-early',
          text: lead ? t(lang, lead.why) : t(lang, 'A week’s head start, so it is not a rush at the end.'),
          action: t(lang, 'Remind me to start {day}', { day: dayName(start, lang) }),
          extra: { title: `Start: ${plan.title}`, dueAt: start.toISOString(), kind: 'task', durationMinutes: 30, flexible: true },
        })
      }
    }

    // An interview or a presentation: an hour to get ready, the evening before.
    if (PREP_EVENT.test(plan.title) && !IS_PREP.test(plan.title) && daysAway > 0.5) {
      const eve = new Date(due.getFullYear(), due.getMonth(), due.getDate() - 1, 18, 0)
      const before = new Date(due.getTime() - 3 * 3_600_000)
      const at = eve.getTime() > now.getTime() + 3_600_000 ? eve : before.getTime() > now.getTime() + 3_600_000 ? before : null
      if (at) {
        out.push({
          id: 'prepare',
          text: t(lang, 'An hour to get ready makes these go better.'),
          action: t(lang, 'Block {day}, {time}', { day: dayName(at, lang), time: clockLabel(at.getHours(), at.getMinutes()) }),
          extra: { title: `Prepare: ${plan.title}`, dueAt: at.toISOString(), kind: 'focus', durationMinutes: 60, flexible: false },
        })
      }
    }
  }

  // A flight or a train: the cab to get there, booked the evening before so
  // an early start is not a scramble for one at the door.
  if (plan.kind === 'commitment' && plan.dueAt && plan.booking && ['flight', 'train'].includes(plan.booking.type)) {
    const departs = new Date(plan.dueAt)
    const leave = new Date(departs.getTime() - plan.booking.remindBeforeMinutes * 60_000)
    const eve = new Date(departs.getFullYear(), departs.getMonth(), departs.getDate() - 1, 20, 0)
    const bookAt = eve.getTime() > now.getTime() + 30 * 60_000 ? eve : null
    if (bookAt && leave.getTime() > now.getTime() + 6 * 3_600_000) {
      const to = plan.booking.type === 'flight' ? 'the airport' : 'the station'
      const leaving = clockLabel(leave.getHours(), leave.getMinutes())
      out.push({
        id: 'book-cab',
        text:
          plan.booking.type === 'flight'
            ? t(lang, 'You need to leave by {time}. Book a cab to the airport the evening before?', { time: leaving })
            : t(lang, 'You need to leave by {time}. Book a cab to the station the evening before?', { time: leaving }),
        action: t(lang, 'Remind me {day}, 8 pm', { day: dayName(bookAt, lang) }),
        extra: { title: `Book a cab to ${to} for ${leaving}`, dueAt: bookAt.toISOString(), kind: 'task', durationMinutes: 10, flexible: false },
      })
    }
  }

  // A birthday or anniversary every year: the evening before, for a gift.
  if (plan.kind === 'recurrence' && plan.rule?.freq === 'yearly' && OCCASION.test(plan.title) && plan.startsOn) {
    const [y, m, d] = plan.startsOn.split('-').map(Number)
    const eve = new Date(y!, m! - 1, d! - 1)
    out.push({
      id: 'gift',
      text: t(lang, 'A reminder the evening before leaves time for a gift or a call.'),
      action: t(lang, 'Remind me the evening before'),
      yearly: { title: `Gift or wishes: ${plan.title}`, hour: 19, minute: 0, byMonth: eve.getMonth(), byMonthDay: eve.getDate() },
    })
  }

  return out
}
