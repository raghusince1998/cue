import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryOf, formatRupees, parseExpense, spentWhen } from './expenses.ts'

test('a spend read from a sentence: amount, kind, and what it was for', () => {
  assert.deepEqual(parseExpense('₹450 cab to Mehta Physio'), {
    amountPaise: 45000,
    category: 'travel',
    note: 'cab to Mehta Physio',
  })
  assert.deepEqual(parseExpense('lunch with Ravi Rs. 1,250'), { amountPaise: 125000, category: 'food', note: 'lunch with Ravi' })
  assert.deepEqual(parseExpense('spent 300 on parking at Infosys'), {
    amountPaise: 30000,
    category: 'parking',
    note: 'parking at Infosys',
  })
  assert.deepEqual(parseExpense('petrol 2000 rs'), { amountPaise: 200000, category: 'fuel', note: 'petrol' })
  assert.equal(parseExpense('hotel in Pune ₹3,499.50')!.amountPaise, 349950)
  assert.equal(parseExpense('courier to Sunrise Hospital 180/-')!.category, 'supplies')
  assert.equal(parseExpense('paid 1,20,000 for the stall')!.amountPaise, 12000000, 'lakhs, grouped the Indian way')
})

test('numbers that are not money are left alone', () => {
  assert.equal(parseExpense('call Ravi at 4'), null)
  assert.equal(parseExpense('meeting in room 204 tomorrow 11am'), null)
  assert.equal(parseExpense('send 3 samples to Dr. Mehta'), null)
  assert.equal(parseExpense('team review every mon wed fri at 10'), null)
})

test('categories, and rupees as an Indian claim form writes them', () => {
  assert.equal(categoryOf('Uber to the airport'), 'travel')
  assert.equal(categoryOf('Toll on the expressway'), 'parking')
  assert.equal(categoryOf('gift for the clinic opening'), 'other')
  assert.equal(formatRupees(45000), '₹450')
  assert.equal(formatRupees(349950), '₹3,499.50')
  assert.equal(formatRupees(12000000), '₹1,20,000')
  assert.equal(formatRupees(1234567800), '₹1,23,45,678')
})

test('when it was spent, read looking back', () => {
  // Sunday 11 October 2026.
  const now = new Date(2026, 9, 11, 15, 0)
  assert.deepEqual(spentWhen('yesterday lunch with Dr Rao', now), { day: '2026-10-10', note: 'lunch with Dr Rao' })
  assert.deepEqual(spentWhen('cab day before yesterday', now), { day: '2026-10-09', note: 'cab' })
  assert.deepEqual(spentWhen('hotel in Pune on friday', now), { day: '2026-10-09', note: 'hotel in Pune' })
  assert.equal(spentWhen('sunday breakfast', now)!.day, '2026-10-11', 'a bare weekday can be today')
  assert.equal(spentWhen('last sunday breakfast', now)!.day, '2026-10-04', 'last sunday never is')
  assert.equal(spentWhen('parking 8 oct', now)!.day, '2026-10-08')
  assert.equal(spentWhen('stay on oct 2nd', now)!.day, '2026-10-02')
  assert.equal(spentWhen('flight 20 dec', now)!.day, '2025-12-20', 'not yet this year, so last year')
  assert.equal(spentWhen('courier 5/10', now)!.day, '2026-10-05', 'day first')
  assert.equal(spentWhen('cab today', now)!.day, '2026-10-11')
  assert.equal(spentWhen('cab to Mehta Physio', now), null)
  assert.equal(spentWhen('31 feb', now), null)
})
