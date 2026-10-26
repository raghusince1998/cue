import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * A deal with someone new: they are saved to People as the deal is — never
 * twice, found again by phone or by name — and the deal says why it closed
 * and when it is expected to.
 */

let h: Harness
let me: Seeded
let app: FastifyInstance
let token: string

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, body?: Record<string, unknown>) {
  const res = await app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}

before(async () => {
  h = await createTestDb('trackerpeople')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { trackerRoutes } = await import('./trackers.ts')
  me = await seedUser(h.sql, 'deals@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(trackerRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'deals@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

const people = () => h.sql<{ id: string; name: string; phone: string | null; organization: string | null }[]>`
  select id, name, phone, organization from contacts where org_id = ${me.orgId} order by created_at`

test('someone new on a deal is saved to People, at the client', async () => {
  const deal = await call('POST', '/trackers/deals', {
    title: 'Tata Motors',
    detail: '50 laptops',
    valuePaise: 2_500_000_00,
    expectedCloseOn: '2026-11-30',
    person: { name: 'Ravi Kumar', phone: '+91 98765 43210' },
  })
  assert.equal(deal.status, 201, JSON.stringify(deal.body))
  assert.equal(deal.body.contactCreated, true)
  assert.equal(deal.body.contactName, 'Ravi Kumar')
  assert.equal(deal.body.contactPhone, '+91 98765 43210')
  assert.equal(deal.body.expectedCloseOn, '2026-11-30')

  const saved = await people()
  assert.equal(saved.length, 1)
  assert.equal(saved[0]!.organization, 'Tata Motors')
})

test('the same number again is the same person, however the name is typed', async () => {
  const again = await call('POST', '/trackers/deals', {
    title: 'Tata Motors',
    detail: 'Service contract',
    person: { name: 'Ravi K', phone: '09876543210' },
  })
  assert.equal(again.status, 201)
  assert.equal(again.body.contactCreated, false)
  assert.equal(again.body.contactName, 'Ravi Kumar')
  assert.equal((await people()).length, 1)
})

test('a name already in People, with no number, is that person — and gains the number given', async () => {
  await h.sql`insert into contacts (org_id, name) values (${me.orgId}, 'Meera Shah')`
  const deal = await call('POST', '/trackers/deals', {
    title: 'Infosys',
    person: { name: 'meera shah', phone: '9123456780' },
  })
  assert.equal(deal.body.contactCreated, false)
  assert.equal(deal.body.contactName, 'Meera Shah')
  const [meera] = await h.sql`select phone from contacts where name = 'Meera Shah'`
  assert.equal(meera!.phone, '9123456780')
})

test('a client who is a person is not saved as working at themselves', async () => {
  const deal = await call('POST', '/trackers/deals', { title: 'Anil Gupta', person: { name: 'Anil Gupta' } })
  assert.equal(deal.body.contactCreated, true)
  const [anil] = await h.sql`select organization from contacts where name = 'Anil Gupta'`
  assert.equal(anil!.organization, null)
})

test('lost, with why; opened again, the reason goes', async () => {
  const deal = await call('POST', '/trackers/deals', { title: 'Wipro', detail: 'Cloud migration' })
  const lost = await call('PATCH', `/tracker-items/${deal.body.id}`, { stage: 'lost', closeReason: 'Went with a competitor' })
  assert.equal(lost.status, 200)
  assert.equal(lost.body.closeReason, 'Went with a competitor')
  assert.ok(lost.body.closedAt)

  const reopened = await call('PATCH', `/tracker-items/${deal.body.id}`, { stage: 'negotiation' })
  assert.equal(reopened.body.closeReason, null)
  assert.equal(reopened.body.closedAt, null)
})

test('a person added later from the deal itself', async () => {
  const deal = await call('POST', '/trackers/deals', { title: 'HCL' })
  assert.equal(deal.body.contactId, null)
  const linked = await call('PATCH', `/tracker-items/${deal.body.id}`, {
    person: { name: 'Sunita Rao', phone: '9988776655', email: 'sunita@hcl.example' },
  })
  assert.equal(linked.body.contactCreated, true)
  assert.equal(linked.body.contactName, 'Sunita Rao')
  assert.equal(linked.body.contactEmail, 'sunita@hcl.example')
  const [sunita] = await h.sql`select organization from contacts where name = 'Sunita Rao'`
  assert.equal(sunita!.organization, 'HCL')
})
