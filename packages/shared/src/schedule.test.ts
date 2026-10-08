import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addToDate, offsetLabel, stepDate } from './schedule.ts'

test('weeks and days count on from the start', () => {
  assert.equal(addToDate('2026-08-01', { amount: 6, unit: 'weeks' }), '2026-09-12')
  assert.equal(addToDate('2026-08-01', { amount: 10, unit: 'weeks' }), '2026-10-10')
  assert.equal(addToDate('2026-12-30', { amount: 5, unit: 'days' }), '2027-01-04')
  assert.equal(addToDate('2026-08-01', { amount: 0, unit: 'weeks' }), '2026-08-01')
})

test('months keep the day of the month, or the last day when it does not exist', () => {
  assert.equal(addToDate('2026-08-01', { amount: 9, unit: 'months' }), '2027-05-01')
  // One month after 31 January is the end of February, not 3 March.
  assert.equal(addToDate('2027-01-31', { amount: 1, unit: 'months' }), '2027-02-28')
  assert.equal(addToDate('2028-01-31', { amount: 1, unit: 'months' }), '2028-02-29')
  assert.equal(addToDate('2026-10-31', { amount: 16, unit: 'months' }), '2028-02-29')
})

test('years land on the same date, or 28 February for a leap day', () => {
  assert.equal(addToDate('2026-08-01', { amount: 5, unit: 'years' }), '2031-08-01')
  assert.equal(addToDate('2028-02-29', { amount: 1, unit: 'years' }), '2029-02-28')
})

test('a step is a gap after the start, or a date of its own', () => {
  assert.equal(stepDate('2026-08-01', { offset: { amount: 14, unit: 'weeks' } }), '2026-11-07')
  assert.equal(stepDate('2026-08-01', { date: '2027-01-15' }), '2027-01-15')
  assert.equal(stepDate('2026-08-01', {}), null)
  assert.equal(stepDate('2026-08-01', { date: '15/01/2027' }), null)
})

test('a gap reads the way people say it', () => {
  assert.equal(offsetLabel({ amount: 0, unit: 'weeks' }), 'At the start')
  assert.equal(offsetLabel({ amount: 1, unit: 'months' }), '1 month')
  assert.equal(offsetLabel({ amount: 6, unit: 'weeks' }), '6 weeks')
})
