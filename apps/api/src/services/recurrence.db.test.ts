import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Turning a rule into rows, against the real schema.
 *
 * The expansion arithmetic is covered in packages/shared. What is covered here
 * is everything that only exists in the database: the unique index that makes
 * generation idempotent, the cascades, and whether reminders actually get
 * queued. That is where the bugs in this feature were.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./recurrence.ts')
let dbm: typeof import('../db/index.ts')

before(async () => {
  h = await createTestDb('recurrence')
  process.env.DATABASE_URL = h.url
  // Through the app's own client, so rows arrive in the shape the service
  // expects. Raw SQL returns snake_case and the service reads camelCase.
  dbm = await import('../db/index.ts')
  svc = await import('./recurrence.ts')
  me = await seedUser(h.sql, 'rec@test.local')
})

after(async () => {
  await h.close()
})

const NOW = new Date(2026, 9, 5, 9, 0) // Monday 5 October 2026

interface RuleOpts {
  freq?: string
  interval?: number
  byWeekday?: number[] | null
  byMonthDay?: number | null
  setPos?: number | null
  count?: number | null
  untilOn?: string | null
  startsOn?: string
  hour?: number
  exdates?: string[] | null
}

type Row = typeof import('../db/schema.ts').recurrences.$inferSelect

async function makeSeries(title: string, o: RuleOpts = {}): Promise<Row> {
  const [row] = await dbm.db
    .insert(dbm.schema.recurrences)
    .values({
      orgId: me.orgId,
      userId: me.userId,
      title,
      freq: o.freq ?? 'weekly',
      interval: o.interval ?? 1,
      byWeekday: o.byWeekday ?? null,
      byMonthDay: o.byMonthDay ?? null,
      setPos: o.setPos ?? null,
      startsOn: o.startsOn ?? '2026-10-06',
      hour: o.hour ?? 10,
      minute: 0,
      count: o.count ?? null,
      untilOn: o.untilOn ?? null,
      exdates: o.exdates ?? null,
    })
    .returning()
  return row!
}

/** Re-read through Drizzle, for the same camelCase reason. */
async function reload(id: string): Promise<Row> {
  const [row] = await dbm.db
    .select()
    .from(dbm.schema.recurrences)
    .where(eq(dbm.schema.recurrences.id, id))
  return row!
}

async function counts(recurrenceId: string) {
  const [c] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from commitments where recurrence_id = ${recurrenceId}`
  const [r] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from reminders rem
    join commitments c on c.id = rem.commitment_id
    where c.recurrence_id = ${recurrenceId} and rem.status = 'pending'`
  return { occurrences: c!.n, reminders: r!.n }
}

test('materialising creates occurrences and queues one reminder each', async () => {
  const row = await makeSeries('Standup', { byWeekday: [2] })
  const written = await svc.materialise(row, { now: NOW })

  const { occurrences, reminders } = await counts(row.id)
  assert.ok(occurrences > 10, `expected a rolling window of Tuesdays, got ${occurrences}`)
  assert.equal(written, occurrences)
  assert.equal(reminders, occurrences, 'every occurrence needs its own first buzz')
})

test('materialising twice writes nothing the second time', async () => {
  const row = await makeSeries('Idempotent', { byWeekday: [3] })
  await svc.materialise(row, { now: NOW })
  const first = await counts(row.id)

  // Pretend the horizon lapsed, which is what makes the sweep try again.
  await h.sql`update recurrences set materialised_to = null where id = ${row.id}`
  const written = await svc.materialise(await reload(row.id), { now: NOW })

  assert.equal(written, 0, 'the unique index must absorb a repeat run')
  assert.deepEqual(await counts(row.id), first)
})

test('a series with reminders off still mirrors, but does not buzz', async () => {
  const row = await makeSeries('Quiet', { byWeekday: [4] })
  await svc.materialise(row, { now: NOW, remind: false })

  const { occurrences, reminders } = await counts(row.id)
  assert.ok(occurrences > 0)
  assert.equal(reminders, 0)
})

