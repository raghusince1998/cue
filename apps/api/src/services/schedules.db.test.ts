import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Schedules: steps at set distances from one date — a child's vaccinations at
 * birth, 6 weeks, 10 weeks, 9 months — each booked as its own plan.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./schedules.ts')

before(async () => {
  h = await createTestDb('schedules')
  process.env.DATABASE_URL = h.url
  svc = await import('./schedules.ts')
  me = await seedUser(h.sql, 'schedule@test.local')
  other = await seedUser(h.sql, 'someone@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from schedules`
})

/** Thursday 8 October 2026, midday. The child was born on 1 August. */
const NOW = new Date(2026, 9, 8, 12, 0)

const vaccinations = {
  title: "Aarav's vaccinations",
  startsOn: '2026-08-01',
  hour: 10,
  minute: 0,
  kind: 'meeting' as const,
  durationMinutes: 30,
  steps: [
    { title: 'BCG, OPV-0', offset: { amount: 0, unit: 'weeks' as const } },
    { title: 'OPV-1, Pentavalent-1', offset: { amount: 6, unit: 'weeks' as const } },
    { title: 'OPV-2, Pentavalent-2', offset: { amount: 10, unit: 'weeks' as const } },
    { title: '', offset: { amount: 9, unit: 'months' as const } },
    { title: 'Check-up', date: '2027-03-15' },
  ],
}

test('each step is booked on its own date, and steps already past are skipped', async () => {
  const r = await svc.createSchedule(me.orgId, me.userId, vaccinations, NOW)
  // Birth (1 Aug) and 6 weeks (12 Sep) are before 8 October.
  assert.equal(r.skippedPast, 2)
  assert.equal(r.booked, 3)

  const rows = await h.sql<{ title: string; due_at: Date; schedule_id: string }[]>`
    select title, due_at, schedule_id from commitments order by due_at`
  assert.deepEqual(
    rows.map((x) => [x.title, x.due_at.toDateString(), x.due_at.getHours()]),
    [
      ["Aarav's vaccinations — OPV-2, Pentavalent-2", new Date(2026, 9, 10).toDateString(), 10],
      // A step with no name is called by its gap, so the card still makes sense.
      ["Aarav's vaccinations — 9 months", new Date(2027, 4, 1).toDateString(), 10],
      ["Aarav's vaccinations — Check-up", new Date(2027, 2, 15).toDateString(), 10],
    ].sort((a, b) => new Date(a[1] as string).getTime() - new Date(b[1] as string).getTime()),
  )
  assert.ok(rows.every((x) => x.schedule_id === r.schedule.id))

  // Each booked step reminds on its day.
  const [rem] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from reminders rem
    join commitments c on c.id = rem.commitment_id where c.schedule_id = ${r.schedule.id}`
  assert.equal(rem!.n, 3)
})

test('progress counts what is done and names what is next', async () => {
  const { schedule } = await svc.createSchedule(me.orgId, me.userId, vaccinations, NOW)
  await h.sql`
    update commitments set status = 'done', completed_at = now()
    where schedule_id = ${schedule.id} and title like '%OPV-2%'`

  const [listed] = await svc.listSchedules(me.userId, NOW)
  assert.equal(listed!.total, 3)
  assert.equal(listed!.done, 1)
  assert.equal(listed!.next?.title, "Aarav's vaccinations — Check-up")
  assert.deepEqual(await svc.listSchedules(other.userId, NOW), [], 'nobody else sees it')
})

test('stopping removes what is still ahead and keeps what was done', async () => {
  const { schedule } = await svc.createSchedule(me.orgId, me.userId, vaccinations, NOW)
  await h.sql`
    update commitments set status = 'done', completed_at = now()
    where schedule_id = ${schedule.id} and title like '%OPV-2%'`

  assert.equal(await svc.stopSchedule(other.userId, schedule.id, NOW), null, 'not theirs to stop')
  assert.equal(await svc.stopSchedule(me.userId, schedule.id, NOW), 2)

  const left = await h.sql<{ title: string; status: string }[]>`
    select title, status from commitments where schedule_id = ${schedule.id}`
  assert.deepEqual(left.map((x) => x.status), ['done'])
  const [row] = await h.sql<{ status: string }[]>`select status from schedules where id = ${schedule.id}`
  assert.equal(row!.status, 'stopped')
})
