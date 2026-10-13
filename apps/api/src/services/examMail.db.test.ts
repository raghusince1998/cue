import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EXAM_MAIL, asMessage } from '../../../../packages/shared/src/examMail.samples.ts'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Exam boards' email, read from a mailbox: a registration starts an exam, a
 * fee still to pay is a date, a city slip gives the day and the city, a
 * board's attached call letter plans the day itself. A coaching site's
 * "admit card out!" adds news only to an exam already tracked, an OTP is
 * nothing, and a password in a registration email is never repeated.
 */

let h: Harness
let me: Seeded
let svc: typeof import('./mailReader.ts')
let realFetch: typeof fetch

/** Mid-October 2026: the samples' dates are read from here. */
const NOW = new Date(2026, 9, 13, 10, 0)
const pdf = readFileSync(new URL('./fixtures/rrb-admit-card.pdf', import.meta.url))
const b64 = (s: string) => Buffer.from(s).toString('base64url')

const INBOX: Record<string, { from: string; subject: string; body: string; pdf?: boolean; ageDays?: number }> = {
  m1: asMessage(EXAM_MAIL.sscRegistered),
  m2: asMessage(EXAM_MAIL.rrbRegistered),
  m3: asMessage(EXAM_MAIL.ntaCity),
  m4: asMessage(EXAM_MAIL.coaching),
  m5: asMessage(EXAM_MAIL.otp),
  m6: { from: 'Testbook <news@testbook.com>', subject: 'UPSC Prelims admit card out', body: 'UPSC CSE prelims e-admit card released. Download now and join our test series!' },
  m7: { from: 'RRB Ajmer <noreply@rrbajmer.gov.in>', subject: 'E-Call Letter for CBT-1', body: 'Dear Candidate, please find your e-call letter attached.', pdf: true },
}

before(async () => {
  h = await createTestDb('exam_mail')
  process.env.DATABASE_URL = h.url
  svc = await import('./mailReader.ts')
  me = await seedUser(h.sql, 'exam-mail@test.local')
  await h.sql`update users set home_city = 'Delhi' where id = ${me.userId}`
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    if (url.includes('/messages?')) return new Response(JSON.stringify({ messages: Object.keys(INBOX).map((id) => ({ id })) }))
    if (url.includes('/attachments/')) return new Response(JSON.stringify({ data: pdf.toString('base64url'), size: pdf.length }))
    const id = /messages\/(m\d+)/.exec(url)![1]!
    const m = INBOX[id]!
    return new Response(
      JSON.stringify({
        id,
        internalDate: String(NOW.getTime() - (m.ageDays ?? 0) * 86_400_000 - 3_600_000),
        payload: {
          mimeType: 'multipart/mixed',
          headers: [
            { name: 'From', value: m.from },
            { name: 'Subject', value: m.subject },
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: b64(m.body) } },
            ...(m.pdf ? [{ mimeType: 'application/pdf', filename: 'E-Call-Letter.pdf', body: { attachmentId: 'att-1', size: pdf.length } }] : []),
          ],
        },
      }),
    )
  }) as typeof fetch
})

after(async () => {
  globalThis.fetch = realFetch
  await h.close()
})

test('a mailbox of board emails becomes the exams in it', async () => {
  const [acc] = await h.sql<{ id: string }[]>`
    insert into oauth_accounts (org_id, user_id, provider, email, mail_enabled)
    values (${me.orgId}, ${me.userId}, 'google', 'g@test.local', true) returning id`
  const { db, schema } = await import('../db/index.ts')
  const { eq } = await import('drizzle-orm')
  const [account] = await db.select().from(schema.oauthAccounts).where(eq(schema.oauthAccounts.id, acc!.id))

  const found = await svc.readMail(account!, NOW, async () => 'token')
  assert.ok(!found.join(' ').includes('Asha@1234'), 'a password in an email is never repeated')
  assert.ok(found.includes('SSC CGL 2026: registered · reg no …7890'), found.join('\n'))
  assert.ok(found.some((f) => /^RRB NTPC CEN 05\/2024: fee still to pay by Tue,? 20 Oct$/.test(f)), found.join('\n'))
  assert.ok(found.some((f) => /^NEET UG 2027: exam city Kota, exam Sun,? 2 May$/.test(f)), found.join('\n'))
  assert.ok(found.includes('SSC CGL 2026: admit card out. Download it and print it'), 'news from a coaching site, for an exam tracked')
  assert.ok(found.some((f) => /^RRB NTPC CEN 05\/2024: exam day planned from the admit card — Wed,? 18 Nov, report by 7:30 am · iON Digital Zone/.test(f)), found.join('\n'))
  assert.equal(found.length, 5, 'the OTP and the news about an exam never applied for are nothing')

  const exams = await h.sql<{ key: string; cycle: string; stage: string; reg: string | null; city: string | null; roll: string | null }[]>`
    select exam_key as key, cycle, stage, registration_no as reg, centre_city as city, roll_no as roll from exams order by exam_key`
  assert.deepEqual(
    exams.map((x) => [x.key, x.cycle, x.stage, x.reg, x.city, x.roll]),
    [
      ['neet-ug', '2027', 'applied', '270410123456', 'Kota', null],
      ['rrb-ntpc', 'CEN 05/2024', 'cbt1', '241051234567890', 'Jaipur', '2412345678'],
      ['ssc-cgl', '2026', 'applied', '61234567890', null, null],
    ],
  )

  const plans = async () =>
    h.sql<{ title: string; due: string }[]>`
      select title, to_char(due_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as due
      from commitments where exam_id is not null and status = 'pending' order by due_at`
  const before = await plans()
  assert.deepEqual(
    before.map((p) => p.title),
    [
      'Download the admit card: SSC CGL 2026 Tier 1',
      'Pay the fee: RRB NTPC CEN 05/2024',
      'Book your journey to Jaipur for RRB NTPC CEN 05/2024',
      'Exam: RRB NTPC CEN 05/2024 CBT 1',
      'Exam: NEET UG 2027',
    ],
  )
  assert.equal(before.find((p) => p.title.startsWith('Pay the fee'))!.due, '2026-10-20 23:59')
  assert.equal(before.find((p) => p.title.startsWith('Exam: RRB'))!.due, '2026-11-18 07:30')

  // Read again — a better reader, a mailbox read twice: nothing doubles.
  await h.sql`delete from mail_seen`
  await svc.readMail({ ...account!, mailReaderVersion: svc.READER_VERSION }, NOW, async () => 'token')
  assert.deepEqual((await plans()).map((p) => p.title), before.map((p) => p.title))
  assert.equal((await h.sql`select count(*)::int as n from exams`)[0]!.n, 3)
})

test('news weeks old is not news', async () => {
  for (const id of Object.keys(INBOX)) delete INBOX[id]
  INBOX.m8 = {
    from: 'Adda247 <news@adda247.com>',
    subject: 'NEET UG 2027 admit card out',
    body: 'The NEET UG 2027 admit card has been released. Download it now!',
    ageDays: 10,
  }
  const { db, schema } = await import('../db/index.ts')
  const [account] = await db.select().from(schema.oauthAccounts)
  const found = await svc.readMail({ ...account!, mailReaderVersion: svc.READER_VERSION }, NOW, async () => 'token')
  assert.deepEqual(found, [])
  const news = await h.sql`select count(*)::int as n from commitments where title like 'Download the admit card: NEET%'`
  assert.equal(news[0]!.n, 0)
})
