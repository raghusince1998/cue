import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnose } from './diagnose.ts'
import { parseWhen, placeFrom, titleFrom } from './parseWhen.ts'
import { findMalformedTime, originalIfInformative } from './textCleanup.ts'

/** Tuesday 29 September 2026. */
const NOW = new Date(2026, 8, 29, 10, 0, 0, 0)

// --- the two silent wrong answers this work uncovered ----------------------

test('"5th of November" keeps its month', () => {
  // Was returning 5 October: the "of" broke the day-month match and it fell
  // through to the bare-ordinal rule.
  const r = parseWhen('session on 5th of November', NOW)
  assert.equal(r?.date.getMonth(), 10, 'should be November')
  assert.equal(r?.date.getDate(), 5)
})

test('"2:30 p.m" is the afternoon, not the small hours', () => {
  // Was returning 02:30, because only "p.m." with both dots was recognised.
  for (const form of ['2:30 p.m', '2:30 p.m.', '2:30 pm', '2.30pm', '2:30 PM']) {
    const r = parseWhen(`call at ${form}`, NOW)
    assert.equal(r?.date.getHours(), 14, `${form} should be 14:00`)
    assert.equal(r?.date.getMinutes(), 30, `${form} should be :30`)
  }
})

test('am forms still mean the morning', () => {
  for (const form of ['9:15 a.m', '9:15 am', '9:15 A.M.']) {
    const r = parseWhen(`call at ${form}`, NOW)
    assert.equal(r?.date.getHours(), 9, `${form} should be 09:00`)
    assert.equal(r?.date.getMinutes(), 15, `${form} should be :15`)
  }
})

// --- explaining a failure --------------------------------------------------

test('the real sentence: says exactly what is missing', () => {
  const d = diagnose(
    'hi please block my calendar for of November for the pause awareness session at Volkswagen Pune on site the session time will be 22330 p.m',
  )
  assert.ok(d, 'should produce a diagnosis')
  assert.equal(d.monthWithoutDay?.toLowerCase(), 'november')
  assert.equal(d.unparseableTime, '22330 p.m')
  assert.match(d.message, /which day of November/i)
  assert.match(d.message, /22330/)
})

test('it still recovers the useful parts', () => {
  const d = diagnose(
    'hi please block my calendar for of November for the pause awareness session at Volkswagen Pune on site the session time will be 22330 p.m',
  )
  assert.equal(d?.likelyPlace, 'Volkswagen Pune')
  assert.match(d!.likelyTitle!, /awareness session/i)
  // The conversational wrapper must not survive into the title.
  assert.doesNotMatch(d!.likelyTitle!, /please|block my calendar|^hi\b/i)
})

test('a month with no day is flagged on its own', () => {
  const d = diagnose('team offsite in November at Pune')
  assert.equal(d?.monthWithoutDay?.toLowerCase(), 'november')
  assert.match(d!.message, /which day/i)
})

test('a sentence that parses fine gets no diagnosis', () => {
  // Explaining a success would be noise on top of a working preview.
  assert.equal(diagnose('dentist friday 6pm'), null)
  assert.equal(diagnose('When I go to Mathura, remind me to buy peda'), null)
  assert.equal(diagnose('I am going to Mathura from 12th to 14th October'), null)
})

test('short or empty input is left alone', () => {
  assert.equal(diagnose(''), null)
  assert.equal(diagnose('hi'), null)
})

// --- titles from whole dictated sentences ----------------------------------

test('a full spoken sentence yields a short title, not the sentence', () => {
  const said =
    'hi please block my calendar for 30th of November for the pause awareness session at Volkswagen Pune on site the session time will be 22330 p.m'
  const r = parseWhen(said, NOW)
  assert.ok(r, 'the date should parse')
  assert.equal(r.date.getMonth(), 10, 'November')
  assert.equal(r.date.getDate(), 30)

  const title = titleFrom(said, r)
  assert.equal(title, 'pause awareness session')
  // None of the conversational wrapper may survive.
  for (const junk of ['please', 'block my calendar', 'on site', 'session time will be', '22330']) {
    assert.doesNotMatch(title, new RegExp(junk, 'i'), `"${junk}" should be gone`)
  }
})

test('the place is pulled out separately rather than left in the title', () => {
  const said =
    'hi please block my calendar for 30th of November for the pause awareness session at Volkswagen Pune on site'
  assert.equal(placeFrom(said), 'Volkswagen Pune')
  assert.doesNotMatch(titleFrom(said, parseWhen(said, NOW)!), /Volkswagen/i)
})

test('a broken time is still reported even when the date parsed', () => {
  // The date succeeding must not hide the fact that "22330 p.m" was ignored
  // and 9am quietly assumed.
  assert.equal(
    findMalformedTime('session on 30th of November the time will be 22330 p.m'),
    '22330 p.m',
  )
  assert.equal(findMalformedTime('session on 30th November at 2:30 pm'), null)
})

test('ordinary short input is not over-trimmed', () => {
  const r = parseWhen('dentist friday 6pm', NOW)!
  assert.equal(titleFrom('dentist friday 6pm', r), 'dentist')
  const r2 = parseWhen('call client tomorrow 4pm', NOW)!
  assert.equal(titleFrom('call client tomorrow 4pm', r2), 'call client')
})

// --- keeping what was actually said ----------------------------------------

test('a long dictated sentence is kept as notes', () => {
  const said =
    'hi please block my calendar for 30th of November for the pause awareness session at Volkswagen Pune on site the session time will be 22330 p.m'
  const title = titleFrom(said, parseWhen(said, NOW)!)
  assert.equal(originalIfInformative(said, title), said)
})

test('a short entry does not repeat itself in the notes', () => {
  const said = 'dentist friday 6pm'
  const title = titleFrom(said, parseWhen(said, NOW)!)
  assert.equal(title, 'dentist')
  // Two extra words is just the date; nothing was lost worth keeping.
  assert.equal(originalIfInformative(said, title), null)
})

test('an identical title and sentence is never duplicated', () => {
  assert.equal(originalIfInformative('Team standup', 'Team standup'), null)
  assert.equal(originalIfInformative('  Team standup ', 'team standup'), null)
})

test('in Hindi, it says what is missing in Hindi', () => {
  const both = diagnose(
    'hi please block my calendar for of November for the pause awareness session at Volkswagen Pune on site the session time will be 22330 p.m',
    'hi',
  )
  assert.equal(both?.message, 'बस थोड़ा और — अभी November की तारीख, और एक सही समय चाहिए। "22330 p.m" को मैं समय की तरह नहीं पढ़ पाया।')
  assert.equal(both?.likelyPlace, 'Volkswagen Pune', 'what it recovers is the same')
  assert.equal(diagnose('team offsite in November at Pune', 'hi')?.message, 'बस थोड़ा और — अभी November की तारीख चाहिए।')
  // English unchanged.
  assert.match(diagnose('team offsite in November at Pune', 'en')!.message, /^Almost — I still need which day of November\.$/)
})
