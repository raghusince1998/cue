import { parseRRule, type IcsEvent, type IcsParseResult, type IcsSkip } from '@cue/shared'
import { freshAccessToken, OAuthError, type AccountRow } from './oauthConnect.ts'

/**
 * Reading calendars and events through the Google Calendar API.
 *
 * The output is deliberately an `IcsParseResult` — the same shape the `.ics`
 * parser produces. Everything downstream (the window, the upserts, removing
 * what vanished, the skipped report) is then shared with file and URL imports
 * rather than reimplemented, and a bug fixed in one path is fixed in all three.
 */

const API = 'https://www.googleapis.com/calendar/v3'
const FETCH_TIMEOUT_MS = 20_000

/** The documented ceiling. Fewer requests for the same events. */
const PAGE_SIZE = 2500

/**
 * A calendar with more pages than this is not something to mirror quietly.
 * Stops a pathological account from pulling for ever on a timer.
 */
const MAX_PAGES = 10

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'GoogleCalendarError'
  }
}

export interface GoogleCalendarSummary {
  id: string
  name: string
  primary: boolean
  /** 'owner' | 'writer' | 'reader' | 'freeBusyReader' — reader is plenty. */
  accessRole: string
  /** True when the account holder has hidden it in Google's own UI. */
  hidden: boolean
}

async function googleGet(
  account: AccountRow,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = `${API}${path}?${new URLSearchParams(params).toString()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const token = await freshAccessToken(account)
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: controller.signal,
    })

    if (res.status === 401) {
      // The token was not expired by our clock but Google rejected it anyway.
      // Saying "connect it again" is more useful than a bare 401, and far more
      // useful than retrying on a timer and mirroring nothing.
      throw new OAuthError(
        'Google rejected the stored access. Connect the account again.',
        'unauthorized',
        true,
      )
    }
    if (res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; errors?: { reason?: string }[] }
      }
      const reason = body.error?.errors?.[0]?.reason ?? ''
      throw new GoogleCalendarError(
        reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'
          ? 'Google is rate limiting this account — it will try again on the next sync.'
          : (body.error?.message ?? 'Google refused that request.'),
        reason || 'forbidden',
      )
    }
    if (res.status === 404) {
      throw new GoogleCalendarError('That calendar is no longer shared with this account.', 'gone')
    }
    if (!res.ok) {
      throw new GoogleCalendarError(`Google replied ${res.status}.`, 'http_error')
    }

    return (await res.json()) as Record<string, unknown>
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new GoogleCalendarError('Google took too long to reply.', 'timeout')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Everything this account can read, for the picker. */
export async function listCalendars(account: AccountRow): Promise<GoogleCalendarSummary[]> {
  const out: GoogleCalendarSummary[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { maxResults: '250', minAccessRole: 'reader' }
    if (pageToken) params.pageToken = pageToken

    const body = await googleGet(account, '/users/me/calendarList', params)
    const items = (body.items ?? []) as Record<string, unknown>[]

    for (const item of items) {
      out.push({
        id: String(item.id ?? ''),
        name: String(item.summaryOverride ?? item.summary ?? item.id ?? 'Calendar'),
        primary: item.primary === true,
        accessRole: String(item.accessRole ?? 'reader'),
        hidden: item.hidden === true,
      })
    }

    pageToken = body.nextPageToken as string | undefined
    if (!pageToken) break
  }

  // The main calendar first, then alphabetically — the order someone expects
  // to find their own calendar in.
  return out.sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * An all-day date, read as a local calendar date.
 *
 * Google writes these as "2026-10-02" with no zone. `new Date(string)` would
 * read that as UTC midnight and shift the day backwards for anyone west of
 * Greenwich; the `.ics` parser builds a local date for exactly this reason and
 * these two have to agree or the same holiday lands on different days
 * depending on how it was imported.
 */
/**
 * An event description as text.
 *
 * Google stores descriptions as HTML — anything pasted from an invite arrives
 * as "Hi Everyone!<br>Today we have a joint session led by <strong>…", and
 * that is what showed under the event in Cue. Line breaks are kept as line
 * breaks; every other tag is dropped and the common entities decoded.
 */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function localDate(ymd: string): Date | null {
  const parts = ymd.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  return new Date(parts[0]!, parts[1]! - 1, parts[2]!)
}

interface GoogleStamp {
  date?: string
  dateTime?: string
}

function readStamp(stamp: GoogleStamp | undefined): { date: Date; allDay: boolean } | null {
  if (!stamp) return null
  if (stamp.date) {
    const d = localDate(stamp.date)
    return d ? { date: d, allDay: true } : null
  }
  if (stamp.dateTime) {
    // RFC3339 and always carries an offset, so the built-in parser is correct here.
    const d = new Date(stamp.dateTime)
    return Number.isNaN(d.getTime()) ? null : { date: d, allDay: false }
  }
  return null
}

/** The date part of an instant, as the recurrence machinery writes exclusions. */
function ymdOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface GoogleEvent {
  id?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  start?: GoogleStamp
  end?: GoogleStamp
  recurrence?: string[]
  recurringEventId?: string
  originalStartTime?: GoogleStamp
}

/**
 * Google's events for one calendar, in the shape the importer already speaks.
 *
 * `singleEvents=false` keeps repeating events as a rule rather than as hundreds
 * of expanded copies, which is what lets them stay one repeating plan in Cue
 * instead of flooding the calendar with identical rows.
 *
 * No `timeMin` is sent, and that is deliberate. It is documented as a bound on
 * an event's *end* time, and the docs do not say what that means for a series
 * that began years ago and still runs weekly — so it could quietly drop exactly
 * the meetings most worth mirroring. The window is applied downstream instead,
 * where a one-off outside it is counted and reported rather than lost, which is
 * already how importing a `.ics` file behaves.
 */
export type { GoogleEvent }

/**
 * Google's event JSON, in the shape the importer already speaks.
 *
 * Pure and exported on purpose: the fiddly parts — an exclusive all-day end, a
 * date with no zone, a series whose rule we cannot model, a single week called
 * off — are exactly what wants testing, and none of them should need a live
 * Google account to exercise.
 */
export function mapGoogleEvents(
  raw: GoogleEvent[],
  calendarName: string | null = null,
): IcsParseResult {
  // A cancelled instance names its parent. Gathered first so the series it
  // belongs to can carry the exclusion, rather than the week appearing in Cue
  // after it was called off in Google.
  const exclusionsBySeries = new Map<string, string[]>()
  for (const item of raw) {
    if (item.status !== 'cancelled' || !item.recurringEventId) continue
    const when = readStamp(item.originalStartTime)
    if (!when) continue
    const list = exclusionsBySeries.get(item.recurringEventId) ?? []
    list.push(ymdOf(when.date))
    exclusionsBySeries.set(item.recurringEventId, list)
  }

  const events: IcsEvent[] = []
  const skipped: IcsSkip[] = []

  for (const item of raw) {
    const uid = item.id
    if (!uid) continue

    // Already folded into its parent's exclusions above.
    if (item.recurringEventId && item.status === 'cancelled') continue

    const label = (item.summary ?? '').trim() || '(untitled)'
    const start = readStamp(item.start)
    if (!start) {
      // No usable start is not an event. Reported rather than dropped silently,
      // because "47 of 48 imported" is a question somebody can act on.
      skipped.push({ uid, title: label, reason: 'has no start time I could read' })
      continue
    }

    let rule = null
    const rruleLine = (item.recurrence ?? []).find((line) => line.startsWith('RRULE:'))
    if (rruleLine) {
      rule = parseRRule(rruleLine.slice('RRULE:'.length))
      if (!rule) {
        skipped.push({ uid, title: label, reason: 'repeats in a way I cannot describe yet' })
        continue
      }

      // EXDATE lines on the series, plus the instances cancelled one at a time.
      const exdates = new Set(exclusionsBySeries.get(uid) ?? [])
      for (const line of item.recurrence ?? []) {
        if (!line.startsWith('EXDATE')) continue
        const value = line.slice(line.indexOf(':') + 1)
        for (const piece of value.split(',')) {
          const stamp = piece.trim()
          if (stamp.length < 8) continue
          const d = localDate(
            `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
          )
          if (d) exdates.add(ymdOf(d))
        }
      }
      if (exdates.size > 0) rule = { ...rule, exdates: [...exdates] }
    }

    let end = readStamp(item.end)

    // An all-day end is *exclusive* in Google exactly as in iCalendar: a
    // one-day holiday on 2 October ends 3 October. Taken literally every
    // single-day event renders a day too long. Normalised here so the two
    // import paths cannot disagree.
    if (end && start.allDay) {
      const inclusive = new Date(end.date.getTime() - 86_400_000)
      end = { date: inclusive < start.date ? start.date : inclusive, allDay: true }
    }

    events.push({
      uid,
      title: label,
      description: plainText(item.description ?? '') || null,
      location: (item.location ?? '').trim() || null,
      startsAt: start.date,
      endsAt: end?.date ?? null,
      allDay: start.allDay,
      rule,
      cancelled: item.status === 'cancelled',
    })
  }

  return { calendarName, events, skipped }
}

