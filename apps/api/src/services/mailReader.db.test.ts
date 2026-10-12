import { test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Reading email: only messages from the senders that send bookings, parcels
 * and bills are opened; each becomes what it is, once; offers become nothing.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./mailReader.ts')
let realFetch: typeof fetch
let opened: string[]

before(async () => {
  h = await createTestDb('mail_reader')
  process.env.DATABASE_URL = h.url
  svc = await import('./mailReader.ts')
  me = await seedUser(h.sql, 'mail@test.local')
  realFetch = globalThis.fetch
})

after(async () => {
  globalThis.fetch = realFetch
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from mail_seen`
  await h.sql`delete from oauth_accounts`
  await h.sql`delete from bills`
  await h.sql`delete from deliveries`
  await h.sql`delete from commitments`
  await h.sql`delete from trips`
  opened = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const pad = (n: number) => String(n).padStart(2, '0')
const journey = new Date(Date.now() + 6 * 86_400_000)
const doj = `${pad(journey.getDate())}-${journey.toLocaleString('en', { month: 'short' })}-${journey.getFullYear()}`

const GMAIL: Record<string, { from: string; subject: string; plain?: string; html?: string }> = {
  m1: {
    from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
    subject: 'Your HDFC Bank Credit Card Statement',
    html: '<html><body><table><tr><td>Credit Card ending</td><td>1234</td></tr><tr><td>Total Amount Due</td><td>Rs. 12,345.67</td></tr><tr><td>Minimum Amount Due</td><td>Rs. 620.00</td></tr><tr><td>Payment Due Date</td><td>04/11/2030</td></tr></table></body></html>',
  },
  m2: {
    from: 'IRCTC <ticketadmin@irctc.co.in>',
    subject: `Booking Confirmation on IRCTC, Train: 12951, ${doj}, 3A, MMCT - NDLS`,
    plain: `Electronic Reservation Slip (ERS) PNR No. : 2345678901 Train No./Name : 12951/MUMBAI RAJDHANI Class : AC 3 TIER (3A) From : MUMBAI CENTRAL (MMCT) Date of Journey : ${doj} To : NEW DELHI (NDLS) Departure* : 17:00 ${doj} Passenger 1 ASHA RAO CNF/B2/45/LOWER`,
  },
  m3: {
    from: 'Amazon.in <shipment-tracking@amazon.in>',
    subject: 'Your Amazon.in order #402-1234567-1234567 has shipped',
    plain: 'Your package with Prestige Electric Kettle 1.5L has shipped and will be delivered by tomorrow. Track package: https://amazon.in/progress-tracker/package?orderId=402-1234567-1234567',
  },
  m4: {
    from: 'IndiGo <offers@goindigo.in>',
    subject: 'Flat 20% off on flights this festive season!',
    plain: 'Fly IndiGo to 80+ destinations. Book your flight before 30 Oct 2030. Use code FEST20 at checkout.',
  },
}

function fakeGmail() {
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    if (url.includes('/messages?')) {
      assert.match(decodeURIComponent(url), /newer_than:\d+d \(from:\(irctc OR/)
      return new Response(JSON.stringify({ messages: Object.keys(GMAIL).map((id) => ({ id })) }))
    }
    const id = url.split('/messages/')[1]!.split('?')[0]!
    opened.push(id)
    const m = GMAIL[id]!
    const parts = [
      ...(m.plain ? [{ mimeType: 'text/plain', body: { data: b64(m.plain) } }] : []),
      ...(m.html ? [{ mimeType: 'text/html', body: { data: b64(m.html) } }] : []),
    ]
    return new Response(
      JSON.stringify({
        id,
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: m.from },
            { name: 'Subject', value: m.subject },
          ],
          parts,
        },
      }),
    )
  }) as typeof fetch
}

async function account(provider: 'google' | 'microsoft') {
  const [row] = await h.sql<{ id: string }[]>`
    insert into oauth_accounts (org_id, user_id, provider, email, mail_enabled)
    values (${me.orgId}, ${me.userId}, ${provider}, ${`${provider}@test.local`}, true) returning id`
  const [full] = await (await import('../db/index.ts')).db
    .select()
    .from((await import('../db/index.ts')).schema.oauthAccounts)
    .where((await import('drizzle-orm')).eq((await import('../db/index.ts')).schema.oauthAccounts.id, row!.id))
  return full!
}

test('a statement, an e-ticket and a shipping email become a bill, a booking and a parcel; a sale becomes nothing', async () => {
  fakeGmail()
  const acc = await account('google')
  const found = await svc.readMail(acc, new Date(), async () => 'token')
  assert.equal(found.length, 3, found.join(' | '))

  const [bill] = await h.sql<{ name: string; amount_paise: string; due_on: string }[]>`select name, amount_paise::text, due_on::text from bills`
  assert.deepEqual(bill, { name: 'HDFC Bank credit card ••1234', amount_paise: '1234567', due_on: '2030-11-04' })

  const [train] = await h.sql<{ title: string; ref: string; trip: string | null }[]>`
    select c.title, c.booking->>'ref' as ref, t.place_label as trip
    from commitments c left join trips t on t.id = c.trip_id where c.booking is not null`
  assert.deepEqual(train, { title: 'Train 12951 · Mumbai Central → New Delhi', ref: '2345678901', trip: 'Delhi' })

  const [parcel] = await h.sql<{ store: string; item: string }[]>`select store, item from deliveries`
  assert.deepEqual(parcel, { store: 'Amazon', item: 'Prestige Electric Kettle 1.5L' })

  const seen = await h.sql<{ message_id: string; found: string | null }[]>`select message_id, found from mail_seen order by message_id`
  assert.deepEqual(seen.map((s) => [s.message_id, Boolean(s.found)]), [
    ['m1', true],
    ['m2', true],
    ['m3', true],
    ['m4', false],
  ])

  // The next look opens nothing it has opened before.
  opened = []
  const again = await svc.readMail({ ...acc, mailCheckedAt: new Date() }, new Date(), async () => 'token')
  assert.deepEqual(again, [])
  assert.deepEqual(opened, [])
  assert.equal((await h.sql`select count(*)::int as n from commitments where booking is not null`)[0]!.n, 1)
})

test('Outlook: only messages from known senders are opened at all', async () => {
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    if (url.includes('$select=id,subject,from')) {
      return new Response(
        JSON.stringify({
          value: [
            { id: 'o1', subject: 'Dinner on Saturday?', from: { emailAddress: { name: 'A friend', address: 'friend@example.com' } } },
            { id: 'o2', subject: 'Your Flipkart order has been shipped', from: { emailAddress: { name: 'Flipkart', address: 'noreply@nct.flipkart.com' } } },
          ],
        }),
      )
    }
    const id = url.split('/messages/')[1]!.split('?')[0]!
    opened.push(id)
    return new Response(
      JSON.stringify({
        body: {
          contentType: 'text',
          content: 'Shipped: Your Redmi Note 13 5G with order ID OD430012345678901234 has been shipped and will be delivered by tomorrow. Track: http://fkrt.it/xyz',
        },
      }),
    )
  }) as typeof fetch
  const acc = await account('microsoft')
  const found = await svc.readMail(acc, new Date(), async () => 'token')
  assert.deepEqual(opened, ['o2'], 'the friend’s email is never opened')
  assert.equal(found.length, 1)
  assert.match(found[0]!, /^Flipkart · Redmi Note 13 5G/)
})

test('a failed look is recorded on the account, and nothing is marked read', async () => {
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
  const acc = await account('google')
  await assert.rejects(svc.readMail(acc, new Date(), async () => 'token'))
  const [row] = await h.sql<{ mail_error: string | null }[]>`select mail_error from oauth_accounts`
  assert.match(row!.mail_error!, /500/)
  assert.equal((await h.sql`select count(*)::int as n from mail_seen`)[0]!.n, 0)
})

test('only what is worth opening, and HTML made readable', () => {
  assert.equal(svc.worthOpening('IRCTC <ticketadmin@irctc.co.in>', 'anything'), true)
  assert.equal(svc.worthOpening('My Travel Agent <agent@example.com>', 'E-Ticket for your flight'), true)
  assert.equal(svc.worthOpening('A friend <friend@example.com>', 'Dinner on Saturday?'), false)
  assert.equal(
    svc.htmlToText('<p>Total Amount Due</p><table><tr><td>Rs.&nbsp;12,345</td><td>&#8377;5</td></tr></table><style>.x{}</style>'),
    'Total Amount Due\nRs. 12,345 ₹5',
  )
})

test('insurance: a renewal reminder, then the new policy moves it a year on, by the vehicle', async () => {
  const soon = new Date(Date.now() + 20 * 86_400_000)
  const nextYear = new Date(soon.getTime() + 365 * 86_400_000)
  const d = (x: Date) => `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`
  const inbox: Record<string, { from: string; subject: string; plain: string }> = {
    i1: {
      from: 'Digit Insurance <noreply@godigit.com>',
      subject: 'Your bike insurance is expiring soon',
      plain: `Your two-wheeler policy for KA 01 XY 5678 expires on ${d(soon)}. Renewal premium: Rs 1,749. Renew now to stay covered.`,
    },
  }
  const serve = () => {
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/messages?')) return new Response(JSON.stringify({ messages: Object.keys(inbox).map((id) => ({ id })) }))
      const id = url.split('/messages/')[1]!.split('?')[0]!
      const m = inbox[id]!
      return new Response(
        JSON.stringify({
          id,
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: m.from },
              { name: 'Subject', value: m.subject },
            ],
            body: { data: b64(m.plain) },
          },
        }),
      )
    }) as typeof fetch
  }
  serve()
  const acc = await account('google')
  const first = await svc.readMail(acc, new Date(), async () => 'token')
  assert.match(first[0]!, /^Bike insurance · KA01XY5678 \(Digit\): renew by/)
  let rows = await h.sql<{ name: string; kind: string; due_on: string; remind_days: number }[]>`select name, kind, due_on::text, remind_days from bills`
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.kind, 'renewal')
  assert.equal(rows[0]!.remind_days, 30)

  // Renewed with another insurer: the new policy's email moves the same reminder.
  inbox.i2 = {
    from: 'ACKO <policy@acko.com>',
    subject: 'Your two-wheeler policy is issued',
    plain: `ACKO: Your Bike Insurance Policy No. ACKO/2W/998877 is issued for KA01XY5678. Policy Period: ${d(soon)} to ${d(nextYear)}. Total Premium: ₹1,699.`,
  }
  serve()
  await svc.readMail({ ...acc, mailCheckedAt: new Date() }, new Date(), async () => 'token')
  rows = await h.sql`select name, kind, due_on::text, remind_days from bills`
  assert.equal(rows.length, 1, 'still one reminder for that bike')
  const ymd = `${nextYear.getFullYear()}-${pad(nextYear.getMonth() + 1)}-${pad(nextYear.getDate())}`
  assert.equal(rows[0]!.due_on, ymd)
})

test('a PUC certificate and a service reminder, by vehicle; an insurer’s PUC email stays a PUC', async () => {
  const later = (days: number) => new Date(Date.now() + days * 86_400_000)
  const d = (x: Date) => `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`
  const inbox: Record<string, { from: string; subject: string; plain: string }> = {
    v1: {
      from: 'Parivahan <noreply@parivahan.gov.in>',
      subject: 'PUC Certificate issued',
      plain: `PUC certificate for vehicle MH12AB1234 issued at Shree Emission Centre. Valid till: ${d(later(180))}.`,
    },
    v2: {
      from: 'Maruti Suzuki <service@marutisuzuki.com>',
      subject: 'Service reminder',
      plain: `Dear customer, your vehicle MH12AB1234 is due for its 3rd free service on ${d(later(12))} or at 10,000 km, whichever is earlier.`,
    },
    v3: {
      from: 'ACKO <noreply@acko.com>',
      subject: 'Your PUC is expiring',
      plain: `The PUC of your car KA05MN4321 expires on ${d(later(9))}. Renew it at a nearby centre. ACKO General Insurance Ltd.`,
    },
  }
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    if (url.includes('/messages?')) {
      assert.match(decodeURIComponent(url), /parivahan/)
      return new Response(JSON.stringify({ messages: Object.keys(inbox).map((id) => ({ id })) }))
    }
    const id = url.split('/messages/')[1]!.split('?')[0]!
    const m = inbox[id]!
    return new Response(
      JSON.stringify({
        id,
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: m.from },
            { name: 'Subject', value: m.subject },
          ],
          body: { data: b64(m.plain) },
        },
      }),
    )
  }) as typeof fetch
  const acc = await account('google')
  const found = await svc.readMail(acc, new Date(), async () => 'token')
  assert.equal(found.length, 3, found.join(' | '))

  const bills = await h.sql<{ name: string; kind: string; category: string }[]>`select name, kind, category from bills order by name`
  assert.deepEqual(bills.map((x) => [x.name, x.kind, x.category]), [
    ['PUC · KA05MN4321', 'renewal', 'vehicle'],
    ['PUC · MH12AB1234', 'renewal', 'vehicle'],
  ])
  const [service] = await h.sql<{ title: string; type: string }[]>`select title, booking->>'type' as type from commitments where booking is not null`
  assert.deepEqual(service, { title: 'Vehicle service · MH12AB1234 (Maruti Suzuki)', type: 'service' })
  const [reminder] = await h.sql<{ days: number }[]>`
    select round(extract(epoch from (c.due_at - r.fire_at)) / 86400)::int as days
    from reminders r join commitments c on c.id = r.commitment_id where c.booking is not null`
  assert.equal(reminder!.days, 3, 'three days ahead, to book a slot')
})
