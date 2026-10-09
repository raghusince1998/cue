import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reopenTime } from './reopen.ts'

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)
const hm = (d: Date) => `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`

test('a time still to come is kept', () => {
  assert.equal(hm(reopenTime(at(12, 11), at(9, 15))), '12 11:00')
})

test('a time already gone moves to the next whole hour, at least half an hour off', () => {
  assert.equal(hm(reopenTime(at(9, 11), at(9, 15, 10))), '9 16:00')
  assert.equal(hm(reopenTime(at(9, 11), at(9, 15, 40))), '9 17:00')
  // Due a minute from now is as good as gone: it would buzz while still open.
  assert.equal(hm(reopenTime(at(9, 15, 41), at(9, 15, 40))), '9 17:00')
})

test('late in the evening it waits for tomorrow morning', () => {
  assert.equal(hm(reopenTime(at(9, 18), at(9, 20, 15))), '10 10:00')
  assert.equal(hm(reopenTime(at(9, 18), at(9, 23, 50))), '10 10:00')
})