/**
 * Google's events for one calendar.
 *
 * `singleEvents=false` keeps repeating events as a rule rather than as hundreds
 * of expanded copies, which is what lets them stay one repeating plan in Cue
 * instead of flooding the calendar with identical rows.
 *
 * No `timeMin` is sent, and that is deliberate. It is documented as a bound on
 * an event's *end* time, and the documentation does not say what that means for
 * a series that began years ago and still runs weekly — so it could quietly
 * drop exactly the meetings most worth mirroring. The window is applied
 * downstream instead, where a one-off outside it is counted and reported rather
 * than lost, which is already how importing a `.ics` file behaves.
 */
export async function fetchGoogleEvents(
  account: AccountRow,
  calendarId: string,
  opts: { calendarName?: string | null; horizonDays?: number } = {},
): Promise<IcsParseResult> {
  const horizon = opts.horizonDays ?? 400
  const timeMax = new Date(Date.now() + horizon * 86_400_000).toISOString()

  const raw: GoogleEvent[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = {
      maxResults: String(PAGE_SIZE),
      singleEvents: 'false',
      // Cancelled *instances* of a repeating event arrive this way, and they
      // are the only record that one week was called off.
      showDeleted: 'true',
      timeMax,
    }
    if (pageToken) params.pageToken = pageToken

    const body = await googleGet(
      account,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      params,
    )
    raw.push(...((body.items ?? []) as GoogleEvent[]))

    pageToken = body.nextPageToken as string | undefined
    if (!pageToken) break
  }

  return mapGoogleEvents(raw, opts.calendarName ?? null)
}
