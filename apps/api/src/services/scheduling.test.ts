import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Double-booking, against a real database.
 *
 * The env var has to be set before anything pulls in db/index.ts, which builds
 * its connection pool at module load — hence the dynamic import below.
 */
let h: Harness
let me: Seeded
let other: Seeded
let checkConflicts: typeof import('./scheduling.ts').checkConflicts

before(async () => {
  h = await createTestDb('scheduling')
  process.env.DATABASE_URL = h.url
  ;({ checkConflicts } = await import('./scheduling.ts'))
  me = await seedUser(h.sql, 'me@test.local')
  other = await seedUser(h.sql, 'other@test.local')
})

after(async () => {
  await h.close()
})

/** A fixed Monday, so "10:00" in a test name means the same thing every run. */
const DAY = new Date(2026, 9, 5)
const at = (hour: number, minute = 0) =>
  new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate(), hour, minute)

interface BookOpts {
  user?: Seeded
  minutes?: number
  allDay?: boolean
  endsAt?: Date
  flexibility?: string
  status?: string
}

async function book(title: string, when: Date, opts: BookOpts = {}): Promise<string> {
  const who = opts.user ?? me
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, due_at, duration_minutes, all_day, ends_at, flexibility, status)
    values (${who.orgId}, ${who.userId}, ${title}, ${when}, ${opts.minutes ?? 60},
            ${opts.allDay ?? false}, ${opts.endsAt ?? null}, ${opts.flexibility ?? 'fixed'},
            ${opts.status ?? 'pending'})
    returning id`
  return row!.id
}

async function clear() {
  await h.sql`delete from commitments`
}

test('an overlapping slot is reported', async () => {
  await clear()
  await book('Existing', at(10), { minutes: 60 })

  const r = await checkConflicts(me.userId, { startsAt: at(10, 30), durationMinutes: 30 })
  assert.equal(r.conflicts.length, 1)
  assert.equal(r.conflicts[0]!.title, 'Existing')
})

test('slots that merely touch do not clash', async () => {
  await clear()
  await book('Morning', at(14), { minutes: 60 })

  // 14:00-15:00 leaves 15:00 free. Reporting this would make every
  // back-to-back day look like a pile of conflicts.
  const after = await checkConflicts(me.userId, { startsAt: at(15), durationMinutes: 30 })
  assert.deepEqual(after.conflicts, [])

  const before = await checkConflicts(me.userId, { startsAt: at(13), durationMinutes: 60 })
  assert.deepEqual(before.conflicts, [])
})

test('an all-day item is context and never blocks a slot', async () => {
  await clear()
  await book('Trip to Mathura', at(0), {
    allDay: true,
    endsAt: new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate() + 2, 23, 59),
  })

  const r = await checkConflicts(me.userId, { startsAt: at(11), durationMinutes: 60 })
  assert.deepEqual(r.conflicts, [], 'a three-day trip must not clash with every call during it')
})

test('a flexible item does not veto a real appointment', async () => {
  await clear()
  // "Call the plumber this afternoon" must not block a 15:00 meeting.
  await book('Call the plumber', at(15), { flexibility: 'flexible' })

  const r = await checkConflicts(me.userId, { startsAt: at(15), durationMinutes: 60 })
  assert.deepEqual(r.conflicts, [])
})

test('only pending items clash', async () => {
  await clear()
  await book('Already done', at(10), { status: 'done' })
  await book('Cancelled', at(10), { status: 'cancelled' })

  const r = await checkConflicts(me.userId, { startsAt: at(10), durationMinutes: 60 })
  assert.deepEqual(r.conflicts, [])
})

test('conflicts are per person, not per organisation', async () => {
  await clear()
  await book('Their meeting', at(16), { user: other })

  const r = await checkConflicts(me.userId, { startsAt: at(16), durationMinutes: 60 })
  assert.deepEqual(r.conflicts, [], 'two people can both be busy at 4pm')
})

test('excludeId lets an item be moved without clashing with itself', async () => {
  await clear()
  const id = await book('Dentist', at(9), { minutes: 60 })

  const naive = await checkConflicts(me.userId, { startsAt: at(9, 15), durationMinutes: 60 })
  assert.equal(naive.conflicts.length, 1, 'without the exclusion it finds itself')

  const moving = await checkConflicts(me.userId, { startsAt: at(9, 15), durationMinutes: 60 }, id)
  assert.deepEqual(moving.conflicts, [], 'nudging something by 15 minutes is not a conflict')
})

test('suggestions are free, and after the clash', async () => {
  await clear()
  await book('Standup', at(10), { minutes: 60 })

  const r = await checkConflicts(me.userId, { startsAt: at(10), durationMinutes: 30 })
  assert.ok(r.conflicts.length > 0)
  assert.ok(r.suggestions.length > 0, 'a clash with no way out is not much help')

  for (const iso of r.suggestions) {
    const candidate = new Date(iso)
    assert.ok(candidate > at(10), 'suggestions move forward')
    const check = await checkConflicts(me.userId, { startsAt: candidate, durationMinutes: 30 })
    assert.deepEqual(check.conflicts, [], `suggested ${iso} was not actually free`)
  }
})

test('a multi-day span blocks by its end, not its duration', async () => {
  await clear()
  // Timed, but running three days: endsAt has to win over durationMinutes.
  await book('Conference', at(9), {
    minutes: 60,
    endsAt: new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate() + 2, 17, 0),
  })

  const nextDay = new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate() + 1, 11, 0)
  const r = await checkConflicts(me.userId, { startsAt: nextDay, durationMinutes: 30 })
  assert.equal(r.conflicts.length, 1, 'the second day of a three-day booking is still busy')
})
