import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findCity, samePlace } from './cities.ts'

test('a city in the sentence, as a whole word, longest first', () => {
  assert.equal(findCity('client meeting in pune on 15 oct 11am'), 'Pune')
  assert.equal(findCity('Demo at the Navi Mumbai office'), 'Navi Mumbai')
  assert.equal(findCity('review with the New York team'), 'New York')
  assert.equal(findCity('call the Dakota office'), null, 'Kota is not in Dakota')
  assert.equal(findCity('meeting at the office tomorrow 4pm'), null)
})

test('names that are also people or words are not read as places', () => {
  assert.equal(findCity('call Anand tomorrow'), null)
  assert.equal(findCity('meet Sagar about the order'), null)
  assert.equal(findCity('costs will erode the margin'), null)
})

test("places this person planned trips to count, whatever they are called", () => {
  assert.equal(findCity('dentist in sirsi friday', []), 'Sirsi')
  assert.equal(findCity('stock check at Kumta depot', ['Kumta']), 'Kumta')
})

test('the same place, however it was typed', () => {
  assert.ok(samePlace('Pune', ' pune '))
  assert.ok(samePlace('Navi  Mumbai', 'navi mumbai'))
  assert.ok(!samePlace('Pune', 'Mumbai'))
  assert.ok(!samePlace(null, 'Pune'))
})
