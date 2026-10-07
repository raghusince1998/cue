import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { and, eq, gte, inArray, isNotNull, isNull, lt, not, sql } from 'drizzle-orm'
import { parseIcs, type IcsEvent, type IcsParseResult } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { decryptSecret } from '../secrets.ts'
import { scheduleFirstReminder, cancelPendingReminders } from './reminders.ts'
import { materialise, regenerate } from './recurrence.ts'
import { fetchGoogleEvents } from './googleCalendar.ts'
import { fetchMicrosoftEvents } from './microsoftCalendar.ts'

/**
 * Mirroring a subscribed calendar into Cue.
 *
 * Read-only in every direction that matters: the feed is the source of truth,
 * Cue keeps a copy, and nothing is ever written back. Re-reading the same
 * feed updates rather than duplicates because every VEVENT carries a stable
 * UID, which is the dedupe key.
 */

/** A feed is text. Anything this large is not a calendar. */
const MAX_BYTES = 8 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000

/**
 * How much of the past to mirror when a feed does not say.
 *
 * A year, not a fortnight. A Google export arrives with the whole history of
 * the calendar, and dropping all of it means the History screen is empty of
 * everything the person actually did.
 */
const DEFAULT_PAST_DAYS = 365
const FUTURE_DAYS = 400

export class FeedError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message)
  }
}

/**
 * Blocks the server being used to reach things only it can see.
 *
 * The URL comes from a user, and the server fetches it with the server's own
 * network position. Without this check, `http://169.254.169.254/...` or
 * `http://localhost:5432` would be fetched happily and the response handed
 * back — a textbook SSRF. Private ranges are refused after resolution, so a
 * public hostname that resolves inward is caught too.
 */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new FeedError('That does not look like a URL.', 'bad_url')
  }

  // webcal: is what calendar apps hand out; it is https underneath.
  if (url.protocol === 'webcal:') url.protocol = 'https:'

  if (url.protocol !== 'https:') {
    throw new FeedError('The address must start with https.', 'https_required')
  }

  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new FeedError('I could not find that host.', 'dns_failed')
      })

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new FeedError('That address points back inside the server.', 'private_address')
    }
  }

  return url
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase()
    if (v6 === '::1' || v6 === '::') return true
    // Unique-local and link-local.
    if (/^f[cd]/.test(v6) || v6.startsWith('fe80')) return true
    // IPv4 written as IPv6, which would otherwise slip past every check below.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
    return mapped ? isPrivateAddress(mapped[1]!) : false
  }

  const [a, b] = ip.split('.').map(Number)
  if (a === undefined || b === undefined) return false
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, including cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast and reserved
  )
}

export async function fetchIcs(rawUrl: string): Promise<string> {
  const url = await assertPublicUrl(rawUrl)

  const res = await fetch(url, {
    redirect: 'error', // A redirect could hop to a private address after the check.
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5' },
  }).catch((err: Error) => {
    throw new FeedError(
      err.name === 'TimeoutError' ? 'The calendar took too long to respond.' : 'I could not reach that address.',
      'fetch_failed',
    )
  })

  if (!res.ok) {
    throw new FeedError(
      res.status === 404
        ? 'That address returned nothing — check you copied the whole secret URL.'
        : `The calendar returned ${res.status}.`,
      'bad_status',
    )
  }

  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) throw new FeedError('That calendar is too large to read.', 'too_large')

  const text = await res.text()
  if (text.length > MAX_BYTES) throw new FeedError('That calendar is too large to read.', 'too_large')
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new FeedError('That address did not return a calendar.', 'not_a_calendar')
  }
  return text
}

export interface SyncReport {
  calendarName: string | null
  imported: number
  updated: number
  removed: number
  skipped: number
  repeating: number
  /**
   * Real events that fell outside the window this mirrors — almost always a
   * calendar's own history. Reported rather than dropped in silence: an export
   * holding a year of past meetings and one upcoming one would otherwise say
   * "1 event" and leave the user to conclude the import was broken.
   */
  outsideWindow: number
  /** Oldest and newest thing the file actually contained, when any was out. */
  oldest: string | null
  newest: string | null
  /** The window that was applied, so the message can offer to widen it. */
  historyDays: number | null
}

