import { test } from 'node:test'
import assert from 'node:assert/strict'
import { owedMessage, parseOwed, splitEqually } from './owed.ts'

test('who owes you what, read from a sentence', () => {
  assert.deepEqual(parseOwed('Ravi owes me ₹500 for the tickets'), { amountPaise: 50000, name: 'Ravi', note: 'the tickets' })
  assert.deepEqual(parseOwed('Dr. Mehta owes me 1,200'), { amountPaise: 120000, name: 'Dr. Mehta', note: null })
  assert.deepEqual(parseOwed('lent ₹2,000 to Priya Nair for rent'), { amountPaise: 200000, name: 'Priya Nair', note: 'rent' })
  assert.deepEqual(parseOwed('I lent Sneha 750 rs'), { amountPaise: 75000, name: 'Sneha', note: null })
  assert.deepEqual(parseOwed('collect ₹300 from Ravi tomorrow'), { amountPaise: 30000, name: 'Ravi', note: null })
  assert.deepEqual(parseOwed('get 450 back from Priya for the cab'), { amountPaise: 45000, name: 'Priya', note: 'the cab' })
  assert.equal(parseOwed('Ravi has to give me 300')!.amountPaise, 30000)

  assert.equal(parseOwed('₹450 cab to Mehta Physio'), null, 'spent, not owed')
  assert.equal(parseOwed('call Ravi about the 500 units'), null)
  assert.equal(parseOwed('someone owes me 500'), null)
})

test('a reminder that says what, when and where to send it', () => {
  assert.equal(
    owedMessage({ name: 'Ravi Kumar', lines: [{ amountPaise: 45000, note: 'cab to Infosys', on: '2026-10-11' }], upiId: 'sid@okaxis' }),
    'Hi Ravi,\n\nJust a reminder about ₹450 for cab to Infosys (11 Oct).\n\nYou can send it to my UPI: sid@okaxis\n\nThanks!',
  )
  const two = owedMessage({
    name: 'Dr. Anil Mehta',
    lines: [
      { amountPaise: 45000, note: 'cab', on: '2026-10-11' },
      { amountPaise: 80000, note: null, on: '2026-10-14' },
    ],
  })
  assert.ok(two.startsWith('Hi Dr. Mehta,\n\nJust a reminder about ₹1,250 in all:\n• ₹450 for cab (11 Oct)\n• ₹800 from 14 Oct'))
  assert.ok(two.includes('Send it whenever you can.'))
})

test('split equally, in whole rupees, the odd paise yours', () => {
  assert.deepEqual(splitEqually(90000, 1), [45000])
  assert.deepEqual(splitEqually(100000, 2), [33300, 33300])
  assert.deepEqual(splitEqually(150, 2), [50, 50], 'under a rupee each, in paise')
  assert.deepEqual(splitEqually(90000, 0), [])
})
