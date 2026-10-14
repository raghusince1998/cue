import { test } from 'node:test'
import assert from 'node:assert/strict'
import { examClashes, type ExamDayItem } from './examClash.ts'

const day = (examId: string, on: string, at: string | null = null, city: string | null = null): ExamDayItem => ({ examId, label: examId, on, at, city })

test('two exams on one day clash, unless their shifts are far apart in one city', () => {
  assert.deepEqual(
    examClashes([day('chsl', '2026-11-20'), day('ntpc', '2026-11-20')]).map((c) => [c.kind, c.on, c.a.examId, c.b.examId]),
    [['same-day', '2026-11-20', 'chsl', 'ntpc']],
  )
  assert.equal(examClashes([day('chsl', '2026-11-20', '09:00', 'Jaipur'), day('ntpc', '2026-11-20', '15:00', 'jaipur')])[0]!.kind, 'same-day-shifts')
  assert.equal(examClashes([day('chsl', '2026-11-20', '09:00', 'Jaipur'), day('ntpc', '2026-11-20', '15:00', 'Delhi')])[0]!.kind, 'same-day', 'not in two cities')
  assert.equal(examClashes([day('chsl', '2026-11-20', '09:00'), day('ntpc', '2026-11-20', '11:00')])[0]!.kind, 'same-day', 'two hours apart is one shift')
})

test('following days in two cities is a journey to plan; in one city, nothing', () => {
  assert.deepEqual(
    examClashes([day('ntpc', '2026-11-21', null, 'Delhi'), day('chsl', '2026-11-20', null, 'Jaipur')]).map((c) => [c.kind, c.a.examId, c.b.examId]),
    [['next-day-travel', 'chsl', 'ntpc']],
  )
  assert.deepEqual(examClashes([day('chsl', '2026-11-20', null, 'Jaipur'), day('ntpc', '2026-11-21', null, 'Jaipur')]), [])
  assert.deepEqual(examClashes([day('chsl', '2026-11-30'), day('ntpc', '2026-12-01')]), [], 'cities not known yet: nothing to say')
  assert.deepEqual(examClashes([day('chsl', '2026-11-20'), day('chsl', '2026-11-20')]), [], 'one exam is not a clash with itself')
})
