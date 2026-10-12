import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { parseDelivery } from '@cue/shared'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Deliveries: the next message about a parcel moves it along instead of
 * adding another, never backwards; and the morning it is due, one reminder.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./deliveries.ts')

before(async () => {
  h = await createTestDb('deliveries')
  process.env.DATABASE_URL = h.url
  svc = await import('./deliveries.ts')
  me = await seedUser(h.sql, 'deliveries@test.local')
  other = await seedUser(h.sql, 'deliveries-other@test.local')
  await h.sql`update users set timezone = 'Asia/Kolkata'`
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from deliveries`
})

// 9:00 in Kolkata on Monday 12 October.
const morning = new Date('2026-10-12T03:30:00Z')
const read = (text: string) => parseDelivery(text, new Date(2026, 9, 12, 9, 0))!

test('one parcel, three messages: shipped, out for delivery, delivered', async () => {
  const shipped = await svc.recordDelivery(me.orgId, me.userId, read(
    'Shipped: Your Redmi Note 13 5G with order ID OD430012345678901234 has been shipped and will be delivered by Thu, Oct 15. Track: http://fkrt.it/xyz',
  ))
  assert.equal(shipped.created, true)
  assert.equal(shipped.delivery.store, 'Flipkart')

  const out = await svc.recordDelivery(me.orgId, me.userId, read(
    'Out for Delivery: Redmi Note 13 5G (Black, 128 GB) from Flipkart will be delivered today by Ekart Agent. Please pay Rs.17,999 at the time of delivery.',
  ))
  assert.equal(out.created, false, 'the same parcel, by shop and item')
  assert.equal(out.delivery.id, shipped.delivery.id)
  assert.equal(out.delivery.status, 'out_for_delivery')
  assert.equal(out.delivery.expectedOn, '2026-10-12')
  assert.equal(out.delivery.codPaise, 1799900)
  assert.equal(out.delivery.item, 'Redmi Note 13 5G', 'the first name it was given stays')

  const late = await svc.recordDelivery(me.orgId, me.userId, read(
    'Shipped: Your Redmi Note 13 5G with order ID OD430012345678901234 has been shipped and will be delivered by Thu, Oct 15.',
  ))
  assert.equal(late.delivery.status, 'out_for_delivery', 'an old message moves nothing back')

  const done = await svc.recordDelivery(me.orgId, me.userId, read('Delivered: Redmi Note 13 5G from Flipkart was delivered successfully.'))
  assert.equal(done.delivery.status, 'delivered')
  assert.ok(done.delivery.deliveredAt)
  assert.equal((await h.sql`select count(*)::int as n from deliveries`)[0]!.n, 1)
})

test('two parcels from one shop stay two', async () => {
  await svc.recordDelivery(me.orgId, me.userId, read('Your Myntra order with HRX T-shirt is out for delivery and will reach you today.'))
  const shoes = await svc.recordDelivery(me.orgId, me.userId, read('Your Myntra order with Puma running shoes will be delivered by 16 Oct.'))
  assert.equal(shoes.created, true)
  const list = await svc.activeDeliveries(me.userId, morning)
  assert.deepEqual(list.map((x) => x.item), ['HRX T-shirt', 'Puma running shoes'], 'soonest first')
  assert.deepEqual(await svc.activeDeliveries(other.userId, morning), [])
})

test('got it, and gone from the list after the day', async () => {
  const { delivery } = await svc.recordDelivery(me.orgId, me.userId, read('Your Meesho order for Women Kurti will be delivered by 16 Oct. Keep Rs 349 ready for Cash on Delivery.'))
  assert.equal(await svc.updateDelivery(other.userId, delivery.id, { status: 'delivered' }), null)
  const got = await svc.updateDelivery(me.userId, delivery.id, { status: 'delivered' })
  assert.equal(got!.status, 'delivered')
  assert.equal((await svc.activeDeliveries(me.userId)).length, 1, 'still shown, ticked, for a few hours')
  assert.equal((await svc.activeDeliveries(me.userId, new Date(Date.now() + 13 * 3_600_000))).length, 0)
})

test('the morning it is due: one reminder for everything arriving', async () => {
  await svc.recordDelivery(me.orgId, me.userId, read('Your Myntra order with HRX T-shirt is out for delivery and will reach you today.'))
  await svc.recordDelivery(me.orgId, me.userId, read('Your Meesho order for Women Kurti will be delivered today. Keep Rs 349 ready for Cash on Delivery.'))
  await svc.recordDelivery(me.orgId, me.userId, read('Your Amazon order #402-1234567-1234567 for Kettle has shipped and will be delivered by Wednesday, October 14.'))

  assert.deepEqual((await svc.deliveriesToRemind(morning)).map((x) => x.item).sort(), ['HRX T-shirt', 'Women Kurti'])
  assert.equal((await svc.deliveriesToRemind(new Date('2026-10-11T20:30:00Z'))).length, 0, 'two in the morning: wait')
  assert.equal(await svc.runDeliveryReminders(morning), 1)
  assert.equal((await svc.deliveriesToRemind(morning)).length, 0, 'once a day')
})
