import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { langsOf, t } from '../i18n.ts'
import { sendToUser } from '../push.ts'
import { managedByCue } from './overdue.ts'

/**
 * Meeting prep: what is still open from last time.
 *
 * A follow-up remembers the meeting it came out of. "Last time" is any
 * earlier meeting of the same person's that is plainly the same conversation:
 * the same repeating series, the same contact, or the same title (ignoring
 * case and spacing). What is still open from those is what should be raised
 * in this one — before it starts, not remembered after it ends.
 */

const c = schema.commitments

/**
 * SQL: the earlier meetings related to the commitments row in scope.
 *
 * Inside, the earlier meetings are aliased `m`, so the unqualified-by-alias
 * "commitments" columns interpolated here refer to the outer row — the
 * meeting being prepared for.
 */
function relatedEarlierMeetings() {
  return sql`(
    select m.id from commitments m
    where m.user_id = ${c.userId}
      and m.id <> ${c.id}
      and m.kind = 'meeting'
      and m.due_at < ${c.dueAt}
      and (
        (${c.recurrenceId} is not null and m.recurrence_id = ${c.recurrenceId})
        or (${c.contactId} is not null and m.contact_id = ${c.contactId})
        or lower(regexp_replace(btrim(m.title), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(${c.title}), '[[:space:]]+', ' ', 'g'))
      )
  )`
}

/** SQL: for a meeting, how many follow-ups from earlier related meetings are still open. */
export function prepOpenCount() {
  return sql<number>`(case when ${c.kind} = 'meeting' then (
    select count(*)::int from commitments f
    where f.status = 'pending' and f.from_commitment_id in ${relatedEarlierMeetings()}
  ) else 0 end)`
}

export interface RelatedMeeting {
  id: string
  title: string
  dueAt: Date
}

/**
 * The earlier related meetings, most recent first; null when the meeting is
 * not this person's (or does not exist).
 */
export async function relatedMeetings(
  userId: string,
  meetingId: string,
): Promise<RelatedMeeting[] | null> {
  const [self] = (await db.execute(sql`
    select id from commitments where id = ${meetingId} and user_id = ${userId}
  `)) as unknown as { id: string }[]
  if (!self) return null

  const rows = (await db.execute(sql`
    select m.id, m.title, m.due_at
    from commitments m, commitments x
    where x.id = ${meetingId}
      and m.user_id = x.user_id
      and m.id <> x.id
      and m.kind = 'meeting'
      and m.due_at < x.due_at
      and (
        (x.recurrence_id is not null and m.recurrence_id = x.recurrence_id)
        or (x.contact_id is not null and m.contact_id = x.contact_id)
        or lower(regexp_replace(btrim(m.title), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(x.title), '[[:space:]]+', ' ', 'g'))
      )
    order by m.due_at desc
    limit 50
  `)) as unknown as { id: string; title: string; due_at: Date | string }[]

  return rows.map((r) => ({ id: r.id, title: r.title, dueAt: new Date(r.due_at) }))
}

/** How far ahead of a meeting the notification goes. */
const LEAD_MINUTES = 15

interface Upcoming {
  id: string
  user_id: string
  title: string
  due_at: Date | string
  open: number
}

function minutesUntil(when: Date, now: Date): number {
  return Math.max(1, Math.round((when.getTime() - now.getTime()) / 60_000))
}

/**
 * One pass: a notification for each meeting starting in the next quarter of
 * an hour that has something still open from last time. Marked before
 * sending, so it goes once.
 */
export async function promptPrep(now = new Date()): Promise<number> {
  const at = now.toISOString()
  const until = new Date(now.getTime() + LEAD_MINUTES * 60_000).toISOString()
  const rows = (await db.execute(sql`
    update commitments set prep_prompted_at = ${at}::timestamptz
    where id in (
      select ${c.id} from commitments
      join users u on u.id = ${c.userId}
      where u.prep_prompts
        and ${c.status} = 'pending'
        and ${c.kind} = 'meeting'
        and not ${c.allDay}
        and ${c.prepPromptedAt} is null
        and ${managedByCue()}
        and ${c.dueAt} > ${at}::timestamptz
        and ${c.dueAt} <= ${until}::timestamptz
        and ${prepOpenCount()} > 0
      for update of commitments skip locked
    )
    returning id, user_id, title, due_at
  `)) as unknown as Omit<Upcoming, 'open'>[]

  let sent = 0
  const langs = await langsOf(rows.map((r) => r.user_id))
  for (const row of rows) {
    try {
      const lang = langs.get(row.user_id) ?? 'en'
      const related = await relatedMeetings(row.user_id, row.id)
      const ids = (related ?? []).map((m) => m.id)
      const open = ids.length
        ? await db
            .select({ title: c.title, waitingOn: c.waitingOn })
            .from(c)
            .where(and(eq(c.status, 'pending'), inArray(c.fromCommitmentId, ids)))
            .orderBy(asc(c.dueAt))
        : []
      if (open.length === 0) continue

      const named = open.slice(0, 2).map((o) =>
        o.waitingOn ? `${o.title.replace(/^Waiting on [^:]+:\s*/i, '')} (${o.waitingOn})` : o.title,
      )
      const list = named.join('; ')
      await sendToUser(row.user_id, {
        title: t(lang, '{title} in {n} min', { title: row.title, n: minutesUntil(new Date(row.due_at), now) }),
        body:
          open.length > 2
            ? t(lang, '{n} open from last time: {list} and {more} more.', { n: open.length, list, more: open.length - 2 })
            : t(lang, '{n} open from last time: {list}.', { n: open.length, list }),
        tag: `prep-${row.id}`,
        url: `/?prep=${row.id}`,
        lang,
      })
      sent += 1
    } catch (err) {
      console.error('[prep] could not send for', row.id, (err as Error).message)
    }
  }
  return sent
}

export function startPrepWorker(intervalMs = 2 * 60_000) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const n = await promptPrep()
      if (n > 0) console.log(`[prep] sent ${n} meeting prep notification(s)`)
    } catch (err) {
      console.error('[prep] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  void run()
  const handle = setInterval(run, intervalMs)
  console.log(`[prep] meeting prep checking every ${intervalMs / 60_000} min`)
  return () => clearInterval(handle)
}
