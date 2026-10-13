import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseBookings } from '@cue/shared'
import { pdfText } from './pdfText.ts'

/**
 * PDF tickets: their words put back into lines and cells, a row of labels
 * over a row of values read as "Label: value", and the ticket read from that.
 * The fixtures are printed from HTML the way ticketing systems print theirs.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
const NOW = new Date(2026, 9, 12, 9, 0)
const pad = (n: number) => String(n).padStart(2, '0')
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

test('an IRCTC ERS as a PDF reads as the ticket it is', async () => {
  const text = await pdfText(fixture('irctc-ers.pdf'))
  assert.ok(text)
  assert.match(text, /^Booked From: MUMBAI CENTRAL \(MMCT\)$/m)
  assert.match(text, /^Train No\.\/Name: 12951\/MUMBAI RAJDHANI$/m)
  assert.match(text, /^Current Status: CNF\/B2\/45\/LOWER$/m)

  const [train, ...more] = parseBookings(`Your e-ticket\nIRCTC <ticketadmin@irctc.co.in>\n${text}`, NOW)
  assert.equal(more.length, 0)
  assert.equal(train!.title, 'Train 12951 Mumbai Rajdhani · Mumbai Central → New Delhi')
  assert.equal(local(train!.startsAt), '2026-10-17 17:00')
  assert.match(train!.notes!, /B2 45 Lower · Board at Borivali/)
})

test('a round-trip e-ticket PDF is two flights, both with the PNR', async () => {
  const text = await pdfText(fixture('roundtrip-eticket.pdf'))
  assert.ok(text)
  const legs = parseBookings(`E-ticket attached\nSpiceJet <itinerary@spicejet.com>\n${text}`, NOW)
  assert.deepEqual(
    legs.map((b) => [b.title, local(b.startsAt), b.city, b.ref]),
    [
      ['Flight SG 401 · Delhi → Jaipur', '2026-11-07 05:50', 'Jaipur', 'Q4WX8Z'],
      ['Flight SG 402 · Jaipur → Delhi', '2026-11-09 21:10', 'Delhi', 'Q4WX8Z'],
    ],
  )
  assert.match(legs[0]!.notes!, /Terminal 1D/)
})

test('what is not a readable PDF is nothing, not an error', async () => {
  assert.equal(await pdfText(new TextEncoder().encode('not a pdf at all')), null)
})
