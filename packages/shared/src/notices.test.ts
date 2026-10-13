import { test } from 'node:test'
import assert from 'node:assert/strict'
import { datesMentioned, noticeKind, noticeSummary, proposeFromNotice } from './notices.ts'

/** Notice titles as RSSB and RPSC list them. */

test('what kind of notice a title says it is', () => {
  assert.equal(noticeKind('Village Development Officer 2025 : Office Order regarding Guidelines for Scrutiny Form and DV Schedule'), 'dv')
  assert.equal(noticeKind('Librarian Grade III 2024 : Order Of Final Recommendation (04 Candidates)'), 'result')
  assert.equal(noticeKind('Contractual Teaching Associate (Raj-CES) 2026 : Press Note regarding Exam Schedule (Exam Dates & Time)'), 'schedule')
  assert.equal(noticeKind('Patwari 2025 : Admit Card for Written Exam'), 'admit_card')
  assert.equal(noticeKind('Junior Assistant 2026 : Advertisement and Online Application'), 'notification')
  assert.equal(noticeKind('Exams 2026 : Press Note For Upcoming Exam Dates'), 'schedule')
  assert.equal(noticeKind('Contractual Teaching Associate (Raj-CES) 2026 : District List for Exam'), 'other')
})

test('the board before the title: RSSB\'s Patwari, RSSB\'s VDO', () => {
  const vdo = proposeFromNotice({ board: 'RSSB', title: 'Village Development Officer 2025 : Office Order regarding Guidelines for Scrutiny Form and DV Schedule' })!
  assert.deepEqual(vdo, { examKey: 'rssb-vdo', cycle: '2025', kind: 'dv', dates: [] })
  assert.equal(proposeFromNotice({ board: 'RSSB', title: 'Junior Assistant 2026 : Advertisement' })!.examKey, 'rssb-ldc')
  assert.equal(proposeFromNotice({ board: 'RSSB', title: 'Lab Assistant 2026 : Last chance of Document Verification' }), null, 'not an exam in the list')
})

test('a row of RPSC\'s exam dates: the exam, its round and its day', () => {
  const pre = proposeFromNotice({ board: 'RPSC', title: 'RAJ. STATE AND SUB. SERVICES COMB. COMP EXAM 2026 — Pre', examDate: '2026-12-06' })!
  assert.deepEqual(pre, {
    examKey: 'ras',
    cycle: '2026',
    kind: 'schedule',
    dates: [{ step: 'exam', on: '2026-12-06', at: null, round: 'prelims', note: null }],
  })
  const ends = proposeFromNotice({ board: 'RPSC', title: 'RAJ. STATE AND SUB. SERVICES COMB. COMP EXAM 2026 — Mains (End Date)', examDate: '2027-05-02' })!
  assert.deepEqual(ends.dates, [{ step: 'other', on: '2027-05-02', at: null, round: 'mains', note: 'Mains ends' }])
  assert.equal(proposeFromNotice({ board: 'RPSC', title: 'SCHOOL LECTURER (SPECIAL EDUCATION) 2026 — School Lecturer', examDate: '2026-12-08' })!.examKey, 'rpsc-school-lecturer')
})

test('what trackers are told', () => {
  assert.equal(
    noticeSummary({ examKey: 'ras', cycle: '2026', kind: 'schedule', dates: [{ step: 'exam', on: '2026-12-06', at: null, round: 'prelims', note: null }] }),
    'RAS/RTS 2026: Prelims on Sun, 6 Dec',
  )
  assert.equal(noticeSummary({ examKey: 'rssb-vdo', cycle: '2025', kind: 'dv', dates: [] }), 'Rajasthan VDO (Gram Vikas Adhikari) 2025: document verification schedule out')
})

test('dates in a notice, as hints: still to come, once each, in order', () => {
  const NOW = new Date(2026, 9, 13)
  const text = 'fnukad 17-11-2026, 07-12-2026, 17-11-2026 ... notice dated 23-06-2026 ... 16 January 2027'
  assert.deepEqual(datesMentioned(text, NOW), ['2026-11-17', '2026-12-07', '2027-01-16'])
})
