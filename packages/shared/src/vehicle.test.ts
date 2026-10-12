import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseChallan, parseFastag, parseVehicleNotice, vehicleNoticeName } from './vehicle.ts'

test('PUC: when the certificate runs out, by vehicle', () => {
  const p = parseVehicleNotice(
    'Parivahan: PUC certificate for vehicle MH12AB1234 issued on 15/10/2026 at Shree Emission Centre. Valid till: 14/04/2027.',
  )!
  assert.deepEqual(p, { kind: 'puc', vehicle: 'MH12AB1234', dueOn: '2027-04-14', maker: null, detail: null })
  assert.equal(vehicleNoticeName(p), 'PUC · MH12AB1234')

  const park = parseVehicleNotice('Park+: The Pollution Under Control certificate of your car KA 05 MN 4321 expires on 20 Oct 2026. Get it renewed at a nearby centre.')!
  assert.equal(park.vehicle, 'KA05MN4321')
  assert.equal(park.dueOn, '2026-10-20')
})

test('service: due date, which service, the km, the maker', () => {
  const s = parseVehicleNotice(
    'Maruti Suzuki: Dear customer, your vehicle MH12AB1234 is due for its 3rd free service on 25/10/2026 or at 10,000 km, whichever is earlier. Book at your nearest Arena workshop.',
  )!
  assert.equal(s.kind, 'service')
  assert.equal(s.dueOn, '2026-10-25')
  assert.equal(s.vehicle, 'MH12AB1234')
  assert.equal(s.maker, 'Maruti Suzuki')
  assert.equal(s.detail, '3rd free service, or at 10,000 km')
  assert.equal(vehicleNoticeName(s), 'Vehicle service · MH12AB1234 (Maruti Suzuki)')

  const bike = parseVehicleNotice('Royal Enfield: Service reminder for your Classic 350 (TN 09 CD 7788). Next service due date: 02 Nov 2026.')!
  assert.equal(bike.dueOn, '2026-11-02')
  assert.equal(vehicleNoticeName(bike), 'Bike service · TN09CD7788 (Royal Enfield)')
})

test('not a reminder: a policy mentioning PUC, a booked appointment, an offer', () => {
  assert.equal(
    parseVehicleNotice(
      'Your car insurance policy for MH12AB1234 is issued. Please keep a valid PUC certificate with you while driving. Policy Period: 15/10/2026 to 14/10/2027.',
    ),
    null,
  )
  assert.equal(parseVehicleNotice('Your service appointment is confirmed for 20 Oct 2026 at 10:00 AM at Kothari Hyundai.'), null)
  assert.equal(parseVehicleNotice('Flat 20% off on car service this Diwali! Offer valid till 31 Oct 2026.'), null)
})

test('FASTag: running low, low after a toll, recharged; a plain toll is nothing', () => {
  assert.deepEqual(
    parseFastag('Paytm FASTag: Your FASTag balance for MH12AB1234 is Rs 85.50, which is below the minimum threshold. Recharge now to avoid paying double toll.'),
    { vehicle: 'MH12AB1234', balancePaise: 8550, status: 'low', issuer: 'Paytm' },
  )
  assert.equal(
    parseFastag('ICICI Bank FASTag: Rs 120.00 deducted at Khed Shivapur Toll Plaza for MH12AB1234. Available balance: Rs 60.00')!.status,
    'low',
    'too little left for the next toll',
  )
  assert.equal(parseFastag('ICICI Bank FASTag: Rs 120.00 deducted at Khed Shivapur Toll Plaza for MH12AB1234. Available balance: Rs 1,560.00'), null)
  const done = parseFastag('Your FASTag (MH12AB1234) has been recharged with Rs 500 successfully. Available balance Rs 585.50. - HDFC Bank')!
  assert.equal(done.status, 'recharged')
  assert.equal(done.balancePaise, 58550)
})

test('challans: issued with the fine, offence and number; paid; a GST challan is not one', () => {
  assert.deepEqual(
    parseChallan(
      'An e-Challan No. MH12345678901234 has been issued for your vehicle MH12AB1234 on 10/10/2026 for Over speeding. Fine amount: Rs 1,000. Pay before 09/12/2026 at echallan.parivahan.gov.in',
    ),
    {
      number: 'MH12345678901234',
      vehicle: 'MH12AB1234',
      amountPaise: 100000,
      offence: 'Over speeding',
      issuedOn: null,
      dueOn: '2026-12-09',
      status: 'issued',
    },
  )
  const btp = parseChallan('Bangalore Traffic Police: Challan 4567891234 for KA05MN4321. Offence: Jumping red light. Date of offence: 08-10-2026. Penalty Rs 500.')!
  assert.equal(btp.offence, 'Jumping red light')
  assert.equal(btp.issuedOn, '2026-10-08')
  assert.equal(btp.amountPaise, 50000)
  assert.equal(parseChallan('Your payment for e-Challan No. MH12345678901234 of Rs 1,000 is successful. Thank you.')!.status, 'paid')
  assert.equal(parseChallan('GST challan CPIN 26101234567890 generated for Rs 18,000. Pay before 20/10/2026.'), null)
})
