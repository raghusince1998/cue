import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readyFor, readyList } from './examReady.ts'

const on = new Date(2026, 10, 20)
const nobody = { category: null, level: null, training: [] }

test('which dates carry a list', () => {
  assert.equal(readyFor('apply_by', null), 'form')
  assert.equal(readyFor('exam', 'dv'), 'dv')
  assert.equal(readyFor('exam', 'medical'), 'medical')
  assert.equal(readyFor('exam', 'interview'), 'interview')
  assert.equal(readyFor('exam', 'ssb'), 'interview')
  assert.equal(readyFor('exam', 'tier1'), null, 'the exam day has its own carry list, from the admit card')
  assert.equal(readyFor('fee_by', null), null)
  assert.equal(readyFor('result', 'dv'), null)
})

test('the form: what the exam asks for, and the person’s own category', () => {
  const list = readyList('form', 'ssc-cgl', { category: 'OBC', level: 'graduate', training: [] }, on)
  assert.ok(list.includes('Graduation marksheets or degree'), 'they are graduates: no final-year hint')
  assert.ok(list.includes('OBC certificate issued on or after 1 April 2026, in the format the notice gives'))
  assert.match(list[0]!, /^Photo and signature/)
  assert.match(list.at(-1)!, /registration number/)

  const unsaid = readyList('form', 'ssc-cgl', nobody, on)
  assert.ok(unsaid.some((x) => /^Graduation marksheets or degree \(in the final year\?/.test(x)))
  assert.ok(!unsaid.some((x) => /certificate issued|in the format/.test(x)), 'no category said, none asked')
})

test('training: theirs when they said it, else what the exam takes', () => {
  assert.ok(readyList('form', 'rrb-alp', { category: null, level: '10th', training: ['iti'] }, on).includes('ITI certificate (NCVT or SCVT)'))
  assert.ok(
    readyList('form', 'rrb-alp', nobody, on).includes('ITI certificate (NCVT or SCVT) or Engineering diploma or degree, as the notice asks'),
  )
})

test('SC and ST certificates are asked for without a date; the open category is not', () => {
  assert.ok(readyList('dv', 'rrb-ntpc', { category: 'SC', level: null, training: [] }, on).includes('SC certificate, in the format the notice gives'))
  assert.ok(!readyList('dv', 'rrb-ntpc', { category: 'UR', level: null, training: [] }, on).some((x) => /UR/.test(x)))
})

test('a renewed certificate is for the financial year of the date, not today', () => {
  const march = readyList('dv', 'ssc-cgl', { category: 'EWS', level: 'graduate', training: [] }, new Date(2027, 2, 20))
  assert.ok(march.includes('EWS certificate issued on or after 1 April 2026, in the format the notice gives'))
  const may = readyList('dv', 'ssc-cgl', { category: 'EWS', level: 'graduate', training: [] }, new Date(2027, 4, 2))
  assert.ok(may.includes('EWS certificate issued on or after 1 April 2027, in the format the notice gives'))
})

test('verification, medical and interview lists; in Hindi too', () => {
  const dv = readyList('dv', 'ssc-cgl', nobody, on)
  assert.match(dv[0]!, /call letter/)
  assert.ok(dv.includes('10th marksheet (proof of date of birth)'))
  assert.ok(dv.includes('Graduation marksheets or degree'), 'no final-year hint at verification')
  assert.equal(readyList('medical', 'rrb-ntpc', nobody, on).length, 5)
  assert.equal(readyList('interview', 'upsc-cse', nobody, on).length, 5)

  const hi = readyList('form', 'ssc-cgl', { category: 'MBC', level: 'graduate', training: [] }, on, 'hi')
  assert.match(hi[0]!, /फोटो और हस्ताक्षर/)
  assert.ok(hi.includes('स्नातक की अंकतालिकाएँ या डिग्री'))
  assert.ok(hi.some((x) => x.startsWith('1 अप्रैल 2026 या उसके बाद बना MBC प्रमाण पत्र')))
})
