import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Meeting prep: which earlier meetings count as "last time", what is still
 * open from them, and the notification before the next one.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./meetingPrep.ts')
let dbm: typeof import('../db/index.ts')

before(async () => {
  h = await createTestDb('prep')
  process.env.DATABASE_URL = h.url
  dbm = await import('../db/index.ts')
  svc = await import('./meetingPrep.ts')
  me = await seedUser(h.sql, 'prep@test.local')
  other = await seedUser(h.sql, 'someone@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from recurrences`
  await h.sql`update users set prep_prompts = true`
})

/** Thursday 8 October 2026, 9:50. */
const NOW = new Date(2026, 9, 8, 9, 50)
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)

async function add(
  title: string,
  dueAt: Date,
  opts: {
    kind?: string
    status?: string
    from?: string
    waitingOn?: string
    user?: Seeded
    recurrenceId?: string
    contactId?: string
  } = {},
): Promise<string> {
  const who = opts.user ?? me
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments
      (org_id, user_id, title, kind, due_at, duration_minutes, status, from_commitment_id, waiting_on,
       recurrence_id, contact_id)
    values (${who.orgId}, ${who.userId}, ${title}, ${opts.kind ?? 'meeting'}, ${dueAt}, 60,
            ${opts.status ?? 'pending'}, ${opts.from ?? null}, ${opts.waitingOn ?? null},
            ${opts.recurrenceId ?? null}, ${opts.contactId ?? null})
    returning id`
  return row!.id
}

test('last time is the same title, the same series, or the same person', async () => {
  const today = await add('Client review — Northwind', at(8, 10))
  const sameTitle = await add('client review —  Northwind ', at(1, 10), { status: 'done' })
  await add('Budget sync', at(2, 10), { status: 'done' }) // unrelated
  await add('Client review — Northwind', at(15, 10)) // later, not earlier
  await add('Client review — Northwind', at(1, 10), { user: other, status: 'done' }) // someone else's

  const related = await svc.relatedMeetings(me.userId, today)
  assert.deepEqual(related!.map((m) => m.id), [sameTitle])
  assert.equal(await svc.relatedMeetings(other.userId, today), null, 'not theirs to look at')

  // The same series, whatever the title says.
  const [series] = await h.sql<{ id: string }[]>`
    insert into recurrences (org_id, user_id, title, freq, starts_on)
    values (${me.orgId}, ${me.userId}, 'Weekly 1:1', 'weekly', '2026-09-01') returning id`
  const thisWeek = await add('1:1 with Ananya', at(8, 15), { recurrenceId: series!.id })
  const lastWeek = await add('1:1 (moved)', at(1, 15), { recurrenceId: series!.id, status: 'done' })
  assert.deepEqual((await svc.relatedMeetings(me.userId, thisWeek))!.map((m) => m.id), [lastWeek])

  // The same person, whatever the title says.
  const [contact] = await h.sql<{ id: string }[]>`
    insert into contacts (org_id, name) values (${me.orgId}, 'Ravi Kumar') returning id`
  const withRavi = await add('Contract call', at(8, 16), { contactId: contact!.id })
  const lastWithRavi = await add('Quick sync', at(5, 11), { contactId: contact!.id, status: 'done' })
  assert.deepEqual((await svc.relatedMeetings(me.userId, withRavi))!.map((m) => m.id), [lastWithRavi])
})

test('a meeting counts what is still open from every earlier one like it', async () => {
  const today = await add('Client review — Northwind', at(8, 10))
  const lastWeek = await add('Client review — Northwind', at(1, 10), { status: 'done' })
  const before = await add('Client review — Northwind', at(24 - 30, 10), { status: 'done' }) // September
  await add('Send the revised proposal', at(2, 10), { kind: 'task', from: lastWeek })
  await add('Waiting on Ravi: signed contract', at(9, 10), { kind: 'followup', from: lastWeek, waitingOn: 'Ravi' })
  await add('Share the pricing sheet', at(2, 12), { kind: 'task', from: lastWeek, status: 'done' })
  await add('Intro to their CFO', at(1, 9), { kind: 'task', from: before })

  const c = dbm.schema.commitments
  const [row] = await dbm.db.select({ open: svc.prepOpenCount() }).from(c).where(eq(c.id, today))
  assert.equal(Number(row!.open), 3, 'two from last week and one from before; the done one is not open')

  const [task] = await dbm.db
    .select({ open: svc.prepOpenCount() })
    .from(c)
    .where(eq(c.title, 'Send the revised proposal'))
  assert.equal(Number(task!.open), 0, 'only meetings have prep')
})

test('a notification goes once, shortly before, and only with something open', async () => {
  const soon = await add('Client review — Northwind', at(8, 10, 0)) // in 10 minutes
  const last = await add('Client review — Northwind', at(1, 10), { status: 'done' })
  await add('Waiting on Ravi: signed contract', at(9, 10), { kind: 'followup', from: last, waitingOn: 'Ravi' })
  await add('Budget sync', at(8, 10, 5)) // also soon, but nothing open from before
  await add('Client review — Northwind', at(8, 15)) // later today: too early to say

  assert.equal(await svc.promptPrep(NOW), 1)
  const asked = await h.sql<{ id: string }[]>`select id from commitments where prep_prompted_at is not null`
  assert.deepEqual(asked.map((r) => r.id), [soon])
  assert.equal(await svc.promptPrep(NOW), 0, 'never twice')

  await h.sql`update commitments set prep_prompted_at = null`
  await h.sql`update users set prep_prompts = false`
  assert.equal(await svc.promptPrep(NOW), 0, 'switched off')
})
