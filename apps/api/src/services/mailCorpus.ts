/**
 * Emails as the senders really lay them out, for testing the readers end to
 * end: HTML as it arrives, made into text the way the mail reader does, then
 * read. Names, numbers and addresses are made up; the layouts are not.
 *
 * Every layout here is one that once read wrong. Adding the next one that
 * does is how the readers get better: a sample, what it should say, a fix.
 */

export interface CorpusMail {
  name: string
  from: string
  subject: string
  html?: string
  text?: string
}

const ROW = (cells: string[]) => `<tr>${cells.map((c) => `<td style="padding:4px">${c}</td>`).join('')}</tr>`

export const CORPUS: CorpusMail[] = [
  // ------------------------------------------------------------------ trains
  {
    name: 'irctc-ers',
    from: 'IRCTC <ticketadmin@irctc.co.in>',
    subject: 'Booking Confirmation on IRCTC, Train: 12951, 17-Oct-2026, 3A, MMCT - NDLS',
    html: `<html><head><style>td{font-size:12px}</style></head><body>
      <table><tr><td><b>Electronic Reservation Slip (ERS)</b></td></tr></table>
      <table>
        ${ROW(['Booked From', 'Boarding At', 'To'])}
        ${ROW(['MUMBAI CENTRAL (MMCT)', 'BORIVALI (BVI)', 'NEW DELHI (NDLS)'])}
        ${ROW(['Start Date* 17-Oct-2026', 'Departure* 17:00 17-Oct-2026', 'Arrival* 08:32 18-Oct-2026'])}
      </table>
      <table>
        ${ROW(['PNR', 'Train No./Name', 'Class'])}
        ${ROW(['2345678901', '12951/MUMBAI RAJDHANI', 'AC 3 TIER (3A)'])}
        ${ROW(['Quota', 'Distance', 'Booking Date'])}
        ${ROW(['GENERAL (GN)', '1386 KM', '12-Oct-2026 10:15:32 HRS'])}
      </table>
      <table>
        ${ROW(['Passenger Details:'])}
        ${ROW(['#', 'Name', 'Age', 'Gender', 'Booking Status', 'Current Status'])}
        ${ROW(['1.', 'ASHA RAO', '34', 'F', 'CNF/B2/45/LOWER', 'CNF/B2/45/LOWER'])}
        ${ROW(['2.', 'RAVI RAO', '36', 'M', 'CNF/B2/46/MIDDLE', 'CNF/B2/46/MIDDLE'])}
      </table>
      <p>Transaction ID: 100005123456789</p>
      <p>Total Fare (all inclusive): &#8377; 4,230.80</p>
      <p>Please carry the original ID proof used at booking.</p>
    </body></html>`,
  },
  {
    name: 'irctc-ers-waitlisted',
    from: 'IRCTC <ticketadmin@irctc.co.in>',
    subject: 'Booking Confirmation on IRCTC, Train: 12627, 23-Oct-2026, SL, SBC - NDLS',
    html: `<html><body>
      <table>
        ${ROW(['Booked From', 'Boarding At', 'To'])}
        ${ROW(['KSR BENGALURU (SBC)', 'KSR BENGALURU (SBC)', 'NEW DELHI (NDLS)'])}
        ${ROW(['Start Date* 23-Oct-2026', 'Departure* 19:20 23-Oct-2026', 'Arrival* 10:00 25-Oct-2026'])}
        ${ROW(['PNR', 'Train No./Name', 'Class'])}
        ${ROW(['4567890123', '12627/KARNATAKA EXP', 'SLEEPER CLASS (SL)'])}
        ${ROW(['#', 'Name', 'Age', 'Gender', 'Booking Status', 'Current Status'])}
        ${ROW(['1.', 'MEERA S', '29', 'F', 'WL/23', 'WL/12'])}
      </table>
    </body></html>`,
  },
  {
    name: 'irctc-sms',
    from: 'IRCTC <ticketadmin@irctc.co.in>',
    subject: 'PNR 2345678901',
    text: 'PNR:2345678901,TRN:12951,DOJ:17-10-26,3A,MMCT-NDLS,DP:17:00,ASHA RAO+1,B2 45,B2 46,Fare:4230,SC Fee:35.4+PG CHGS. -IRCTC',
  },
  {
    name: 'confirmtkt',
    from: 'ConfirmTkt <noreply@confirmtkt.com>',
    subject: 'Your train ticket is booked! PNR 6789012345',
    html: `<html><body>
      <h2>Ticket confirmed</h2>
      <p>PNR: <b>6789012345</b></p>
      <p><b>12779 Goa Express</b></p>
      <table>
        ${ROW(['Pune Jn (PUNE)<br>Fri, 30 Oct 2026<br>22:05', '&rarr;', 'Madgaon (MAO)<br>Sat, 31 Oct 2026<br>09:40'])}
      </table>
      <p>Class: 3A &middot; Quota: General</p>
      <p>Passenger 1: CNF / B1 / 22</p>
    </body></html>`,
  },

  // ----------------------------------------------------------------- flights
  {
    name: 'indigo',
    from: 'IndiGo <reservations@customer.goindigo.in>',
    subject: 'Your IndiGo booking is confirmed - PNR X7K2LM',
    html: `<html><body>
      <p>Hello Asha, your booking is confirmed.</p>
      <p>PNR: <b>X7K2LM</b></p>
      <table>
        ${ROW(['Flight', 'Departure', 'Arrival'])}
        ${ROW(['6E 2134', 'Bengaluru (BLR)<br>Sun, 18 Oct 2026<br>06:15<br>Terminal 1', 'Delhi (DEL)<br>Sun, 18 Oct 2026<br>09:05<br>Terminal 2'])}
      </table>
      <p>Web check-in opens 48 hours before departure.</p>
    </body></html>`,
  },
  {
    name: 'makemytrip-flight',
    from: 'MakeMyTrip <noreply@makemytrip.com>',
    subject: 'Booking Confirmed: Bengaluru to Goa | Sun, 01 Nov 2026',
    html: `<html><body>
      <p>Booking ID: NF7B2C3D4E5F6</p>
      <p><b>Bengaluru &rarr; Goa</b> &middot; Sun, 01 Nov 2026</p>
      <table>
        ${ROW(['IndiGo<br>6E-512', '07:00<br>BLR<br>Kempegowda International Airport, Terminal 1', '1h 15m<br>Non-stop', '08:15<br>GOX<br>Manohar International Airport'])}
      </table>
      <p>Airline PNR: K9LM2P</p>
    </body></html>`,
  },
  {
    name: 'air-india',
    from: 'Air India <noreply@airindia.com>',
    subject: 'Air India e-Ticket - Booking Reference 8HJ2KQ',
    text: `Thank you for choosing Air India.
Booking Reference (PNR): 8HJ2KQ
Flight AI 665 Mumbai (BOM) to Delhi (DEL)
Departure: 22 Oct 2026, 10:00 Terminal 2
Arrival: 22 Oct 2026, 12:10 Terminal 3
Passenger: Mr Ravi Rao  Seat 14C`,
  },

  // ----------------------------------------------------------------- parcels
  {
    name: 'amazon-shipped',
    from: 'Amazon.in <shipment-tracking@amazon.in>',
    subject: 'Your Amazon.in order of "boAt Rockerz 450 Bluetooth On Ear Headphones..." has shipped',
    html: `<html><body>
      <p>Hello Asha,</p>
      <p>Your package has shipped.</p>
      <p><b>Arriving Thursday, 15 October</b></p>
      <p>boAt Rockerz 450 Bluetooth On Ear Headphones with Mic</p>
      <p>Order # 407-1234567-1234567</p>
      <p>Track package</p>
    </body></html>`,
  },
  {
    name: 'amazon-out-for-delivery',
    from: 'Amazon.in <shipment-tracking@amazon.in>',
    subject: 'Out for delivery: "boAt Rockerz 450 Bluetooth On Ear Headphones..."',
    html: `<html><body><p>Your package is out for delivery.</p><p>Arriving today by 9 PM</p><p>Order # 407-1234567-1234567</p></body></html>`,
  },
  {
    name: 'amazon-delivered',
    from: 'Amazon.in <shipment-tracking@amazon.in>',
    subject: 'Delivered: "boAt Rockerz 450 Bluetooth On Ear Headphones..."',
    html: `<html><body><p>Your package was delivered.</p><p>Delivered today</p><p>Order # 407-1234567-1234567</p></body></html>`,
  },
  {
    name: 'flipkart-shipped-cod',
    from: 'Flipkart <no-reply@nct.flipkart.com>',
    subject: 'Shipped: Your Flipkart order for Redmi Note 13 5G (Arctic White, 128 GB)',
    html: `<html><body>
      <p>Hi Asha, your order has been shipped.</p>
      <table>
        ${ROW(['Redmi Note 13 5G (Arctic White, 128 GB)', 'Qty: 1'])}
        ${ROW(['Delivery by', 'Fri, Oct 16, 2026'])}
        ${ROW(['Amount to be paid on delivery', '&#8377;17,999'])}
      </table>
      <p>Order ID: OD329876543210987654</p>
    </body></html>`,
  },
  {
    name: 'myntra',
    from: 'Myntra <updates@myntra.com>',
    subject: 'Your Myntra order is on its way!',
    html: `<html><body>
      <p>Your order has been shipped.</p>
      <p><b>Roadster Men Blue Slim Fit Jeans</b></p>
      <p>Size: 32</p>
      <p>Expected delivery by 17 Oct</p>
      <p>Order No: 1234567-8901234-5678901</p>
    </body></html>`,
  },
  {
    name: 'meesho-cod',
    from: 'Meesho <noreply@meesho.com>',
    subject: 'Your Meesho order has been shipped',
    text: 'Hi, your order for Women Cotton Kurti Set has been shipped. Delivery by Sat, 17th Oct. Cash on Delivery amount: Rs. 349. Order ID 9876543210.',
  },
  {
    name: 'nykaa',
    from: 'Nykaa <orders@nykaa.com>',
    subject: 'Your Nykaa order NYK-12345678 has been dispatched',
    text: 'Great news! Your order has been dispatched. Items: Lakme 9 to 5 Primer + Matte Lipstick. Estimated delivery: 19 Oct 2026. Track your order on the Nykaa app.',
  },

  // ------------------------------------------------------------------- bills
  {
    name: 'hdfc-card',
    from: 'HDFC Bank <emailstatements.cards@hdfcbank.net>',
    subject: 'Your HDFC Bank Credit Card Statement for October 2026',
    html: `<html><body>
      <p>Dear Customer, your statement for the HDFC Bank Credit Card ending 1234 is ready.</p>
      <table>
        ${ROW(['Payment Due Date', 'Total Amount Due', 'Minimum Amount Due'])}
        ${ROW(['05/11/2026', 'Rs. 12,345.67', 'Rs. 620.00'])}
      </table>
    </body></html>`,
  },
  {
    name: 'bescom',
    from: 'BESCOM <noreply@bescom.co.in>',
    subject: 'BESCOM Electricity Bill for Account 1234567890',
    text: 'Dear Consumer, your electricity bill for September 2026 is generated. Bill Amount: Rs. 1,240.00. Due Date: 20-10-2026. Pay online to avoid disconnection.',
  },
]
