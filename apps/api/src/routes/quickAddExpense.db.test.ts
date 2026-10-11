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

test('not an expense: a payment still to make, or a number that is not money', async () => {
  const rent = await quick.interpret(me.userId, me.orgId, 'pay ₹5,000 rent tomorrow')
  assert.notEqual(rent.kind, 'expense')
  const toPay = await quick.interpret(me.userId, me.orgId, 'pay ₹5,000 rent')
  assert.notEqual(toPay.kind, 'expense', 'still to pay, even with no date')
  const room = await quick.interpret(me.userId, me.orgId, 'meeting in room 204 tomorrow 3pm')
  assert.notEqual(room.kind, 'expense')
})
