import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REPEATS } from './bills.ts'
import { DELIVERY_STATUSES, STATUS_LABEL } from './deliveries.ts'
import { EXPENSE_CATEGORIES } from './expenses.ts'
import { BOARDS, BOARD_KEYS } from './trackers.ts'
import {
  BOARD_HI,
  DELIVERY_STATUS_HI,
  EXPENSE_CATEGORY_HI,
  REPEAT_HI,
  TRACKER_STAGE_HI,
  boardLabel,
  deliveryStatusLabel,
  expenseCategoryLabel,
  repeatLabel,
  trackerStageLabel,
} from './hindi.ts'

const DEVANAGARI = /[\u0900-\u097F]/

test('every label in the shared tables has Hindi', () => {
  for (const r of REPEATS) assert.ok(DEVANAGARI.test(REPEAT_HI[r.key]), r.key)
  for (const s of DELIVERY_STATUSES) assert.ok(DEVANAGARI.test(DELIVERY_STATUS_HI[s]), s)
  for (const c of EXPENSE_CATEGORIES) assert.ok(DEVANAGARI.test(EXPENSE_CATEGORY_HI[c.key]), c.key)
  for (const b of BOARD_KEYS) {
    assert.ok(DEVANAGARI.test(BOARD_HI[b]), b)
    for (const s of BOARDS[b].stages) assert.ok(DEVANAGARI.test(TRACKER_STAGE_HI[b][s.key] ?? ''), `${b}.${s.key}`)
  }
})

test('the helpers say the English label in English, and the Hindi in Hindi', () => {
  assert.equal(repeatLabel('monthly'), 'Every month')
  assert.equal(repeatLabel('monthly', 'hi'), 'हर महीने')
  assert.equal(deliveryStatusLabel('shipped'), STATUS_LABEL.shipped)
  assert.equal(deliveryStatusLabel('out_for_delivery', 'hi'), 'डिलीवरी के लिए निकला')
  assert.equal(boardLabel('jobs'), 'Job hunt')
  assert.equal(boardLabel('hiring', 'hi'), 'भर्ती')
  assert.equal(trackerStageLabel('jobs', 'interview'), 'Interviewing')
  assert.equal(trackerStageLabel('jobs', 'interview', 'hi'), 'इंटरव्यू')
  assert.equal(trackerStageLabel('deals', 'made_up', 'hi'), 'made_up', 'a stage no board has is said as it is')
  assert.equal(expenseCategoryLabel('parking'), 'Parking & tolls')
  assert.equal(expenseCategoryLabel('travel', 'hi'), 'आना-जाना')
})
