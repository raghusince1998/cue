import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseChecklist } from './parseChecklist.ts'

/**
 * Splitting a list off a plan.
 *
 * The danger is entirely in the false positives: a comma is far too common
 * inside an ordinary title to mean anything, and a colon turns up in times and
 * URLs. Turning one plan into five is a worse failure than making somebody
 * type the list separately.
 */

test('a colon introduces a list', () => {
  const r = parseChecklist('go shopping this evening: milk, bread, peda and eggs')
  assert.ok(r)
  assert.equal(r.title, 'go shopping this evening')
  assert.deepEqual(r.items, ['milk', 'bread', 'peda', 'eggs'])
})

test('the trailing "and" is how people write the last item', () => {
  assert.deepEqual(parseChecklist('pack: charger, meds and gifts')?.items, [
    'charger',
    'meds',
    'gifts',
  ])
})

test('a dash works as well as a colon', () => {
  const r = parseChecklist('shopping tomorrow — milk, bread, eggs')
  assert.ok(r)
  assert.deepEqual(r.items, ['milk', 'bread', 'eggs'])
})

test('semicolons separate items too', () => {
  assert.deepEqual(parseChecklist('buy: milk; bread; eggs')?.items, ['milk', 'bread', 'eggs'])
})

test('bullets in front of items are stripped', () => {
  assert.deepEqual(parseChecklist('shopping: - milk, - bread')?.items, ['milk', 'bread'])
})

// ------------------------------------------------------------- restraint

test('a time is not a list', () => {
  assert.equal(parseChecklist('standup at 9:30'), null)
  assert.equal(parseChecklist('dentist friday 6:00 pm'), null)
})

test('a URL is not a list', () => {
  // It has a colon and even a comma-free tail; one item is not a list.
  assert.equal(parseChecklist('client call tomorrow 3pm: https://meet.google.com/abc-defg'), null)
})

test('one thing after a colon is a phrase, not a list', () => {
  assert.equal(parseChecklist('note: remember the invoice'), null)
})

test('a comma with no colon is just a sentence', () => {
  // "Meeting with Ravi, then lunch" is one plan, not two items.
  assert.equal(parseChecklist('meeting with Ravi, then lunch'), null)
  assert.equal(parseChecklist('call mum, dad and the bank'), null)
})

test('a list with no plan in front of it is refused', () => {
  assert.equal(parseChecklist(': milk, bread'), null)
})

test('an implausibly long list is a sentence that had commas in it', () => {
  const many = Array.from({ length: 25 }, (_, i) => `item${i}`).join(', ')
  assert.equal(parseChecklist(`shopping: ${many}`), null)
})

test('ordinary plans are untouched', () => {
  for (const input of [
    'dentist friday 6pm',
    'buy milk',
    'gym every mon wed fri at 7',
    'going to Mathura from 12 to 14 October',
  ]) {
    assert.equal(parseChecklist(input), null, input)
  }
})
