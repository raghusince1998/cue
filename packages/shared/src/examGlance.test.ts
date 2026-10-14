import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysAway, examGlance, financialYearStart, isRenewedCategory, nextFirstApril, type GlanceExam } from './examGlance.ts'
import type { ExamClash } from './examClash.ts'

const now = new Date(2026, 9, 14, 9, 0)
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).toISOString()
const exam = (id: string, dates: GlanceExam['dates'], closedAt: string | null = null): GlanceExam => ({
  id,
  examKey: id,
  name: id.toUpperCase(),
  cycle: '2026',
  closedAt,
  dates,
})
const date = (step: string, dueAt: string, status = 'pending', round: string | null = null) => ({ step, round, dueAt, allDay: false, status })

test('the next exam, and last dates within two weeks, soonest first', () => {
  const g = examGlance(
    [
      exam('cgl', [date('apply_by', at(2026, 10, 1), 'done'), date('exam', at(2026, 12, 8), 'pending', 'tier1')]),
      exam('chsl', [date('fee_by', at(2026, 10, 24)), date('apply_by', at(2026, 10, 22)), date('exam', at(2027, 1, 20))]),
      exam('ntpc', [date('apply_by', at(2026, 11, 20))]),
    ],
    [],
    now,
  )
  assert.equal(g.next?.examId, 'cgl')
  assert.equal(g.next?.label, 'CGL 2026')
  assert.equal(g.next?.round, 'tier1')
  assert.deepEqual(
    g.soon.map((s) => [s.examId, s.step]),
    [
      ['chsl', 'apply_by'],
      ['chsl', 'fee_by'],
    ],
    'a month away is not soon; done is not soon',
  )
})

test('a finished exam, and dates gone by, are left out; today’s still shows', () => {
  const g = examGlance(
    [
      exam('cgl', [date('exam', at(2026, 11, 2))], at(2026, 10, 1)),
      exam('chsl', [date('apply_by', at(2026, 10, 13)), date('apply_by', at(2026, 10, 14, 8))]),
    ],
    [],
    now,
  )
  assert.equal(g.next, null)
  assert.equal(g.soon.length, 1)
  assert.equal(daysAway(g.soon[0]!.on, now), 0)
})

test('clashes worth a decision, not two shifts far apart', () => {
  const item = (examId: string) => ({ examId, label: examId, on: '2027-03-10', at: null, city: null })
  const clashes: ExamClash[] = [
    { kind: 'same-day-shifts', on: '2027-03-09', a: item('a'), b: item('b') },
    { kind: 'same-day', on: '2027-03-10', a: item('CHSL'), b: item('NTPC') },
  ]
  assert.deepEqual(examGlance([], clashes, now).clashes, [{ kind: 'same-day', on: '2027-03-10', a: 'CHSL', b: 'NTPC' }])
})

test('days by the calendar, not by the hour', () => {
  assert.equal(daysAway('2026-10-15', new Date(2026, 9, 14, 23, 50)), 1)
  assert.equal(daysAway(at(2026, 12, 8, 9), now), 55)
})

test('certificates renewed each financial year, from 1 April', () => {
  assert.ok(isRenewedCategory('EWS'))
  assert.ok(isRenewedCategory('OBC'))
  assert.ok(isRenewedCategory('MBC'))
  assert.ok(!isRenewedCategory('SC'), 'a caste certificate does not lapse')
  assert.ok(!isRenewedCategory(null))
  assert.equal(nextFirstApril(now), '2027-04-01')
  assert.equal(nextFirstApril(new Date(2027, 1, 10)), '2027-04-01')
  assert.equal(financialYearStart(now), '2026-04-01')
  assert.equal(financialYearStart(new Date(2027, 1, 10)), '2026-04-01')
})
