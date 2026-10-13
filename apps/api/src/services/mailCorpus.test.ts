import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBooking, parseBookings, parseDelivery, parseDueNotice } from '@cue/shared'
import { CORPUS } from './mailCorpus.ts'
import { htmlToText } from './mailReader.ts'

/**
 * The sample emails, read end to end the way the mail reader reads them:
 * HTML made text, subject and sender first. Each says what it must come out
 * as. A layout that reads wrong in someone's inbox belongs here: add the
 * sample, say what it should read as, then fix the reader until it does.
 */

/** Monday 12 October 2026, 9am: every date in the samples is ahead of it. */
const NOW = new Date(2026, 9, 12, 9, 0)
const pad = (n: number) => String(n).padStart(2, '0')
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

function read(name: string): string {
  const m = CORPUS.find((c) => c.name === name)
  assert.ok(m, `no sample called ${name}`)
  return `${m.subject}\n${m.from}\n${m.html ? htmlToText(m.html) : m.text}`
}

interface Journey {
  title: string
  leaves: string
  city: string
  fromCity: string
  ref: string
  notes?: RegExp[]
}

const JOURNEYS: Record<string, Journey> = {
  'irctc-ers': {
    title: 'Train 12951 Mumbai Rajdhani · Mumbai Central → New Delhi',
    leaves: '2026-10-17 17:00',
    city: 'Delhi',
    fromCity: 'Mumbai',
    ref: '2345678901',
    notes: [/\b3A\b/, /B2 45 Lower, B2 46 Middle/, /Board at Borivali/, /Arrives New Delhi 8:32 am, Sun, 18 Oct/],
  },
  'irctc-ers-waitlisted': {
    title: 'Train 12627 Karnataka Express · Bengaluru City → New Delhi',
    leaves: '2026-10-23 19:20',
    city: 'Delhi',
    fromCity: 'Bengaluru',
    ref: '4567890123',
    notes: [/\bSL\b/, /Waitlisted \(WL 12\)/],
  },
  'irctc-sms': {
    title: 'Train 12951 · Mumbai Central → New Delhi',
    leaves: '2026-10-17 17:00',
    city: 'Delhi',
    fromCity: 'Mumbai',
    ref: '2345678901',
    notes: [/B2 45, B2 46/],
  },
  confirmtkt: {
    title: 'Train 12779 Goa Express · Pune → Madgaon',
    leaves: '2026-10-30 22:05',
    city: 'Goa',
    fromCity: 'Pune',
    ref: '6789012345',
    notes: [/\b3A\b/, /B1 22/, /Arrives Madgaon 9:40 am/],
  },
  indigo: {
    title: 'Flight 6E 2134 · Bengaluru → Delhi',
    leaves: '2026-10-18 06:15',
    city: 'Delhi',
    fromCity: 'Bengaluru',
    ref: 'X7K2LM',
    notes: [/IndiGo/, /Terminal 1/, /Lands in Delhi 9:05 am/],
  },
  'makemytrip-flight': {
    title: 'Flight 6E 512 · Bengaluru → Goa',
    leaves: '2026-11-01 07:00',
    city: 'Goa',
    fromCity: 'Bengaluru',
    ref: 'K9LM2P',
    notes: [/Lands in Goa 8:15 am/],
  },
  'air-india': {
    title: 'Flight AI 665 · Mumbai → Delhi',
    leaves: '2026-10-22 10:00',
    city: 'Delhi',
    fromCity: 'Mumbai',
    ref: '8HJ2KQ',
    notes: [/Terminal 2/, /Lands in Delhi 12:10 pm/],
  },
}

for (const [name, want] of Object.entries(JOURNEYS)) {
  test(`journey: ${name}`, () => {
    const b = parseBooking(read(name), NOW)
    assert.ok(b, 'read as a booking')
    assert.equal(b.title, want.title)
    assert.equal(local(b.startsAt), want.leaves, 'when it leaves')
    assert.equal(b.city, want.city, 'where it goes')
    assert.equal(b.fromCity, want.fromCity, 'where it leaves from')
    assert.equal(b.ref, want.ref)
    for (const re of want.notes ?? []) assert.match(b.notes ?? '', re)
  })
}

interface Parcel {
  store: string
  item: string
  status: string
  expectedOn: string | null
  codPaise?: number
  orderRef?: string
}

