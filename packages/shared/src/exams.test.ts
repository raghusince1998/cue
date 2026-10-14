import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXAMS, examByKey, examFit, examStages, examStepTitle, findExam, parseExamLine, readAdmitCard, splitExamStep, timesIn, dateIn } from './exams.ts'

/** Mid-October 2026: the days in the lines below are read from here. */
const NOW = new Date(2026, 9, 13, 10, 0)

test('the catalog: every exam has a body, rounds and a working alias', () => {
  const keys = new Set<string>()
  for (const e of EXAMS) {
    assert.ok(!keys.has(e.key), `${e.key} twice`)
    keys.add(e.key)
    assert.ok(e.rounds.length > 0, e.key)
    assert.ok(e.site === null || e.site.startsWith('https://'), e.key)
    assert.equal(findExam(`applied for ${e.name}`)?.exam.key, e.key, `"${e.name}" finds itself`)
  }
})

test('the exam a line is about, the longest name winning', () => {
  assert.equal(findExam('applied for Rajasthan Police SI')?.exam.key, 'raj-police-si')
  assert.equal(findExam('rajasthan police constable form')?.exam.key, 'raj-police-constable')
  assert.equal(findExam('RRB PO prelims')?.exam.key, 'ibps-rrb', 'a gramin bank, not the railways')
  assert.equal(findExam('NEET PG counselling'), null, 'not NEET UG')
  assert.equal(findExam('send the NDA to the client by friday'), null, 'a contract, not an exam')
  assert.equal(findExam('meet at the gate at 5'), null)
  assert.equal(findExam('feed the cat'), null)
})

test('stages: the form, applying, each round, and how it ended', () => {
  assert.deepEqual(
    examStages('ssc-cgl').map((s) => s.key),
    ['to_apply', 'applied', 'tier1', 'tier2', 'dv', 'selected', 'not_selected', 'dropped'],
  )
  assert.deepEqual(examStages(null).map((s) => s.key).slice(0, 3), ['to_apply', 'applied', 'exam'], 'one not in the list')
})

test('applied, with the board and the registration number', () => {
  const p = parseExamLine('applied for RRB NTPC 2026, RRB Ajmer, reg no 241051234567', NOW)!
  assert.equal(p.examKey, 'rrb-ntpc')
  assert.equal(p.cycle, '2026')
  assert.equal(p.region, 'RRB Ajmer')
  assert.equal(p.registrationNo, '241051234567')
  assert.equal(p.stage, 'applied')
  assert.deepEqual(p.dates, [])
})

test('dates, each by the words beside it', () => {
  const exam = parseExamLine('SSC CGL tier 1 exam on 14 sep', NOW)!
  assert.deepEqual(exam.dates, [{ step: 'exam', on: '2027-09-14', at: null, round: 'tier1' }])

  const form = parseExamLine('REET form last date 20 nov', NOW)!
  assert.equal(form.stage, 'to_apply')
  assert.deepEqual(form.dates, [{ step: 'apply_by', on: '2026-11-20', at: null, round: null }])

  const two = parseExamLine('RRB Group D form last date 20 nov, fee by 22 nov', NOW)!
  assert.deepEqual(two.dates.map((d) => [d.step, d.on]), [['apply_by', '2026-11-20'], ['fee_by', '2026-11-22']])

  const prelims = parseExamLine('UPSC prelims 24 may 2027', NOW)!
  assert.deepEqual(prelims.dates, [{ step: 'exam', on: '2027-05-24', at: null, round: 'prelims' }])

  assert.deepEqual(parseExamLine('NEET result 14 june', NOW)!.dates.map((d) => d.step), ['result'])
  assert.equal(parseExamLine('Patwari exam on 23 oct at 9am', NOW)!.dates[0]!.at, '09:00')
})

test('a round cleared moves it on; studying for one is just a plan', () => {
  assert.equal(parseExamLine('cleared RRB NTPC CBT 1', NOW)!.stage, 'cbt2')
  assert.equal(parseExamLine('cleared UPSC interview', NOW)!.stage, 'selected')
  assert.equal(parseExamLine('study for UPSC prelims tomorrow 6am', NOW), null)
  assert.equal(parseExamLine('SSC CGL mock test sunday 10am', NOW), null)
  assert.equal(parseExamLine('SSC CGL', NOW), null, 'a name alone says nothing')
  assert.equal(parseExamLine('registered for SSC CHSL', NOW)!.registrationNo, null, '"registered" is not a number')
})

