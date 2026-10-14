import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Each step's list, attached to its date as the date is planned: what the
 * form asks for, what to carry to verification — fitted to the person, in
 * their language, and counted on the exam page.
 */

let h: Harness
let app: FastifyInstance
let asha: Seeded
let ravi: Seeded

before(async () => {
  h = await createTestDb('exam_ready')
  process.env.DATABASE_URL = h.url
  asha = await seedUser(h.sql, 'asha@test.local')
  ravi = await seedUser(h.sql, 'ravi@test.local')
  await h.sql`update users set exam_level = 'graduate' where id = ${asha.userId}`
  await h.sql`update users set language = 'hi', exam_level = '10th', exam_training = '{iti}' where id = ${ravi.userId}`
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { examRoutes } = await import('../routes/exams.ts')
  app = Fastify()
  await registerAuth(app)
  await app.register(examRoutes)
  await app.ready()
})

after(async () => {
  await app.close()
  await h.close()
})

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, who = asha, email = 'asha@test.local') {
  const token = app.jwt.sign({ sub: who.userId, orgId: who.orgId, email })
  const res = await app.inject({ method, url, payload: body as never, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as any }
}

const listOf = (planId: string) =>
  h.sql<{ text: string }[]>`select text from checklist_items where commitment_id = ${planId} order by position`.then((r) => r.map((x) => x.text))

test('the last date to apply carries what the form asks for, with their category', async () => {
  const made = await call('POST', '/exams', {
    examKey: 'ssc-cgl',
    name: 'SSC CGL',
    cycle: '2027',
    stage: 'to_apply',
    dates: [
      { step: 'apply_by', on: '2027-05-10' },
      { step: 'fee_by', on: '2027-05-12' },
    ],
  })
  await call('PATCH', `/exams/${made.body.id}`, { category: 'EWS' })
  const exam = (await call('GET', `/exams/${made.body.id}`)).body
  const apply = exam.dates.find((d: { step: string }) => d.step === 'apply_by')
  const fee = exam.dates.find((d: { step: string }) => d.step === 'fee_by')
  assert.equal(fee.ready, null, 'paying the fee needs no list')
  assert.equal(apply.ready.done, 0)
  const items = await listOf(apply.id)
  assert.equal(apply.ready.total, items.length)
  assert.ok(items.includes('Graduation marksheets or degree'))
  assert.ok(!items.some((x) => /EWS/.test(x)), 'the category came after the date was planned')

  // A second exam inherits the category, and its list asks for this year's certificate.
  const second = await call('POST', '/exams', { examKey: 'ssc-chsl', name: 'SSC CHSL', cycle: '2027', stage: 'to_apply', dates: [{ step: 'apply_by', on: '2027-06-01' }] })
  const chsl = (await call('GET', `/exams/${second.body.id}`)).body
  assert.ok((await listOf(chsl.dates[0].id)).includes('EWS certificate issued on or after 1 April 2027, in the format the notice gives'))
})

test('a verification date carries what to bring; ticked items are counted', async () => {
  const made = await call('POST', '/exams', { examKey: 'rrb-ntpc', name: 'RRB NTPC', cycle: '2026', stage: 'cbt2' })
  await call('POST', `/exams/${made.body.id}/dates`, { step: 'exam', on: '2027-02-15', round: 'dv' })
  const dv = (await call('GET', `/exams/${made.body.id}`)).body.dates.find((d: { round: string | null }) => d.round === 'dv')
  const items = await listOf(dv.id)
  assert.match(items[0]!, /call letter for document verification/)
  await h.sql`update checklist_items set done = true where commitment_id = ${dv.id} and position < 2`
  const again = (await call('GET', `/exams/${made.body.id}`)).body.dates.find((d: { round: string | null }) => d.round === 'dv')
  assert.deepEqual(again.ready, { done: 2, total: items.length })
})

test('in Hindi, with their own training', async () => {
  const made = await call('POST', '/exams', { examKey: 'rrb-alp', name: 'RRB ALP', cycle: '2027', stage: 'to_apply', dates: [{ step: 'apply_by', on: '2027-03-01' }] }, ravi, 'ravi@test.local')
  const exam = (await call('GET', `/exams/${made.body.id}`, undefined, ravi, 'ravi@test.local')).body
  const items = await listOf(exam.dates[0].id)
  assert.match(items[0]!, /फोटो और हस्ताक्षर/)
  assert.ok(items.includes('ITI प्रमाण पत्र (NCVT या SCVT)'))
})
