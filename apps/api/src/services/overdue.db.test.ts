import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * What can be overdue, and what is calendar history.
 *
 * Connecting a calendar brings in its past. Cue was not there for it, so it
 * cannot say whether any of it happened: it is neither done nor overdue. From
 * the moment the calendar is connected, its events are managed like anything
 * else — except all-day entries, which are context (a holiday), not tasks.
 */
let h: Harness
let me: Seeded
let dbm: typeof import('../db/index.ts')
let rules: typeof import('./overdue.ts')

before(async () => {
  h = await createTestDb('overdue')
  process.env.DATABASE_URL = h.url
  dbm = await import('../db/index.ts')
  rules = await import('./overdue.ts')
  me = await seedUser(h.sql, 'overdue@test.local')
})

after(async () => {
  await h.close()
})

/** Connected on Monday 5 October 2026, at three in the afternoon. */
const CONNECTED = new Date(2026, 9, 5, 15, 0)

test('calendar history has no status; what came after connecting is managed', async () => {
  const [feed] = await h.sql<{ id: string }[]>`
    insert into calendar_feeds (org_id, user_id, label, source, created_at)
    values (${me.orgId}, ${me.userId}, 'Work', 'google', ${CONNECTED}) returning id`

  const add = async (title: string, dueAt: Date, opts: { feed?: boolean; allDay?: boolean } = {}) => {
    await h.sql`
      insert into commitments (org_id, user_id, title, due_at, status, feed_id, all_day)
      values (${me.orgId}, ${me.userId}, ${title}, ${dueAt}, 'pending',
              ${opts.feed ? feed!.id : null}, ${opts.allDay ?? false})`
  }

  await add('Mine, last week', new Date(2026, 8, 28, 10, 0))
  await add('Offsite last year', new Date(2025, 10, 1, 10, 0), { feed: true })
  // The same day, but before the calendar was connected: Cue was not there yet.
  await add('Standup that morning', new Date(2026, 9, 5, 10, 0), { feed: true })
  await add('Review after connecting', new Date(2026, 9, 6, 11, 0), { feed: true })
  await add('Holiday after connecting', new Date(2026, 9, 7, 0, 0), { feed: true, allDay: true })

  const c = dbm.schema.commitments
  const rows = await dbm.db
    .select({ title: c.title, history: rules.isCalendarHistory(), can: rules.canBeOverdue(new Date(2026, 9, 9)) })
    .from(c)
    .where(eq(c.userId, me.userId))

  const by = Object.fromEntries(rows.map((r) => [r.title, { history: Boolean(r.history), can: Boolean(r.can) }]))
  assert.deepEqual(by['Mine, last week'], { history: false, can: true })
  assert.deepEqual(by['Offsite last year'], { history: true, can: false })
  assert.deepEqual(by['Standup that morning'], { history: true, can: false })
  assert.deepEqual(by['Review after connecting'], { history: false, can: true })
  assert.deepEqual(by['Holiday after connecting'], { history: false, can: false })
})