const PARCELS: Record<string, Parcel> = {
  'amazon-shipped': { store: 'Amazon', item: 'boAt Rockerz 450 Bluetooth On Ear Headphones', status: 'shipped', expectedOn: '2026-10-15', orderRef: '407-1234567-1234567' },
  'amazon-out-for-delivery': { store: 'Amazon', item: 'boAt Rockerz 450 Bluetooth On Ear Headphones', status: 'out_for_delivery', expectedOn: '2026-10-12' },
  'amazon-delivered': { store: 'Amazon', item: 'boAt Rockerz 450 Bluetooth On Ear Headphones', status: 'delivered', expectedOn: null },
  'flipkart-shipped-cod': { store: 'Flipkart', item: 'Redmi Note 13 5G (Arctic White, 128 GB)', status: 'shipped', expectedOn: '2026-10-16', codPaise: 1_799_900, orderRef: 'OD329876543210987654' },
  myntra: { store: 'Myntra', item: 'Roadster Men Blue Slim Fit Jeans', status: 'shipped', expectedOn: '2026-10-17' },
  'meesho-cod': { store: 'Meesho', item: 'Women Cotton Kurti Set', status: 'shipped', expectedOn: '2026-10-17', codPaise: 34_900 },
  nykaa: { store: 'Nykaa', item: 'Lakme 9 to 5 Primer + Matte Lipstick', status: 'shipped', expectedOn: '2026-10-19', orderRef: 'NYK-12345678' },
}

for (const [name, want] of Object.entries(PARCELS)) {
  test(`parcel: ${name}`, () => {
    const text = read(name)
    assert.equal(parseBooking(text, NOW), null, 'not a booking')
    const p = parseDelivery(text, NOW)
    assert.ok(p, 'read as a parcel')
    assert.equal(p.store, want.store)
    assert.equal(p.item, want.item, 'what is coming, and nothing else')
    assert.equal(p.status, want.status)
    assert.equal(p.expectedOn, want.expectedOn)
    if (want.codPaise !== undefined) assert.equal(p.codPaise, want.codPaise, 'cash to keep ready')
    if (want.orderRef) assert.equal(p.orderRef, want.orderRef)
  })
}

test('bills: a card statement laid out as a table, an electricity bill as text', () => {
  const card = parseDueNotice(read('hdfc-card'))
  assert.deepEqual(card, { name: 'HDFC Bank credit card ••1234', category: 'card', amountPaise: 1_234_567, dueOn: '2026-11-05', minimumPaise: 62_000 })
  const power = parseDueNotice(read('bescom'))
  assert.equal(power?.amountPaise, 124_000)
  assert.equal(power?.dueOn, '2026-10-20')
})

test('an email table becomes label: value lines, and money keeps its commas', () => {
  const text = htmlToText(CORPUS.find((c) => c.name === 'irctc-ers')!.html!)
  assert.match(text, /^PNR: 2345678901$/m)
  assert.match(text, /^Train No\.\/Name: 12951\/MUMBAI RAJDHANI$/m)
  assert.match(text, /^Booked From: MUMBAI CENTRAL \(MMCT\)$/m)
  assert.match(text, /^Current Status: CNF\/B2\/45\/LOWER$/m)
  assert.match(text, /₹ 4,230\.80/)
  assert.ok(!/td\{|font-size/.test(text), 'no styles')
})

test('a round trip is two journeys, each with its own day, time and the airline PNR', () => {
  const legs = parseBookings(read('makemytrip-round-trip'), NOW)
  assert.deepEqual(
    legs.map((b) => [b.title, local(b.startsAt), b.city, b.ref]),
    [
      ['Flight 6E 512 · Bengaluru → Goa', '2026-11-01 07:00', 'Goa', 'K9LM2P'],
      ['Flight 6E 513 · Goa → Bengaluru', '2026-11-05 19:30', 'Bengaluru', 'K9LM2P'],
    ],
  )
  assert.ok(!/Terminal/.test(legs[1]!.notes ?? ''), 'the way back leaves Goa, not Terminal 1 at Bengaluru')
})

test('a change of plane is one journey, landing where the last leg lands', () => {
  const [journey, ...rest] = parseBookings(read('air-india-connection'), NOW)
  assert.equal(rest.length, 0)
  assert.equal(journey!.title, 'Flight AI 504 + AI 887 · Bengaluru → Delhi via Mumbai')
  assert.equal(local(journey!.startsAt), '2026-10-25 06:00')
  assert.equal(journey!.city, 'Delhi', 'the trip is to Delhi, not Mumbai')
  assert.match(journey!.notes!, /Change at Mumbai: AI 887 at 9:30 am · Lands in Delhi 11:40 am/)
})

test('one flight is still one booking', () => {
  assert.equal(parseBookings(read('indigo'), NOW).length, 1)
  assert.equal(parseBookings(read('irctc-ers'), NOW).length, 1)
})
