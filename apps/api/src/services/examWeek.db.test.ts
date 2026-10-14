import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Keeping an aspirant on track week to week: the Sunday prep report from the
 * study plan, mock scores and next week's dates; the top of Today; and a
 * yearly reminder to renew a category certificate, set once.
 */

let h: Harness
let app: FastifyInstance
let svc: typeof import('./exams.ts')
let week: typeof import('./examWeek.ts')
let asha: Seeded
let bob: Seeded

before(async () => {
  h = await createTestDb('exam_week')
  process.env.DATABASE_URL = h.url
  svc = await import('./exams.ts')
  week = await import('./examWeek.ts')
  asha = await seedUser(h.sql, 'asha@test.local')
  bob = await seedUser(h.sql, 'bob@test.local')
  await h.sql`update users set uses = '{exams}' where id in (${asha.userId}, ${bob.userId})`
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { examRoutes } = await import('../routes/exams.ts')
  const { recurrenceRoutes } = await import('../routes/recurrences.ts')
  const { ZodError } = await import('zod')
  app = Fastify()
  app.setErrorHandler((err: Error, _req, reply) => reply.code(err instanceof ZodError ? 400 : 500).send({ error: err.message }))
  await registerAuth(app)
  await app.register(examRoutes)
  await app.register(recurrenceRoutes)
  await app.ready()
})

after(async () => {
  await app.close()
  await h.close()
})

