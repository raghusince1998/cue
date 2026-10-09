import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWishList } from './wishes.ts'

test('several things for one place, in one line', () => {
  assert.deepEqual(parseWishList('Jaipur: visit Hawa Mahal, buy lakh chudi'), {
    placeLabel: 'Jaipur',
    titles: ['visit Hawa Mahal', 'buy lakh chudi'],
  })
  assert.deepEqual(parseWishList('when I go to Jaipur: visit Hawa Mahal and buy lakh chudi'), {
    placeLabel: 'Jaipur',
    titles: ['visit Hawa Mahal', 'buy lakh chudi'],
  })
  assert.deepEqual(parseWishList("next time I'm in pune: meet Dr. Joshi, see the new office")!.placeLabel, 'Pune')
  assert.deepEqual(parseWishList('in Kumta: check the depot, meet the dealer')!.placeLabel, 'Kumta')
})

test('a wishlist with no place at all', () => {
  assert.deepEqual(parseWishList('wishlist: learn swimming, read Deep Work'), {
    placeLabel: null,
    titles: ['learn swimming', 'read Deep Work'],
  })
  assert.equal(parseWishList('someday: paragliding, scuba diving')!.placeLabel, null)
  assert.equal(parseWishList('bucket list - Ladakh road trip, see the northern lights')!.placeLabel, null)
})

test('a list on an ordinary plan is not a wishlist', () => {
  assert.equal(parseWishList('Groceries: milk, bread'), null)
  assert.equal(parseWishList('prepare for the demo tomorrow 5pm: deck, pricing, samples'), null)
  assert.equal(parseWishList('visit Hawa Mahal'), null, 'one thing, no list')
  // A place this person has used before counts, even off the city list.
  assert.equal(parseWishList('Kumta: check the depot, meet the dealer', ['Kumta'])!.placeLabel, 'Kumta')
  assert.equal(parseWishList('Kumta: check the depot, meet the dealer'), null)
})
