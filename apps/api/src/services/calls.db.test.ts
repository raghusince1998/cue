import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * A call, logged as it ends: who it was (from the number, if need be), how it
 * went, and what comes next — and only calls where you spoke count as contact.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./calls.ts')
let touch: typeof import('./keepInTouch.ts')
let report: typeof import('./dailyReport.ts')

before(async () => {
  h = await createTestDb('calls')
  process.env.DATABASE_URL = h.url
  svc = await import('./calls.ts')
  touch = await import('./keepInTouch.ts')
  report = await import('./dailyReport.ts')
  me = await seedUser(h.sql, 'calls@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from interactions`
  await h.sql`delete from contacts`
})

/** Friday 9 October 2026, 4 in the afternoon. */
const NOW = new Date(2026, 9, 9, 16, 0)
const TOMORROW = new Date(2026, 9, 10, 10, 0)

async function mehta(): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into contacts (org_id, name, organization, phone, keep_in_touch_days, keep_in_touch_since)
    values (${me.orgId}, 'Dr. Anil Mehta', 'Mehta Physio Clinic', '+91 98200 11223', 30, ${new Date(2026, 8, 1)})
    returning id`
  return row!.id
}

async function callBack(contactId: string): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, kind, due_at, contact_id)
    values (${me.orgId}, ${me.userId}, 'Call back Dr. Mehta', 'callback', ${new Date(2026, 9, 9, 15)}, ${contactId})
    returning id`
  return row!.id
}

test('the number finds the person, however it is written', async () => {
  const id = await mehta()
  const logged = await svc.logCall(me.orgId, me.userId, { phone: '098200-11223', outcome: 'spoke', notes: 'Wants a trial' }, NOW)
  const [row] = await h.sql`select contact_id, channel, connected, outcome, notes from interactions where id = ${logged.interactionId}`
  assert.deepEqual(
    { ...row },
    { contact_id: id, channel: 'call', connected: true, outcome: 'Spoke', notes: 'Wants a trial' },
  )
})

test('nobody answered the call back: it moves to the next try instead of piling up', async () => {
  const id = await mehta()
  const source = await callBack(id)
  const logged = await svc.logCall(
    me.orgId,
    me.userId,
    { contactId: id, outcome: 'no_answer', commitmentId: source, next: { kind: 'again', dueAt: TOMORROW.toISOString() } },
    NOW,
  )
  assert.equal(logged.rescheduled, true)
  assert.equal(logged.nextId, null, 'no second call back')
  const plans = await h.sql<{ id: string; status: string; due_at: Date }[]>`select id, status, due_at from commitments`
  assert.equal(plans.length, 1)
  assert.equal(plans[0]!.status, 'pending')
  assert.equal(plans[0]!.due_at.getTime(), TOMORROW.getTime())
  const [queued] = await h.sql<{ n: number }[]>`select count(*)::int as n from reminders where commitment_id = ${source} and status = 'pending'`
  assert.equal(queued!.n, 1, 'reminded at the new time')

  // An unanswered call is not contact.
  const [status] = await touch.keepInTouch(me.orgId, me.userId, NOW)
  assert.equal(status!.lastTouch, null)
})

test('spoke: the call back is done, and what they will send becomes a check-in', async () => {
  const id = await mehta()
  const source = await callBack(id)
  const logged = await svc.logCall(
    me.orgId,
    me.userId,
    {
      contactId: id,
      outcome: 'spoke',
      commitmentId: source,
      markDone: true,
      next: { kind: 'waiting', title: 'signed order form', dueAt: TOMORROW.toISOString() },
    },
    NOW,
  )
  assert.equal(logged.closed, true)
  const [closed] = await h.sql`select status from commitments where id = ${source}`
  assert.equal(closed!.status, 'done')
  const [check] = await h.sql`select title, kind, waiting_on, contact_id from commitments where id = ${logged.nextId}`
  assert.deepEqual(
    { ...check },
    { title: 'Waiting on Dr. Mehta: signed order form', kind: 'followup', waiting_on: 'Dr. Mehta', contact_id: id },
  )

  const [status] = await touch.keepInTouch(me.orgId, me.userId, NOW)
  assert.equal(status!.lastTouch?.getTime(), NOW.getTime(), 'a call where you spoke is contact')
})

test('an unknown number is still logged, and the day\'s report lists the calls', async () => {
  await mehta()
  await svc.logCall(me.orgId, me.userId, { phone: '+91 90000 00000', outcome: 'no_answer' }, new Date(2026, 9, 9, 11))
  await svc.logCall(
    me.orgId,
    me.userId,
    { phone: '9820011223', outcome: 'spoke', notes: 'Confirmed the demo for Tuesday', next: { kind: 'followup', title: 'Send the demo deck', dueAt: TOMORROW.toISOString() } },
    new Date(2026, 9, 9, 12),
  )

  const r = await report.dayReport(me.userId, NOW, NOW)
  assert.deepEqual(
    r.calls.map((c) => [c.title, c.who, c.note]),
    [
      ['+91 90000 00000', 'No answer', null],
      ['Dr. Anil Mehta (Mehta Physio Clinic)', 'Spoke', 'Confirmed the demo for Tuesday'],
    ],
  )
  assert.equal(r.visits.length, 0, 'calls are not visits')
  assert.match(report.composeReminder(r, null)!.body, /^2 calls\./)
  const [deck] = await h.sql`select title, kind from commitments where title = 'Send the demo deck'`
  assert.equal(deck!.kind, 'task')
})
