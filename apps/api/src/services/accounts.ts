import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { AccountStage } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { keepInTouch, lastTouches } from './keepInTouch.ts'
import { matchersFor, peopleOf, relevantRows, wordRe } from './people.ts'

/**
 * Accounts: a clinic or company, and everything between you and the people
 * there.
 *
 * An account is not created; it is whatever people's "Works at" names. Plans
 * belong to it through those people, the same way they belong to a person,
 * or by naming the place itself ("Demo at Mehta Physio Clinic", "Waiting on
 * Mehta Physio Clinic: payment"). The accounts table only adds what is said
 * about the place: its stage and notes.
 */

const DAY_MS = 86_400_000
/** Talks or a proposal with no contact for this long have gone quiet. */
export const QUIET_DAYS = 14
const ACTIVE: AccountStage[] = ['talking', 'proposal']

/** One spelling for comparing: no case, no extra spaces. */
export function accountKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export interface Account {
  key: string
  name: string
  stage: AccountStage | null
  stageChangedAt: Date | null
  notes: string | null
  people: { id: string; name: string; role: string | null; phone: string | null; reachOut: boolean }[]
  /** Commitment ids, soonest first. */
  waiting: string[]
  waitingDue: number
  owe: string[]
  nextMeetings: string[]
  /** Meetings that have happened, newest first. */
  pastMeetings: string[]
  lastContact: Date | null
  /** People there it has been too long with. */
  reachOut: number
  /** In talks or a proposal out, and no contact or stage change for QUIET_DAYS. */
  quiet: boolean
}

export async function listAccounts(orgId: string, userId: string, now = new Date()): Promise<Account[]> {
  const ct = schema.contacts
  const [members, saved, people, rows, touchList] = await Promise.all([
    db
      .select({ id: ct.id, name: ct.name, role: ct.role, phone: ct.phone, organization: ct.organization })
      .from(ct)
      .where(and(eq(ct.orgId, orgId), isNotNull(ct.organization)))
      .orderBy(ct.name),
    db.select().from(schema.accounts).where(eq(schema.accounts.orgId, orgId)),
    peopleOf(orgId),
    relevantRows(userId, now),
    keepInTouch(orgId, userId, now),
  ])

  const groups = new Map<string, { name: string; members: typeof members; row?: (typeof saved)[number] }>()
  const group = (name: string) => {
    const key = accountKey(name)
    if (!groups.has(key)) groups.set(key, { name: name.trim().replace(/\s+/g, ' '), members: [] })
    return groups.get(key)!
  }
  for (const m of members) if (m.organization?.trim()) group(m.organization).members.push(m)
  for (const a of saved) {
    const g = group(a.name)
    g.row = a
    g.name = a.name
  }

  const matchers = matchersFor(people)
  const touches = await lastTouches(orgId, userId, members.map((m) => m.id), now)
  const due = new Set(touchList.filter((t) => t.due).map((t) => t.id))

  const out: Account[] = []
  for (const [key, g] of groups) {
    const ids = new Set(g.members.map((m) => m.id))
    const ms = g.members.map((m) => matchers.get(m.id)).filter((m) => m !== undefined)
    // A short name like "ABC" is too likely to turn up inside other words'
    // company; the place is only recognised in a title from four letters.
    const named = key.length >= 4 ? wordRe(key) : null
    // Named in the title, or where it is: "Demo" at "Mehta Physio Clinic".
    const mentions = (r: { title: string; placeLabel: string | null }) =>
      (named?.test(r.title) ?? false) ||
      (r.placeLabel !== null && (named?.test(r.placeLabel) ?? false)) ||
      ms.some((m) => m.inTitle(r.title))

    const meetings = rows.filter(
      (r) => r.kind === 'meeting' && r.status !== 'cancelled' && (ids.has(r.contactId ?? '') || mentions(r)),
    )
    const meetingIds = new Set(meetings.map((r) => r.id))
    const past = meetings.filter((r) => r.dueAt < now).sort((a, b) => +b.dueAt - +a.dueAt)
    const ahead = meetings
      .filter((r) => r.dueAt >= now && r.status === 'pending')
      .sort((a, b) => +a.dueAt - +b.dueAt)

    const pending = rows.filter((r) => r.status === 'pending' && r.kind !== 'meeting' && r.kind !== 'focus')
    const waiting = pending
      .filter((r) => r.waitingOn && (accountKey(r.waitingOn) === key || ms.some((m) => m.isName(r.waitingOn))))
      .sort((a, b) => +a.dueAt - +b.dueAt)
    const owe = pending
      .filter(
        (r) =>
          !r.waitingOn &&
          (ids.has(r.contactId ?? '') ||
            (r.fromCommitmentId !== null && meetingIds.has(r.fromCommitmentId)) ||
            mentions(r)),
      )
      .sort((a, b) => +a.dueAt - +b.dueAt)

    const contactTimes = [
      ...g.members.map((m) => touches.get(m.id)?.getTime() ?? 0),
      past[0]?.dueAt.getTime() ?? 0,
    ].filter((t) => t > 0)
    const lastContact = contactTimes.length ? new Date(Math.max(...contactTimes)) : null
    const stage = (g.row?.stage as AccountStage | null) ?? null
    // Moving the stage on counts as activity: "In talks" set today is not
    // already going cold for want of a meeting on record.
    const lastActivity = Math.max(lastContact?.getTime() ?? 0, g.row?.stageChangedAt?.getTime() ?? 0)
    const quiet =
      stage !== null && ACTIVE.includes(stage) && now.getTime() - lastActivity > QUIET_DAYS * DAY_MS

    out.push({
      key,
      name: g.name,
      stage,
      stageChangedAt: g.row?.stageChangedAt ?? null,
      notes: g.row?.notes ?? null,
      people: g.members.map((m) => ({ id: m.id, name: m.name, role: m.role, phone: m.phone, reachOut: due.has(m.id) })),
      waiting: waiting.map((r) => r.id),
      waitingDue: waiting.filter((r) => r.dueAt <= now).length,
      owe: owe.map((r) => r.id),
      nextMeetings: ahead.slice(0, 3).map((r) => r.id),
      pastMeetings: past.slice(0, 6).map((r) => r.id),
      lastContact,
      reachOut: g.members.filter((m) => due.has(m.id)).length,
      quiet,
    })
  }

  // What needs you first, then what is coming, then the rest by name.
  const weight = (a: Account) =>
    (a.quiet || a.waitingDue > 0 || a.reachOut > 0 ? 4 : 0) + (a.nextMeetings.length ? 2 : 0) + (a.owe.length ? 1 : 0)
  return out.sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name))
}

