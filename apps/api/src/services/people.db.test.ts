import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Everything between you and one person — and, as much, nothing that belongs
 * to someone else with the same first name.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./people.ts')

before(async () => {
  h = await createTestDb('people')
  process.env.DATABASE_URL = h.url
  svc = await import('./people.ts')
  me = await seedUser(h.sql, 'people@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from contacts`
})

/** Friday 9 October 2026, noon. */
const NOW = new Date(2026, 9, 9, 12, 0)
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0)

async function contact(name: string): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into contacts (org_id, name) values (${me.orgId}, ${name}) returning id`
  return row!.id
}

async function add(
  title: string,
  dueAt: Date,
  opts: { kind?: string; status?: string; waitingOn?: string; contactId?: string; from?: string } = {},
): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, kind, due_at, status, waiting_on, contact_id, from_commitment_id)
    values (${me.orgId}, ${me.userId}, ${title}, ${opts.kind ?? 'task'}, ${dueAt}, ${opts.status ?? 'pending'},
            ${opts.waitingOn ?? null}, ${opts.contactId ?? null}, ${opts.from ?? null})
    returning id`
  return row!.id
}

test('names: the full name always, a first name only when it is unambiguous, whole words only', () => {
  const m = svc.matchersFor([
    { id: 'ravi', name: 'Ravi Kumar' },
    { id: 'priya', name: 'Priya Shah' },
    { id: 'priya2', name: 'Priya Nair' },
  ])
  const ravi = m.get('ravi')!
  assert.ok(ravi.isName('Ravi') && ravi.isName('ravi kumar') && ravi.isName(' Ravi  Kumar '))
  assert.ok(ravi.inTitle('Meeting with Ravi') && ravi.inTitle('Send Ravi Kumar the deck'))
  assert.ok(!ravi.inTitle('Ravindra sync'), 'part of a longer name is not the name')
  // Two Priyas: the first name alone is nobody in particular.
  assert.ok(!m.get('priya')!.isName('Priya'))
  assert.ok(m.get('priya')!.isName('Priya Shah'))
  assert.ok(!m.get('priya')!.inTitle('Lunch with Priya'))
})

test('what they owe you, what you owe them, and your meetings', async () => {
  const ravi = await contact('Ravi Kumar')
  await contact('Priya Shah')

  const last = await add('Client review', at(6, 10), { kind: 'meeting', status: 'done', contactId: ravi })
  await add('Earlier sync', at(1, 10), { kind: 'meeting', status: 'done', contactId: ravi })
  const proposal = await add('Send the revised proposal', at(12, 10), { from: last })
  const deck = await add('Send Ravi the deck', at(13, 10))
  const direct = await add('Book his flights', at(14, 10), { contactId: ravi })
  const contract = await add('Waiting on Ravi: signed contract', at(9, 9), { kind: 'followup', waitingOn: 'Ravi' })
  const next = await add('Meeting with Ravi', at(13, 15), { kind: 'meeting' })
  await add('Ravindra sync', at(13, 11), { kind: 'meeting' }) // somebody else
  await add('Waiting on Priya: numbers', at(12, 10), { kind: 'followup', waitingOn: 'Priya' })

  const links = await svc.personLinks(me.orgId, me.userId, ravi, NOW)
  assert.ok(links)
  assert.deepEqual(links!.waitingOnThem, [contract])
  assert.deepEqual(links!.youOwe, [proposal, deck, direct])
  assert.deepEqual(links!.nextMeetings, [next])
  assert.equal(links!.lastMeeting, last)
  assert.deepEqual(links!.lastMeetingFollowUps, [proposal])
  assert.equal(links!.meetingCount, 2)
  assert.equal(links!.firstMet?.getTime(), at(1, 10).getTime())
})

test('the list says what is open with each person, and who is mentioned but not saved', async () => {
  const ravi = await contact('Ravi Kumar')
  const priya = await contact('Priya Shah')
  await add('Waiting on Ravi: signed contract', at(9, 9), { kind: 'followup', waitingOn: 'Ravi' }) // due
  await add('Send Ravi the deck', at(13, 10))
  await add('Waiting on Anita: travel approval', at(12, 10), { kind: 'followup', waitingOn: 'Anita' })

  const s = await svc.peopleSummary(me.orgId, me.userId, NOW)
  assert.deepEqual(s.people[ravi], { waiting: 1, waitingDue: 1, owe: 1, next: null, lastMet: null })
  assert.equal(s.people[priya], undefined, 'nothing open with Priya')
  assert.deepEqual(s.unsaved, ['Anita'])
})
