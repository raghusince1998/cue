import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBooking } from './bookings.ts'

// Monday 12 October 2026.
const now = new Date(2026, 9, 12, 9, 0)
const local = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

test('IRCTC: PNR, train, date, class, route, departure, seat', () => {
  const b = parseBooking(
    'PNR:2345678901,TRN:12951,DOJ:15-10-26,3A,MMCT-NDLS,DP:17:00,RAVI KUMAR+1,B2 45,B2 46,Fare:3215,SC Fee:35.4+PG CHGS. -IRCTC',
    now,
  )!
  assert.equal(b.type, 'train')
  assert.equal(b.title, 'Train 12951 · Mumbai Central → New Delhi')
  assert.equal(local(b.startsAt), '2026-10-15 17:00')
  assert.equal(b.city, 'Delhi')
  assert.equal(b.ref, '2345678901')
  assert.equal(b.notes, 'PNR 2345678901 · 3A · B2 45')
  assert.equal(b.remindBeforeMinutes, 120)

  const wl = parseBooking('PNR:4512345678 TRN:12627 DOJ:22-10-2026 SL SBC-NDLS DP:20:00 WL 12 -IRCTC', now)!
  assert.match(wl.notes!, /Waitlisted \(WL 12\)/)
  assert.equal(local(wl.startsAt), '2026-10-22 20:00')
})

test('flights: number, route, date and time, PNR, a web check-in to come', () => {
  const b = parseBooking('IndiGo: Your booking is confirmed. PNR: X7K2LM. 6E 2134 BLR-DEL, 18 Oct 26, Dep 06:15, Arr 09:05. Web check-in opens 48 hrs before departure.', now)!
  assert.equal(b.type, 'flight')
  assert.equal(b.title, 'Flight 6E 2134 · Bengaluru → Delhi')
  assert.equal(local(b.startsAt), '2026-10-18 06:15')
  assert.equal(b.ref, 'X7K2LM')
  assert.equal(b.city, 'Delhi')
  assert.equal(b.provider, 'IndiGo')

  const mmt = parseBooking('Your MakeMyTrip flight booking is confirmed. Air India AI 865 DEL to BOM on Wed, 21 Oct 2026 at 7:30 PM. PNR ABC123', now)!
  assert.equal(mmt.title, 'Flight AI 865 · Delhi → Mumbai')
  assert.equal(local(mmt.startsAt), '2026-10-21 19:30')
})

test('bus, hotel, a movie, an appointment', () => {
  const bus = parseBooking('Your redBus ticket TKT8812345 from Pune to Goa on 23 Oct 2026 is confirmed. Reporting time 21:30. Boarding point: Swargate. Seat 14, 15.', now)!
  assert.equal(bus.type, 'bus')
  assert.equal(bus.title, 'Bus · Pune → Goa')
  assert.equal(local(bus.startsAt), '2026-10-23 21:30')
  assert.equal(bus.city, 'Goa')
  assert.match(bus.notes!, /Boarding: Swargate/)

  const hotel = parseBooking('Your booking at Hotel Sea Breeze, Goa is confirmed. Check-in: 24 Oct 2026, 2:00 PM. Check-out: 27 Oct 2026. Booking ID HB998877.', now)!
  assert.equal(hotel.type, 'hotel')
  assert.equal(hotel.title, 'Check in: Hotel Sea Breeze')
  assert.equal(local(hotel.startsAt), '2026-10-24 14:00')
  assert.equal(hotel.endsOn, '2026-10-27')

  const movie = parseBooking('Booking confirmed! Your tickets for Dune: Part Two at PVR Phoenix, Screen 3, on Sat, 17 Oct at 7:30 PM. Seats J11, J12. Booking ID WN7KX2Q. -BookMyShow', now)!
  assert.equal(movie.type, 'show')
  assert.equal(movie.title, 'Dune: Part Two at PVR Phoenix')
  assert.equal(local(movie.startsAt), '2026-10-17 19:30')
  assert.match(movie.notes!, /Seats J11, J12/)

  const appt = parseBooking('Your appointment with Dr. Meera Shah at Apollo Clinic is confirmed for 20 Oct 2026 at 10:30 AM.', now)!
  assert.equal(appt.type, 'appointment')
  assert.equal(appt.title, 'Appointment with Dr. Meera Shah')
  assert.equal(local(appt.startsAt), '2026-10-20 10:30')
})

