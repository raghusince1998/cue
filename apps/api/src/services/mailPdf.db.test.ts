import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * A ticket that is only in its attachment: the email says "your e-ticket is
 * attached" and nothing else. The PDF is fetched, read, and its round trip
 * becomes two flights on one trip — and the PDF is not kept.
 */

let h: Harness
let me: Seeded
let svc: typeof import('./mailReader.ts')
let realFetch: typeof fetch
const fetched: string[] = []

/** The fixture's flights are on 7 and 9 November 2026; read as of mid-October. */
const NOW = new Date(2026, 9, 12, 9, 0)
const pdf = readFileSync(new URL('./fixtures/roundtrip-eticket.pdf', import.meta.url))

before(async () => {
  h = await createTestDb('mail_pdf')
  process.env.DATABASE_URL = h.url
  svc = await import('./mailReader.ts')
  me = await seedUser(h.sql, 'pdf@test.local')
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    fetched.push(url)
    if (url.includes('/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'm-pdf' }] }))
    if (url.includes('/attachments/att-1')) return new Response(JSON.stringify({ data: pdf.toString('base64url'), size: pdf.length }))
    return new Response(
      JSON.stringify({
        id: 'm-pdf',
        payload: {
          mimeType: 'multipart/mixed',
          headers: [
            { name: 'From', value: 'SpiceJet <itinerary@spicejet.com>' },
            { name: 'Subject', value: 'Your SpiceJet e-ticket' },
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: Buffer.from('Dear Guest, your e-ticket is attached. Have a pleasant journey.').toString('base64url') } },
            { mimeType: 'application/pdf', filename: 'E-Ticket.pdf', body: { attachmentId: 'att-1', size: pdf.length } },
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

test('a round trip only in the attached PDF becomes two flights on one trip', async () => {
  await h.sql`update users set home_city = 'Delhi' where id = ${me.userId}`
  const [acc] = await h.sql<{ id: string }[]>`
    insert into oauth_accounts (org_id, user_id, provider, email, mail_enabled)
    values (${me.orgId}, ${me.userId}, 'google', 'g@test.local', true) returning id`
  const { db, schema } = await import('../db/index.ts')
  const { eq } = await import('drizzle-orm')
  const [account] = await db.select().from(schema.oauthAccounts).where(eq(schema.oauthAccounts.id, acc!.id))

  const found = await svc.readMail(account!, NOW, async () => 'token')
  assert.ok(fetched.some((u) => u.includes('/attachments/att-1')), 'the PDF was fetched')
  assert.equal(found.length, 1, 'one email, one find')
  assert.match(found[0]!, /Flight SG 401 · Delhi → Jaipur, .*; Flight SG 402 · Jaipur → Delhi, /)

  const flights = await h.sql<{ title: string; ref: string; place: string; starts: string; ends: string }[]>`
    select c.title, c.booking->>'ref' as ref, t.place_label as place, t.starts_on::text as starts, t.ends_on::text as ends
    from commitments c join trips t on t.id = c.trip_id
    where c.booking is not null order by c.due_at`
  assert.deepEqual(
    flights.map((f) => [f.title, f.ref, f.place, f.starts, f.ends]),
    [
      ['Flight SG 401 · Delhi → Jaipur', 'Q4WX8Z', 'Jaipur', '2026-11-07', '2026-11-09'],
      ['Flight SG 402 · Jaipur → Delhi', 'Q4WX8Z', 'Jaipur', '2026-11-07', '2026-11-09'],
    ],
    'both ways, one trip, the same PNR',
  )

  // Read again: the same PNR on both flights is still two flights, not one.
  await h.sql`delete from mail_seen`
  await svc.readMail({ ...account!, mailReaderVersion: svc.READER_VERSION }, NOW, async () => 'token')
  assert.equal((await h.sql`select count(*)::int as n from commitments where booking is not null`)[0]!.n, 2)
})
