import { resolveZone, type IcsEvent, type IcsParseResult, type IcsSkip } from '@cue/shared'
import type { RecurrenceRule } from '@cue/shared'
import { freshAccessToken, OAuthError, type AccountRow } from './oauthConnect.ts'

/**
 * Reading Outlook and Microsoft 365 calendars through Microsoft Graph.
 *
 * Output is an `IcsParseResult`, the same shape the `.ics` parser produces, so
 * the window, the upserts, removing what vanished and the skipped report are
 * all shared with the other import paths rather than written again.
 *
 * Graph differs from Google in two ways that matter. Times arrive as a naive
 * wall clock plus a separate zone name — and that name is usually a *Windows*
 * one, which is why `resolveZone` exists. And recurrence is a structured
 * object rather than an RRULE string, so it has to be translated rather than
 * parsed.
 */

const API = 'https://graph.microsoft.com/v1.0'
const FETCH_TIMEOUT_MS = 20_000
const PAGE_SIZE = 500
const MAX_PAGES = 10

/** Only what is used. A full event payload is large and mostly irrelevant. */
const EVENT_FIELDS = [
  'id',
  'subject',
  'bodyPreview',
  'start',
  'end',
  'isAllDay',
  'isCancelled',
  'location',
  'recurrence',
  'type',
  'seriesMasterId',
  'onlineMeeting',
].join(',')

export class MicrosoftCalendarError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'MicrosoftCalendarError'
  }
}

export interface MicrosoftCalendarSummary {
  id: string
  name: string
  primary: boolean
  accessRole: string
  hidden: boolean
}

async function graphGet(account: AccountRow, url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const token = await freshAccessToken(account)
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        // Ask Graph to express every time in UTC. Without this each event
        // carries the organiser's own zone and the conversion has to be done
        // here, for every event, from a Windows zone name.
        Prefer: 'outlook.timezone="UTC"',
      },
      signal: controller.signal,
    })

    if (res.status === 401) {
      throw new OAuthError(
        'Microsoft rejected the stored access. Connect the account again.',
        'unauthorized',
        true,
      )
    }
    if (res.status === 403) {
      throw new MicrosoftCalendarError(
        'Microsoft refused that request — the account may not be allowed to share this calendar.',
        'forbidden',
      )
    }
    if (res.status === 404) {
      throw new MicrosoftCalendarError('That calendar is no longer available.', 'gone')
    }
    if (res.status === 429) {
      throw new MicrosoftCalendarError(
        'Microsoft is rate limiting this account — it will try again on the next sync.',
        'rate_limited',
      )
    }
    if (!res.ok) {
      throw new MicrosoftCalendarError(`Microsoft replied ${res.status}.`, 'http_error')
    }

    return (await res.json()) as Record<string, unknown>
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new MicrosoftCalendarError('Microsoft took too long to reply.', 'timeout')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Everything this account can read, for the picker. */
export async function listMicrosoftCalendars(
  account: AccountRow,
): Promise<MicrosoftCalendarSummary[]> {
  const out: MicrosoftCalendarSummary[] = []
  let url: string | undefined = `${API}/me/calendars?$top=100`

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const body: Record<string, unknown> = await graphGet(account, url)
    for (const item of (body.value ?? []) as Record<string, unknown>[]) {
      out.push({
        id: String(item.id ?? ''),
        name: String(item.name ?? 'Calendar'),
        primary: item.isDefaultCalendar === true,
        accessRole: item.canEdit === true ? 'writer' : 'reader',
        hidden: false,
      })
    }
    url = body['@odata.nextLink'] as string | undefined
  }

  return out.sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

interface GraphStamp {
  dateTime?: string
  timeZone?: string
}

interface GraphPattern {
  type?: string
  interval?: number
  daysOfWeek?: string[]
  dayOfMonth?: number
  index?: string
  month?: number
}

interface GraphRange {
  type?: string
  startDate?: string
  endDate?: string
  numberOfOccurrences?: number
}

