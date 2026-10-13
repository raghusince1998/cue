import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from './i18n-check.ts'

// The web app's Hindi: every line the screens show has it, with the same
// placeholders, and nothing in the dictionaries is left over or said two ways.
const report = check()

test('every line shown has Hindi', () => {
  assert.deepEqual(report.missing, [])
})

test('Hindi keeps every {placeholder} and <tag>', () => {
  assert.deepEqual(report.mismatched, [])
})

test('a line means the same in every area', () => {
  assert.deepEqual(report.conflicts, [])
})

test('no Hindi is left over from a line that is gone', () => {
  assert.deepEqual(report.unused, [])
})
