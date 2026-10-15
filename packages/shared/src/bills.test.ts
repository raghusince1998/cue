import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryOfBill, daysToDue, dueLabel, nextDue, parseBill } from './bills.ts'

// Sunday 11 October 2026.
const now = new Date(2026, 9, 11, 15, 0)

test('bills read from a line, with what they are, how much, when and how often', () => {
  assert.deepEqual(parseBill('electricity bill ₹1,200 on the 5th every month', now), {
    name: 'Electricity bill',
    kind: 'bill',
    category: 'electricity',
    amountPaise: 120000,
    dueOn: '2026-11-05',
    repeat: 'monthly',
  })
  assert.deepEqual(parseBill('rent 15000 due on the 1st', now), {
    name: 'Rent',
    kind: 'bill',
    category: 'rent',
    amountPaise: 1500000,
    dueOn: '2026-11-01',
    repeat: 'monthly',
  })
  assert.deepEqual(parseBill('car insurance premium 8,400 rs on 20 jan every year', now), {
    name: 'Car insurance premium',
    kind: 'bill',
    category: 'insurance',
    amountPaise: 840000,
    dueOn: '2027-01-20',
    repeat: 'yearly',
  })
  assert.deepEqual(parseBill('passport expires 12 march 2028', now), {
    name: 'Passport',
    kind: 'renewal',
    category: 'document',
    amountPaise: null,
    dueOn: '2028-03-12',
    repeat: 'none',
  })
  assert.equal(parseBill('netflix subscription 649 on the 15th', now)!.dueOn, '2026-10-15', 'this month’s 15th is still ahead')
  assert.equal(parseBill('home loan emi ₹22,500 on 7th every month', now)!.category, 'emi')

  assert.equal(parseBill('pay the electricity bill on the 5th', now)!.repeat, 'monthly', 'a bill on a day of the month repeats')
  assert.equal(parseBill('pay the plumber tomorrow', now), null, 'no bill word')
  assert.equal(parseBill('send the bill to Anita tomorrow', now), null, 'once, and no amount: a to-do')
  assert.equal(parseBill('electricity bill', now), null, 'no date')
})

test('the asking is not the name: "remind me to renew…", "don’t forget to pay…"', () => {
  const now = new Date(2026, 9, 15, 10, 0)
  assert.equal(parseBill('remind me to renew car insurance on 5 nov', now)?.name, 'Car insurance')
  assert.equal(parseBill("don't forget to pay the electricity bill by 20th", now)?.name, 'Electricity bill')
})

test('the next due date keeps its day', () => {
  assert.equal(nextDue('2026-10-05', 'monthly'), '2026-11-05')
  assert.equal(nextDue('2026-01-31', 'monthly'), '2026-02-28')
  assert.equal(nextDue('2026-02-28', 'monthly', 31), '2026-03-31', 'back to the 31st')
  assert.equal(nextDue('2026-10-05', 'quarterly'), '2027-01-05')
  assert.equal(nextDue('2026-10-05', 'yearly'), '2027-10-05')
  assert.equal(nextDue('2026-10-05', 'weekly'), '2026-10-12')
  assert.equal(nextDue('2026-10-05', 'none'), null)
})

test('how soon, in words', () => {
  assert.equal(daysToDue('2026-10-14', now), 3)
  assert.equal(dueLabel('2026-10-11', 'bill', now), 'due today')
  assert.equal(dueLabel('2026-10-12', 'bill', now), 'due tomorrow')
  assert.equal(dueLabel('2026-10-09', 'bill', now), '2 days overdue')
  assert.equal(dueLabel('2026-10-10', 'bill', now), '1 day overdue')
  assert.equal(dueLabel('2028-03-12', 'renewal', now), 'expires in 17 months')
  assert.equal(dueLabel('2026-10-01', 'renewal', now), 'expired 10 days ago')
  assert.equal(categoryOfBill('Airtel postpaid'), 'phone')
  assert.equal(categoryOfBill('Something else'), 'other')
})

test('a subscription that renews is a monthly charge, not an expiry', () => {
  const netflix = parseBill('Netflix renews on 18th', now)!
  assert.equal(netflix.name, 'Netflix')
  assert.equal(netflix.kind, 'bill')
  assert.equal(netflix.category, 'subscription')
  assert.equal(netflix.repeat, 'monthly')
  assert.equal(netflix.dueOn, '2026-10-18')
  assert.equal(parseBill('watch netflix tomorrow', now), null, 'watching it is not paying for it')
})

test('dueLabel in Hindi: देय for a bill, ख़त्म for a renewal', () => {
  assert.equal(dueLabel('2026-10-11', 'bill', now, 'hi'), 'आज देय')
  assert.equal(dueLabel('2026-10-12', 'bill', now, 'hi'), 'कल देय')
  assert.equal(dueLabel('2026-10-16', 'bill', now, 'hi'), '5 दिन में देय')
  assert.equal(dueLabel('2026-10-08', 'bill', now, 'hi'), '3 दिन पहले देय था')
  assert.equal(dueLabel('2026-10-12', 'renewal', now, 'hi'), 'कल ख़त्म')
  assert.equal(dueLabel('2027-04-11', 'renewal', now, 'hi'), '6 महीने में ख़त्म')
  assert.equal(dueLabel('2029-10-11', 'renewal', now, 'hi'), '3 साल में ख़त्म')
  assert.equal(dueLabel('2026-10-10', 'renewal', now, 'hi'), '1 दिन पहले ख़त्म')
  // English unchanged.
  assert.equal(dueLabel('2026-10-12', 'bill', now), 'due tomorrow')
  assert.equal(dueLabel('2026-10-10', 'renewal', now, 'en'), 'expired yesterday')
})
