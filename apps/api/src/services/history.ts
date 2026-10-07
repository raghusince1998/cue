import { sql } from 'drizzle-orm'
import { db } from '../db/index.ts'

/**
 * What actually happened.
 *
 * History read only the visits table — things deliberately logged as "already
 * happened" — so everything *finished* was missing from it. You ticked the
 * dentist off, it sat in "Closed today" until midnight, and then vanished from
 * every screen in the app. A planner whose whole promise is that nothing gets
 * dropped was quietly forgetting the entire record of what you had done.
 *
 * So this is one timeline of four things that are all, in plain terms, "what
 * happened": a visit you logged, a plan you completed, a plan you cancelled,
 * and a plan you took off your list entirely.
 *
 * Cancelled and deleted are kept apart on purpose. A cancelled meeting still
 * exists and is still on Tuesday's calendar with a line through it — seeing it
 * there is how you know the slot is free and why. Deleting is the gesture that
 * means "off my list", and that is the one worth calling "let go", because
 * what somebody keeps abandoning is a pattern and this is the only screen
 * where it can be seen.
 *
 * The tag is whatever you decided last, and the timestamp is the moment you
 * decided it — not the due time. Something ticked off a week late belongs at
 * the top of the timeline, not back where it was scheduled.
 */

export type HistoryKind = 'visit' | 'done' | 'cancelled' | 'deleted'

export interface HistoryEntry {
  kind: HistoryKind
  id: string
  title: string
  /** When it happened, not when the row was written. */
  at: string
  place: string | null
  contact: string | null
  outcome: string | null
  notes: string | null
}

export async function buildHistory(
  orgId: string,
  userId: string,
  limit = 100,
): Promise<HistoryEntry[]> {
  const rows = await db.execute(sql`
    select
      'visit' as kind,
      v.id::text as id,
      coalesce(p.name, ct.name, v.contact_name, 'Visit') as title,
      v.started_at as at,
      p.name as place,
      coalesce(ct.name, v.contact_name) as contact,
      v.outcome as outcome,
      v.notes as notes
    from interactions v
    left join places p on p.id = v.place_id
    left join contacts ct on ct.id = v.contact_id
    where v.user_id = ${userId}

    union all

    select
      c.status,
      c.id::text,
      c.title,
      -- Last decision wins, in both the tag and the time. The fallback to
      -- due_at only catches rows cancelled before those columns existed; a
      -- null here would sort as the newest row and lose the entry entirely.
      --
      -- Clamped, because that fallback is the one value that can be in the
      -- future: cancelling next week's dentist filed it under "what happened"
      -- dated next week, which read as "in 1 week" in a list of the past.
      -- The recorded moments never need this — they are always already past.
      coalesce(c.deleted_at, c.cancelled_at, c.completed_at, least(c.due_at, now())),
      coalesce(p.name, c.place_label),
      ct.name,
      null,
      c.notes
    from commitments c
    left join places p on p.id = c.place_id
    left join contacts ct on ct.id = c.contact_id
    where c.user_id = ${userId}
      and c.status in ('done', 'cancelled', 'deleted')

    order by at desc
    limit ${limit}
  `)

  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    kind: r.kind as HistoryKind,
    id: String(r.id),
    title: String(r.title ?? ''),
    at: new Date(r.at as string | Date).toISOString(),
    place: (r.place as string | null) ?? null,
    contact: (r.contact as string | null) ?? null,
    outcome: (r.outcome as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  }))
}

/**
 * Remove one entry from History, permanently.
 *
 * Not the ordinary delete. That one is soft on purpose — deleting a plan moves
 * it here as "let go" — so calling it on something already in History would
 * just relabel a Done entry rather than remove it. This is the step after that:
 * somebody looking at their own record and deciding a line should not be on
 * it at all.
 *
 * Narrow by design. It only touches a row whose status matches the kind it was
 * shown as, so this route can never reach a plan that is still pending — that
 * goes through the ordinary delete, which keeps the record. And it is scoped to
 * the person's own rows, so a guessed id from someone else's history finds
 * nothing.
 */
export async function forgetHistoryEntry(
  userId: string,
  kind: HistoryKind,
  id: string,
): Promise<boolean> {
  if (kind === 'visit') {
    const rows = await db.execute(sql`
      delete from interactions
       where id = ${id} and user_id = ${userId}
      returning id`)
    return (rows as unknown as unknown[]).length > 0
  }

  // done, cancelled, deleted — the three statuses History shows.
  const rows = await db.execute(sql`
    delete from commitments
     where id = ${id} and user_id = ${userId} and status = ${kind}
    returning id`)
  return (rows as unknown as unknown[]).length > 0
}
