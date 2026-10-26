import { test } from 'node:test'
import assert from 'node:assert/strict'
import { happeningKind, isHappening } from './happenings.ts'

/** Not everything is a meeting or a task: some things are just days to mark, or places to be. */

test('a festival or a day to mark is a celebration', () => {
  for (const line of ['Diwali', 'Holi', 'Eid', 'Raksha Bandhan', 'Mom’s birthday', 'wedding anniversary', 'Diwali puja', 'Karva Chauth', 'New Year', 'दिवाली', 'माँ का जन्मदिन']) {
    assert.equal(happeningKind(line), 'celebration', line)
  }
})

test('an occasion you go to is an event', () => {
  for (const line of ['Ravi’s wedding', 'Priya’s sangeet', 'Coldplay concert', 'office party at the hotel', 'birthday party', 'Diwali party', 'school annual day', 'housewarming at Amit’s', 'tech conference', 'शादी में जाना']) {
    assert.equal(happeningKind(line), 'event', line)
  }
})

test('something to do about an occasion is still a task', () => {
  for (const line of ['buy Diwali sweets', 'wish Ravi happy birthday', 'book the wedding hall', 'send anniversary gift', 'call caterer for the party', 'दिवाली की मिठाई खरीदनी है']) {
    assert.equal(happeningKind(line), null, line)
  }
})

test('ordinary lines are neither', () => {
  for (const line of ['dentist appointment', 'submit the report', 'follow up with the party for payment', 'meeting with Ravi']) {
    assert.equal(happeningKind(line), null, line)
  }
})

test('only events and celebrations are happenings', () => {
  assert.ok(isHappening('event'))
  assert.ok(isHappening('celebration'))
  assert.ok(!isHappening('meeting'))
  assert.ok(!isHappening('focus'))
})
