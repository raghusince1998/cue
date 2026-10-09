import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * The day, written up: only what has happened, with who it was with, what
 * was agreed, and what is next — and, the morning after, the same as a
 * standup with "yesterday" skipping a quiet weekend.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./dailyReport.ts')

before(async () => {
  h = await createTestDb('daily_report')
  process.env.DATABASE_URL = h.url
  svc = await import('./dailyReport.ts')
  me = await seedUser(h.sql, 'report@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from interactions`
  await h.sql`delete from contacts`
})

/** Friday 9 October 2026, 6:30 in the evening. */
const NOW = new Date(2026, 9, 9, 18, 30)
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)

async function contact(name: string, organization: string | null = null): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into contacts (org_id, name, organization) values (${me.orgId}, ${name}, ${organization}) returning id`
  return row!.id
}

async function plan(
  title: string,
  dueAt: Date,
  opts: {
    kind?: string
    status?: string
    completedAt?: Date
    contactId?: string
    waitingOn?: string
    from?: string
    notes?: string
  } = {},
): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, kind, due_at, status, completed_at, contact_id,
                             waiting_on, from_commitment_id, notes)
    values (${me.orgId}, ${me.userId}, ${title}, ${opts.kind ?? 'task'}, ${dueAt}, ${opts.status ?? 'pending'},
            ${opts.completedAt ?? null}, ${opts.contactId ?? null}, ${opts.waitingOn ?? null},
            ${opts.from ?? null}, ${opts.notes ?? null})
    returning id`
  return row!.id
}

test('what happened today, with who, what was agreed, and the next working day', async () => {
  const mehta = await contact('Dr. Anil Mehta', 'Mehta Physio Clinic')

  const demo = await plan('Demo at Mehta Physio Clinic', at(9, 11), {
    kind: 'meeting', contactId: mehta, notes: 'Interested in two units.\nAsked about the service contract.',
  })
  await plan('Team review', at(9, 19, 30), { kind: 'meeting' }) // later tonight
  await plan('Lunch with the vendor', at(9, 13), { kind: 'meeting', status: 'cancelled' })

  await plan('Send revised proposal', at(12, 10), { from: demo })
  await plan('Waiting on Dr. Mehta: budget confirmation', at(14, 10), {
    kind: 'followup', waitingOn: 'Dr. Mehta', from: demo,
  })

  await plan('Send pricing sheet to Dr. Nair', at(9, 9), { status: 'done', completedAt: at(9, 15) })
  await plan('Waiting on Vikram: signed contract', at(8, 10), {
    kind: 'followup', status: 'done', completedAt: at(9, 16), waitingOn: 'Vikram',
  })
  await plan('Yesterday’s call', at(8, 10), { status: 'done', completedAt: at(8, 11) })

  await h.sql`
    insert into interactions (org_id, user_id, contact_id, purpose, outcome, notes, started_at)
    values (${me.orgId}, ${me.userId}, ${mehta}, 'business', 'Interested', 'Wants a two-week trial', ${at(9, 12, 30)})`

  await plan('Call back Dr. Rao', at(12, 15))

  const r = await svc.dayReport(me.userId, NOW, NOW)
  assert.equal(r.date, '2026-10-09')
  assert.deepEqual(
    r.meetings.map((m) => [m.title, m.who, m.note]),
    [['Demo at Mehta Physio Clinic', 'Dr. Anil Mehta (Mehta Physio Clinic)', 'Interested in two units.']],
    'not the one tonight, not the cancelled one',
  )
  assert.deepEqual(r.visits.map((v) => [v.title, v.who, v.note]), [
    ['Mehta Physio Clinic', 'Dr. Anil Mehta', 'Interested — Wants a two-week trial'],
  ])
  assert.deepEqual(r.done.map((d) => d.title), [
    'Send pricing sheet to Dr. Nair',
    'Received from Vikram: signed contract',
  ])
  assert.deepEqual(r.agreed.map((a) => a.title), ['Send revised proposal', 'Dr. Mehta to send: budget confirmation'])
  assert.deepEqual(r.waiting.map((w) => w.title), ['Dr. Mehta: budget confirmation'])
  assert.equal(r.next.date, '2026-10-12', 'a quiet weekend is skipped: Monday is next')
  assert.deepEqual(r.next.items.map((n) => n.title), ['Send revised proposal', 'Call back Dr. Rao'])

  const reminder = svc.composeReminder(r, 'Suresh')!
  assert.equal(reminder.title, 'Your daily report is ready')
  assert.equal(reminder.body, '1 meeting, 1 visit, 2 done, 2 next steps agreed. Have a look and send it to Suresh.')
  assert.equal(reminder.url, '/?report=1')
})

test('a day with nothing in it sends no reminder', async () => {
  const r = await svc.dayReport(me.userId, NOW, NOW)
  assert.equal(svc.composeReminder(r, null), null)
})

test('a standup on Monday reports Friday, unless the weekend had work in it', async () => {
  const monday = new Date(2026, 9, 12, 9, 0)
  await plan('Friday wrap-up', at(9, 16), { kind: 'meeting' })
  assert.equal((await svc.previousWorkingDay(me.userId, monday)).getDate(), 9)

  await plan('Saturday site visit', at(10, 11), { kind: 'meeting' })
  assert.equal((await svc.previousWorkingDay(me.userId, monday)).getDate(), 10)

  // On a Wednesday, yesterday is simply Tuesday.
  assert.equal((await svc.previousWorkingDay(me.userId, new Date(2026, 9, 14, 9))).getDate(), 13)

  // "Next" for a standup is today: all of it, including what is already done.
  await plan('Client call', at(12, 11), { kind: 'meeting' })
  await plan('Morning check-in', at(12, 8), { kind: 'meeting', status: 'done' })
  await plan('Dropped meeting', at(12, 12), { kind: 'meeting', status: 'cancelled' })
  const r = await svc.dayReport(me.userId, at(10, 0), monday, { next: monday })
  assert.equal(r.next.date, '2026-10-12')
  assert.deepEqual(r.next.items.map((n) => n.title), ['Morning check-in', 'Client call'])
})