type FeedRow = typeof schema.calendarFeeds.$inferSelect

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Minutes between start and end, floored at 15 so nothing occupies zero time. */
function durationOf(event: IcsEvent): number {
  if (!event.endsAt) return 60
  const mins = Math.round((event.endsAt.getTime() - event.startsAt.getTime()) / 60_000)
  return Math.min(Math.max(mins, 15), 24 * 60)
}

/** The source event's own notes, kept apart from anything the user writes. */
function notesOf(event: IcsEvent): string | null {
  const parts = [event.description, event.location ? `Location: ${event.location}` : null].filter(
    Boolean,
  )
  return parts.length ? parts.join('\n\n') : null
}

/**
 * Reads the feed and makes Cue match it.
 *
 * Everything here is scoped to rows this feed owns. A commitment you created
 * yourself is never touched, however much it looks like one from the calendar.
 */
export async function syncFeed(feed: FeedRow, opts: { now?: Date } = {}): Promise<SyncReport> {
  // A connected account: ask the provider directly. Same reconciliation, a
  // different way of getting hold of the events.
  if (feed.source === 'google' || feed.source === 'microsoft') {
    if (!feed.oauthAccountId || !feed.externalCalendarId) {
      throw new FeedError('This calendar is missing its connection.', 'no_account')
    }
    const [account] = await db
      .select()
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.id, feed.oauthAccountId))
      .limit(1)
    if (!account) {
      throw new FeedError('That account has been disconnected.', 'no_account')
    }
    const parsed =
      feed.source === 'microsoft'
        ? await fetchMicrosoftEvents(account, feed.externalCalendarId, {
            calendarName: feed.calendarName,
          })
        : await fetchGoogleEvents(account, feed.externalCalendarId, {
            calendarName: feed.calendarName,
          })
    return reconcile(feed, parsed, opts)
  }

  // A file-sourced feed has nothing to re-read: its events changed when the
  // user uploaded a newer export, and that path calls importIcs directly.
  if (feed.source !== 'url' || !feed.urlEncrypted) {
    throw new FeedError('This calendar came from a file — upload a new export to update it.', 'not_a_url_feed')
  }
  return importIcs(feed, await fetchIcs(decryptSecret(feed.urlEncrypted)), opts)
}

/**
 * The half of a sync that touches the database, with the network already done.
 *
 * Split out so the mirroring rules can be exercised against a known calendar
 * without a live feed — and because fetching and reconciling are genuinely
 * different jobs that fail in different ways.
 */
export async function importIcs(
  feed: FeedRow,
  text: string,
  opts: { now?: Date } = {},
): Promise<SyncReport> {
  return reconcile(feed, parseIcs(text), opts)
}

/**
 * Makes Cue match a calendar that has already been read.
 *
 * Takes parsed events rather than text, which is what lets a `.ics` file, a
 * subscribed URL and a connected Google account share every rule below —
 * the window, the upserts, removing what vanished, the skipped report. Three
 * ways in, one set of behaviours, and a fix in one is a fix in all three.
 */
export async function reconcile(
  feed: FeedRow,
  parsed: IcsParseResult,
  opts: { now?: Date } = {},
): Promise<SyncReport> {
  const now = opts.now ?? new Date()

  // Null historyDays means no lower bound: take everything the file holds.
  const pastDays = feed.historyDays === null ? null : (feed.historyDays ?? DEFAULT_PAST_DAYS)
  const from = pastDays === null ? new Date(0) : new Date(now.getTime() - pastDays * 86_400_000)
  const to = new Date(now.getTime() + FUTURE_DAYS * 86_400_000)

  const report: SyncReport = {
    calendarName: parsed.calendarName,
    imported: 0,
    updated: 0,
    removed: 0,
    skipped: parsed.skipped.length,
    repeating: 0,
    outsideWindow: 0,
    oldest: null,
    newest: null,
    historyDays: null,
  }

  // Tracked across everything the file held, in range or not, so the report can
  // say what period the calendar actually covers.
  let oldest: Date | null = null
  let newest: Date | null = null
  for (const e of parsed.events) {
    if (!oldest || e.startsAt < oldest) oldest = e.startsAt
    if (!newest || e.startsAt > newest) newest = e.startsAt
  }

  const seenCommitments: string[] = []
  const seenRecurrences: string[] = []

  for (const event of parsed.events) {
    // A repeating event is in range if the series could produce anything in it;
    // a one-off only if it actually falls there.
    if (!event.rule && (event.startsAt < from || event.startsAt > to)) {
      report.outsideWindow += 1
      continue
    }
    if (event.cancelled) continue

    if (event.rule) {
      seenRecurrences.push(event.uid)
      report.repeating += 1
      await upsertSeries(feed, event, now)
    } else {
      seenCommitments.push(event.uid)
      const created = await upsertOne(feed, event)
      if (created) report.imported += 1
      else report.updated += 1
    }
  }

  report.removed = await removeVanished(feed, now, seenCommitments, seenRecurrences)

  report.historyDays = pastDays
  if (report.outsideWindow > 0) {
    report.oldest = oldest ? ymd(oldest) : null
    report.newest = newest ? ymd(newest) : null
  }
  return report
}

