import { test } from 'node:test'
import assert from 'node:assert/strict'
import { vcard } from '../src/lib/vcard.ts'

/** A person from a deal, as the card a phone adds to its contacts. */

test('name, number, email and company, as a phone reads them', () => {
  const card = vcard({ name: ' Ravi  Kumar ', phone: '+91 98765-43210', email: 'ravi@tata.example', organization: 'Tata Motors' })
  assert.equal(
    card,
    [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Ravi Kumar',
      'N:Kumar;Ravi;;;',
      'TEL;TYPE=CELL:+919876543210',
      'EMAIL:ravi@tata.example',
      'ORG:Tata Motors',
      'END:VCARD',
      '',
    ].join('\r\n'),
  )
})

test('one name, nothing else: still a card', () => {
  const card = vcard({ name: 'Meera' })
  assert.ok(card.includes('FN:Meera\r\n'))
  assert.ok(card.includes('N:;Meera;;;\r\n'))
  assert.ok(!card.includes('TEL'))
})

test('commas and semicolons in a company do not break the card', () => {
  const card = vcard({ name: 'Anil Gupta', organization: 'Gupta, Sons; Traders' })
  assert.ok(card.includes('ORG:Gupta\\, Sons\\; Traders\r\n'))
})

test('an Indian mobile saved without a country code gains +91, so WhatsApp finds it', () => {
  assert.ok(vcard({ name: 'Sunil Verma', phone: '98111 22233' }).includes('TEL;TYPE=CELL:+919811122233\r\n'))
  assert.ok(vcard({ name: 'Sunil Verma', phone: '098111 22233' }).includes('TEL;TYPE=CELL:+919811122233\r\n'))
  assert.ok(vcard({ name: 'Sunil Verma', phone: '91 98111 22233' }).includes('TEL;TYPE=CELL:+919811122233\r\n'))
})
