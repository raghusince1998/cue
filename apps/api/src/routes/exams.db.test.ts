import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Exams through the routes: a line typed once becomes an exam, a later line
 * adds its date to the same one, an admit card becomes the day itself — the
 * plan at reporting time, what to carry, the trip to a centre in another
 * city — and taking it back takes its dates with it.
 */

let h: Harness
let me: Seeded
let app: FastifyInstance
let token: string

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, type?: string) {
  const res = await app.inject({
    method,
    url,
    payload: body as never,
    headers: { authorization: `Bearer ${token}`, ...(type ? { 'content-type': type } : {}) },
  })
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}

/** A day this many days ahead, as typed ("18 Nov 2026") and as stored ("2026-11-18"). */
function ahead(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    said: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    ymd: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    slashed: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
  }
}

before(async () => {
  h = await createTestDb('exams')
  process.env.DATABASE_URL = h.url
  process.env.ESCALATION_MINUTES = '15'
  process.env.MAX_ESCALATIONS = '3'
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { quickAddRoutes } = await import('./quickAdd.ts')
  const { examRoutes } = await import('./exams.ts')
  const { meRoutes } = await import('./me.ts')
  const { env } = await import('../env.ts')
  env.captureAiKey = ''
  me = await seedUser(h.sql, 'exams@test.local')
  await h.sql`update users set uses = '{exams}', home_city = 'Delhi' where id = ${me.userId}`
  app = Fastify()
  await registerAuth(app)
  await app.register(quickAddRoutes)
  await app.register(examRoutes)
  await app.register(meRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'exams@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

const exams = async () => (await call('GET', '/exams')).body as unknown as Record<string, any>[]

test('typed once, then a date added to the same exam', async () => {
  const preview = (await call('POST', '/quick/preview', { text: 'applied for RRB NTPC 2026, RRB Ajmer, reg no 241051234567' })).body
  assert.equal(preview.kind, 'exam')
  assert.match(preview.summary as string, /^Exams: RRB NTPC 2026 · RRB Ajmer · Applied · reg no 241051234567$/)

  const saved = await call('POST', '/quick', { text: 'applied for RRB NTPC 2026, RRB Ajmer, reg no 241051234567' })
  assert.equal(saved.status, 201)
  let list = await exams()
  assert.equal(list.length, 1)
  assert.deepEqual(
    [list[0]!.examKey, list[0]!.cycle, list[0]!.region, list[0]!.registrationNo, list[0]!.stage],
    ['rrb-ntpc', '2026', 'RRB Ajmer', '241051234567', 'applied'],
  )
  assert.ok(((await call('GET', '/me/filled')).body.filled as string[]).includes('exams'))

  const day = ahead(36)
  const preview2 = (await call('POST', '/quick/preview', { text: `RRB NTPC CBT 1 exam on ${day.said}` })).body
  assert.match((preview2.assumptions as string[])[0]!, /Added to the RRB NTPC 2026 you are tracking/)
  const more = await call('POST', '/quick', { text: `RRB NTPC CBT 1 exam on ${day.said}` })
  assert.deepEqual(more.body.ids, [], 'undo would take the date back, not the exam')
  list = await exams()
  assert.equal(list.length, 1, 'the same exam, not a second one')
  const dates = list[0]!.dates as Record<string, any>[]
  assert.deepEqual(
    dates.map((d) => [d.step, d.round, d.title, d.dueAt.slice(0, 10) <= day.ymd]),
    [['exam', 'cbt1', 'Exam: RRB NTPC 2026 CBT 1', true]],
  )
  const reminders = await h.sql`select count(*)::int as n from reminders where commitment_id = ${dates[0]!.id}`
  assert.equal(reminders[0]!.n, 3, 'a week before, the evening before, the morning of')
})

test('an admit card PDF is read, and nothing is kept of it', async () => {
  const pdf = readFileSync(new URL('../services/fixtures/rrb-admit-card.pdf', import.meta.url))
  const read = await call('POST', '/exams/admit-card', pdf, 'application/pdf')
  assert.equal(read.status, 200)
  const card = read.body.card as Record<string, unknown>
  assert.deepEqual(
    [card.examKey, card.round, card.rollNo, card.date, card.reportingAt, card.gateClosesAt, card.startsAt, card.endsAt, card.centreCity],
    ['rrb-ntpc', 'cbt1', '2412345678', '2026-11-18', '07:30', '08:30', '09:00', '10:30', 'Jaipur'],
  )
  assert.equal(card.centreName, 'iON Digital Zone iDZ Mansarovar')

  const junk = await call('POST', '/exams/admit-card', { text: 'Your parcel is out for delivery' })
  assert.equal(junk.status, 422)
})

test('the day from a card: the plan put right, what to carry, and the trip to the centre', async () => {
  const [exam] = await exams()
  const day = ahead(36)
  const card = (
    await call('POST', '/exams/admit-card', {
      text: `E-Call Letter for CBT-1\nRRB NTPC\nRoll Number: 2412345678\nDate of Exam: ${day.slashed}\nReporting Time: 07:30 AM\nGate Closing Time: 08:30 AM\nExam Time: 09:00 AM to 10:30 AM\nTest Centre Name: iON Digital Zone iDZ Mansarovar\nTest Centre Address: Plot No 12, Sector 7, Jaipur, Rajasthan - 302020`,
    })
  ).body.card as Record<string, unknown>

  const saved = await call('POST', '/exams/day', { ...card, examId: exam!.id })
  assert.equal(saved.status, 201)
  assert.equal(saved.body.travel, 'trip')
  const after = saved.body.exam as Record<string, any>
  assert.deepEqual([after.rollNo, after.centreCity, after.stage], ['2412345678', 'Jaipur', 'cbt1'])

  const plans = await h.sql<{ title: string; due: string; notes: string; place: string; trip: string | null; minutes: number }[]>`
    select title, to_char(due_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as due, notes, place_label as place, trip_id as trip, duration_minutes as minutes
    from commitments where exam_id = ${exam!.id} and status = 'pending' and exam_step like 'exam%'`
  assert.equal(plans.length, 1, 'the typed date was put right, not doubled')
  assert.equal(plans[0]!.due, `${day.ymd} 07:30`)
  assert.equal(plans[0]!.minutes, 180, 'reporting to the end of the exam')
  assert.match(plans[0]!.notes, /^Report by 7:30 am · gate closes 8:30 am · exam 9:00 am–10:30 am\nRoll no 2412345678\niON Digital Zone/)
  assert.equal(plans[0]!.place, 'iON Digital Zone iDZ Mansarovar')
  assert.ok(plans[0]!.trip, 'on the trip to Jaipur')

  const carry = await h.sql<{ text: string }[]>`
    select text from checklist_items where commitment_id = (select id from commitments where exam_id = ${exam!.id} and exam_step like 'exam%' and status = 'pending') order by position`
  assert.equal(carry[0]!.text, 'Admit card, printed')
  assert.ok(carry.some((c) => /Original photo ID/.test(c.text)))

  const trip = await h.sql<{ place: string; starts: string; ends: string }[]>`select place_label as place, starts_on::text as starts, ends_on::text as ends from trips`
  assert.equal(trip[0]!.place, 'Jaipur')
  assert.equal(trip[0]!.ends, day.ymd)
  assert.ok(trip[0]!.starts < day.ymd, 'from the day before')
  const book = await h.sql`select title from commitments where exam_id = ${exam!.id} and exam_step = 'other'`
  assert.match(book[0]!.title as string, /^Book your journey to Jaipur for RRB NTPC 2026$/)

  // The same card again changes nothing twice.
  await call('POST', '/exams/day', { ...card, examId: exam!.id })
  const again = await h.sql`select count(*)::int as n from commitments where exam_id = ${exam!.id} and status = 'pending'`
  assert.equal(again[0]!.n, 2, 'one exam day, one journey to book')
})

test('a card for an exam not yet tracked starts it', async () => {
  const day = ahead(50)
  const saved = await call('POST', '/exams/day', {
    examKey: 'ssc-cgl',
    round: 'tier1',
    date: day.ymd,
    reportingAt: '07:45',
    centreName: 'Aptech Learning Centre',
    centreCity: 'Delhi',
  })
  assert.equal(saved.status, 201)
  assert.equal(saved.body.travel, 'home', 'a centre in the home city is no trip')
  const cgl = (await exams()).find((x) => x.examKey === 'ssc-cgl')!
  assert.equal(cgl.stage, 'tier1')
})

test('an exam that ends takes its dates still to come; undo takes it all', async () => {
  const cgl = (await exams()).find((x) => x.examKey === 'ssc-cgl')!
  await call('PATCH', `/exams/${cgl.id}`, { stage: 'not_selected' })
  const left = await h.sql`select count(*)::int as n from commitments where exam_id = ${cgl.id} and status = 'pending'`
  assert.equal(left[0]!.n, 0)
  assert.ok((await exams()).find((x) => x.id === cgl.id)!.closedAt)

  const typed = await call('POST', '/quick', { text: `REET form last date ${ahead(20).said}` })
  const reet = (await exams()).find((x) => x.examKey === 'reet')!
  assert.equal(reet.stage, 'to_apply')
  assert.equal((reet.dates as unknown[]).length, 1)
  await call('DELETE', `/quick/exam/${typed.body.id}`)
  assert.equal((await exams()).some((x) => x.examKey === 'reet'), false)
  const orphans = await h.sql`select count(*)::int as n from commitments where title like '%REET%' and status = 'pending'`
  assert.equal(orphans[0]!.n, 0, 'its last date went with it')
})

test('studying for an exam is still just a plan', async () => {
  const p = (await call('POST', '/quick/preview', { text: 'study for UPSC prelims tomorrow 6am' })).body
  assert.equal(p.kind, 'commitment')
})

test('a last date is said once days ahead, and chased only once the day has come', async () => {
  const worker = await import('../worker/reminders.ts')
  const plan = async (dueInMinutes: number) => {
    const [row] = await h.sql<{ id: string }[]>`
      insert into commitments (org_id, user_id, title, kind, due_at, exam_step)
      values (${me.orgId}, ${me.userId}, 'Last date to apply: CTET', 'task', now() + make_interval(mins => ${dueInMinutes}), 'apply_by')
      returning id`
    await h.sql`insert into reminders (org_id, commitment_id, fire_at) values (${me.orgId}, ${row!.id}, now() - interval '1 minute')`
    return row!.id
  }
  const early = await plan(3 * 24 * 60)
  const today = await plan(-10)
  await worker.runOnce()
  const pending = async (id: string) =>
    (await h.sql`select count(*)::int as n from reminders where commitment_id = ${id} and status = 'pending'`)[0]!.n
  assert.equal(await pending(early), 0, 'three days ahead: said once, not chased')
  assert.equal(await pending(today), 1, 'on the day: chased until it is done')
})
