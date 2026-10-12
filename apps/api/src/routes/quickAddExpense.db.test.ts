import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * The capture box reading money spent: "₹450 cab to Mehta Physio" is an
 * expense for today, but a payment still to make is a plan, and a number that
 * is not named as money is not one at all.
 */
let h: Harness
let me: Seeded
let quick: typeof import('./quickAdd.ts')

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

before(async () => {
  h = await createTestDb('quick_expense')
  process.env.DATABASE_URL = h.url
  quick = await import('./quickAdd.ts')
  me = await seedUser(h.sql, 'quick-expense@test.local')
})

after(async () => {
  await h.close()
})

test('money spent is an expense, dated and on the trip', async () => {
  const today = new Date()
  const cab = await quick.interpret(me.userId, me.orgId, '₹450 cab to Mehta Physio')
  assert.equal(cab.kind, 'expense')
  assert.deepEqual(cab.expense, { amountPaise: 45000, category: 'travel', note: 'cab to Mehta Physio', spentOn: ymd(today) })
  assert.equal(cab.title, 'cab to Mehta Physio')

  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const lunch = await quick.interpret(me.userId, me.orgId, 'yesterday lunch with Dr Rao 1,250 rs')
  assert.equal(lunch.kind, 'expense')
  assert.equal(lunch.expense!.spentOn, ymd(yesterday))
  assert.equal(lunch.expense!.amountPaise, 125000)
  assert.equal(lunch.expense!.category, 'food')
  assert.ok(!/yesterday/i.test(lunch.title), `the day comes out of the note: ${lunch.title}`)
  assert.ok(lunch.assumptions.some((a) => a.startsWith('Spent on')))

  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  await h.sql`
    insert into trips (org_id, user_id, place_label, starts_on, ends_on)
    values (${me.orgId}, ${me.userId}, 'Pune', ${ymd(from)}, ${ymd(to)})`
  const parking = await quick.interpret(me.userId, me.orgId, 'paid 60 for parking')
  assert.equal(parking.kind, 'expense')
  assert.equal(parking.expense!.category, 'parking')
  assert.ok(parking.assumptions.includes('On your Pune trip.'))
})

test('owed to you: by a saved person when it is certainly them, by name when not', async () => {
  await h.sql`insert into contacts (org_id, name, organization) values (${me.orgId}, 'Ravi Kumar', 'Infosys')`
  const ravi = await quick.interpret(me.userId, me.orgId, 'Ravi owes me ₹500 for the tickets')
  assert.equal(ravi.kind, 'owed')
  assert.deepEqual(ravi.owed, { amountPaise: 50000, name: 'Ravi', note: 'the tickets' })

  const lent = await quick.interpret(me.userId, me.orgId, 'lent ₹2,000 to Priya')
  assert.equal(lent.kind, 'owed', 'lent is not spent')
  assert.equal(lent.owed!.name, 'Priya')
})

test('not an expense: a payment still to make, or a number that is not money', async () => {
  const rent = await quick.interpret(me.userId, me.orgId, 'pay ₹5,000 rent tomorrow')
  assert.notEqual(rent.kind, 'expense')
  const toPay = await quick.interpret(me.userId, me.orgId, 'pay ₹5,000 rent')
  assert.notEqual(toPay.kind, 'expense', 'still to pay, even with no date')
  const room = await quick.interpret(me.userId, me.orgId, 'meeting in room 204 tomorrow 3pm')
  assert.notEqual(room.kind, 'expense')
})

test('tracked: a new application, then an interview that is part of it', async () => {
  const applied = await quick.interpret(me.userId, me.orgId, 'applied to Zoho for the frontend developer role')
  assert.equal(applied.kind, 'tracker')
  assert.deepEqual(applied.tracker, { board: 'jobs', stage: 'applied', title: 'Zoho', detail: 'Frontend developer' })

  await h.sql`insert into tracker_items (org_id, user_id, board, title, stage) values (${me.orgId}, ${me.userId}, 'jobs', 'Zoho', 'applied')`
  const raw = 'interview at Zoho friday 11am'
  const interview = await quick.enrichForTest(me.userId, me.orgId, raw)
  assert.equal(interview.kind, 'commitment')
  assert.equal(interview.trackerItem!.title, 'Zoho')
  assert.equal(interview.trackerItem!.moveTo, 'interview')
  assert.ok(interview.assumptions.some((a) => a.includes('Zoho application')))
})

test('bills and renewals from one line', async () => {
  const rent = await quick.interpret(me.userId, me.orgId, 'rent ₹15,000 on the 1st every month')
  assert.equal(rent.kind, 'bill')
  assert.equal(rent.bill!.name, 'Rent')
  assert.equal(rent.bill!.amountPaise, 1500000)
  assert.equal(rent.bill!.repeat, 'monthly')
  const passport = await quick.interpret(me.userId, me.orgId, 'passport expires 12 march 2030')
  assert.equal(passport.kind, 'bill')
  assert.equal(passport.bill!.kind, 'renewal')
  assert.equal(passport.bill!.dueOn, '2030-03-12')
  const todo = await quick.interpret(me.userId, me.orgId, 'send the bill to Anita tomorrow 10am')
  assert.equal(todo.kind, 'commitment', 'a to-do about a bill is still a to-do')
})

test('a pasted delivery message is a parcel, not a wishlist or a plan', async () => {
  const fk = await quick.interpret(
    me.userId,
    me.orgId,
    'Out for Delivery: Redmi Note 13 5G (Black, 128 GB) from Flipkart will be delivered today by Ekart Agent. Please pay Rs.17,999 at the time of delivery. Track: http://fkrt.it/abc',
  )
  assert.equal(fk.kind, 'delivery')
  assert.equal(fk.delivery!.store, 'Flipkart')
  assert.ok(fk.summary.includes('arriving today'), fk.summary)
  assert.ok(fk.summary.includes('₹17,999 cash on delivery'), fk.summary)
  const done = await quick.interpret(me.userId, me.orgId, 'Delivered: Your package with Prestige Kettle was delivered. https://amzn.in/d/x9')
  assert.equal(done.kind, 'delivery')
})

test('a booking confirmation is a plan at the time it starts, on the trip it takes you on', async () => {
  const d = new Date()
  d.setDate(d.getDate() + 5)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  const sms = `PNR:2345678901,TRN:12951,DOJ:${dd}-${mm}-${yy},3A,MMCT-NDLS,DP:17:00,RAVI KUMAR+1,B2 45,Fare:3215 -IRCTC`
  const train = await quick.enrichForTest(me.userId, me.orgId, sms)
  assert.equal(train.kind, 'commitment')
  assert.equal(train.title, 'Train 12951 · Mumbai Central → New Delhi')
  assert.equal(new Date(train.dueAt!).getHours(), 17)
  assert.equal(train.booking!.city, 'Delhi')
  assert.equal(train.trip!.placeLabel, 'Delhi', 'a trip to Delhi is offered')
  assert.equal(train.links.people.length, 0, 'passengers are not people to link')
  assert.match(train.notes!, /PNR 2345678901/)

  const old = await quick.interpret(me.userId, me.orgId, 'PNR:2345678901,TRN:12951,DOJ:01-01-26,3A,MMCT-NDLS,DP:17:00 -IRCTC')
  assert.equal(old.kind, 'unclear')
  assert.match(old.problem!, /has passed/)
})
