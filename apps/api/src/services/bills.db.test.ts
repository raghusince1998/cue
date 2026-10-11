import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Bills: paying moves one to its next due date and keeps the payment; a
 * renewal moves to its new expiry; reminders go on the reminder day, the due
 * day and the day after — once a day, in the person's daytime.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./bills.ts')

before(async () => {
  h = await createTestDb('bills')
  process.env.DATABASE_URL = h.url
  svc = await import('./bills.ts')
  me = await seedUser(h.sql, 'bills@test.local')
  other = await seedUser(h.sql, 'bills-other@test.local')
  await h.sql`update users set timezone = 'Asia/Kolkata'`
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from bills`
})

test('paid: on to the next due date, keeping its day; once: done', async () => {
  const rent = await svc.createBill(me.orgId, me.userId, { name: 'Rent', amountPaise: 1500000, dueOn: '2026-01-31' })
  assert.equal(rent.repeat, 'monthly')
  assert.equal(rent.category, 'rent')
  assert.equal(rent.remindDays, 3)

  assert.equal(await svc.payBill(other.userId, rent.id, {}), null, 'not theirs')
  const feb = await svc.payBill(me.userId, rent.id, { paidOn: '2026-01-30' })
  assert.equal(feb!.dueOn, '2026-02-28')
  assert.equal(feb!.lastPaidOn, '2026-01-30')
  const mar = await svc.payBill(me.userId, rent.id, { paidOn: '2026-02-27', amountPaise: 1550000 })
  assert.equal(mar!.dueOn, '2026-03-31', 'back on the 31st')
  assert.deepEqual(
    (await svc.billPaymentsOf(me.userId, rent.id))!.map((x) => [x.dueOn, x.amountPaise]),
    [
      ['2026-02-28', 1550000],
      ['2026-01-31', 1500000],
    ],
  )

  const back = await svc.undoPayment(me.userId, rent.id)
  assert.equal(back!.dueOn, '2026-02-28')
  assert.equal(back!.lastPaidOn, '2026-01-30')

  const fine = await svc.createBill(me.orgId, me.userId, { name: 'Traffic fine', amountPaise: 50000, dueOn: '2026-02-10', repeat: 'none' })
  const paid = await svc.payBill(me.userId, fine.id, {})
  assert.equal(paid!.active, false)
})

test('a renewal waits a month ahead and moves to its new expiry', async () => {
  const passport = await svc.createBill(me.orgId, me.userId, { name: 'Passport', kind: 'renewal', dueOn: '2027-03-12' })
  assert.equal(passport.repeat, 'none')
  assert.equal(passport.remindDays, 30)
  assert.equal(passport.category, 'document')
  const renewed = await svc.payBill(me.userId, passport.id, { nextDueOn: '2037-03-11' })
  assert.equal(renewed!.active, true)
  assert.equal(renewed!.dueOn, '2037-03-11')
})

test('the month at a glance', async () => {
  const now = new Date('2026-10-11T06:00:00Z')
  await svc.createBill(me.orgId, me.userId, { name: 'Electricity', amountPaise: 120000, dueOn: '2026-10-09' })
  await svc.createBill(me.orgId, me.userId, { name: 'Internet', amountPaise: 99900, dueOn: '2026-10-15' })
  await svc.createBill(me.orgId, me.userId, { name: 'Insurance', amountPaise: 840000, dueOn: '2027-01-20', repeat: 'yearly' })
  await svc.createBill(me.orgId, me.userId, { name: 'Passport', kind: 'renewal', dueOn: '2026-10-12' })
  const phone = await svc.createBill(me.orgId, me.userId, { name: 'Phone', amountPaise: 59900, dueOn: '2026-10-05' })
  await svc.payBill(me.userId, phone.id, { paidOn: '2026-10-05' })
  await svc.createBill(other.orgId, other.userId, { name: 'Not mine', amountPaise: 100, dueOn: '2026-10-10' })

  const { bills, month } = await svc.listBills(me.userId, now)
  assert.deepEqual(bills.map((x) => x.name), ['Electricity', 'Passport', 'Internet', 'Phone', 'Insurance'])
  assert.deepEqual(month, { duePaise: 120000 + 99900, paidPaise: 59900, overdue: 1, dueThisWeek: 1 })
})

test('reminders: the reminder day, the due day, the day after — once, in daytime', async () => {
  // 10:00 in Kolkata on 11 October.
  const morning = new Date('2026-10-11T04:30:00Z')
  const make = (name: string, dueOn: string, extra: Record<string, unknown> = {}) =>
    svc.createBill(me.orgId, me.userId, { name, amountPaise: 10000, dueOn, ...extra })
  await make('Three days off', '2026-10-14')
  await make('Today', '2026-10-11')
  await make('Yesterday', '2026-10-10')
  await make('Two days off', '2026-10-13')
  await make('Autopay today', '2026-10-11', { autopay: true })
  await make('Autopay ahead', '2026-10-14', { autopay: true })
  await make('Long gone', '2026-10-01')

  const names = async (at: Date) => (await svc.billsToRemind(at)).map((x) => x.name).sort()
  assert.deepEqual(await names(morning), ['Autopay ahead', 'Three days off', 'Today', 'Yesterday'])
  assert.deepEqual(await names(new Date('2026-10-10T20:30:00Z')), [], '2am in Kolkata: wait for morning')

  assert.equal(await svc.runBillReminders(morning), 1, 'one notification for all of them')
  assert.deepEqual(await names(morning), [], 'not twice in a day')
})
