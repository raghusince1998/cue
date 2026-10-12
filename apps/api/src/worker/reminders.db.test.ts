import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * The nag engine.
 *
 * This is the product: a planner that quietly stops chasing you is worse than
 * no planner, because you trusted it. Nothing here had a test until now, and
 * the failure mode is silent — you find out by missing an appointment.
 *
 * Push delivery is not stubbed. With no subscriptions stored, sendToUser
 * reports zero delivered and returns normally, which is exactly the path a
 * real user takes before they enable notifications; the reminder still has to
 * be marked sent and escalated.
 */
let h: Harness
let me: Seeded
let worker: typeof import('./reminders.ts')

before(async () => {
  h = await createTestDb('worker')
  process.env.DATABASE_URL = h.url
  // Short and quiet, so the escalation chain is observable in one pass.
  process.env.ESCALATION_MINUTES = '15'
  process.env.MAX_ESCALATIONS = '3'
  worker = await import('./reminders.ts')
  me = await seedUser(h.sql, 'worker@test.local')
  // The nag engine on its own: work hours holding nags back would make these
  // depend on the time of day the suite runs (see workLife.db.test.ts).
  await h.sql`update users set keep_apart = false where id = ${me.userId}`
})

after(async () => {
  await h.close()
})

async function commitment(title: string, opts: { status?: string } = {}): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, due_at, status)
    values (${me.orgId}, ${me.userId}, ${title}, now() - interval '1 minute',
            ${opts.status ?? 'pending'})
    returning id`
  return row!.id
}

/** A reminder already due, which is what the worker claims. */
async function queue(commitmentId: string, attempt = 0): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into reminders (org_id, commitment_id, fire_at, attempt, status)
    values (${me.orgId}, ${commitmentId}, now() - interval '1 minute', ${attempt}, 'pending')
    returning id`
  return row!.id
}

async function reminders(commitmentId: string) {
  return h.sql<{ id: string; status: string; attempt: number }[]>`
    select id, status, attempt from reminders
    where commitment_id = ${commitmentId} order by attempt, created_at`
}

/**
 * One pass of the loop, awaited rather than slept through.
 *
 * This used to start the real worker and wait 400ms for it to finish. That is
 * a stopwatch calibrated against a local database: a pass is several queries,
 * and against a database across a network each one is a round trip, so the
 * assertions ran before the work was done and the worker looked broken. Now it
 * waits for the actual thing.
 */
async function tick() {
  await worker.runOnce()
}

test('a due reminder is sent and the next attempt is queued', async () => {
  const id = await commitment('Call the dentist')
  await queue(id)

  await tick()

  const chain = await reminders(id)
  assert.equal(chain[0]!.status, 'sent', 'the first buzz must actually fire')
  assert.equal(chain.length, 2, 'and the chase must continue')
  assert.equal(chain[1]!.status, 'pending')
  assert.equal(chain[1]!.attempt, 1)

  const [c] = await h.sql<{ escalation_count: number }[]>`
    select escalation_count from commitments where id = ${id}`
  assert.equal(c!.escalation_count, 1)
})

test('the chain stops at the limit rather than buzzing forever', async () => {
  const id = await commitment('Persistent')
  // Already chased to the cap; this is the last one allowed to fire.
  await queue(id, 2)

  await tick()

  const chain = await reminders(id)
  assert.equal(chain.filter((r) => r.status === 'pending').length, 0, 'no further attempt queued')
  assert.equal(chain.at(-1)!.status, 'sent')
})

test('a completed commitment cancels its queued buzz instead of firing', async () => {
  const id = await commitment('Already handled', { status: 'done' })
  await queue(id)

  await tick()

  const chain = await reminders(id)
  assert.equal(chain[0]!.status, 'cancelled')
  assert.equal(chain.length, 1, 'nothing should be queued after it')
})

test('a reminder that is not due yet is left alone', async () => {
  const id = await commitment('Later')
  await h.sql`
    insert into reminders (org_id, commitment_id, fire_at, attempt, status)
    values (${me.orgId}, ${id}, now() + interval '2 hours', 0, 'pending')`

  await tick()

  const chain = await reminders(id)
  assert.equal(chain[0]!.status, 'pending', 'the future is not due')
  assert.equal(chain.length, 1)
})

test('claiming is exclusive, so two workers cannot double-send', async () => {
  const id = await commitment('Only once')
  await queue(id)

  // Two passes at the same moment, as two API instances would.
  await Promise.all([tick(), tick()])

  const sent = (await reminders(id)).filter((r) => r.status === 'sent')
  assert.equal(sent.length, 1, 'FOR UPDATE SKIP LOCKED exists precisely to stop this')
})

test('a batch with one bad row still processes the rest', async () => {
  const good = await commitment('Fine')
  await queue(good)

  // A reminder pointing at a commitment that no longer exists cannot happen
  // through the FK, so the realistic bad case is one already closed out.
  const closed = await commitment('Closed', { status: 'cancelled' })
  await queue(closed)

  await tick()

  assert.equal((await reminders(good))[0]!.status, 'sent')
  assert.equal((await reminders(closed))[0]!.status, 'cancelled')
})

test('a meeting from a connected calendar is announced once, not chased', async () => {
  const [feed] = await h.sql<{ id: string }[]>`
    insert into calendar_feeds (org_id, user_id, label, source)
    values (${me.orgId}, ${me.userId}, 'Work', 'google') returning id`
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, due_at, status, feed_id)
    values (${me.orgId}, ${me.userId}, 'Design review', now() - interval '1 minute', 'pending', ${feed!.id})
    returning id`
  await queue(row!.id)

  await tick()

  const chain = await reminders(row!.id)
  assert.equal(chain.length, 1, '"Still open, 15 min overdue" about a meeting is nagging, not reminding')
  assert.equal(chain[0]!.status, 'sent')
})

test('a check-in with someone reminds once, not every fifteen minutes', async () => {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, due_at, status, waiting_on)
    values (${me.orgId}, ${me.userId}, 'Waiting on Ravi: contract', now() - interval '1 minute', 'pending', 'Ravi')
    returning id`
  await queue(row!.id)

  await tick()

  const chain = await reminders(row!.id)
  assert.equal(chain.length, 1)
  assert.equal(chain[0]!.status, 'sent')
})