/** One non-repeating event. */
async function upsertOne(feed: FeedRow, event: IcsEvent): Promise<boolean> {
  const values = {
    orgId: feed.orgId,
    userId: feed.userId,
    feedId: feed.id,
    externalUid: event.uid,
    title: event.title,
    kind: 'meeting',
    notes: notesOf(event),
    dueAt: event.startsAt,
    durationMinutes: durationOf(event),
    allDay: event.allDay,
    // Only for something that genuinely spans more than one day. A single-day
    // holiday ends where it starts, and the schema reserves endsAt for spans —
    // there is a check constraint saying exactly that.
    endsAt:
      event.allDay && event.endsAt && event.endsAt.getTime() > event.startsAt.getTime()
        ? event.endsAt
        : null,
    placeLabel: event.location,
    status: 'pending' as const,
  }

  const [existing] = await db
    .select({ id: schema.commitments.id, dueAt: schema.commitments.dueAt, status: schema.commitments.status })
    .from(schema.commitments)
    .where(and(eq(schema.commitments.feedId, feed.id), eq(schema.commitments.externalUid, event.uid)))
    .limit(1)

  if (!existing) {
    const [row] = await db.insert(schema.commitments).values(values).returning({ id: schema.commitments.id })
    if (row && feed.remind) {
      await scheduleFirstReminder({ orgId: feed.orgId, commitmentId: row.id, fireAt: event.startsAt })
    }
    return true
  }

  // Leave anything the user has already closed out alone — re-opening a
  // meeting they marked done because the feed still lists it would be wrong.
  if (existing.status !== 'pending') return false

  const moved = existing.dueAt.getTime() !== event.startsAt.getTime()
  await db
    .update(schema.commitments)
    .set({ ...values, escalationCount: moved ? 0 : undefined })
    .where(eq(schema.commitments.id, existing.id))

  if (moved) {
    // A moved meeting is not late for its old time.
    await cancelPendingReminders(existing.id)
    if (feed.remind) {
      await scheduleFirstReminder(
        { orgId: feed.orgId, commitmentId: existing.id, fireAt: event.startsAt },
        db,
      )
    }
  }
  return false
}

/** One repeating event, mirrored onto the recurrence machinery. */
async function upsertSeries(feed: FeedRow, event: IcsEvent, now: Date): Promise<void> {
  const rule = event.rule!
  const values = {
    orgId: feed.orgId,
    userId: feed.userId,
    feedId: feed.id,
    externalUid: event.uid,
    title: event.title,
    kind: 'meeting',
    notes: notesOf(event),
    durationMinutes: durationOf(event),
    placeLabel: event.location,
    freq: rule.freq,
    interval: rule.interval,
    byWeekday: rule.byWeekday ?? null,
    byMonthDay: rule.byMonthDay ?? null,
    byMonth: rule.byMonth ?? null,
    setPos: rule.setPos ?? null,
    untilOn: rule.until ?? null,
    count: rule.count ?? null,
    exdates: rule.exdates ?? null,
    startsOn: ymd(event.startsAt),
    hour: event.startsAt.getHours(),
    minute: event.startsAt.getMinutes(),
    status: 'active',
  }

  const [existing] = await db
    .select()
    .from(schema.recurrences)
    .where(and(eq(schema.recurrences.feedId, feed.id), eq(schema.recurrences.externalUid, event.uid)))
    .limit(1)

  if (!existing) {
    const [row] = await db.insert(schema.recurrences).values(values).returning()
    if (row) await materialise(row, { now, remind: feed.remind })
    return
  }

  const [row] = await db
    .update(schema.recurrences)
    .set(values)
    .where(eq(schema.recurrences.id, existing.id))
    .returning()

  // Only rebuild when something about the rule or the event actually moved;
  // regenerating on every sync would churn reminders for no reason.
  const changed =
    existing.freq !== values.freq ||
    existing.interval !== values.interval ||
    existing.startsOn !== values.startsOn ||
    existing.hour !== values.hour ||
    existing.minute !== values.minute ||
    existing.untilOn !== values.untilOn ||
    existing.count !== values.count ||
    JSON.stringify(existing.byWeekday) !== JSON.stringify(values.byWeekday) ||
    JSON.stringify(existing.exdates) !== JSON.stringify(values.exdates) ||
    existing.byMonthDay !== values.byMonthDay ||
    existing.setPos !== values.setPos

  if (row && changed) await regenerate(row, { now, remind: feed.remind })
}

