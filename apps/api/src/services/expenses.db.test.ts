import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Expenses: on the trip they were spent on, totalled by the month, and
 * claimed and reimbursed in batches — only ever by their owner.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./expenses.ts')

before(async () => {
  h = await createTestDb('expenses')
  process.env.DATABASE_URL = h.url
  svc = await import('./expenses.ts')
  me = await seedUser(h.sql, 'expenses@test.local')
  other = await seedUser(h.sql, 'someone@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from expenses`
  await h.sql`delete from trips`
})

test('spent while away: on that trip without being told', async () => {
  const [trip] = await h.sql<{ id: string }[]>`
    insert into trips (org_id, user_id, place_label, starts_on, ends_on)
    values (${me.orgId}, ${me.userId}, 'Pune', '2026-10-14', '2026-10-16') returning id`

  const cab = await svc.createExpense(me.orgId, me.userId, { amountPaise: 45000, category: 'travel', note: ' cab to Mehta Physio ', spentOn: '2026-10-15' })
  assert.equal(cab.tripId, trip!.id)
  assert.equal(cab.tripLabel, 'Pune')
  assert.equal(cab.note, 'cab to Mehta Physio')

  const home = await svc.createExpense(me.orgId, me.userId, { amountPaise: 12000, category: 'food', spentOn: '2026-10-20' })
  assert.equal(home.tripId, null, 'no trip that day')
  const toldNot = await svc.createExpense(me.orgId, me.userId, { amountPaise: 5000, category: 'other', spentOn: '2026-10-15', tripId: null })
  assert.equal(toldNot.tripId, null, 'told it is not on the trip')

  const moved = await svc.updateExpense(me.userId, home.id, { spentOn: '2026-10-16' })
  assert.equal(moved!.tripId, trip!.id, 'moved onto a trip day, so on the trip')
  const back = await svc.updateExpense(me.userId, home.id, { spentOn: '2026-10-21' })
  assert.equal(back!.tripId, null, 'and off it again')

  const [rao] = await h.sql<{ id: string }[]>`
    insert into contacts (org_id, name, organization) values (${me.orgId}, 'Dr. Rao', 'Sunrise Hospital') returning id`
  const lunch = await svc.createExpense(me.orgId, me.userId, { amountPaise: 90000, category: 'food', spentOn: '2026-10-20', contactId: rao!.id })
  assert.equal(lunch.account, 'Sunrise Hospital', 'where the person works')
  assert.equal(lunch.contactName, 'Dr. Rao')
})

test('a month, with what is still to be claimed', async () => {
  const a = await svc.createExpense(me.orgId, me.userId, { amountPaise: 45000, category: 'travel', spentOn: '2026-10-15' })
  const b = await svc.createExpense(me.orgId, me.userId, { amountPaise: 125000, category: 'food', spentOn: '2026-10-02' })
  await svc.createExpense(me.orgId, me.userId, { amountPaise: 30000, category: 'travel', spentOn: '2026-10-31' })
  await svc.createExpense(me.orgId, me.userId, { amountPaise: 99900, category: 'stay', spentOn: '2026-09-30' })
  await svc.createExpense(other.orgId, other.userId, { amountPaise: 777700, category: 'stay', spentOn: '2026-10-10' })

  assert.equal(await svc.setClaim(me.userId, [a.id, b.id], 'claimed'), 2)
  assert.equal(await svc.setClaim(other.userId, [a.id], 'reimbursed'), 0, "not someone else's to change")

  const october = await svc.expenseMonth(me.userId, '2026-10')
  assert.deepEqual(october.expenses.map((x) => x.spentOn), ['2026-10-31', '2026-10-15', '2026-10-02'], 'newest first, this month only')
  assert.deepEqual(october.totals, {
    all: 200000,
    unclaimed: 30000,
    claimed: 170000,
    reimbursed: 0,
    people: 0,
    byCategory: { travel: 75000, food: 125000 },
  })
  assert.ok(october.expenses.find((x) => x.id === a.id)!.claimedAt)

  // What a claim is usually made of: everything unclaimed, across months.
  assert.deepEqual((await svc.unclaimed(me.userId)).map((x) => x.spentOn), ['2026-09-30', '2026-10-31'])

  assert.deepEqual((await svc.awaitingPayment(me.userId)).map((x) => x.id).sort(), [a.id, b.id].sort())
  await svc.setClaim(me.userId, [b.id], 'reimbursed')
  assert.deepEqual((await svc.awaitingPayment(me.userId)).map((x) => x.id), [a.id], 'paid back is off the list')

  await svc.setClaim(me.userId, [a.id], 'unclaimed')
  assert.equal((await svc.expenseById(me.userId, a.id))!.claimedAt, null)
})

test('receipts and changes belong to the owner alone', async () => {
  const x = await svc.createExpense(me.orgId, me.userId, { amountPaise: 45000, category: 'travel', spentOn: '2026-10-15' })
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  assert.equal(await svc.setReceipt(other.userId, x.id, image, 'image/jpeg'), false)
  assert.equal(await svc.setReceipt(me.userId, x.id, image, 'image/jpeg'), true)
  assert.equal((await svc.expenseById(me.userId, x.id))!.hasReceipt, true)
  assert.deepEqual((await svc.receiptOf(me.userId, x.id))!.image, image)
  assert.equal(await svc.receiptOf(other.userId, x.id), null)

  assert.equal(await svc.updateExpense(other.userId, x.id, { amountPaise: 1 }), null)
  assert.equal((await svc.updateExpense(me.userId, x.id, { amountPaise: 50000, note: 'cab both ways' }))!.amountPaise, 50000)
  assert.equal(await svc.deleteExpense(other.userId, x.id), false)
  assert.equal(await svc.deleteExpense(me.userId, x.id), true)
})