/** Sets an account's stage or notes, creating its row the first time either is said. */
export async function saveAccount(
  orgId: string,
  input: { name: string; stage?: AccountStage | null; notes?: string | null },
): Promise<void> {
  const key = accountKey(input.name)
  const [existing] = await db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.orgId, orgId), sql`lower(regexp_replace(btrim(${schema.accounts.name}), '[[:space:]]+', ' ', 'g')) = ${key}`))
    .limit(1)
  const stageChanged = input.stage !== undefined && input.stage !== (existing?.stage ?? null)
  const values = {
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    ...(stageChanged ? { stageChangedAt: input.stage ? new Date() : null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
  }
  if (existing) {
    if (Object.keys(values).length) {
      await db.update(schema.accounts).set(values).where(eq(schema.accounts.id, existing.id))
    }
    return
  }
  // Named the way the people there already spell it, not however it was
  // typed this time: "mehta physio clinic" should not become the page title.
  const [spelled] = await db
    .select({ name: schema.contacts.organization })
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.orgId, orgId),
        sql`lower(regexp_replace(btrim(${schema.contacts.organization}), '[[:space:]]+', ' ', 'g')) = ${key}`,
      ),
    )
    .limit(1)
  const name = (spelled?.name ?? input.name).trim().replace(/\s+/g, ' ')
  await db.insert(schema.accounts).values({ orgId, name, ...values })
}

/**
 * Renames a clinic or company everywhere: on every person who works there, and
 * on its own record. Renaming onto another account merges the two, keeping
 * what the target already says and filling its gaps from the old one.
 */
export async function renameAccount(orgId: string, from: string, to: string): Promise<void> {
  const fromKey = accountKey(from)
  const toName = to.trim().replace(/\s+/g, ' ')
  const toKey = accountKey(toName)
  const keyOf = (col: typeof schema.contacts.organization | typeof schema.accounts.name) =>
    sql`lower(regexp_replace(btrim(${col}), '[[:space:]]+', ' ', 'g'))`

  await db.transaction(async (tx) => {
    await tx
      .update(schema.contacts)
      .set({ organization: toName })
      .where(and(eq(schema.contacts.orgId, orgId), sql`${keyOf(schema.contacts.organization)} = ${fromKey}`))

    const rows = await tx
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.orgId, orgId), sql`${keyOf(schema.accounts.name)} in (${fromKey}, ${toKey})`))
    const source = rows.find((r) => accountKey(r.name) === fromKey)
    const target = fromKey === toKey ? undefined : rows.find((r) => accountKey(r.name) === toKey)
    if (!source) return
    if (!target) {
      await tx.update(schema.accounts).set({ name: toName }).where(eq(schema.accounts.id, source.id))
      return
    }
    await tx
      .update(schema.accounts)
      .set({
        stage: target.stage ?? source.stage,
        stageChangedAt: target.stage ? target.stageChangedAt : source.stageChangedAt,
        notes: [target.notes, source.notes].filter(Boolean).join('\n\n') || null,
      })
      .where(eq(schema.accounts.id, target.id))
    await tx.delete(schema.accounts).where(eq(schema.accounts.id, source.id))
  })
}