test('what each date is called', () => {
  const e = { name: 'RRB NTPC', cycle: '2026', examKey: 'rrb-ntpc' }
  assert.equal(examStepTitle(e, 'apply_by'), 'Last date to apply: RRB NTPC 2026')
  assert.equal(examStepTitle(e, 'exam', 'cbt1'), 'Exam: RRB NTPC 2026 CBT 1')
  assert.deepEqual(splitExamStep('exam:cbt1'), { step: 'exam', round: 'cbt1' })
  assert.deepEqual(splitExamStep('apply_by'), { step: 'apply_by', round: null })
  assert.equal(splitExamStep('nonsense'), null)
})

test('times and dates the way admit cards write them', () => {
  assert.deepEqual(timesIn('09:00 AM to 10:30 AM'), ['09:00', '10:30'])
  assert.deepEqual(timesIn('02:00 PM - 05:20 PM'), ['14:00', '17:20'])
  assert.deepEqual(timesIn('7.30 am'), ['07:30'])
  assert.deepEqual(timesIn('12:00 PM'), ['12:00'])
  assert.deepEqual(timesIn('1330 hrs'), [], 'four digits with no colon are not a time to guess at')
  assert.equal(dateIn('18/11/2026'), '2026-11-18')
  assert.equal(dateIn('02.05.2027'), '2027-05-02')
  assert.equal(dateIn('14-Sep-2026'), '2026-09-14')
  assert.equal(dateIn('Sunday, 7th June 2026'), '2026-06-07')
  assert.equal(dateIn('31/02/2026'), '2026-02-31'.replace('31', '31'), 'not validated past the month: the card is believed')
})

/** An RRB e-call letter, as a PDF reads: label and value on each line. */
const RRB_CARD = `RAILWAY RECRUITMENT BOARDS
E-Call Letter for CBT-1
CEN No. 05/2024 (NTPC Graduate Level Posts)
Registration Number: 241051234567890
Roll Number: 2412345678
Candidate Name: ASHA MEENA
Date of Exam: 18/11/2026
Shift: 1
Reporting Time: 07:30 AM
Gate Closing Time: 08:30 AM
Exam Time: 09:00 AM to 10:30 AM
Test Centre Name: iON Digital Zone iDZ Mansarovar
Test Centre Address: Plot No 12, Sector 7, Mansarovar Industrial Area,
Near Metro Station, Jaipur, Rajasthan - 302020
Instructions to candidates`

test('an RRB call letter', () => {
  assert.deepEqual(readAdmitCard(RRB_CARD), {
    examKey: 'rrb-ntpc',
    examName: 'RRB NTPC',
    round: 'cbt1',
    rollNo: '2412345678',
    registrationNo: '241051234567890',
    date: '2026-11-18',
    reportingAt: '07:30',
    gateClosesAt: '08:30',
    startsAt: '09:00',
    endsAt: '10:30',
    shift: '1',
    centreName: 'iON Digital Zone iDZ Mansarovar',
    centreAddress: 'Plot No 12, Sector 7, Mansarovar Industrial Area, Near Metro Station, Jaipur, Rajasthan - 302020',
    centreCity: 'Jaipur',
  })
})

test('an NTA admit card', () => {
  const card = readAdmitCard(`NATIONAL TESTING AGENCY
Admit Card NEET (UG) - 2027
Application No.: 270410123456
Roll No.: 3101020345
Candidate's Name: RAHUL SHARMA
Date of Examination: 02.05.2027
Reporting/Entry time at Centre: 11:00 AM
Gate closing time of Centre: 01:30 PM
Timing of Test: 02:00 PM to 05:00 PM
Test Centre No.: 310102
Name of Test Centre: Kendriya Vidyalaya No. 3
Address of Test Venue: Jhalawar Road, Kota, Rajasthan 324005`)!
  assert.equal(card.examKey, 'neet-ug')
  assert.equal(card.rollNo, '3101020345')
  assert.equal(card.registrationNo, '270410123456')
  assert.equal(card.date, '2027-05-02')
  assert.deepEqual([card.reportingAt, card.gateClosesAt, card.startsAt, card.endsAt], ['11:00', '13:30', '14:00', '17:00'])
  assert.equal(card.centreName, 'Kendriya Vidyalaya No. 3', 'the name, not the centre number')
  assert.equal(card.centreCity, 'Kota')
})

