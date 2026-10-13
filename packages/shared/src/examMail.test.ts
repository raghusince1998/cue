import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isExamBody, parseExamEmail } from './examMail.ts'
import { EXAM_MAIL } from './examMail.samples.ts'

const NOW = new Date(2026, 9, 13, 10, 0)

test('who sent it: the board, or someone passing on the news', () => {
  assert.equal(isExamBody('Staff Selection Commission <no-reply@ssc.gov.in>'), true)
  assert.equal(isExamBody('RRB Apply <noreply@rrbapply.gov.in>'), true)
  assert.equal(isExamBody('neet-ug@nta.ac.in'), true)
  assert.equal(isExamBody('IBPS <noreply@ibps.in>'), true)
  assert.equal(isExamBody('Testbook <news@testbook.com>'), false)
  assert.equal(isExamBody('"ssc.gov.in" <spoof@gmail.com>'), false, 'the address, not the name')
})

test('a registration: the exam, the year and the number', () => {
  const m = parseExamEmail(EXAM_MAIL.sscRegistered, NOW)!
  assert.deepEqual([m.kind, m.examKey, m.cycle, m.registrationNo], ['registered', 'ssc-cgl', '2026', '61234567890'])
  assert.deepEqual(m.dates, [])
})

test('registered with the fee still to pay, and the password left where it is', () => {
  const m = parseExamEmail(EXAM_MAIL.rrbRegistered, NOW)!
  assert.deepEqual([m.kind, m.examKey, m.cycle, m.registrationNo], ['fee_due', 'rrb-ntpc', 'CEN 05/2024', '241051234567890'])
  assert.deepEqual(m.dates, [{ step: 'fee_by', on: '2026-10-20', at: '23:59', round: null }])
  assert.ok(!JSON.stringify(m).includes('Asha@1234'), 'never read out')
})

test('a city slip: the exam day and its city', () => {
  const m = parseExamEmail(EXAM_MAIL.ntaCity, NOW)!
  assert.deepEqual([m.kind, m.examKey, m.cycle, m.registrationNo, m.city], ['city_slip', 'neet-ug', '2027', '270410123456', 'Kota'])
  assert.deepEqual(m.dates, [{ step: 'exam', on: '2027-05-02', at: null, round: null }])
})

test('admit cards out, with the exam day they give', () => {
  const jee = parseExamEmail(EXAM_MAIL.ntaAdmitCard, NOW)!
  assert.deepEqual([jee.kind, jee.examKey, jee.cycle, jee.round], ['admit_card', 'jee-main', '2027', 'session1'])
  assert.deepEqual(jee.dates, [{ step: 'exam', on: '2027-01-22', at: null, round: 'session1' }])

  const upsc = parseExamEmail(EXAM_MAIL.upscAdmitCard, NOW)!
  assert.deepEqual([upsc.kind, upsc.examKey, upsc.cycle, upsc.round, upsc.registrationNo], ['admit_card', 'upsc-cse', '2027', 'prelims', '12345678901'])
  assert.deepEqual(upsc.dates, [{ step: 'exam', on: '2027-05-24', at: null, round: 'prelims' }])

  const ibps = parseExamEmail(EXAM_MAIL.ibpsCallLetter, NOW)!
  assert.deepEqual([ibps.kind, ibps.examKey, ibps.round], ['admit_card', 'ibps-po', 'prelims'])
  assert.deepEqual(ibps.dates.map((d) => [d.step, d.on]), [['exam', '2026-11-07']])
})

test('an answer key: the last day to object', () => {
  const m = parseExamEmail(EXAM_MAIL.sscAnswerKey, NOW)!
  assert.deepEqual([m.kind, m.examKey, m.round], ['answer_key', 'ssc-cgl', 'tier1'])
  assert.deepEqual(m.dates, [{ step: 'answer_key', on: '2026-11-13', at: '18:00', round: 'tier1' }])
})

test('a result, and a shortlist for the next round', () => {
  const ras = parseExamEmail(EXAM_MAIL.rpscResult, NOW)!
  assert.deepEqual([ras.kind, ras.examKey, ras.round], ['result', 'ras', 'prelims'])
  assert.deepEqual(ras.dates, [], 'the mains date is for those who qualified; it is not known who did')

  const rbi = parseExamEmail(EXAM_MAIL.rbiShortlist, NOW)!
  assert.deepEqual([rbi.kind, rbi.examKey, rbi.nextRound, rbi.rollNo], ['shortlisted', 'rbi-grade-b', 'interview', '2610045678'])
})

test('a code to type is not an exam', () => {
  assert.equal(parseExamEmail(EXAM_MAIL.otp, NOW), null)
})

test('the news, from a coaching site, still reads — who sent it decides what it may do', () => {
  const m = parseExamEmail(EXAM_MAIL.coaching, NOW)!
  assert.deepEqual([m.kind, m.examKey], ['admit_card', 'ssc-cgl'])
})
