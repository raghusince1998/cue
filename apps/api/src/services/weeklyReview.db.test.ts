import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * The weekly review: what it counts for the week behind and the one ahead,
 * what the Friday notification says, and when it goes.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./weeklyReview.ts')

before(async () => {
  h = await createTestDb('review')
  process.env.DATABASE_URL = h.url
  svc = await import('./weeklyReview.ts')
  me = await seedUser(h.sql, 'review@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`
    update users set timezone = 'Asia/Kolkata', weekly_review_enabled = true,
      weekly_review_hour = 17, last_review_prompt_on = null, last_reviewed_at = null`
})

/** Friday 9 October 2026, ten past five. The week is Monday 5 to Sunday 11. */
const NOW = new Date(2026, 9, 9, 17, 10)
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)

async function add(
  title: string,
  dueAt: Date,
  opts: {
    kind?: string
    minutes?: number
    status?: string
    completedAt?: Date
    from?: string
    waitingOn?: string
    createdAt?: Date
  } = {},
): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments
      (org_id, user_id, title, kind, due_at, duration_minutes, status, completed_at,
       from_commitment_id, waiting_on, created_at)
    values (${me.orgId}, ${me.userId}, ${title}, ${opts.kind ?? 'task'}, ${dueAt}, ${opts.minutes ?? 30},
            ${opts.status ?? 'pending'}, ${opts.completedAt ?? null}, ${opts.from ?? null},
            ${opts.waitingOn ?? null}, ${opts.createdAt ?? at(1, 9)})
    returning id`
  return row!.id
}

test('it counts the week behind and lays out the week ahead', async () => {
  await add('File the expenses', at(6, 17), { status: 'done', completedAt: at(6, 18) })
  const review = await add('Client review', at(7, 10), {
    kind: 'meeting',
    minutes: 60,
    status: 'done',
    completedAt: at(7, 11),
  })
  await add('Old thing', at(1, 10), { status: 'done', completedAt: new Date(2026, 8, 30, 10) }) // last week
  await add('Standup', at(8, 9, 30), { kind: 'meeting', minutes: 30 }) // happened, not ticked off
  await add('Send the proposal', at(12, 10), { from: review, createdAt: at(7, 11, 5) })
  await add('Chase the invoice', at(6, 12)) // slipped
  await add('Waiting on Ravi: contract', at(9, 9), { kind: 'followup', waitingOn: 'Ravi' })
  await add('Board prep', at(13, 10), { kind: 'meeting', minutes: 120 })
  await add('Pricing call', at(13, 14), { kind: 'meeting', minutes: 60 })

  const r = await svc.weekReview(me.userId, NOW)
  assert.deepEqual(r.week, { from: '2026-10-05', to: '2026-10-11' })
  assert.equal(r.done.total, 2)
  assert.deepEqual([r.done.meetings, r.done.tasks], [1, 1])
  assert.deepEqual(r.meetings, { count: 2, minutes: 90 }, 'the standup took the time, ticked or not')
  assert.equal(r.followUps, 1)
  assert.equal(r.slipped, 1, 'the standup is waiting to be wrapped up, not slipped')
  assert.equal(r.waiting.count, 1)
  assert.equal(r.waiting.oldest?.who, 'Ravi')
  assert.equal(r.nextWeek.busiest, '2026-10-13')
  // "Send the proposal" (Monday, 30 minutes) is booked too: three hours and a half.
  assert.equal(r.nextWeek.items, 3)
  assert.equal(r.nextWeek.meetingMinutes, 180)
  assert.equal(r.nextWeek.freeMinutes, 5 * 13 * 60 - 210)

  const note = svc.composeReview(r)!
  assert.equal(note.title, 'Your week: 2 done, 1 slipped')
  assert.match(note.body, /2 meetings \(1\.5h\)\./)
  assert.match(note.body, /1 still waiting on others\./)
  assert.match(note.body, /busiest day: Tuesday\./)
  assert.equal(note.url, '/?review=1')
})

test('a week with nothing in it either way sends nothing', async () => {
  assert.equal(svc.composeReview(await svc.weekReview(me.userId, NOW)), null)
})

test('it goes on Friday at the chosen hour, once, and finishing is remembered', async () => {
  assert.equal((await svc.usersDueForReview(at(8, 17, 10))).length, 0, 'Thursday')
  assert.equal((await svc.usersDueForReview(at(9, 16, 50))).length, 0, 'Friday, too early')
  assert.deepEqual(
    (await svc.usersDueForReview(NOW)).map((u) => [u.id, u.local_date]),
    [[me.userId, '2026-10-09']],
  )

  await add('File the expenses', at(6, 17), { status: 'done', completedAt: at(6, 18) })
  assert.equal(await svc.runWeeklyReviews(NOW), 1)
  assert.equal((await svc.usersDueForReview(at(9, 18))).length, 0, 'not twice on a Friday')

  await svc.markReviewed(me.userId, NOW)
  assert.equal((await svc.weekReview(me.userId, NOW)).reviewedAt, NOW.toISOString())
})
