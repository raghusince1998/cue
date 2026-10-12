import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInsurance } from './insurance.ts'

test('a car policy issued: cover ends at the end of its period', () => {
  assert.deepEqual(
    parseInsurance(
      'ACKO: Your Car Insurance Policy No. ACKO/MOT/1234567 is issued. Vehicle: Maruti Swift (MH12AB1234). Policy Period: 15/10/2026 to 14/10/2027. Total Premium: ₹8,450.00. Download your policy document.',
    ),
    { name: 'Car insurance · MH12AB1234 (ACKO)', kind: 'renewal', dueOn: '2027-10-14', amountPaise: 845000, vehicle: 'MH12AB1234' },
  )
})

test('a bike renewal reminder, a health renewal, a life premium due', () => {
  const bike = parseInsurance(
    'Digit Insurance: Your two-wheeler policy for KA 01 XY 5678 expires on 20 Oct 2026. Renewal premium: Rs 1,749. Renew now to stay covered.',
  )!
  assert.equal(bike.name, 'Bike insurance · KA01XY5678 (Digit)')
  assert.equal(bike.kind, 'renewal')
  assert.equal(bike.dueOn, '2026-10-20')
  assert.equal(bike.amountPaise, 174900)

  const health = parseInsurance('Star Health: Your health insurance policy 12/1234/567 is due for renewal on 05-Nov-2026. Premium: Rs. 18,920.')!
  assert.equal(health.name, 'Health insurance (Star Health)')
  assert.equal(health.dueOn, '2026-11-05')

  const life = parseInsurance('LIC: Premium of Rs 12,345 for your life insurance policy no 123456789 is due on 28/10/2026. Pay online at licindia.in')!
  assert.equal(life.name, 'Life insurance (LIC)')
  assert.equal(life.kind, 'bill')
  assert.equal(life.dueOn, '2026-10-28')
  assert.equal(life.amountPaise, 1234500)

  const pb = parseInsurance(
    'PolicyBazaar: Your car insurance (DL3CAB1234) with HDFC ERGO expires on 2 Dec 2026. Compare and renew in 2 minutes.',
  )!
  assert.equal(pb.name, 'Car insurance · DL03CAB1234 (HDFC ERGO)', 'the insurer, not the site that sold it')
})

test('not a policy: an offer, a privacy policy, a card statement', () => {
  assert.equal(parseInsurance('Save up to 85% on car insurance! Offer valid till 31 Oct 2026. Buy now on ACKO.'), null)
  assert.equal(parseInsurance('We have updated our privacy policy, effective 1 Nov 2026.'), null)
  assert.equal(parseInsurance('call Ravi about the policy tomorrow'), null)
})
