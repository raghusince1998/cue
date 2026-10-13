import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cutOffsIn, findNumber, normalizeNumber, numbersIn } from './results.ts'

test('roll numbers in a page of a list, however they are printed', () => {
  const page = 'S.No | Roll No | Name\n1 | 2412345678 | ASHA\n2 | 2412345679 | RAVI\nNTA2701234 | ...  Page 3 of 412  Dated 12.11.2026'
  const numbers = numbersIn(page)
  assert.ok(numbers.includes('2412345678'))
  assert.ok(numbers.includes('NTA2701234'))
  assert.ok(!numbers.includes('3'), 'page numbers are not roll numbers')
  assert.ok(!numbers.includes('12112026'), 'a date is not one either')
  assert.equal(normalizeNumber(' 24-1234 5678 '), '2412345678')
})

test('which page a number is on, by roll number or registration number', () => {
  const pages = [new Set(['1111111', '2222222']), new Set(['2412345678'])]
  assert.equal(findNumber(pages, ['24 1234 5678']), 2)
  assert.equal(findNumber(pages, [null, '2222222']), 1, 'its registration number, when that is what the list uses')
  assert.equal(findNumber(pages, ['9999999']), null)
  assert.equal(findNumber(pages, [null, '']), null, 'no number, nothing to look for')
})

test('cut-offs by category, after a cut-off heading', () => {
  const text = `Result of CBT-1
Category-wise cut-off marks
UR 72.50
EWS 65.10
OBC-NCL 68.25
SC | 58.4
ST 52
Candidates shortlisted: 1,23,456`
  assert.deepEqual(cutOffsIn(text), [
    { category: 'UR', marks: 72.5 },
    { category: 'EWS', marks: 65.1 },
    { category: 'OBC', marks: 68.25 },
    { category: 'SC', marks: 58.4 },
    { category: 'ST', marks: 52 },
  ])
  assert.deepEqual(cutOffsIn('UR 72.50, OBC 68 — a table with no heading'), [])
})
