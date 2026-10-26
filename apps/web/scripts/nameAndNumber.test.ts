import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameAndNumber } from '../src/lib/phoneContacts.ts'

/** Someone new typed in one box: the name and the number land in their own fields. */

test('a name and a number, typed together, come apart', () => {
  assert.deepEqual(nameAndNumber('Dr Sharma 98111 22233'), { name: 'Dr Sharma', phone: '98111 22233' })
  assert.deepEqual(nameAndNumber('+91 98111-22233, Meena'), { name: 'Meena', phone: '+91 98111-22233' })
  assert.deepEqual(nameAndNumber('Ravi - 9876543210'), { name: 'Ravi', phone: '9876543210' })
})

test('only a number, or only a name', () => {
  assert.deepEqual(nameAndNumber(' 98111 22233 '), { name: '', phone: '98111 22233' })
  assert.deepEqual(nameAndNumber('Dr Sharma'), { name: 'Dr Sharma', phone: '' })
})

test('a short number in a name is part of the name', () => {
  assert.deepEqual(nameAndNumber('Clinic 24'), { name: 'Clinic 24', phone: '' })
})
