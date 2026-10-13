import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'
import { CORPUS } from './mailCorpus.ts'

/**
 * Putting right what an older reader got wrong. A mailbox last read by an
 * older reader has its last month read again; a train saved as just "Train"
 * becomes the train it is, with its time and its trip; a parcel whose name
 * ran into the sender's address gets its name; and none of it is announced
 * as news.
 */

let h: Harness
let me: Seeded
let svc: typeof import('./mailReader.ts')
let realFetch: typeof fetch
const asked: string[] = []

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const journey = new Date(Date.now() + 9 * 86_400_000)
const next = new Date(journey.getTime() + 86_400_000)
const ers = (d: Date) => `${pad(d.getDate())}-${d.toLocaleString('en', { month: 'short' })}-${d.getFullYear()}`
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

const sample = (name: string) => CORPUS.find((c) => c.name === name)!
const MAIL: Record<string, { from: string; subject: string; html: string }> = {
  'm-ers': {
    from: sample('irctc-ers').from,
    subject: sample('irctc-ers').subject.replace('17-Oct-2026', ers(journey)),
    html: sample('irctc-ers').html!.replaceAll('17-Oct-2026', ers(journey)).replaceAll('18-Oct-2026', ers(next)),
  },
  'm-amazon': {
    from: sample('amazon-out-for-delivery').from,
    subject: sample('amazon-out-for-delivery').subject,
    html: sample('amazon-out-for-delivery').html!,
  },
}

before(async () => {
  h = await createTestDb('mail_reread')
  process.env.DATABASE_URL = h.url
  svc = await import('./mailReader.ts')
  me = await seedUser(h.sql, 'reread@test.local')
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    if (url.includes('/messages?')) {
      asked.push(decodeURIComponent(url))
      return new Response(JSON.stringify({ messages: Object.keys(MAIL).map((id) => ({ id })) }))
    }
    const id = url.split('/messages/')[1]!.split('?')[0]!
    const m = MAIL[id]!
    return new Response(
      JSON.stringify({
        id,
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: m.from },
            { name: 'Subject', value: m.subject },
          ],
          parts: [{ mimeType: 'text/html', body: { data: b64(m.html) } }],
        },
      }),
    )
  }) as typeof fetch
})

after(async () => {
  globalThis.fetch = realFetch
  await h.close()
})

afterEach(() => {
  asked.length = 0
})

test('a mailbox read by an older reader is read again, and what it saved is put right', async () => {
  await h.sql`update users set home_city = 'Mumbai' where id = ${me.userId}`
  // What the older reader left: "Train" at 8am, no trip, a garbled parcel.
  const [old] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, kind, due_at, duration_minutes, notes, booking)
    values (${me.orgId}, ${me.userId}, 'Train', 'task', ${new Date(journey.getFullYear(), journey.getMonth(), journey.getDate(), 8, 0)}, 60,
            'PNR 2345678901', ${h.sql.json({ type: 'train', ref: '2345678901', from: null, city: null, provider: 'IRCTC', remindBeforeMinutes: 120 })})
    returning id`
  await h.sql`insert into reminders (org_id, commitment_id, fire_at, attempt, status)
              values (${me.orgId}, ${old!.id}, ${new Date(journey.getFullYear(), journey.getMonth(), journey.getDate(), 6, 0)}, 0, 'pending')`
  await h.sql`
    insert into deliveries (org_id, user_id, store, item, status, expected_on, order_ref)
    values (${me.orgId}, ${me.userId}, 'Amazon', '"boAt Rockerz 450 Bluetooth On Ear Headphones..." Amazon.in <shipment-tracking@…',
            'shipped', ${ymd(new Date())}, '407-1234567-1234567')`
  const [acc] = await h.sql<{ id: string }[]>`
    insert into oauth_accounts (org_id, user_id, provider, email, mail_enabled, mail_checked_at, mail_reader_version)
    values (${me.orgId}, ${me.userId}, 'google', 'g@test.local', true, ${new Date(Date.now() - 2 * 86_400_000)}, 1)
    returning id`
  await h.sql`insert into mail_seen (account_id, message_id, found, reader_version)
              values (${acc!.id}, 'm-ers', 'Train, soon', 1), (${acc!.id}, 'm-amazon', 'Amazon · garbled', 1)`

  const { db, schema } = await import('../db/index.ts')
  const { eq } = await import('drizzle-orm')
  const [account] = await db.select().from(schema.oauthAccounts).where(eq(schema.oauthAccounts.id, acc!.id))
  const found = await svc.readMail(account!, new Date(), async () => 'token')

  assert.ok(asked.some((q) => /newer_than:30d/.test(q)), 'the last month, read again')
  assert.deepEqual(found, [], 'corrections are not news')

  const [train] = await h.sql<{ title: string; notes: string; due_at: Date; place: string | null }[]>`
    select c.title, c.notes, c.due_at, t.place_label as place
    from commitments c left join trips t on t.id = c.trip_id where c.id = ${old!.id}`
  assert.equal(train!.title, 'Train 12951 Mumbai Rajdhani · Mumbai Central → New Delhi')
  assert.match(train!.notes, /B2 45 Lower, B2 46 Middle/)
  assert.equal(train!.due_at.getHours(), 17, 'its real departure, not 8am')
  assert.equal(train!.place, 'Delhi', 'on its trip')
  const reminders = await h.sql<{ fire_at: Date; status: string }[]>`
    select fire_at, status from reminders where commitment_id = ${old!.id} order by fire_at`
  assert.ok(reminders.some((r) => r.status === 'cancelled' && r.fire_at.getHours() === 6), 'the 6am reminder for the wrong time is gone')
  assert.ok(reminders.some((r) => r.status === 'pending' && r.fire_at.getHours() === 15), 'and one two hours before 5pm is there')
  assert.equal((await h.sql`select count(*)::int as n from commitments where booking is not null`)[0]!.n, 1, 'put right, not added again')

  const [parcel] = await h.sql<{ item: string; status: string }[]>`select item, status from deliveries`
  assert.equal(parcel!.item, 'boAt Rockerz 450 Bluetooth On Ear Headphones')
  assert.equal(parcel!.status, 'out_for_delivery')

  const seen = await h.sql<{ message_id: string; found: string; reader_version: number }[]>`
    select message_id, found, reader_version from mail_seen order by message_id`
  assert.ok(seen.every((s) => s.reader_version === svc.READER_VERSION))
  assert.match(seen.find((s) => s.message_id === 'm-ers')!.found, /^Train 12951 Mumbai Rajdhani · Mumbai Central → New Delhi, /)
  const [after] = await db.select().from(schema.oauthAccounts).where(eq(schema.oauthAccounts.id, acc!.id))
  assert.equal(after!.mailReaderVersion, svc.READER_VERSION)

  // Read by the current reader now: nothing is opened again.
  asked.length = 0
  assert.deepEqual(await svc.readMail(after!, new Date(), async () => 'token'), [])
  assert.ok(!asked.some((q) => /newer_than:30d/.test(q)), 'back to only what is new')
})