test('an SSC admit card, two cells to a line', () => {
  const card = readAdmitCard(`Staff Selection Commission
Admit Card - Combined Graduate Level Examination, 2026 (Tier-I)
Roll No: 2201234567 | Registration No: 61234567890
Exam Date: 14-Sep-2026 | Shift Timing: 09:00 AM - 10:00 AM
Reporting Time: 07:45 AM | Entry Closing Time: 08:45 AM
Venue Name: Aptech Learning Centre
Venue Address: 2nd Floor, Station Road, Ajmer - 305001`)!
  assert.equal(card.examKey, 'ssc-cgl')
  assert.equal(card.round, 'tier1')
  assert.equal(card.rollNo, '2201234567')
  assert.equal(card.registrationNo, '61234567890')
  assert.equal(card.date, '2026-09-14')
  assert.deepEqual([card.reportingAt, card.gateClosesAt, card.startsAt, card.endsAt], ['07:45', '08:45', '09:00', '10:00'])
  assert.equal(card.shift, null, '"Shift Timing" is the time, not the shift')
  assert.equal(card.centreName, 'Aptech Learning Centre')
  assert.equal(card.centreCity, 'Ajmer')
})

test('a Rajasthan admit card, in Hindi and English', () => {
  const card = readAdmitCard(`राजस्थान कर्मचारी चयन बोर्ड
प्रवेश पत्र / Admit Card
Patwari Direct Recruitment Exam 2026
रोल नंबर / Roll No.: 1050123456
परीक्षा तिथि / Exam Date: 23-10-2026
Reporting Time: 08:00 AM
प्रवेश बंद होने का समय / Gate Closing Time: 09:00 AM
परीक्षा समय / Exam Time: 09:00 AM - 12:00 PM
परीक्षा केन्द्र / Exam Centre: Govt. Sr. Sec. School, Sikar Road
Centre Address: Govt. Sr. Sec. School, Sikar Road, Sikar 332001`)!
  assert.equal(card.examKey, 'rssb-patwari')
  assert.equal(card.rollNo, '1050123456')
  assert.equal(card.date, '2026-10-23')
  assert.deepEqual([card.reportingAt, card.gateClosesAt, card.startsAt, card.endsAt], ['08:00', '09:00', '09:00', '12:00'])
  assert.equal(card.centreName, 'Govt. Sr. Sec. School, Sikar Road')
  assert.equal(card.centreCity, 'Sikar')
})

test('what is not an admit card is nothing', () => {
  assert.equal(readAdmitCard('Your order has shipped. Track it here.'), null)
  assert.equal(readAdmitCard('Exam Date: 12/12/2026'), null, 'a date alone is not a card')
})

test('every exam falls in a group to choose it from', async () => {
  const { examGroup, EXAM_GROUPS } = await import('./exams.ts')
  const counts = Object.fromEntries(EXAM_GROUPS.map((g) => [g.key, EXAMS.filter((e) => examGroup(e) === g.key).length]))
  assert.deepEqual(counts, { railways: 6, ssc: 8, upsc: 7, banks: 9, entrance: 10, rajasthan: 13 })
})

test('whether what someone studied fits what a form usually asks for', () => {
  const studied = (level: string | null, training: string[] = []) => ({ level: level as never, training })
  assert.equal(examFit(examByKey('ssc-cgl'), studied('graduate')), 'fits')
  assert.equal(examFit(examByKey('ssc-cgl'), studied('12th')), 'needs')
  assert.equal(examFit(examByKey('ssc-chsl'), studied('postgraduate')), 'fits', 'more than enough is enough')
  assert.equal(examFit(examByKey('rrb-alp'), studied('10th', ['iti'])), 'fits')
  assert.equal(examFit(examByKey('rrb-alp'), studied('graduate', ['engineering'])), 'fits', 'engineering counts where ITI is asked')
  assert.equal(examFit(examByKey('rrb-alp'), studied('graduate')), 'needs')
  assert.equal(examFit(examByKey('ctet'), studied('graduate', ['teaching'])), 'fits')
  assert.equal(examFit(examByKey('ctet'), studied('graduate')), 'needs')
  assert.equal(examFit(examByKey('ssc-cgl'), studied(null)), null, 'not said, not judged')
  assert.equal(examFit(examByKey('raj-police-constable'), studied('10th')), null, 'not plain enough to say')
})
