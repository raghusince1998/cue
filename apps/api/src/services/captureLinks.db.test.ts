import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * What a typed plan already knows about: the person it names (certain, or a
 * choice), a place or account named in part, and the trip a plan in another
 * city belongs to.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./captureLinks.ts')

before(async () => {
  h = await createTestDb('capture_links')
  process.env.DATABASE_URL = h.url
  svc = await import('./captureLinks.ts')
  me = await seedUser(h.sql, 'capture@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from contacts`
  await h.sql`delete from places`
  await h.sql`delete from trips`
  await h.sql`delete from intentions`
  await h.sql`update users set home_city = null`
})

async function person(name: string, role: string | null = null, organization: string | null = null) {
  const [row] = await h.sql<{ id: string }[]>`
    insert into contacts (org_id, name, role, organization) values (${me.orgId}, ${name}, ${role}, ${organization})
    returning id`
  return row!.id
}

test('one Raghu is certain; a Raghunath is only a possibility', async () => {
  const raghu = await person('Raghu Kumar', 'Purchase manager', 'Infosys')
  const raghunath = await person('Raghunath S')
  await person('Priya Shah')

  const links = await svc.findLinks(me.orgId, 'call raghu tomorrow 4pm', { contactId: null })
  assert.deepEqual(
    links.people.map((p) => [p.id, p.certain, p.detail]),
    [
      [raghu, true, 'Purchase manager at Infosys'],
      [raghunath, false, null],
    ],
  )
})

test('two Priyas: a choice, not a guess', async () => {
  await person('Priya Shah')
  await person('Priya Nair')
  const links = await svc.findLinks(me.orgId, 'lunch with priya friday', { contactId: null })
  assert.deepEqual(links.people.map((p) => [p.name, p.certain]), [
    ['Priya Nair', false],
    ['Priya Shah', false],
  ])
})

test('a clinic named in part is offered; named in full, or through its doctor, it needs no offer', async () => {
  await person('Dr. Anil Mehta', 'Physiotherapist', 'Mehta Physio Clinic')
  const partial = await svc.findLinks(me.orgId, 'demo at mehta physio friday 11', { contactId: null })
  assert.deepEqual(partial.accounts, [{ name: 'Mehta Physio Clinic', people: 1 }])

  const full = await svc.findLinks(me.orgId, 'demo at Mehta Physio Clinic friday 11', { contactId: null })
  assert.deepEqual(full.accounts, [])

  const viaDoctor = await svc.findLinks(me.orgId, 'call Anil Mehta about the demo', { contactId: null })
  assert.equal(viaDoctor.people[0]!.certain, true)
  assert.deepEqual(viaDoctor.accounts, [], 'reached through him')
})

test('saved places by their distinctive word, and nothing from ordinary words', async () => {
  await h.sql`insert into places (org_id, name, kind, lat, lng) values (${me.orgId}, 'Apollo Clinic Powai', 'clinic', 19.1, 72.9)`
  const links = await svc.findLinks(me.orgId, 'visit apollo tomorrow morning', { contactId: null })
  assert.deepEqual(links.places.map((p) => p.name), ['Apollo Clinic Powai'])

  await person('Monday Group') // a contact named like a weekday
  const plain = await svc.findLinks(me.orgId, 'call the office on monday', { contactId: null })
  assert.deepEqual(plain, { people: [], places: [], accounts: [] })
})

test('a plan in another city belongs to a trip there, with what was saved for it', async () => {
  await h.sql`insert into intentions (org_id, user_id, title, place_label) values (${me.orgId}, ${me.userId}, 'visit Apollo Clinic', 'pune')`
  const at = new Date(2026, 9, 15, 11)

  const fresh = await svc.tripLinkFor(me.userId, 'client meeting in Pune 15 oct 11am', 'Pune', at)
  assert.deepEqual(
    { ...fresh, waiting: fresh!.waiting.map((w) => w.title) },
    { placeLabel: 'Pune', day: '2026-10-15', existing: null, waiting: ['visit Apollo Clinic'] },
  )

  const [trip] = await h.sql<{ id: string }[]>`
    insert into trips (org_id, user_id, place_label, starts_on, ends_on)
    values (${me.orgId}, ${me.userId}, 'Pune', '2026-10-14', '2026-10-16') returning id`
  const joined = await svc.tripLinkFor(me.userId, 'client meeting pune 15 oct 11am', null, at)
  assert.equal(joined!.existing!.id, trip!.id, 'joins the trip already there')

  await h.sql`update users set home_city = 'pune' where id = ${me.userId}`
  assert.equal(await svc.tripLinkFor(me.userId, 'client meeting in Pune', 'Pune', at), null, 'home is not a trip')

  assert.equal(await svc.tripLinkFor(me.userId, 'team review in the boardroom', null, at), null)
})

test('a place this person has made trips to counts as a city', async () => {
  await h.sql`
    insert into trips (org_id, user_id, place_label, starts_on, ends_on)
    values (${me.orgId}, ${me.userId}, 'Kumta', '2026-09-01', '2026-09-02')`
  const link = await svc.tripLinkFor(me.userId, 'stock check at kumta depot', null, new Date(2026, 9, 20, 10))
  assert.equal(link!.placeLabel, 'Kumta')
  assert.equal(await svc.upcomingTripTo(me.userId, 'kumta', new Date(2026, 9, 9)), null, 'that trip is over')
})
