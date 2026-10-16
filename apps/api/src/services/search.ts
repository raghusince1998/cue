import { sql } from 'drizzle-orm'
import { db } from '../db/index.ts'

/**
 * Finding anything, by any of the words attached to it.
 *
 * Everything the app knows was write-only: months of commitments, visits,
 * trips and the notes attached to them, and no way back in except scrolling.
 * "What did I agree with Ramesh?" was unanswerable with the data sitting
 * right there.
 *
 * One query across every table that holds words, because the person asking
 * does not know or care which table their answer is in. Plain ILIKE rather
 * than full-text search: it needs no extension, no index maintenance and no
 * stemming surprises, and at the scale of one person's calendar the difference
 * is unmeasurable. If that stops being true, pg_trgm is the next step and this
 * is the only file that changes.
 */

export type SearchKind =
  | 'commitment'
  | 'trip'
  | 'intention'
  | 'contact'
  | 'place'
  | 'recurrence'
  | 'visit'

export interface SearchHit {
  kind: SearchKind
  id: string
  title: string
  /** Where it sits in time, when it has a position. */
  when: string | null
  /** The matching context, so a hit explains itself. */
  detail: string | null
  /** Where tapping it goes. */
  href: string
  /** Higher sorts first. */
  score: number
}

/** Rejects a query too short to be meaningful; "a" matches everything. */
const MIN_LENGTH = 2
const PER_KIND = 8

/**
 * How well a row matched, so an exact name beats a word buried in a note.
 *
 * Done in SQL rather than afterwards because the ordering has to survive the
 * per-table limit — ranking only what came back would mean the best hit was
 * sometimes cut before it was ever seen.
 */
function rank(column: ReturnType<typeof sql>, needle: string) {
  return sql<number>`
    case
      when lower(${column}) = lower(${needle}) then 100
      when lower(${column}) like lower(${needle + '%'}) then 70
      when lower(${column}) like lower(${'%' + needle + '%'}) then 40
      else 0
    end`
}

export async function searchEverything(
  orgId: string,
  userId: string,
  query: string,
): Promise<{ hits: SearchHit[]; truncated: boolean }> {
  const q = query.trim()
  if (q.length < MIN_LENGTH) return { hits: [], truncated: false }

  const like = `%${q}%`

  // One round trip. Each branch keeps its own shape and they are unioned as
  // text, because the alternative is seven sequential queries for a box that
  // runs on every keystroke.
  const rows = await db.execute(sql`
    with hits as (
      select 'commitment' as kind, c.id::text as id, c.title as title,
             c.due_at::text as when_at,
             coalesce(c.place_label, c.notes) as detail,
             greatest(${rank(sql`c.title`, q)}, ${rank(sql`c.notes`, q)},
                      ${rank(sql`c.place_label`, q)}) as score
      -- A repeating plan once, not every day of it: its next one, or else its latest.
      from (
        select distinct on (coalesce(m.recurrence_id::text, m.id::text)) m.*
        from commitments m
        where m.user_id = ${userId}
          and m.status <> 'deleted'
          and (m.title ilike ${like} or m.notes ilike ${like} or m.place_label ilike ${like})
        order by coalesce(m.recurrence_id::text, m.id::text),
                 (m.due_at < now()),
                 case when m.due_at >= now() then m.due_at end asc,
                 m.due_at desc
      ) c

      union all
      select 'trip', t.id::text, t.place_label,
             t.starts_on::text,
             t.starts_on::text || ' to ' || t.ends_on::text,
             greatest(${rank(sql`t.place_label`, q)}, ${rank(sql`t.notes`, q)})
      from trips t
      where t.user_id = ${userId}
        and (t.place_label ilike ${like} or t.notes ilike ${like})

      union all
      select 'intention', i.id::text, i.title, null,
             'saved for ' || i.place_label,
             greatest(${rank(sql`i.title`, q)}, ${rank(sql`i.place_label`, q)},
                      ${rank(sql`i.notes`, q)})
      from intentions i
      where i.user_id = ${userId}
        and (i.title ilike ${like} or i.place_label ilike ${like} or i.notes ilike ${like})

      union all
      select 'contact', ct.id::text, ct.name, null,
             concat_ws(' · ', ct.role, ct.organization, ct.phone),
             greatest(${rank(sql`ct.name`, q)}, ${rank(sql`ct.role`, q)},
                      ${rank(sql`ct.organization`, q)},
                      ${rank(sql`ct.phone`, q)}, ${rank(sql`ct.notes`, q)})
      from contacts ct
      where ct.org_id = ${orgId}
        and (ct.name ilike ${like} or ct.role ilike ${like} or ct.organization ilike ${like}
             or ct.phone ilike ${like} or ct.notes ilike ${like})

      union all
      select 'place', p.id::text, p.name, null, p.address,
             greatest(${rank(sql`p.name`, q)}, ${rank(sql`p.address`, q)},
                      ${rank(sql`p.category`, q)})
      from places p
      where p.org_id = ${orgId}
        and (p.name ilike ${like} or p.address ilike ${like} or p.category ilike ${like})

      union all
      select 'recurrence', r.id::text, r.title, null, r.freq,
             greatest(${rank(sql`r.title`, q)}, ${rank(sql`r.notes`, q)})
      from recurrences r
      where r.user_id = ${userId}
        and (r.title ilike ${like} or r.notes ilike ${like})

      union all
      select 'visit', v.id::text,
             coalesce(v.contact_name, 'Visit'),
             v.started_at::text,
             coalesce(v.outcome, v.notes),
             greatest(${rank(sql`v.notes`, q)}, ${rank(sql`v.contact_name`, q)},
                      ${rank(sql`v.outcome`, q)})
      from interactions v
      where v.user_id = ${userId}
        and (v.notes ilike ${like} or v.contact_name ilike ${like} or v.outcome ilike ${like})
    ),
    ranked as (
      -- Equally good matches: the one nearest today first, coming or gone.
      select *, abs(extract(epoch from (when_at::timestamptz - now()))) as distance,
             row_number() over (
               partition by kind
               order by score desc, abs(extract(epoch from (when_at::timestamptz - now()))) asc nulls last
             ) as rn
      from hits
    )
    select kind, id, title, when_at, detail, score from ranked
    where rn <= ${PER_KIND}
    order by score desc, distance asc nulls last
    limit 60
  `)

  const HREF: Record<SearchKind, (id: string) => string> = {
    commitment: (id) => `/?edit=${id}`,
    trip: (id) => `/trips?trip=${id}`,
    intention: () => '/trips',
    contact: () => '/people',
    place: (id) => `/places?place=${id}`,
    recurrence: (id) => `/repeating?series=${id}`,
    visit: () => '/history',
  }

  const hits = (rows as unknown as Record<string, unknown>[]).map((r) => {
    const kind = r.kind as SearchKind
    return {
      kind,
      id: String(r.id),
      title: String(r.title ?? ''),
      when: r.when_at ? String(r.when_at) : null,
      detail: r.detail ? String(r.detail) : null,
      href: HREF[kind](String(r.id)),
      score: Number(r.score ?? 0),
    }
  })

  return { hits, truncated: hits.length >= 60 }
}