export interface GraphEvent {
  id?: string
  subject?: string
  bodyPreview?: string
  start?: GraphStamp
  end?: GraphStamp
  isAllDay?: boolean
  isCancelled?: boolean
  location?: { displayName?: string }
  recurrence?: { pattern?: GraphPattern; range?: GraphRange }
  type?: string
  seriesMasterId?: string
  onlineMeeting?: { joinUrl?: string }
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

/** 'second' -> 2, 'last' -> -1. */
const INDEXES: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  last: -1,
}

/**
 * Graph's structured recurrence -> our rule, or null when it asks for
 * something we do not model.
 *
 * Null means "this repeats in a way we cannot describe", and the caller reports
 * it rather than importing a single occurrence that looks complete and is
 * missing every other date.
 */
export function mapGraphRecurrence(
  recurrence: { pattern?: GraphPattern; range?: GraphRange } | undefined,
): RecurrenceRule | null {
  const pattern = recurrence?.pattern
  const range = recurrence?.range
  if (!pattern?.type) return null

  const interval = Math.max(1, pattern.interval ?? 1)
  const weekdays = (pattern.daysOfWeek ?? [])
    .map((d) => WEEKDAYS[d.toLowerCase()])
    .filter((n): n is number => n !== undefined)

  let rule: RecurrenceRule | null = null

  switch (pattern.type) {
    case 'daily':
      rule = { freq: 'daily', interval }
      break
    case 'weekly':
      rule = { freq: 'weekly', interval, byWeekday: weekdays }
      break
    case 'absoluteMonthly':
      rule = { freq: 'monthly', interval, byMonthDay: pattern.dayOfMonth ?? null }
      break
    case 'relativeMonthly': {
      // "the second Tuesday". Without setPos this would read as a fortnightly
      // rule and drift off the real date within two months.
      const setPos = INDEXES[(pattern.index ?? 'first').toLowerCase()]
      if (!setPos || weekdays.length !== 1) return null
      rule = { freq: 'monthly', interval, byWeekday: weekdays, setPos }
      break
    }
    case 'absoluteYearly':
      rule = {
        freq: 'yearly',
        interval,
        byMonth: pattern.month ? pattern.month - 1 : null,
        byMonthDay: pattern.dayOfMonth ?? null,
      }
      break
    // relativeYearly is "the first Monday of May every year". setPos is
    // monthly-only in our model, so this is refused rather than imported as
    // something close but wrong.
    default:
      return null
  }

  if (range?.type === 'endDate' && range.endDate) {
    rule = { ...rule, until: range.endDate }
  } else if (range?.type === 'numbered' && range.numberOfOccurrences) {
    rule = { ...rule, count: range.numberOfOccurrences }
  }

  return rule
}

/**
 * A Graph timestamp -> an instant.
 *
 * Graph sends a naive wall clock and a zone name separately, and the name is
 * usually a Windows one. The `Prefer` header asks for UTC, so that is the
 * normal case; the resolver covers a server that ignored the hint.
 */
function readStamp(stamp: GraphStamp | undefined, allDay: boolean): Date | null {
  if (!stamp?.dateTime) return null

  // Graph writes seven fractional digits, which `Date` will not parse.
  const text = stamp.dateTime.replace(/(\.\d{3})\d+$/, '$1')
  const zone = stamp.timeZone ?? 'UTC'

  if (allDay) {
    // An all-day event is a calendar date, not an instant. Built local to match
    // the .ics parser — read as UTC it lands on the previous day for anyone
    // west of Greenwich, and the same holiday would differ by import route.
    const [y, m, d] = text.slice(0, 10).split('-').map(Number)
    if (!y || !m || !d) return null
    return new Date(y, m - 1, d)
  }

  const isUtc = zone.toUpperCase() === 'UTC'
  const instant = new Date(isUtc ? `${text}Z` : text)
  if (!Number.isNaN(instant.getTime()) && isUtc) return instant

  const resolved = resolveZone(zone)
  if (!resolved) return null

  // Re-express the wall clock in the named zone.
  const [datePart, timePart = '00:00:00'] = text.split('T')
  const [y, mo, d] = datePart!.split('-').map(Number)
  const [h, mi, s] = timePart.split(':').map(Number)
  if (!y || !mo || !d) return null

  const naive = Date.UTC(y, mo - 1, d, h ?? 0, mi ?? 0, Math.trunc(s ?? 0))
  const offset = (ts: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: resolved,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(ts)
        .map((p) => [p.type, p.value]),
    )
    return (
      Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour) % 24,
        Number(parts.minute),
        Number(parts.second),
      ) - ts
    )
  }
  const first = offset(naive)
  const ts = naive - first
  const second = offset(ts)
  return new Date(second === first ? ts : naive - second)
}

