import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDueNotice } from './dueNotices.ts'

test('a credit card statement: the card, the total due, the minimum, the due date', () => {
  const email = `Your HDFC Bank Credit Card Statement for October 2026
    Dear Customer, your statement for the HDFC Bank Credit Card ending 1234 for the period 16 Sep 2026 to 15 Oct 2026 is ready.
    Statement Date: 15/10/2026  Total Amount Due: Rs. 12,345.67  Minimum Amount Due: Rs. 620.00  Payment Due Date: 04/11/2026
    Available credit limit Rs 1,50,000. Reward points 2,345.`
  assert.deepEqual(parseDueNotice(email), {
    name: 'HDFC Bank credit card ••1234',
    category: 'card',
    amountPaise: 1234567,
    dueOn: '2026-11-04',
    minimumPaise: 62000,
  })

  const sms = 'SBI Card: Statement for your card XX5678: Total Amt Due Rs 8,450.00, Min Amt Due Rs 423.00, Payment Due Date 05-Nov-26.'
  const sbi = parseDueNotice(sms)!
  assert.equal(sbi.name, 'SBI Card credit card ••5678')
  assert.equal(sbi.amountPaise, 845000)
  assert.equal(sbi.dueOn, '2026-11-05')
})

test('an electricity bill, a postpaid bill', () => {
  const bescom = parseDueNotice(
    'BESCOM: Your electricity bill for Account No 1234567890 for Oct 2026 is generated. Bill Amount: Rs 1,240.00. Due Date: 20-10-2026. Pay online at bescom.co.in',
  )!
  assert.equal(bescom.name, 'BESCOM electricity (1234567890)')
  assert.equal(bescom.category, 'electricity')
  assert.equal(bescom.amountPaise, 124000)
  assert.equal(bescom.dueOn, '2026-10-20')

  const jvvnl = parseDueNotice('JVVNL bill for K No 210123456789: Amount Payable Rs 2,310, Due Date 25/10/2026.')!
  assert.equal(jvvnl.name, 'JVVNL electricity (210123456789)')

  const airtel = parseDueNotice('Your Airtel postpaid bill of Rs 599.00 for mobile 98XXXXXX10 is generated. Amount due: Rs 599.00. Due date: 28 Oct 2026.')!
  assert.equal(airtel.category, 'phone')
  assert.equal(airtel.name, 'Airtel postpaid')
})

test('not a notice: an offer, or no amount or date to act on', () => {
  assert.equal(parseDueNotice('Get a lifetime free credit card! Apply now and get 5000 reward points.'), null)
  assert.equal(parseDueNotice('Your HDFC credit card statement is ready. Log in to view it.'), null)
  assert.equal(parseDueNotice('call Ravi tomorrow 4pm'), null)
})
