import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRelative, stripRelative } from './parseRelative.ts'
import { parseWhen } from './parseWhen.ts'

// A fixed Monday noon, so "tomorrow" and "after lunch" mean the same thing
// every run.
const NOW = new Date(2026, 9, 5, 12, 0)

function at(input: string): string {
  const parsed = parseWhen(input, NOW)
  if (!parsed) return 'NOT UNDERSTOOD'
  const d = parsed.date
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ------------------------------------------------------------- conventions

test('phrases that mean the same to everyone resolve without a lookup', () => {
  const cases: Array<[string, string]> = [
    ['call the bank first thing tomorrow', '06/10 09:00'],
    ['send the report by end of day', '05/10 17:00'],
    ['review the deck after lunch', '05/10 14:00'],
    // Already past at midday, so it rolls to tomorrow — as it should.
    ['quick sync before lunch', '06/10 11:00'],
    ['catch up over lunch tomorrow', '06/10 13:00'],
    ['gym after work', '05/10 18:00'],
    ['run before work tomorrow', '06/10 07:00'],
    ['walk after dinner', '05/10 20:00'],
    ['read before bed', '05/10 21:00'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(at(input), expected, input)
  }
})

test('a convention carries its window, so no false precision is claimed', () => {
  assert.equal(parseWhen('review the deck after lunch', NOW)?.window, 'afternoon')
  assert.equal(parseWhen('gym after work', NOW)?.window, 'evening')
  // "End of day" names a deadline, not a vague stretch of afternoon.
  assert.equal(parseWhen('send it by end of day', NOW)?.window, undefined)
})

test('a convention beats the single day-part word hiding inside it', () => {
  // "after lunch" must not be read as the bare "noon" it does not contain, nor
  // "over lunch" be missed because no single word matched.
  assert.equal(at('catch up over lunch'), '05/10 13:00')
  assert.equal(at('standup first thing'), '06/10 09:00')
})

// --------------------------------------------------- relative to your day

test('a named thing in your day becomes an anchor', () => {
  const r = parseRelative('call Ravi after the standup')
  assert.ok(r)
  assert.equal(r.relation, 'after')
  assert.deepEqual(r.anchor, { kind: 'named', text: 'standup' })
  assert.equal(r.offsetMinutes, 15)
})

test('before works as well as after', () => {
  const r = parseRelative('grab coffee before the client review')
  assert.ok(r)
  assert.equal(r.relation, 'before')
  assert.deepEqual(r.anchor, { kind: 'named', text: 'client review' })
})

test('"once X is done" is an after', () => {
  const r = parseRelative('send the invoice once the client review is done')
  assert.ok(r)
  assert.equal(r.relation, 'after')
  assert.deepEqual(r.anchor, { kind: 'named', text: 'client review' })
})

test('first and last are their own anchors', () => {
  assert.deepEqual(parseRelative('call mum after my last meeting')?.anchor, { kind: 'lastThing' })
  assert.deepEqual(parseRelative('gym before my first meeting')?.anchor, { kind: 'firstThing' })
  assert.deepEqual(parseRelative('tidy up after my last call')?.anchor, { kind: 'lastThing' })
})

test('a stated gap is honoured', () => {
  assert.equal(parseRelative('call Ravi 30 minutes after the standup')?.offsetMinutes, 30)
  assert.equal(parseRelative('call Ravi 2 hours after the standup')?.offsetMinutes, 120)
  assert.equal(parseRelative('call Ravi an hour after the standup')?.offsetMinutes, 60)
  assert.equal(parseRelative('call Ravi half hour after the standup')?.offsetMinutes, 30)
})

test('a trailing date belongs to the sentence, not the anchor’s name', () => {
  // "the standup tomorrow" is a standup, and an anchor named "standup
  // tomorrow" would never match anything.
  assert.deepEqual(parseRelative('call Ravi after the standup tomorrow')?.anchor, {
    kind: 'named',
    text: 'standup',
  })
  assert.deepEqual(parseRelative('call Ravi after the standup at 3pm')?.anchor, {
    kind: 'named',
    text: 'standup',
  })
})

test('the relative phrase is cut out of the title', () => {
  const cases: Array<[string, string]> = [
    ['call Ravi after the standup', 'call Ravi'],
    ['gym before my first meeting', 'gym'],
    ['send the invoice 30 minutes after the client review', 'send the invoice'],
  ]
  for (const [input, expected] of cases) {
    const parsed = parseRelative(input)
    assert.ok(parsed, input)
    assert.equal(stripRelative(input, parsed), expected)
  }
})

// ------------------------------------------------------------- restraint

test('conventions are not sent off to look up a calendar entry', () => {
  // These resolve in parseWhen. Treating them as anchors would make the server
  // hunt for a commitment called "lunch" and fail for most people most days.
  for (const input of ['review the deck after lunch', 'gym after work', 'walk after dinner']) {
    assert.equal(parseRelative(input), null, input)
  }
})

test('an anchor too vague to resolve is left alone', () => {
  // A day with four meetings in it cannot answer "after the meeting".
  for (const input of ['call Ravi after the meeting', 'do it after the call']) {
    assert.equal(parseRelative(input), null, input)
  }
})

test('ordinary sentences are not mistaken for relative ones', () => {
  for (const input of [
    'dentist friday 6pm',
    'buy milk',
    'standup every tuesday',
    'going to Mathura from 12 to 14 October',
  ]) {
    assert.equal(parseRelative(input), null, input)
  }
})
