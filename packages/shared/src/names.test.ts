import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameParts, shortName } from './names.ts'

test('a title is not a first name', () => {
  assert.deepEqual(nameParts('Dr. Anil Mehta'), { title: 'Dr.', bare: 'Anil Mehta', given: 'Anil', last: 'Mehta' })
  assert.deepEqual(nameParts('  mrs  Kavita   Rao '), { title: 'mrs', bare: 'Kavita Rao', given: 'Kavita', last: 'Rao' })
  assert.deepEqual(nameParts('Ravi Kumar'), { title: null, bare: 'Ravi Kumar', given: 'Ravi', last: 'Kumar' })
  // A lone word is a name, even one that looks like a title.
  assert.deepEqual(nameParts('Dr.'), { title: null, bare: 'Dr.', given: 'Dr.', last: null })
  // Only whole titles: "Drashti" is a name.
  assert.equal(nameParts('Drashti Shah').title, null)
})

test('people are referred to the way they are addressed', () => {
  assert.equal(shortName('Dr. Anil Mehta'), 'Dr. Mehta')
  assert.equal(shortName('Dr. Mehta'), 'Dr. Mehta')
  assert.equal(shortName('Prof Sunita Iyer'), 'Prof Iyer')
  assert.equal(shortName('Ravi Kumar'), 'Ravi')
  assert.equal(shortName('Ravi'), 'Ravi')
})
