import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packingItems, packingList } from './packing.ts'
import { isAbroad, parseBooking, sameCity } from './bookings.ts'

test('a holiday by air: clothes for the nights, toiletries, and what a flight asks', () => {
  const list = packingList({ nights: 4, purpose: 'leisure', modes: ['flight'] })
  const titles = list.map((s) => s.title)
  assert.deepEqual(titles, ['Essentials', 'Clothes', 'Toiletries', 'For the journey'])
  assert.ok(list[1]!.items.includes('5 sets of clothes'), 'a change a day and a spare')
  assert.ok(list[3]!.items.some((i) => /100 ml/.test(i)))
  assert.ok(!titles.includes('Work'))
})

test('a work trip by train adds the laptop and the night on the train', () => {
  const items = packingItems({ nights: 1, purpose: 'work', modes: ['train'] })
  assert.ok(items.includes('Laptop and charger'))
  assert.ok(items.includes('Work clothes for each day'))
  assert.ok(items.some((i) => /blanket/.test(i)))
})

test('a day trip is light; abroad wants a passport and an adapter; a long one stops at a week', () => {
  const day = packingList({ nights: 0, purpose: 'leisure', modes: [] })
  assert.deepEqual(day.map((s) => s.title), ['Essentials', 'Clothes'])
  const abroad = packingItems({ nights: 5, purpose: 'leisure', modes: ['flight'], international: true })
  assert.equal(abroad[0], 'Passport and visa')
  assert.ok(abroad.includes('Travel adapter'))
  assert.ok(packingItems({ nights: 20, purpose: 'leisure', modes: [] }).includes('7 sets of clothes'))
})

test('where a journey leaves from, by its city', () => {
  const now = new Date(2026, 9, 12, 9, 0)
  const train = parseBooking('PNR:2345678901,TRN:12951,DOJ:15-10-26,3A,MMCT-NDLS,DP:17:00,RAVI KUMAR+1,B2 45', now)!
  assert.equal(train.fromCity, 'Mumbai')
  assert.equal(train.city, 'Delhi')
  const flight = parseBooking('Your IndiGo flight 6E 512 BLR-GOI on 1 Nov 2026 departs 07:00. PNR ABC123', now)!
  assert.equal(flight.fromCity, 'Bengaluru')
  assert.equal(flight.city, 'Goa')
})

test('the same city under either name, and cities abroad', () => {
  assert.ok(sameCity('Bangalore', 'Bengaluru'))
  assert.ok(sameCity(' bombay ', 'Mumbai'))
  assert.ok(!sameCity('Pune', 'Mumbai'))
  assert.ok(isAbroad('Dubai'))
  assert.ok(!isAbroad('Goa'))
})