test('exdates are skipped when the rows are written', async () => {
  const row = await makeSeries('With a gap', {
    byWeekday: [2],
    startsOn: '2026-10-06',
    exdates: ['2026-10-20'],
  })
  await svc.materialise(row, { now: NOW })

  const days = await h.sql<{ d: string }[]>`
    select to_char(occurrence_on, 'YYYY-MM-DD') as d from commitments
    where recurrence_id = ${row.id} order by occurrence_on`
  const list = days.map((x) => x.d)
  assert.ok(list.includes('2026-10-13'))
  assert.ok(!list.includes('2026-10-20'), 'the excluded date must not be written')
  assert.ok(list.includes('2026-10-27'))
})

test('regenerating replaces future occurrences but keeps edited and past ones', async () => {
  const row = await makeSeries('Yoga', { byWeekday: [1] })
  const id = row.id
  await svc.materialise(row, { now: NOW })

  // One in the past, one completed, one the user edited by hand.
  const all = await h.sql<{ id: string; due_at: Date }[]>`
    select id, due_at from commitments where recurrence_id = ${id} order by due_at`
  await h.sql`update commitments set due_at = ${new Date(2026, 8, 1)} where id = ${all[0]!.id}`
  await h.sql`update commitments set status = 'done' where id = ${all[1]!.id}`
  await svc.detach(all[2]!.id)

  await dbm.db
    .update(dbm.schema.recurrences)
    .set({ byWeekday: [5] })
    .where(eq(dbm.schema.recurrences.id, id))
  await svc.regenerate(await reload(id), { now: NOW })

  const kept = await h.sql<{ n: number }[]>`
    select count(*)::int as n from commitments
    where recurrence_id = ${id} and (status = 'done' or detached = true or due_at < ${NOW})`
  assert.equal(kept[0]!.n, 3, 'past, completed and detached occurrences all survive a rule change')

  const weekdays = await h.sql<{ dow: number }[]>`
    select distinct extract(dow from due_at)::int as dow from commitments
    where recurrence_id = ${id} and status = 'pending' and detached = false and due_at >= ${NOW}`
  assert.deepEqual(
    weekdays.map((w) => w.dow),
    [5],
    'everything regenerated should be on the new weekday',
  )
})

test('stopping a series removes what is ahead and keeps what happened', async () => {
  const row = await makeSeries('Class', { byWeekday: [0] })
  const id = row.id
  await svc.materialise(row, { now: NOW })

  const first = await h.sql<{ id: string }[]>`
    select id from commitments where recurrence_id = ${id} order by due_at limit 1`
  await h.sql`update commitments set status = 'done' where id = ${first[0]!.id}`

  await svc.stopSeries(id, { now: NOW })

  const rows = await h.sql<{ status: string }[]>`
    select status from commitments where recurrence_id = ${id}`
  assert.deepEqual(
    rows.map((r) => r.status),
    ['done'],
    'eight attended classes are still eight attended classes',
  )

  const [series] = await h.sql<{ status: string }[]>`
    select status from recurrences where id = ${id}`
  assert.equal(series!.status, 'ended')
})

test('deleting a series takes its occurrences and their reminders with it', async () => {
  const row = await makeSeries('Doomed', { byWeekday: [6] })
  const id = row.id
  await svc.materialise(row, { now: NOW })
  assert.ok((await counts(id)).occurrences > 0)

  await h.sql`delete from recurrences where id = ${id}`

  const [c] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from commitments where recurrence_id = ${id}`
  assert.equal(c!.n, 0, 'an occurrence has no life without its series')

  const [orphans] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from reminders rem
    where not exists (select 1 from commitments c where c.id = rem.commitment_id)`
  assert.equal(orphans!.n, 0, 'reminders must cascade too, or the worker chases ghosts')
})

test('the sweep only touches series whose horizon is running out', async () => {
  const fresh = await makeSeries('Already done', { byWeekday: [2] })
  await svc.materialise(fresh, { now: NOW })

  // Far enough ahead that it needs nothing; the sweep should leave it alone.
  await h.sql`update recurrences set materialised_to = ${'2027-12-31'}
              where id = ${fresh.id}`
  const before = await counts(fresh.id)
  await svc.sweep({ now: NOW })
  assert.deepEqual(await counts(fresh.id), before)
})
