import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractRoles } from './extractRoles.ts'

/**
 * Reading the roles out of a sentence.
 *
 * The risk here is not missing a field, it is inventing one. A place that is
 * really a department, or a "person" that is really a subject, puts wrong data
 * into the parts of the app that reason about travel and contacts — so the
 * tests lean hard on what it must refuse.
 */

function roles(input: string) {
  return extractRoles(input)
}

test('the sentence that started this', () => {
  const r = roles(
    'create appointment for dentist who lives in sirsi regarding sofgtware application demo',
  )
  assert.ok(r)
  assert.equal(r.kind, 'appointment')
  assert.equal(r.person, 'dentist')
  assert.equal(r.place, 'sirsi')
  // The typo is kept verbatim: silently rewriting what someone typed is a
  // worse failure than leaving it as they wrote it.
  assert.equal(r.subject, 'sofgtware application demo')
  assert.equal(r.title, 'Sofgtware application demo')
})

test('a place stops where the date starts, and keeps its own numbers', () => {
  assert.equal(roles('client meeting in Pune 15 oct 11am')!.place, 'Pune')
  assert.equal(roles('client meeting in Pune on friday')!.place, 'Pune')
  assert.equal(roles('site visit at Sector 5 plant with the manager tomorrow')!.place, 'Sector 5 plant')
})

test('a call keeps who it is to, with what it is about', () => {
  assert.equal(roles('call raghu monday 11am about stock')!.title, 'Call raghu about stock')
  assert.equal(roles('call about the renewal')!.title, 'Renewal', 'nobody named: the subject is the name')
})

test('who, where and what are each pulled out separately', () => {
  const r = roles('meeting with Ramesh at Volkswagen Pune about the Q4 contract')
  assert.ok(r)
  assert.equal(r.kind, 'meeting')
  assert.equal(r.person, 'Ramesh')
  assert.equal(r.place, 'Volkswagen Pune')
  assert.equal(r.subject, 'Q4 contract')
})

test('a title and a name are one person', () => {
  // "Dr" alone is the only part nobody would recognise.
  assert.equal(roles('call Dr Shah in Mumbai regarding the test results')?.person, 'Dr Shah')
  assert.equal(roles('appointment with Dr. Mehta about the scan')?.person, 'Dr. Mehta')
})

test('an occupation with no marker is still a person', () => {
  const r = roles('dentist appointment in Sirsi')
  assert.ok(r)
  assert.equal(r.person, 'dentist')
  assert.equal(r.place, 'Sirsi')
})

test('"who lives in X" attaches the place to the person', () => {
  const r = roles('book a call for the plumber who stays in Kothrud')
  assert.ok(r)
  assert.equal(r.person, 'plumber')
  assert.equal(r.place, 'Kothrud')
})

test('every field says which words produced it', () => {
  const r = roles('meeting with Ramesh at Volkswagen Pune about the Q4 contract')
  assert.ok(r)
  const fields = Object.fromEntries(r.evidence.map((e) => [e.field, e.from]))
  assert.match(fields.person!, /Ramesh/)
  assert.match(fields.place!, /Volkswagen Pune/)
  assert.match(fields.subject!, /Q4 contract/)
})

test('a subject with no person is still worth extracting', () => {
  const r = roles('book a call with Priya regarding the invoice')
  assert.ok(r)
  assert.equal(r.subject, 'invoice')
  assert.equal(r.place, null, 'no place was mentioned, so none should be claimed')
})

test('"for" means a person or a subject depending on what follows', () => {
  // The marker alone cannot tell them apart; the occupation lexicon can.
  assert.equal(roles('schedule a demo for the client in Bangalore')?.person, 'client')
  assert.equal(roles('book a slot for the quarterly review')?.person ?? null, null)
})

// --------------------------------------------------------------- restraint

test('ordinary sentences are left to the plain parser', () => {
  for (const input of [
    'dentist friday 6pm',
    'buy milk',
    'standup every tuesday at 10am',
    'going to Mathura from 12 to 14 October',
    'call mom',
  ]) {
    assert.equal(roles(input), null, input)
  }
})

test('a single lonely guess is not enough to claim roles', () => {
  // One field found and nothing else is how a parser earns distrust.
  assert.equal(roles('meeting'), null)
  assert.equal(roles('call'), null)
})

test('a lowercase run after "in" is not a place', () => {
  // "in the morning" and "in accounts" are not somewhere you travel to.
  const r = roles('meeting with Ramesh in the morning')
  assert.equal(r?.place ?? null, null)
})

test('a date is never mistaken for the name of the thing', () => {
  const r = roles('site visit at Chakan plant tomorrow')
  assert.ok(r)
  assert.equal(r.place, 'Chakan plant')
  assert.doesNotMatch(r.title, /tomorrow/i)
})

test('a kind word inside a subject is not torn out of it', () => {
  // "software application demo" is what it is about; gutting the word "demo"
  // would leave a subject that no longer says anything.
  const r = roles('appointment with the client regarding the software demo')
  assert.ok(r)
  assert.match(r.subject!, /demo/)
})