/**
 * Drops what the feed no longer mentions.
 *
 * Deliberately narrow: only rows this feed owns, only ones still ahead, and
 * only ones the user has not taken over by editing. Deleting a meeting from
 * Google should remove it here; it should never remove something you wrote.
 */
async function removeVanished(
  feed: FeedRow,
  now: Date,
  seenCommitments: string[],
  seenRecurrences: string[],
): Promise<number> {
  const goneSeries = await db
    .delete(schema.recurrences)
    .where(
      and(
        eq(schema.recurrences.feedId, feed.id),
        seenRecurrences.length
          ? not(inArray(schema.recurrences.externalUid, seenRecurrences))
          : isNotNull(schema.recurrences.externalUid),
      ),
    )
    .returning({ id: schema.recurrences.id })

  const goneOneOffs = await db
    .delete(schema.commitments)
    .where(
      and(
        eq(schema.commitments.feedId, feed.id),
        isNull(schema.commitments.recurrenceId),
        eq(schema.commitments.status, 'pending'),
        eq(schema.commitments.detached, false),
        gte(schema.commitments.dueAt, now),
        seenCommitments.length
          ? not(inArray(schema.commitments.externalUid, seenCommitments))
          : isNotNull(schema.commitments.externalUid),
      ),
    )
    .returning({ id: schema.commitments.id })

  return goneSeries.length + goneOneOffs.length
}

/** Re-reads every active feed. One broken subscription never stops the others. */
export async function syncAllFeeds(opts: { now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date()
  const feeds = await db
    .select()
    .from(schema.calendarFeeds)
    .where(
      and(
        eq(schema.calendarFeeds.status, 'active'),
        // Not 'file': an upload only changes when a new one is sent.
        inArray(schema.calendarFeeds.source, ['url', 'google', 'microsoft']),
      ),
    )

  let synced = 0
  for (const feed of feeds) {
    try {
      const report = await syncFeed(feed, { now })
      await db
        .update(schema.calendarFeeds)
        .set({
          lastSyncedAt: new Date(),
          lastError: null,
          lastEventCount: report.imported + report.updated + report.repeating,
          lastSkippedCount: report.skipped,
          calendarName: report.calendarName,
        })
        .where(eq(schema.calendarFeeds.id, feed.id))
      synced += 1
    } catch (err) {
      const message = err instanceof FeedError ? err.message : (err as Error).message
      console.error('[calendar] sync failed for', feed.id, message)
      await db
        .update(schema.calendarFeeds)
        .set({ lastSyncedAt: new Date(), lastError: message })
        .where(eq(schema.calendarFeeds.id, feed.id))
    }
  }
  return synced
}

/**
 * Never show the secret back — only enough to tell two subscriptions apart.
 *
 * The host plus a short fingerprint, not a slice of the URL. For Google the
 * tail happens to be "basic.ics" and harmless, but other providers put the
 * secret last, and a display hint is not worth leaking a credential over.
 */
export function hintFor(url: string): string {
  const fingerprint = createHash('sha256').update(url).digest('hex').slice(0, 6)
  try {
    return `${new URL(url.replace(/^webcal:/, 'https:')).hostname} (${fingerprint})`
  } catch {
    return fingerprint
  }
}
