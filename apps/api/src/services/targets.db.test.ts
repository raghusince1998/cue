import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Weekly targets: counted only from what happened this week so far, and
 * judged against an even pace through the working week.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./targets.ts')
let brief: typeof import('./morningBrief.ts')

before(async () => {
  h = await createTestDb('targets')
  process.env.DATABASE_URL = h.url
  svc = await import('./targets.ts')
  brief = await import('./morningBrief.ts')
  me = await seedUser(h.sql, 'targets@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from interactions`
  await h.sql`delete from contacts`
  await h.sql`update users set weekly_targets = '{}'::jsonb`
})

/** Wednesday 7 October 2026, half past one: halfway through the working week. */
const NOW = new Date(2026, 9, 7, 13, 30)
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0)

async function interaction(channel: 'call' | 'visit', when: Date, connected = true) {
  await h.sql`
    insert into interactions (org_id, user_id, purpose, channel, connected, started_at)
    values (${me.orgId}, ${me.userId}, 'business', ${channel}, ${connected}, ${when})`
}

async function plan(kind: string, dueAt: Date, status = 'pending', completedAt: Date | null = null, allDay = false) {
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, status, completed_at, all_day)
    values (${me.orgId}, ${me.userId}, ${kind}, ${kind}, ${dueAt}, ${status}, ${completedAt}, ${allDay})`
}

test('the working week passes Monday to Friday, through working hours', () => {
  assert.equal(svc.weekElapsed(at(5, 8)), 0, 'Monday before work')
  assert.equal(svc.weekElapsed(NOW), 0.5)
  assert.equal(svc.weekElapsed(at(9, 18)), 1, 'Friday evening')
  assert.equal(svc.weekElapsed(at(10, 11)), 1, 'the weekend')
})

test('counted from what happened this week so far, and paced against the week', async () => {
  await interaction('call', at(5, 10))
  await interaction('call', at(6, 11), false)
  await interaction('call', at(7, 10))
  await interaction('call', at(2, 10)) // last Friday
  await interaction('visit', at(6, 15))

  await plan('meeting', at(5, 11), 'done')
  await plan('meeting', at(7, 10))
  await plan('meeting', at(6, 12), 'cancelled')
  await plan('meeting', at(7, 16)) // later today: not yet
  await plan('meeting', at(6, 0), 'pending', null, true) // all day: a holiday, not a meeting
  await plan('task', at(6, 10), 'done', at(6, 12))
  await plan('callback', at(1, 10), 'done', at(7, 9)) // overdue, closed this week
  await plan('meeting', at(5, 9), 'done', at(5, 10)) // a meeting is not a "thing done"

  await h.sql`insert into contacts (org_id, name, created_at) values (${me.orgId}, 'New person', ${at(6, 9)})`
  await h.sql`insert into contacts (org_id, name, created_at) values (${me.orgId}, 'Old person', ${at(1, 9)})`

  await svc.saveTargets(me.userId, { calls: 10, visits: 1, meetings: 4, conversations: 0 })
  const week = await svc.weekTargets(me.userId, NOW)
  const by = Object.fromEntries(week.metrics.map((m) => [m.key, m]))

  assert.equal(week.week.from, '2026-10-05')
  assert.equal(week.tracking, true)
  assert.deepEqual([by.calls!.done, by.calls!.lastWeek, by.calls!.expected, by.calls!.status], [3, 1, 5, 'behind'])
  assert.deepEqual([by.conversations!.done, by.conversations!.status], [2, 'untracked'], 'a target of 0 is no target')
  assert.deepEqual([by.visits!.done, by.visits!.status], [1, 'done'])
  assert.deepEqual([by.meetings!.done, by.meetings!.expected, by.meetings!.status], [3, 2, 'on'])
  assert.equal(by.done!.done, 2)
  assert.equal(by.people!.done, 1)

  assert.equal(svc.behindLine(week.metrics), 'Behind on calls (3 of 10).')
  const stats = await brief.briefStats(me.userId, 'Asia/Kolkata', NOW)
  assert.equal(stats.behind, 'Behind on calls (3 of 10).')
})

test('clearing a target stops tracking it, and the others stay', async () => {
  await svc.saveTargets(me.userId, { calls: 40, visits: 10 })
  await svc.saveTargets(me.userId, { calls: null })
  const [row] = await h.sql`select weekly_targets from users where id = ${me.userId}`
  assert.deepEqual(row!.weekly_targets, { visits: 10 })
  assert.equal(svc.behindLine((await svc.weekTargets(me.userId, NOW)).metrics), 'Behind on visits (0 of 10).')
})