const token = (who: Seeded, email: string) => app.jwt.sign({ sub: who.userId, orgId: who.orgId, email })
async function call(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, who = asha, email = 'asha@test.local') {
  const res = await app.inject({ method, url, payload: body as never, headers: { authorization: `Bearer ${token(who, email)}` } })
  return { status: res.statusCode, body: res.json() as any }
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

let cgl: string

test('the Sunday report: sessions done of those planned, mocks against last week, next week ahead', async () => {
  cgl = (await call('POST', '/exams', { examKey: 'ssc-cgl', name: 'SSC CGL', cycle: '2026', stage: 'applied', dates: [{ step: 'exam', on: '2027-03-10' }] })).body.id
  await call('POST', '/exams', { examKey: 'ssc-chsl', name: 'SSC CHSL', cycle: '2027', stage: 'to_apply', dates: [{ step: 'apply_by', on: '2027-01-14' }] })

  // Monday, Wednesday and Friday at seven; the mock test on Sunday.
  const monday = new Date(2027, 0, 4, 6, 0)
  await svc.makeStudyPlan(asha.userId, cgl, { subjects: ['Maths', 'Reasoning'], days: [1, 3, 5], at: '07:00', minutes: 60, mock: { day: 0, at: '10:00', minutes: 60 } }, monday)
  await h.sql`
    update commitments set status = 'done', completed_at = due_at
    where user_id = ${asha.userId} and recurrence_id is not null
      and due_at >= '2027-01-04' and due_at < '2027-01-09'`
  await svc.addMock(asha.userId, cgl, { takenOn: '2027-01-03', score: 110, outOf: 200 })
  await svc.addMock(asha.userId, cgl, { takenOn: '2027-01-09', score: 124, outOf: 200 })

  const sunday = new Date(2027, 0, 10, 19, 0)
  const w = await week.examWeek(asha.userId, sunday)
  assert.deepEqual(w.study, { done: 3, planned: 4 }, 'Mon, Wed, Fri done; Sunday’s mock not ticked')
  assert.deepEqual(w.mocks, { count: 1, thisWeek: 62, lastWeek: 55 })
  assert.equal(w.studyNext, 4)
  assert.equal(w.ahead.length, 1)
  assert.match(w.ahead[0]!.title, /SSC CHSL/)
  assert.deepEqual(w.nextExam && { label: w.nextExam.label, days: w.nextExam.days }, { label: 'SSC CGL 2026', days: 59 })

  const said = week.composeExamWeek(w)!
  assert.equal(said.title, 'Your prep this week')
  assert.match(said.body, /^Studied 3 of 4 sessions\. Mock tests 62%, from 55% the week before\. Coming up: .*SSC CHSL.* \(Thu, 14 Jan\)\. SSC CGL 2026 in 59 days\. 4 study sessions planned next week\.$/)
  const hindi = week.composeExamWeek(w, 'hi')!
  assert.equal(hindi.title, 'इस हफ़्ते की तैयारी')
  assert.match(hindi.body, /पढ़ाई के 4 में से 3 सत्र पूरे।/)
})

test('sent once on Sunday evening, only to those tracking an exam who have not turned it off', async () => {
  await svc.createExam(bob.orgId, bob.userId, { examKey: 'reet', name: 'REET', stage: 'not_selected' })
  const sent: string[] = []
  const send = (async (userId: string) => {
    sent.push(userId)
    return 1
  }) as never
  const sundayEvening = new Date('2027-01-10T13:30:00Z') // 19:00 in Asia/Kolkata
  assert.equal(await week.runExamWeeks(new Date('2027-01-09T13:30:00Z'), send), 0, 'not on a Saturday')
  assert.equal(await week.runExamWeeks(sundayEvening, send), 1)
  assert.deepEqual(sent, [asha.userId], 'bob’s only exam is over')
  assert.equal(await week.runExamWeeks(new Date('2027-01-10T14:30:00Z'), send), 0, 'once a week')

  await h.sql`update users set exam_week_enabled = false, last_exam_week_on = null where id = ${asha.userId}`
  assert.equal(await week.runExamWeeks(sundayEvening, send), 0, 'turned off')

  await h.sql`update users set exam_week_enabled = true, uses = '{personal}' where id = ${asha.userId}`
  assert.equal(await week.runExamWeeks(sundayEvening, send), 0, 'not for someone who did not choose competitive exams')
})

test('a week with nothing in it says nothing', () => {
  const empty = { week: { from: '', to: '' }, study: { done: 0, planned: 0 }, mocks: { count: 0, thisWeek: null, lastWeek: null }, ahead: [], studyNext: 0, nextExam: null }
  assert.equal(week.composeExamWeek(empty), null)
})

test('the top of Today: the next exam, a last date in the next two weeks', async () => {
  const soon = new Date()
  soon.setDate(soon.getDate() + 5)
  await call('POST', '/exams', { examKey: 'rrb-ntpc', name: 'RRB NTPC', cycle: '2026', stage: 'to_apply', dates: [{ step: 'apply_by', on: ymd(soon) }] })
  const g = (await call('GET', '/exams/glance')).body
  assert.equal(g.next.label, 'SSC CGL 2026')
  assert.deepEqual(
    g.soon.map((s: { label: string; step: string }) => [s.label, s.step]),
    [['RRB NTPC 2026', 'apply_by']],
  )
  assert.deepEqual((await call('GET', '/exams/glance', undefined, bob, 'bob@test.local')).body, { next: null, soon: [], clashes: [] })
})

test('the certificate reminder: every 1 April, set once, under Repeating', async () => {
  assert.equal((await call('GET', `/exams/${cgl}`)).body.certificateReminder, false)
  assert.equal((await call('POST', '/exams/certificate-reminder', { category: 'SC' })).status, 400, 'an SC certificate does not lapse')
  assert.deepEqual((await call('POST', '/exams/certificate-reminder', { category: 'EWS' })).body, { on: true, added: true })
  assert.deepEqual((await call('POST', '/exams/certificate-reminder', { category: 'EWS' })).body, { on: true, added: false }, 'once')

  // Under Repeating, its next date from the rule: months past the window of written days.
  const listed = (await call('GET', '/recurrences')).body.recurrences.find((r: { rule: { freq: string } }) => r.rule.freq === 'yearly')
  const next = new Date(listed.nextAt)
  assert.deepEqual([next.getMonth(), next.getDate(), next.getHours()], [3, 1, 10])
  assert.equal((await call('GET', `/exams/${cgl}`)).body.certificateReminder, true)

  const [series] = await h.sql<{ title: string; freq: string; by_month: number; by_month_day: number; starts_on: string; exam_id: string | null }[]>`
    select title, freq, by_month, by_month_day, starts_on::text, exam_id from recurrences
    where user_id = ${asha.userId} and freq = 'yearly'`
  assert.equal(series!.title, 'Get this year’s EWS certificate')
  assert.deepEqual([series!.by_month, series!.by_month_day], [3, 1], 'April, counting January as 0')
  assert.match(series!.starts_on, /^\d{4}-04-01$/)
  const { expandRecurrence } = await import('@cue/shared')
  const [y] = series!.starts_on.split('-').map(Number)
  const comes = expandRecurrence(
    { freq: 'yearly', interval: 1, byMonth: series!.by_month, byMonthDay: series!.by_month_day },
    { startsOn: new Date(y!, 3, 1), hour: 10, minute: 0 },
    { from: new Date(y!, 0, 1), to: new Date(y! + 1, 11, 31) },
  )
  assert.deepEqual(
    comes.map((d) => [d.getMonth(), d.getDate()]),
    [
      [3, 1],
      [3, 1],
    ],
    'every 1 April',
  )
  assert.equal(series!.exam_id, null, 'the person’s, not one exam’s')

  // Stopped from Repeating, it can be set again.
  await h.sql`update recurrences set status = 'stopped' where user_id = ${asha.userId} and freq = 'yearly'`
  assert.equal((await call('GET', `/exams/${cgl}`)).body.certificateReminder, false)
  assert.equal((await call('POST', '/exams/certificate-reminder', { category: 'OBC' })).body.added, true)
})
