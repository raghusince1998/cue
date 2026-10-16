import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * The Repeating list: for every series at once, what is still ahead — read
 * from the plans written, or, past them, from the rule.
 */

let h: Harness
let me: Seeded
let app: FastifyInstance
let token: string

async function call(method: 'GET' | 'POST', url: string, body?: Record<string, unknown>) {
  const res = await app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

before(async () => {
  h = await createTestDb('recurrencelist')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { recurrenceRoutes } = await import('./recurrences.ts')
  me = await seedUser(h.sql, 'repeat@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(recurrenceRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'repeat@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

test('each series says what is ahead, as the plans written say it', async () => {
  const tomorrow = new Date(Date.now() + 86_400_000)
  const made = await Promise.all([
    call('POST', '/recurrences', { title: 'Morning walk', startsOn: ymd(tomorrow), hour: 7, rule: { freq: 'daily' } }),
    call('POST', '/recurrences', { title: 'Team sync', startsOn: ymd(tomorrow), hour: 10, rule: { freq: 'weekly' } }),
  ])
  for (const m of made) assert.equal(m.status, 201, JSON.stringify(m.body))

  const list = (await call('GET', '/recurrences')).body.recurrences as {
    id: string
    title: string
    nextAt: string | null
    upcomingCount: number
  }[]
  assert.equal(list.length, 2)

  for (const series of list) {
    const [truth] = await h.sql`
      select min(due_at) as next, count(*)::int as n from commitments
      where recurrence_id = ${series.id} and status = 'pending' and due_at >= now()`
    assert.ok(truth!.n > 0, series.title)
    assert.equal(series.upcomingCount, truth!.n, series.title)
    assert.equal(new Date(series.nextAt!).getTime(), new Date(truth!.next as string).getTime(), series.title)
  }
})

test('a series with nothing written ahead still says when it comes next', async () => {
  // A yearly reminder: the next one is far past the rolling window of plans.
  const far = new Date()
  far.setMonth(far.getMonth() + 10)
  const made = await call('POST', '/recurrences', {
    title: 'Renew the car insurance',
    startsOn: ymd(far),
    rule: { freq: 'yearly', byMonth: far.getMonth(), byMonthDay: far.getDate() },
  })
  assert.equal(made.status, 201, JSON.stringify(made.body))

  const list = (await call('GET', '/recurrences')).body.recurrences as {
    title: string
    nextAt: string | null
    upcomingCount: number
  }[]
  const yearly = list.find((r) => r.title === 'Renew the car insurance')!
  assert.equal(yearly.upcomingCount, 0)
  assert.ok(yearly.nextAt)
  assert.equal(ymd(new Date(yearly.nextAt!)), ymd(far))
})
