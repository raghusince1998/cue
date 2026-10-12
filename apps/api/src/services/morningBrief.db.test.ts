import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * The morning brief: what it counts, what it says, and when it goes.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./morningBrief.ts')

before(async () => {
  h = await createTestDb('brief')
  process.env.DATABASE_URL = h.url
  svc = await import('./morningBrief.ts')
  me = await seedUser(h.sql, 'brief@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`
    update users set timezone = 'Asia/Kolkata', morning_brief_enabled = true,
      morning_brief_hour = 8, last_brief_on = null`
})

const TZ = 'Asia/Kolkata'
/** Thursday 8 October 2026, 8:10 in the morning, in Kolkata. */
const NOW = new Date(2026, 9, 8, 8, 10)
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)

async function add(
  title: string,
  dueAt: Date,
  opts: { kind?: string; minutes?: number; waitingOn?: string; status?: string } = {},
) {
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, duration_minutes, status, waiting_on)
    values (${me.orgId}, ${me.userId}, ${title}, ${opts.kind ?? 'task'}, ${dueAt}, ${opts.minutes ?? 30},
            ${opts.status ?? 'pending'}, ${opts.waitingOn ?? null})`
}

test('it counts the day, names the first meeting, and who to chase', async () => {
  await add('Sprint planning', at(8, 10), { kind: 'meeting', minutes: 60 })
  await add('Client review', at(8, 14), { kind: 'meeting', minutes: 60 })
  await add('Send the deck', at(8, 17), { kind: 'task' })
  await add('Waiting on Ravi: contract', at(8, 9), { kind: 'followup', waitingOn: 'Ravi' })
  await add('Waiting on Priya: numbers', at(12, 10), { kind: 'followup', waitingOn: 'Priya' }) // not due yet
  await add('File the expenses', at(6, 17), { kind: 'task' }) // overdue
  await add('Vendor call', at(7, 15), { kind: 'meeting', minutes: 60 }) // yesterday, never wrapped up

  const stats = await svc.briefStats(me.userId, TZ, NOW)
  assert.equal(stats.meetings, 2)
  assert.equal(stats.first?.title, 'Sprint planning')
  assert.equal(stats.tasks, 1)
  assert.deepEqual(stats.checkIns, ['Ravi'], 'only check-ins due today')
  assert.equal(stats.overdue, 1, "yesterday's meeting is waiting for follow-ups, not overdue")
  assert.equal(stats.wrapUps, 1)

  const brief = svc.composeBrief(stats, TZ)!
  assert.equal(brief.title, 'Today: 2 meetings, 1 to do')
  // A working life kept apart from home: the day in two halves.
  assert.match(brief.body, /Work: 3, first Sprint planning at 10:00/i)
  assert.match(brief.body, /Longest free stretch/)
  assert.match(brief.body, /Check in with Ravi\./)
  assert.match(brief.body, /1 meeting still needs follow-ups\./)
  assert.match(brief.body, /1 overdue\./)
  assert.equal(brief.url, '/?day=1')
})

test('an empty day with nothing outstanding sends nothing', async () => {
  const stats = await svc.briefStats(me.userId, TZ, NOW)
  assert.equal(svc.composeBrief(stats, TZ), null)
})

test('it goes once, at or after the chosen hour, in the person\'s own zone', async () => {
  // 7:50 in Kolkata: too early for an 8 o'clock brief.
  assert.equal((await svc.usersDueForBrief(at(8, 7, 50))).length, 0)
  const due = await svc.usersDueForBrief(NOW)
  assert.deepEqual(
    due.map((u) => [u.id, u.local_date]),
    [[me.userId, '2026-10-08']],
  )

  await add('Sprint planning', at(8, 10), { kind: 'meeting', minutes: 60 })
  assert.equal(await svc.runMorningBriefs(NOW), 1)
  assert.equal((await svc.usersDueForBrief(at(8, 9, 0))).length, 0, 'not twice in a morning')

  // Switched off: nothing, even when due.
  await h.sql`update users set morning_brief_enabled = false, last_brief_on = null`
  assert.equal((await svc.usersDueForBrief(NOW)).length, 0)
})

test('work and personal, a journey, parcels and bills: the whole day in one place', async () => {
  await add('Daily standup', at(8, 10), { kind: 'meeting', minutes: 15 })
  await add('Send the Q3 report', at(8, 16), { kind: 'task' })
  await add('Pick up kids from school', at(8, 15, 30), { kind: 'task' })
  await add('Call mom', at(8, 20), { kind: 'callback' })
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, duration_minutes, booking)
    values (${me.orgId}, ${me.userId}, 'Flight to Goa', 'task', ${at(8, 19)}, 120,
            ${h.sql.json({ type: 'flight', ref: null, from: null, city: 'Goa', provider: null, remindBeforeMinutes: 180 })})`
  await h.sql`
    insert into deliveries (org_id, user_id, store, item, status, expected_on, cod_paise)
    values (${me.orgId}, ${me.userId}, 'Flipkart', 'Redmi Note 13', 'out_for_delivery', '2026-10-08', 1799900)`
  await h.sql`
    insert into bills (org_id, user_id, name, due_on) values (${me.orgId}, ${me.userId}, 'Electricity', '2026-10-09')`

  const stats = await svc.briefStats(me.userId, TZ, NOW)
  assert.equal(stats.split, true)
  assert.equal(stats.work.count, 2)
  assert.equal(stats.personal.count, 3, 'the kids, mom and the holiday flight')
  assert.equal(stats.travel?.title, 'Flight to Goa')

  const body = svc.composeBrief(stats, TZ)!.body
  assert.match(body, /Flight to Goa at 7:00 pm — leave by 4:00 pm\./)
  assert.match(body, /Work: 2, first Daily standup at 10:00 am\./)
  assert.match(body, /Personal: 3, first Pick up kids from school at 3:30 pm\./)
  assert.match(body, /Arriving today: Flipkart · Redmi Note 13 \(₹17,999 cash on delivery\)\./)
  assert.match(body, /To pay: Electricity \(tomorrow\)\./)

  await h.sql`delete from deliveries`
  await h.sql`delete from bills`
})

test('someone without a working life gets one list, as before', async () => {
  await h.sql`update users set uses = '{personal}' where id = ${me.userId}`
  await add('Call mom', at(8, 20), { kind: 'callback' })
  const stats = await svc.briefStats(me.userId, TZ, NOW)
  assert.equal(stats.split, false)
  const body = svc.composeBrief(stats, TZ)!.body
  assert.ok(!/Work:|Personal:/.test(body), body)
  await h.sql`update users set uses = '{}' where id = ${me.userId}`
})
