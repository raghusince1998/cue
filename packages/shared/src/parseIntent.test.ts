import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIntention, parseTrip } from './parseIntent.ts'

/** Tuesday 29 September 2026. */
const NOW = new Date(2026, 8, 29, 10, 0, 0, 0)

function intent(input: string) {
  const r = parseIntention(input)
  assert.ok(r, `expected "${input}" to parse as an intention`)
  return r
}

// ------------------------------------------------------------- intentions

test('the headline phrasing', () => {
  const r = intent('When I go to Mathura, remind me to buy peda')
  assert.equal(r.placeLabel, 'Mathura')
  assert.equal(r.title, 'buy peda')
})

test('works without the comma', () => {
  const r = intent('When I am in Mathura remind me to visit Banke Bihari Temple')
  assert.equal(r.placeLabel, 'Mathura')
  assert.equal(r.title, 'visit Banke Bihari Temple')
})

test('"whenever" and contractions', () => {
  const r = intent("Whenever I'm in Jaipur, remind me to visit that restaurant")
  assert.equal(r.placeLabel, 'Jaipur')
  assert.equal(r.title, 'visit that restaurant')
})

test('"near" is a context too', () => {
  const r = intent('When I am near home, remind me to buy groceries')
  assert.equal(r.placeLabel, 'home')
  assert.equal(r.title, 'buy groceries')
})

test('"next time" phrasing', () => {
  const r = intent('Next time I am in Delhi, pick up the parcel')
  assert.equal(r.placeLabel, 'Delhi')
  assert.equal(r.title, 'pick up the parcel')
})

test('task first, place second', () => {
  const r = intent('Buy peda when I go to Mathura')
  assert.equal(r.placeLabel, 'Mathura')
  assert.equal(r.title, 'Buy peda')
})

test('"while I am in X"', () => {
  const r = intent("Try the famous food while I'm in Mathura")
  assert.equal(r.placeLabel, 'Mathura')
  assert.equal(r.title, 'Try the famous food')
})

test('a date stuck to the place is trimmed off it', () => {
  const r = intent('When I go to Mathura on 12 October, remind me to buy peda')
  assert.equal(r.placeLabel, 'Mathura')
})

test('multi-word places survive intact', () => {
  const r = intent('When I go to New Delhi, remind me to collect the visa')
  assert.equal(r.placeLabel, 'New Delhi')
  assert.equal(r.title, 'collect the visa')
})

test('"while I am there" names no place, so it is refused', () => {
  // Resolving "there" needs context the parser does not have; guessing would
  // file the wish under the wrong city.
  assert.equal(parseIntention('I want to try famous food while I am there'), null)
})

test('ordinary sentences are not mistaken for intentions', () => {
  assert.equal(parseIntention('dentist friday 6pm'), null)
  assert.equal(parseIntention('call the plumber this afternoon'), null)
  assert.equal(parseIntention('remind me to call John tomorrow'), null)
  assert.equal(parseIntention(''), null)
})

// ------------------------------------------------------------------ trips

test('the headline trip phrasing', () => {
  const r = parseTrip('I am going to Mathura from 12th to 14th October', NOW)
  assert.deepEqual(r, {
    placeLabel: 'Mathura',
    startsOn: '2026-10-12',
    endsOn: '2026-10-14',
  })
})

test('hyphenated range and short month', () => {
  const r = parseTrip('Trip to Jaipur 3-5 Nov', NOW)
  assert.equal(r?.startsOn, '2026-11-03')
  assert.equal(r?.endsOn, '2026-11-05')
})

test('month-first range', () => {
  const r = parseTrip('Travelling to Goa December 20 to 26', NOW)
  assert.equal(r?.placeLabel, 'Goa')
  assert.equal(r?.startsOn, '2026-12-20')
  assert.equal(r?.endsOn, '2026-12-26')
})

test('a range already past rolls to next year', () => {
  // NOW is late September; March has gone.
  assert.equal(parseTrip('Going to Kochi 4-6 March', NOW)?.startsOn, '2027-03-04')
})

test('a single day is not a range', () => {
  assert.equal(parseTrip('Going to Mathura on 12 October', NOW), null)
})

test('a backwards range is refused rather than silently swapped', () => {
  assert.equal(parseTrip('Going to Mathura from 14th to 12th October', NOW), null)
})

test('no destination means no trip', () => {
  assert.equal(parseTrip('Conference 12 to 14 October', NOW), null)
})

// ------------------------------------------- the month written on both sides

test('a month named on both sides of the range', () => {
  // The commonest way people actually write it, and the one form the parser
  // could not read: the month sits exactly where "to" was expected.
  const r = parseTrip('visiting agra for 3 days on 2 oct to 4 oct', NOW)
  assert.ok(r)
  assert.equal(r.placeLabel, 'agra')
  assert.equal(r.startsOn, '2026-10-02')
  assert.equal(r.endsOn, '2026-10-04')
})

test('the range may be written before the place', () => {
  const r = parseTrip('2 oct to 4 oct trip to agra', NOW)
  assert.ok(r)
  assert.equal(r.placeLabel, 'agra')
  assert.equal(r.startsOn, '2026-10-02')
})

test('month-first on both sides', () => {
  const r = parseTrip('oct 2 to oct 4 going to agra', NOW)
  assert.ok(r)
  assert.equal(r.endsOn, '2026-10-04')
})

test('a range crossing a month is not a backwards range', () => {
  const r = parseTrip('going to Goa 30 dec to 2 jan', NOW)
  assert.ok(r, '"30 to 2" is only backwards if both are the same month')
  assert.equal(r.startsOn, '2026-12-30')
  assert.equal(r.endsOn, '2027-01-02', 'and it lands in the next year')
})

test('a genuinely backwards range is still refused', () => {
  assert.equal(parseTrip('going to Mathura 14 oct to 12 oct', NOW), null)
})

// ------------------------------------------------- a length instead of an end

test('a trip can be given as a length and a start', () => {
  const r = parseTrip('going to agra for 3 days from 2 oct', NOW)
  assert.ok(r)
  assert.equal(r.startsOn, '2026-10-02')
  // Three days means the 2nd, 3rd and 4th.
  assert.equal(r.endsOn, '2026-10-04')
})

test('nights and days are counted differently, because they mean different things', () => {
  const nights = parseTrip('going to agra for 3 nights from 2 oct', NOW)
  assert.equal(nights?.endsOn, '2026-10-05', 'three nights means you come back on the 5th')
})

test('the length never ends up in the name of the place', () => {
  assert.equal(parseTrip('visiting agra for 3 days on 2 oct', NOW)?.placeLabel, 'agra')
})

test('a length with no date at all is not guessed at', () => {
  assert.equal(parseTrip('visiting agra for 3 days', NOW), null)
})
