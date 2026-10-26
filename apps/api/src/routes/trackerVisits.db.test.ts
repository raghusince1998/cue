import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * A visit or a call logged on a deal: it is one of the visits and calls People
 * and the day's report count, the person met becomes who the deal is with,
 * where you stood becomes where the deal is — and what is typed most is
 * offered back the next time.
 */

let h: Harness
let me: Seeded
let app: FastifyInstance
let token: string

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: Record<string, unknown>) {
  const res = await app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}

before(async () => {
  h = await createTestDb('trackervisits')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { trackerRoutes } = await import('./trackers.ts')
  me = await seedUser(h.sql, 'visits@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(trackerRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'visits@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

// Connaught Place, and a spot about 60 m away.
const HERE = { lat: 28.6315, lng: 77.2167 }
const NEARBY = { lat: 28.6320, lng: 77.2169 }

test('a visit with someone new: saved to People, the deal is with them, and where it is', async () => {
  const deal = await call('POST', '/trackers/deals', { title: 'SK Clinic', detail: 'Application demo' })
  assert.equal(deal.status, 201)

  const visit = await call('POST', `/tracker-items/${deal.body.id}/updates`, {
    kind: 'visit',
    outcome: 'Interested',
    note: 'Wants a demo for the front desk next week',
    person: { name: 'Dr Sharma', phone: '98111 22233' },
    ...HERE,
    accuracyM: 12,
    savePlace: true,
  })
  assert.equal(visit.status, 201, JSON.stringify(visit.body))
  assert.equal(visit.body.contactCreated, true)
  assert.equal(visit.body.placeSaved, true)
  assert.equal(visit.body.update.contactName, 'Dr Sharma')
  assert.equal(visit.body.update.kind, 'visit')

  const after = await call('GET', `/tracker-items/${deal.body.id}`)
  assert.equal(after.body.contactName, 'Dr Sharma')
  assert.equal(after.body.place.name, 'SK Clinic')
  assert.equal(after.body.lastUpdate.outcome, 'Interested')
  assert.equal(after.body.updates.length, 1)
  assert.equal(after.body.updates[0].notes, 'Wants a demo for the front desk next week')

  // One of the visits everything else counts: at the place, with the person, linked to the deal.
  const [row] = await h.sql<{ channel: string; purpose: string; place_id: string | null; contact_id: string | null }[]>`
    select channel, purpose, place_id, contact_id from interactions where tracker_item_id = ${deal.body.id}`
  assert.equal(row!.channel, 'visit')
  assert.equal(row!.purpose, 'business')
  assert.equal(row!.place_id, after.body.place.id)
  assert.equal(row!.contact_id, after.body.contactId)
})

test('a second deal at the same clinic finds the place already saved', async () => {
  const deal = await call('POST', '/trackers/deals', { title: 'sk clinic', detail: 'App setup' })
  const visit = await call('POST', `/tracker-items/${deal.body.id}/updates`, { kind: 'visit', ...NEARBY, savePlace: true })
  assert.equal(visit.body.placeSaved, true)
  const places = await h.sql<{ n: number }[]>`select count(*)::int as n from places where org_id = ${me.orgId}`
  assert.equal(places[0]!.n, 1)
})

test('nobody named: the visit is with whoever the deal is with; a place is never saved unasked', async () => {
  const deal = await call('POST', '/trackers/deals', {
    title: 'City Care Hospital',
    detail: 'Application demo',
    person: { name: 'Meena Iyer', phone: '98222 33344' },
  })
  const visit = await call('POST', `/tracker-items/${deal.body.id}/updates`, { kind: 'visit', outcome: 'Already uses one', ...HERE })
  assert.equal(visit.status, 201)
  assert.equal(visit.body.update.contactName, 'Meena Iyer')
  assert.equal(visit.body.placeSaved, false)
  const after = await call('GET', `/tracker-items/${deal.body.id}`)
  assert.equal(after.body.place, null)
})

test('a call nobody answered is logged, not counted as contact', async () => {
  const deal = await call('POST', '/trackers/deals', { title: 'Lotus Dental', detail: 'Application demo' })
  const rang = await call('POST', `/tracker-items/${deal.body.id}/updates`, { kind: 'call', outcome: 'No answer', connected: false })
  assert.equal(rang.status, 201)
  const [row] = await h.sql<{ channel: string; connected: boolean; place_id: string | null }[]>`
    select channel, connected, place_id from interactions where id = ${rang.body.update.id}`
  assert.deepEqual(row, { channel: 'call', connected: false, place_id: null })
})

test('a deal visited lately has not gone quiet, though its stage is old', async () => {
  const visited = await call('POST', '/trackers/deals', { title: 'Apollo Pharmacy', detail: 'Billing app' })
  const left = await call('POST', '/trackers/deals', { title: 'Max Labs', detail: 'Billing app' })
  await h.sql`update tracker_items set stage_changed_at = now() - interval '480 hours' where id in (${visited.body.id}, ${left.body.id})`
  await call('POST', `/tracker-items/${visited.body.id}/updates`, { kind: 'visit', outcome: 'Will think about it' })

  const board = await call('GET', '/trackers/deals')
  const byId = new Map((board.body as unknown as { id: string; quietDays: number | null }[]).map((i) => [i.id, i]))
  assert.equal(byId.get(visited.body.id)!.quietDays, null)
  assert.equal(byId.get(left.body.id)!.quietDays, 20)
})

test('what a deal is for, and the usual next step, most used first', async () => {
  const deals = (await call('GET', '/trackers/deals')).body as unknown as { id: string }[]
  for (const [i, title] of ['Visit again for setup', 'Send the quote', 'visit again for setup'].entries()) {
    await h.sql`insert into commitments (org_id, user_id, title, due_at, tracker_item_id)
      values (${me.orgId}, ${me.userId}, ${title}, now() + ${`${i + 1} days`}::interval, ${deals[0]!.id})`
  }
  const got = await call('GET', '/trackers/deals/suggestions')
  assert.equal(got.status, 200)
  // "Application demo" three times, "Billing app" twice, "App setup" once.
  assert.deepEqual(got.body.details.slice(0, 3), ['Application demo', 'Billing app', 'App setup'])
  // Said twice, in two casings: offered once, as typed last.
  assert.deepEqual(got.body.nextSteps, ['visit again for setup', 'Send the quote'])

  const jobs = await call('GET', '/trackers/jobs/suggestions')
  assert.deepEqual(jobs.body, { details: [], nextSteps: [] })
})

test('a visit can be taken back; another account’s deal cannot be written to', async () => {
  const deal = await call('POST', '/trackers/deals', { title: 'Sunrise Clinic' })
  const visit = await call('POST', `/tracker-items/${deal.body.id}/updates`, { kind: 'visit', note: 'Closed today' })
  const gone = await call('DELETE', `/tracker-items/${deal.body.id}/updates/${visit.body.update.id}`)
  assert.equal(gone.status, 200)
  assert.equal((await call('GET', `/tracker-items/${deal.body.id}`)).body.updates.length, 0)

  const other = await seedUser(h.sql, 'other@test.local')
  const [theirs] = await h.sql<{ id: string }[]>`
    insert into tracker_items (org_id, user_id, board, title, stage) values (${other.orgId}, ${other.userId}, 'deals', 'Theirs', 'lead') returning id`
  const denied = await call('POST', `/tracker-items/${theirs!.id}/updates`, { kind: 'visit' })
  assert.equal(denied.status, 404)
})

test('where a deal is: saved from where you stand, and taken off again', async () => {
  const deal = await call('POST', '/trackers/deals', { title: 'Green Valley Clinic' })
  const placed = await call('PATCH', `/tracker-items/${deal.body.id}`, { here: { ...HERE, address: 'Block B, Connaught Place' } })
  assert.equal(placed.body.place.name, 'Green Valley Clinic')
  assert.equal(placed.body.place.address, 'Block B, Connaught Place')
  const cleared = await call('PATCH', `/tracker-items/${deal.body.id}`, { placeId: null })
  assert.equal(cleared.body.place, null)
})

test('what was said: spoken into a clip while logging, and put right afterwards', async () => {
  const deal = await call('POST', '/trackers/deals', { title: 'Shanti Nursing Home', detail: 'Application demo' })
  const [clip] = await h.sql<{ id: string }[]>`
    insert into voice_notes (org_id, user_id, mime_type, size_bytes, audio)
    values (${me.orgId}, ${me.userId}, 'audio/webm', 3, ${Buffer.from([1, 2, 3])}) returning id`
  const visit = await call('POST', `/tracker-items/${deal.body.id}/updates`, {
    kind: 'visit',
    outcome: 'Interested',
    voiceNoteIds: [clip!.id],
  })
  assert.equal(visit.status, 201)
  assert.equal(visit.body.update.voiceNotes, 1)

  const edited = await call('PATCH', `/tracker-items/${deal.body.id}/updates/${visit.body.update.id}`, {
    note: 'Owner wants it in Hindi; will decide after Diwali',
    outcome: 'Will think about it',
  })
  assert.equal(edited.status, 200)
  const [entry] = (await call('GET', `/tracker-items/${deal.body.id}`)).body.updates
  assert.equal(entry.notes, 'Owner wants it in Hindi; will decide after Diwali')
  assert.equal(entry.outcome, 'Will think about it')
  assert.equal(entry.voiceNotes, 1)

  // Taken back: its clips go with it.
  await call('DELETE', `/tracker-items/${deal.body.id}/updates/${visit.body.update.id}`)
  const left = await h.sql<{ n: number }[]>`select count(*)::int as n from voice_notes where id = ${clip!.id}`
  assert.equal(left[0]!.n, 0)

  const missing = await call('PATCH', `/tracker-items/${deal.body.id}/updates/${visit.body.update.id}`, { note: 'x' })
  assert.equal(missing.status, 404)
})
