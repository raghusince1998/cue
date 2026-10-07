import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * What happened, and — more importantly — what did not.
 *
 * The bug this replaces was a silent one: finishing something made it vanish.
 * So the weight here is on the two ways a timeline lies. It can forget a thing
 * that happened (a completed plan missing), or it can claim a thing that did
 * not (an open plan, or somebody else's day, shown as history).
 */
let h: Harness
let me: Seeded
let other: Seeded
let history: typeof import('./history.ts')

before(async () => {
  h = await createTestDb('history')
  process.env.DATABASE_URL = h.url
  history = await import('./history.ts')
  me = await seedUser(h.sql, 'history@test.local')
  other = await seedUser(h.sql, 'notme@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from interactions`
  await h.sql`delete from contacts`
  await h.sql`delete from places`
})

async function plan(
  title: string,
  opts: {
    status?: string
    dueAt?: string
    completedAt?: string | null
    cancelledAt?: string | null
    deletedAt?: string | null
    notes?: string | null
    placeLabel?: string | null
    user?: Seeded
  } = {},
) {
  const user = opts.user ?? me
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, status,
                             completed_at, cancelled_at, deleted_at, notes, place_label)
    values (${user.orgId}, ${user.userId}, ${title}, ${opts.dueAt ?? '2026-09-20T10:00:00Z'},
            ${opts.status ?? 'done'}, ${opts.completedAt ?? null},
            ${opts.cancelledAt ?? null}, ${opts.deletedAt ?? null},
            ${opts.notes ?? null}, ${opts.placeLabel ?? null})`
}

async function visit(
  startedAt: string,
  opts: { contactName?: string; outcome?: string | null; user?: Seeded } = {},
) {
  const user = opts.user ?? me
  await h.sql`
    insert into interactions (org_id, user_id, contact_name, outcome, started_at)
    values (${user.orgId}, ${user.userId}, ${opts.contactName ?? 'Someone'},
            ${opts.outcome ?? null}, ${startedAt})`
}

const titles = (rows: { title: string }[]) => rows.map((r) => r.title)

test('a logged visit is history', async () => {
  await visit('2026-09-20T10:00:00Z', { contactName: 'Suresh Kumar' })
  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.deepEqual(titles(rows), ['Suresh Kumar'])
  assert.equal(rows[0]!.kind, 'visit')
})

test('finishing a plan puts it in history — the whole point of this file', async () => {
  await plan('Dentist', { status: 'done', completedAt: '2026-09-21T09:00:00Z' })
  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.deepEqual(titles(rows), ['Dentist'])
  assert.equal(rows[0]!.kind, 'done')
})

test('a cancelled plan reads as cancelled, not as let go', async () => {
  // These are different decisions. Cancelled means the thing still exists and
  // is still on its day with a line through it; let go means off the list.
  await plan('Rewire the shed', { status: 'cancelled', cancelledAt: '2026-09-21T09:00:00Z' })
  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.deepEqual(titles(rows), ['Rewire the shed'])
  assert.equal(rows[0]!.kind, 'cancelled')
})

test('a deleted plan is what "let go" means', async () => {
  await plan('Learn the sitar', { status: 'deleted', deletedAt: '2026-09-21T09:00:00Z' })
  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.deepEqual(titles(rows), ['Learn the sitar'])
  assert.equal(rows[0]!.kind, 'deleted')
})

test('deleting is soft — the record outlives the list entry', async () => {
  // The point of the whole change: a delete that destroyed the row made this
  // the one action in the app that could never be looked back on.
  await plan('Abandoned project', {
    status: 'deleted',
    deletedAt: '2026-09-21T09:00:00Z',
    placeLabel: 'Pune',
    notes: 'Never started',
  })
  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.equal(rows[0]!.place, 'Pune')
  assert.equal(rows[0]!.notes, 'Never started')
})

test('the last decision wins when something was cancelled and then deleted', async () => {
  await plan('Changed my mind twice', {
    status: 'deleted',
    cancelledAt: '2026-09-20T09:00:00Z',
    deletedAt: '2026-09-24T09:00:00Z',
  })
  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.equal(rows[0]!.kind, 'deleted')
  assert.equal(new Date(rows[0]!.at).toISOString(), '2026-09-24T09:00:00.000Z')
})

test('a cancellation sits at the moment it was cancelled, not its due time', async () => {
  // Otherwise cancelling next Tuesday's dentist today files it in the future,
  // and "what happened" containing next Tuesday is nonsense.
  await plan('Future dentist', {
    dueAt: '2026-12-25T10:00:00Z',
    status: 'cancelled',
    cancelledAt: '2026-09-21T09:00:00Z',
  })
  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.equal(new Date(rows[0]!.at).toISOString(), '2026-09-21T09:00:00.000Z')
})

test('a plan still waiting is not history', async () => {
  await plan('Call the plumber', { status: 'pending' })
  await plan('Chase the invoice', { status: 'snoozed' })
  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.deepEqual(titles(rows), [])
})

test('another account never appears, however it ended', async () => {
  await plan('Their dentist', { status: 'done', completedAt: '2026-09-21T09:00:00Z', user: other })
  await plan('Their cancelled thing', { status: 'cancelled', user: other })
  await plan('Their deleted thing', { status: 'deleted', deletedAt: '2026-09-21T09:00:00Z', user: other })
  await visit('2026-09-22T10:00:00Z', { contactName: 'Their contact', user: other })

  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.deepEqual(titles(rows), [])
})

test('visits and finished plans interleave by when they happened', async () => {
  await visit('2026-09-22T10:00:00Z', { contactName: 'Tuesday visit' })
  await plan('Finished Wednesday', { status: 'done', completedAt: '2026-09-23T09:00:00Z' })
  await visit('2026-09-21T10:00:00Z', { contactName: 'Monday visit' })

  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.deepEqual(titles(rows), ['Finished Wednesday', 'Tuesday visit', 'Monday visit'])
})

test('a finished plan sits at the time it was finished, not when it was due', async () => {
  // Ticked off a week late. It belongs at the top of the timeline, not back
  // where it was originally scheduled.
  await plan('Late tax filing', {
    dueAt: '2026-09-01T10:00:00Z',
    status: 'done',
    completedAt: '2026-09-25T18:00:00Z',
  })
  await visit('2026-09-10T10:00:00Z', { contactName: 'In between' })

  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.deepEqual(titles(rows), ['Late tax filing', 'In between'])
})

test('nothing is ever filed in the future', async () => {
  // A row cancelled with no recorded moment falls back to its due time, and
  // that is the one value that can still be ahead of now. "What happened"
  // listing next Tuesday, dated "in 1 week", is nonsense.
  await plan('Cancelled next year', { dueAt: '2027-12-25T10:00:00Z', status: 'cancelled' })
  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.equal(rows.length, 1)

  // Compared with a minute of slack rather than against Date.now() directly.
  // The clamp uses Postgres's clock and the assertion reads Node's, and those
  // two are not the same clock — a millisecond of drift between them failed
  // this test while the behaviour it describes was perfectly correct.
  const ahead = new Date(rows[0]!.at).getTime() - Date.now()
  assert.ok(ahead < 60_000, `filed ${Math.round(ahead / 86_400_000)} days ahead of now`)
})

test('a row with no recorded moment falls back to when it was meant to happen', async () => {
  // Cancelled before those columns existed, so every moment is null. Without
  // the fallback it sorts as null and the row is effectively lost twice.
  await plan('Abandoned', { dueAt: '2026-09-15T10:00:00Z', status: 'cancelled' })
  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.equal(rows.length, 1)
  assert.equal(new Date(rows[0]!.at).toISOString(), '2026-09-15T10:00:00.000Z')
})

test('where and what was said come along', async () => {
  await plan('Site review', {
    status: 'done',
    completedAt: '2026-09-21T09:00:00Z',
    placeLabel: 'Chakan Plant',
    notes: 'Signed off',
  })
  await visit('2026-09-20T10:00:00Z', { contactName: 'Amma', outcome: 'Went well' })

  const rows = await history.buildHistory(me.orgId, me.userId)
  assert.equal(rows[0]!.place, 'Chakan Plant')
  assert.equal(rows[0]!.notes, 'Signed off')
  assert.equal(rows[1]!.contact, 'Amma')
  assert.equal(rows[1]!.outcome, 'Went well')
})

test('the limit cuts the oldest, not the newest', async () => {
  for (let day = 1; day <= 5; day++) {
    await visit(`2026-09-0${day}T10:00:00Z`, { contactName: `Day ${day}` })
  }
  const rows = await history.buildHistory(me.orgId, me.userId, 2)
  assert.deepEqual(titles(rows), ['Day 5', 'Day 4'])
})

/**
 * Removing a line from History.
 *
 * What matters is what it refuses: a plan that is still pending, somebody
 * else's entry, and an entry of one kind addressed as another. Each of those
 * would be a delete reaching further than the person meant.
 */
async function idOf(title: string): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`select id from commitments where title = ${title}`
  return row!.id
}

test('a finished plan can be removed from History for good', async () => {
  await plan('Dentist', { status: 'done', completedAt: '2026-09-21T09:00:00Z' })
  const id = await idOf('Dentist')

  assert.equal(await history.forgetHistoryEntry(me.userId, 'done', id), true)
  assert.deepEqual(titles(await history.buildHistory(me.orgId, me.userId)), [])
  const [row] = await h.sql`select id from commitments where id = ${id}`
  assert.equal(row, undefined, 'gone from the table, not relabelled')
})

test('a cancelled and a let-go plan can each be removed', async () => {
  await plan('Called off', { status: 'cancelled', cancelledAt: '2026-09-21T09:00:00Z' })
  await plan('Abandoned', { status: 'deleted', deletedAt: '2026-09-22T09:00:00Z' })

  assert.equal(await history.forgetHistoryEntry(me.userId, 'cancelled', await idOf('Called off')), true)
  assert.equal(await history.forgetHistoryEntry(me.userId, 'deleted', await idOf('Abandoned')), true)
  assert.deepEqual(titles(await history.buildHistory(me.orgId, me.userId)), [])
})

test('a logged visit can be removed', async () => {
  await visit('2026-09-20T10:00:00Z', { contactName: 'Suresh Kumar' })
  const [v] = await h.sql<{ id: string }[]>`select id from interactions limit 1`

  assert.equal(await history.forgetHistoryEntry(me.userId, 'visit', v!.id), true)
  assert.deepEqual(titles(await history.buildHistory(me.orgId, me.userId)), [])
})

test('a plan that is still pending cannot be reached this way', async () => {
  // The ordinary delete keeps the record. This route must never become a way
  // round that for something not yet finished.
  await plan('Still to do', { status: 'pending' })
  const id = await idOf('Still to do')

  for (const kind of ['done', 'cancelled', 'deleted'] as const) {
    assert.equal(await history.forgetHistoryEntry(me.userId, kind, id), false)
  }
  const [row] = await h.sql`select id from commitments where id = ${id}`
  assert.ok(row, 'still there')
})

test('the kind has to match what it was shown as', async () => {
  // A Done entry addressed as "cancelled" is a mismatch between what was on
  // screen and what is in the table. Refusing is safer than guessing.
  await plan('Dentist', { status: 'done', completedAt: '2026-09-21T09:00:00Z' })
  assert.equal(await history.forgetHistoryEntry(me.userId, 'cancelled', await idOf('Dentist')), false)
})

test("someone else's History is out of reach", async () => {
  await plan('Their dentist', { status: 'done', completedAt: '2026-09-21T09:00:00Z', user: other })
  await visit('2026-09-20T10:00:00Z', { contactName: 'Their visit', user: other })
  const theirPlan = await idOf('Their dentist')
  const [theirVisit] = await h.sql<{ id: string }[]>`select id from interactions limit 1`

  assert.equal(await history.forgetHistoryEntry(me.userId, 'done', theirPlan), false)
  assert.equal(await history.forgetHistoryEntry(me.userId, 'visit', theirVisit!.id), false)
  assert.equal(titles(await history.buildHistory(other.orgId, other.userId)).length, 2, 'both survive')
})
