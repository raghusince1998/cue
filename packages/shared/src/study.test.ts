import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mockScoreIn, studyWeek, subjectsFor } from './study.ts'
import { parseExamLine } from './exams.ts'

const NOW = new Date(2026, 9, 13, 10, 0)

test('the usual subjects of an exam, and a sensible default', () => {
  assert.deepEqual(subjectsFor('neet-ug'), ['Physics', 'Chemistry', 'Botany', 'Zoology'])
  assert.equal(subjectsFor('rssb-patwari').at(-1), 'Computer')
  assert.deepEqual(subjectsFor(null), ['Quantitative aptitude', 'Reasoning', 'English', 'General awareness'])
})

test('a week of study: subjects dealt across the days, the mock on its own day', () => {
  const week = studyWeek({
    examName: 'SSC CGL 2026',
    subjects: ['Quant', 'Reasoning', 'English', 'GA'],
    days: [1, 2, 3, 4, 5, 6, 0],
    at: { hour: 6, minute: 30 },
    minutes: 90,
    mock: { day: 0, at: { hour: 10, minute: 0 }, minutes: 120 },
  })
  assert.deepEqual(
    week.map((s) => [s.title, s.weekdays]),
    [
      ['Study Quant: SSC CGL 2026', [1, 5]],
      ['Study Reasoning: SSC CGL 2026', [2, 6]],
      ['Study English: SSC CGL 2026', [3]],
      ['Study GA: SSC CGL 2026', [4]],
      ['Mock test: SSC CGL 2026', [0]],
    ],
    'Monday first; Sunday is the mock',
  )
  assert.equal(week[0]!.hour, 6)
  assert.equal(week.at(-1)!.durationMinutes, 120)
})

test('a mock score, in English or Hindi', () => {
  assert.deepEqual(mockScoreIn('scored 142/200 in CGL mock'), { score: 142, outOf: 200 })
  assert.deepEqual(mockScoreIn('mock test 61.5 out of 100'), { score: 61.5, outOf: 100 })
  assert.deepEqual(mockScoreIn('NEET mock 720 में से 520'), { score: 520, outOf: 720 }, 'the total first, in Hindi')
  assert.deepEqual(mockScoreIn('NEET mock 520 में से 720'), null, 'more than full marks is not a score')
  assert.deepEqual(mockScoreIn('NEET mock में 520/720 आए'), { score: 520, outOf: 720 })
  assert.equal(mockScoreIn('scored 142/200'), null, 'a score that is not a mock is not this')
})

test('a mock score as a line about the exam', () => {
  const p = parseExamLine('scored 142/200 in SSC CGL mock', NOW)!
  assert.deepEqual([p.examKey, p.mock], ['ssc-cgl', { score: 142, outOf: 200 }])
})

test('exam lines in Hinglish and Hindi', () => {
  assert.equal(parseExamLine('RRB NTPC ka form bhar diya, reg no 241051234567', NOW)!.stage, 'applied')
  assert.equal(parseExamLine('REET ka form bharna hai, last date 20 nov', NOW)!.stage, 'to_apply')
  assert.equal(parseExamLine('RRB NTPC CBT 1 clear ho gaya', NOW)!.stage, 'cbt2')
  assert.equal(parseExamLine('Patwari me select ho gaya', NOW)!.stage, 'selected')
  const hindi = parseExamLine('पटवारी परीक्षा 23 नवंबर को है'.replace('पटवारी', 'Patwari'), NOW)!
  assert.deepEqual(hindi.dates, [{ step: 'exam', on: '2026-11-23', at: null, round: null }])
  const form = parseExamLine('SSC CGL फॉर्म भर दिया', NOW)!
  assert.equal(form.stage, 'applied')
})

test('more subjects than days: they share, and none is left out', () => {
  const week = studyWeek({
    examName: 'Patwari 2025',
    subjects: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
    days: [1, 2, 3, 4, 5, 6],
    at: { hour: 6, minute: 0 },
    minutes: 60,
  })
  assert.deepEqual(week.map((s) => s.subject), ['A + G', 'B + H', 'C + I', 'D', 'E', 'F'])
  assert.equal(subjectsFor('rssb-patwari', 'hi')[0], 'राजस्थान सामान्य ज्ञान')
})
