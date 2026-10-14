import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, type Harness } from '../testing/harness.ts'

/**
 * The Cue Exams demo: an aspirant's account with everything the exams side
 * does already in it, current to the day it is opened, in the visitor's
 * language — and nothing buzzing for its past.
 */

let h: Harness
let demo: typeof import('./demo.ts')
let svc: typeof import('./exams.ts')
let week: typeof import('./examWeek.ts')

before(async () => {
  h = await createTestDb('exams_demo')
  process.env.DATABASE_URL = h.url
  demo = await import('./demo.ts')
  svc = await import('./exams.ts')
  week = await import('./examWeek.ts')
})

after(() => h.close())

// A Wednesday morning.
const now = new Date(2026, 9, 14, 9, 0)

test('an aspirant’s account: exams at every stage, a clash, lists, scores, a plan', async () => {
  const { userId } = await demo.createDemo(now, { kind: 'exams', language: 'en' })
  const [user] = await h.sql<{ uses: string[]; language: string; exam_level: string; certificate_series_id: string | null }[]>`
    select uses, language, exam_level, certificate_series_id from users where id = ${userId}`
  assert.deepEqual(user!.uses, ['exams'])
  assert.equal(user!.exam_level, 'graduate')
  assert.ok(user!.certificate_series_id, 'the OBC certificate reminder is set')

  const exams = await svc.listExams(userId, now)
  assert.deepEqual(exams.map((x) => x.name).sort(), ['REET', 'RRB NTPC', 'SSC CGL', 'SSC CHSL'])
  assert.ok(exams.every((x) => x.category === 'OBC'), 'the category carries to every exam')

  const cgl = await svc.examById(userId, exams.find((x) => x.name === 'SSC CGL')!.id)
  assert.equal(cgl!.examDay?.reportingAt, '07:30')
  assert.equal(cgl!.mocks!.length, 4)
  assert.ok(cgl!.study!.length >= 4, 'a series per subject, and the mock test')

  const clashes = await svc.clashesFor(userId, now)
  assert.equal(clashes.filter((k) => k.kind === 'same-day').length, 1, 'CGL and REET on one day')

  const chsl = exams.find((x) => x.name === 'SSC CHSL')!
  assert.ok(chsl.dates.find((d) => d.step === 'apply_by')!.ready!.total >= 6, 'the form’s list')
  const ntpc = await svc.examById(userId, exams.find((x) => x.name === 'RRB NTPC')!.id)
  assert.ok(ntpc!.dates.find((d) => d.round === 'dv')!.ready!.total >= 8, 'what to bring to verification')
  assert.equal(ntpc!.expected!.cbt2!.score, 86)

  // This week so far: everything due done, bar one missed — and nothing overdue.
  const w = await week.examWeek(userId, now)
  assert.equal(w.study.planned, 3, 'Monday, Tuesday and this morning')
  assert.equal(w.study.done, 2)
  const [overdue] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from commitments where user_id = ${userId} and status = 'pending' and due_at < ${now}`
  assert.equal(overdue!.n, 0)
  assert.deepEqual([w.mocks.thisWeek, w.mocks.lastWeek], [65, 61], 'yesterday’s mock against last week’s')

  const [buzz] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from reminders r join commitments c on c.id = r.commitment_id
    where c.user_id = ${userId} and r.status = 'pending' and r.fire_at < ${now}`
  assert.equal(buzz!.n, 0, 'nothing rings for the demo’s past')
})

test('in Hindi, made in Hindi', async () => {
  const { userId } = await demo.createDemo(now, { kind: 'exams', language: 'hi' })
  const exams = await svc.listExams(userId, now)
  const titles = exams.flatMap((x) => x.dates.map((d) => d.title))
  assert.ok(titles.some((t) => /आवेदन की अंतिम तिथि/.test(t)), titles.join(' | '))
})

test('the everyday demo is as it was', async () => {
  const { userId } = await demo.createDemo(now)
  const [user] = await h.sql<{ uses: string[]; language: string }[]>`select uses, language from users where id = ${userId}`
  assert.deepEqual(user!.uses, ['personal', 'office'])
  assert.equal(user!.language, 'en')
  assert.equal((await svc.listExams(userId, now)).length, 0)
})
