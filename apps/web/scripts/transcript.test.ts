import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addPhrase, spoken } from '../src/lib/transcript.ts'

/** Speaking into the Add box: what the recogniser sends, and what ends up written. */

const say = (...phrases: string[]) => phrases.reduce<string[]>((parts, p) => addPhrase(parts, p), [])

test('Android sending a phrase again as it grows writes it once', () => {
  assert.equal(say('call', 'call mom', 'call mom tomorrow at 5').join(' '), 'call mom tomorrow at 5')
})

test('the same phrase twice, or a shorter echo, is said once', () => {
  assert.equal(say('dentist friday 6pm', 'dentist friday 6pm').join(' '), 'dentist friday 6pm')
  assert.equal(say('dentist friday 6pm', 'dentist').join(' '), 'dentist friday 6pm')
  assert.equal(say('Dentist Friday', 'dentist friday  6pm').join(' '), 'dentist friday 6pm')
})

test('everything so far sent again with more replaces it all', () => {
  assert.equal(say('buy milk', 'and bread', 'buy milk and bread tomorrow').join(' '), 'buy milk and bread tomorrow')
})

test('new phrases are added after what came before', () => {
  assert.equal(say('buy milk', 'and bread').join(' '), 'buy milk and bread')
})

test('while still speaking: the words so far, then the ones still coming', () => {
  assert.equal(spoken(['call mom'], 'tomorrow'), 'call mom tomorrow')
  assert.equal(spoken(['call mom'], 'call mom tomorrow'), 'call mom tomorrow')
  assert.equal(spoken([], 'call'), 'call')
  assert.equal(spoken(['call mom'], ''), 'call mom')
})