test('not a booking', () => {
  assert.equal(parseBooking('call Ravi tomorrow 4pm about the booking', now), null)
  assert.equal(parseBooking('interview at Infosys friday 11am', now), null)
  assert.equal(parseBooking('Your Meesho order for Women Kurti will be delivered by 16 Oct.', now), null)
})

test('the same bookings as emails lay them out', () => {
  const ers = parseBooking(
    `Electronic Reservation Slip (ERS) PNR No. : 2345678901 Train No./Name : 12951/MUMBAI RAJDHANI Class : AC 3 TIER (3A) Quota : GENERAL (GN)
     Booking Date : 12-Oct-2026 10:15:32 HRS From : MUMBAI CENTRAL (MMCT) Date of Journey : 17-Oct-2026 To : NEW DELHI (NDLS)
     Boarding At : MUMBAI CENTRAL (MMCT) Departure* : 17:00 17-Oct-2026 Arrival* : 08:32 18-Oct-2026 Passenger Details 1 ASHA RAO 34 F CNF/B2/45/LOWER`,
    now,
  )!
  assert.equal(ers.type, 'train')
  assert.equal(ers.title, 'Train 12951 · Mumbai Central → New Delhi')
  assert.equal(local(ers.startsAt), '2026-10-17 17:00')
  assert.equal(ers.city, 'Delhi')
  assert.equal(ers.notes, 'PNR 2345678901 · 3A · B2 45')

  const itinerary = parseBooking(
    `Booking Confirmed | IndiGo. Your PNR is X7K2LM. Bengaluru (BLR) → Delhi (DEL) Flight 6E 2134 Sun, 18 Oct 2026 Departure 06:15 Terminal 1 Arrival 09:05 Terminal 2. Web check-in opens 48 hours before departure.`,
    now,
  )!
  assert.equal(itinerary.title, 'Flight 6E 2134 · Bengaluru → Delhi')
  assert.equal(local(itinerary.startsAt), '2026-10-18 06:15')
  assert.equal(itinerary.ref, 'X7K2LM')
})

test('a journey typed as a plan is a booking too, with the city it goes to', () => {
  const flight = parseBooking('flight to Bangalore on 25 Oct 6am', now)!
  assert.equal(flight.type, 'flight')
  assert.equal(flight.title, 'Flight to Bengaluru', 'the old name, under the one the lists use')
  assert.equal(local(flight.startsAt), '2026-10-25 06:00')
  assert.equal(flight.city, 'Bengaluru')
  assert.equal(flight.remindBeforeMinutes, 180)

  const train = parseBooking('train 12127 to Pune on Friday 7:10am', now)!
  assert.equal(train.type, 'train')
  assert.equal(train.title, 'Train 12127 to Pune')
  assert.equal(local(train.startsAt), '2026-10-16 07:10')

  const indigo = parseBooking('flight 6E 512 from Delhi to Goa tomorrow 7am', now)!
  assert.equal(indigo.title, 'Flight 6E 512 Delhi → Goa')
  assert.equal(indigo.provider, 'IndiGo')

  assert.equal(parseBooking('bus to office at 9', now), null, 'a commute is not a trip')
  assert.equal(parseBooking('book a train to Pune', now), null, 'a to-do about booking is not a booking')
})

test('a typed hotel check-in has a name, a city and no stray words', () => {
  const stay = parseBooking('hotel check-in Taj Jaipur 10 Nov', now)!
  assert.equal(stay.title, 'Check in: Taj Jaipur')
  assert.equal(stay.city, 'Jaipur')
  assert.equal(local(stay.startsAt), '2026-11-10 14:00')
})
