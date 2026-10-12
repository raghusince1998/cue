import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDelivery } from './deliveries.ts'

// Monday 12 October 2026, morning.
const now = new Date(2026, 9, 12, 9, 0)

test('Amazon: arriving today, then shipped with a date, then delivered', () => {
  assert.deepEqual(
    parseDelivery(
      'Arriving today: Your Amazon package with boAt Airdopes 141... will be delivered today by your Amazon delivery associate. Track: https://amzn.in/d/abc123',
      now,
    ),
    {
      store: 'Amazon',
      item: 'boAt Airdopes 141',
      status: 'out_for_delivery',
      expectedOn: '2026-10-12',
      codPaise: null,
      orderRef: null,
      trackingUrl: 'https://amzn.in/d/abc123',
    },
  )
  const shipped = parseDelivery(
    "Shipped: Your Amazon order #402-1234567-1234567 for 'Prestige Electric Kettle...' has shipped and will be delivered by Wednesday, October 14. Track: https://amzn.in/d/x9",
    now,
  )!
  assert.equal(shipped.status, 'shipped')
  assert.equal(shipped.expectedOn, '2026-10-14')
  assert.equal(shipped.orderRef, '402-1234567-1234567')
  assert.equal(shipped.item, 'Prestige Electric Kettle')
  assert.equal(parseDelivery('Delivered: Your package with Prestige Electric Kettle was delivered. https://amzn.in/d/x9', now)!.status, 'delivered')
})

test('Flipkart with cash on delivery, Myntra, Meesho, a courier', () => {
  const fk = parseDelivery(
    'Out for Delivery: Redmi Note 13 5G (Black, 128 GB) from Flipkart will be delivered today by Ekart Agent Ramesh (9876543210). Please pay Rs.17,999 at the time of delivery. Track: http://fkrt.it/abc',
    now,
  )!
  assert.equal(fk.store, 'Flipkart')
  assert.equal(fk.item, 'Redmi Note 13 5G (Black, 128 GB)')
  assert.equal(fk.status, 'out_for_delivery')
  assert.equal(fk.codPaise, 1799900)

  const fkShipped = parseDelivery(
    'Shipped: Your Redmi Note 13 5G with order ID OD430012345678901234 has been shipped and will be delivered by Thu, Oct 15. Track: http://fkrt.it/xyz',
    now,
  )!
  assert.equal(fkShipped.orderRef, 'OD430012345678901234')
  assert.equal(fkShipped.expectedOn, '2026-10-15')

  const myntra = parseDelivery('Your Myntra order with HRX T-shirt is out for delivery and will reach you today. Track here: https://myntr.it/q1', now)!
  assert.equal(myntra.store, 'Myntra')
  assert.equal(myntra.item, 'HRX T-shirt')
  assert.equal(myntra.expectedOn, '2026-10-12')

  const meesho = parseDelivery('Your Meesho order for Women Kurti will be delivered by 16 Oct. Please keep Rs 349 ready for Cash on Delivery.', now)!
  assert.equal(meesho.store, 'Meesho')
  assert.equal(meesho.item, 'Women Kurti')
  assert.equal(meesho.status, 'shipped')
  assert.equal(meesho.expectedOn, '2026-10-16')
  assert.equal(meesho.codPaise, 34900)

  const courier = parseDelivery('Your shipment AWB 1234567890 from Delhivery is out for delivery. Share OTP 4321 with the agent.', now)!
  assert.equal(courier.store, 'Delhivery')
  assert.equal(courier.orderRef, '1234567890')
  assert.equal(courier.status, 'out_for_delivery')
})

test('not a parcel: plans that only mention delivering or an order', () => {
  assert.equal(parseDelivery('deliver the report to Anita friday', now), null)
  assert.equal(parseDelivery('follow up on the order delivery with Ravi friday', now), null)
  assert.equal(parseDelivery('call Ravi tomorrow 4pm', now), null)
  assert.equal(parseDelivery('Your Flipkart order OD430012345678901234 has been cancelled.', now)!.status, 'cancelled')
})