/**
 * Graph's event JSON, in the shape the importer already speaks.
 *
 * Pure and exported on purpose: the fiddly parts — a structured recurrence, an
 * exclusive all-day end, a Windows zone name — are exactly what wants testing,
 * and none of them should need a live Microsoft account to exercise.
 */
export function mapGraphEvents(
  raw: GraphEvent[],
  calendarName: string | null = null,
): IcsParseResult {
  const events: IcsEvent[] = []
  const skipped: IcsSkip[] = []

  for (const item of raw) {
    const uid = item.id
    if (!uid) continue

    const label = (item.subject ?? '').trim() || '(untitled)'

    // A single changed instance of a series. Importing it as its own event
    // would put that day in twice — the same call the .ics path makes.
    if (item.type === 'exception' || item.type === 'occurrence') {
      skipped.push({ uid, title: label, reason: 'a one-off change to a repeating event' })
      continue
    }

    const allDay = item.isAllDay === true
    const start = readStamp(item.start, allDay)
    if (!start) {
      const zone = item.start?.timeZone
      skipped.push({
        uid,
        title: label,
        reason: zone ? `uses a time zone I do not know (${zone})` : 'has no start time I could read',
      })
      continue
    }

    let rule: RecurrenceRule | null = null
    if (item.recurrence) {
      rule = mapGraphRecurrence(item.recurrence)
      if (!rule) {
        skipped.push({ uid, title: label, reason: 'repeats in a way I cannot describe yet' })
        continue
      }
    }

    let end = readStamp(item.end, allDay)

    // An all-day end is *exclusive*, as everywhere else: a one-day holiday on
    // 2 October ends 3 October. Taken literally every single-day event renders
    // a day too long.
    if (end && allDay) {
      const inclusive = new Date(end.getTime() - 86_400_000)
      end = inclusive < start ? start : inclusive
    }

    // The Teams join link is a field of its own rather than only buried in the
    // body, and it is the one thing somebody actually needs from a reminder.
    const join = item.onlineMeeting?.joinUrl
    const body = (item.bodyPreview ?? '').trim()
    const notes = [body || null, join ? `Join: ${join}` : null].filter(Boolean).join('\n\n')

    events.push({
      uid,
      title: label,
      description: notes || null,
      location: (item.location?.displayName ?? '').trim() || null,
      startsAt: start,
      endsAt: end,
      allDay,
      rule,
      cancelled: item.isCancelled === true,
    })
  }

  return { calendarName, events, skipped }
}

/**
 * Graph's events for one calendar.
 *
 * `/events` returns series masters rather than expanded occurrences, which is
 * what lets a repeating meeting stay one repeating plan in Cue instead of
 * flooding the calendar with identical rows.
 */
export async function fetchMicrosoftEvents(
  account: AccountRow,
  calendarId: string,
  opts: { calendarName?: string | null } = {},
): Promise<IcsParseResult> {
  const raw: GraphEvent[] = []
  let url: string | undefined =
    `${API}/me/calendars/${encodeURIComponent(calendarId)}/events` +
    `?$top=${PAGE_SIZE}&$select=${EVENT_FIELDS}&$orderby=start/dateTime`

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const body: Record<string, unknown> = await graphGet(account, url)
    raw.push(...((body.value ?? []) as GraphEvent[]))
    url = body['@odata.nextLink'] as string | undefined
  }

  return mapGraphEvents(raw, opts.calendarName ?? null)
}
