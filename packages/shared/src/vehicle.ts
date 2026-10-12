/**
 * A vehicle's own reminders, from what the transport department, PUC
 * centres, makers and dealers send: when the pollution certificate (PUC)
 * runs out, and when the next service is due. Kept by registration number,
 * so a new certificate or the next service reminder moves the same one on.
 */

export interface VehicleNotice {
  kind: 'puc' | 'service'
  /** "MH12AB1234", when the message gives it. */
  vehicle: string | null
  /** YYYY-MM-DD: when the PUC expires, or the service is due. */
  dueOn: string
  /** The maker, for a service: "Maruti Suzuki". */
  maker: string | null
  /** For a service: "3rd free service", "or at 10,000 km". */
  detail: string | null
}

const MAKERS: [RegExp, string][] = [
  [/\bmaruti\b|\bnexa\b/i, 'Maruti Suzuki'],
  [/\bhyundai\b/i, 'Hyundai'],
  [/\btata motors\b|\btata\.ev\b/i, 'Tata Motors'],
  [/\bmahindra\b/i, 'Mahindra'],
  [/\bhonda cars?\b/i, 'Honda'],
  [/\btoyota\b/i, 'Toyota'],
  [/\bkia\b/i, 'Kia'],
  [/\bmg motor\b/i, 'MG'],
  [/\brenault\b/i, 'Renault'],
  [/\bskoda\b/i, 'Skoda'],
  [/\bvolkswagen\b|\bvw\b/i, 'Volkswagen'],
  [/\bhero\b/i, 'Hero'],
  [/\bhonda (?:two ?wheelers?|motorcycle|2w)\b|\bhonda activa\b|\bactiva\b/i, 'Honda'],
  [/\bbajaj auto\b|\bpulsar\b/i, 'Bajaj'],
  [/\btvs\b/i, 'TVS'],
  [/\broyal enfield\b/i, 'Royal Enfield'],
  [/\byamaha\b/i, 'Yamaha'],
  [/\bsuzuki motorcycle\b|\baccess 125\b/i, 'Suzuki'],
  [/\bather\b/i, 'Ather'],
  [/\bola electric\b/i, 'Ola Electric'],
  [/\bgomechanic\b/i, 'GoMechanic'],
]

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

function dateAt(text: string): string | null {
  let m = /^\W{0,8}?(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/.exec(text)
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]))
    if (d.getMonth() === Number(m[2]) - 1) return `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`
  }
  m = /^\W{0,8}?(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[\s,-]+(\d{4})\b/i.exec(text)
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3))
    if (mo >= 0) return `${m[3]}-${pad(mo + 1)}-${pad(Number(m[1]))}`
  }
  m = /^\W{0,8}?([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(text)
  if (m) {
    const mo = MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3))
    if (mo >= 0) return `${m[3]}-${pad(mo + 1)}-${pad(Number(m[2]))}`
  }
  return null
}

/** A date after one of these labels, within a stretch of text. */
function dateAfter(text: string, label: RegExp): string | null {
  for (const m of text.matchAll(new RegExp(label.source, 'gi'))) {
    const d = dateAt(text.slice(m.index! + m[0].length, m.index! + m[0].length + 40))
    if (d) return d
  }
  return null
}

function vehicleIn(text: string): string | null {
  const m = /\b([A-Z]{2})[ -]?(\d{1,2})[ -]?([A-Z]{1,3})[ -]?(\d{4})\b/.exec(text)
  return m ? `${m[1]}${m[2]!.padStart(2, '0')}${m[3]}${m[4]}` : null
}

const PUC = /\bpuc(?:c)?\b|\bpollution under control\b|\bpollution (?:certificate|check|test)\b|\bemission (?:test|certificate)\b/i
const SERVICE = /\b(?:next |periodic |paid |free |\d(?:st|nd|rd|th) (?:free )?)?service\b[^.]{0,40}?\b(?:due|reminder|is due|falls due)\b|\bservice due\b|\bdue for (?:its |your |the )?(?:[\w-]+ ){0,3}service\b/i

/**
 * Reads a PUC or service reminder, or null. The date has to sit next to what
 * it is about: a motor policy that mentions "keep a valid PUC" is not a PUC
 * reminder, and its expiry is the policy's.
 */
export function parseVehicleNotice(input: string): VehicleNotice | null {
  const text = input.replace(/\s+/g, ' ')

  const puc = PUC.exec(text)
  if (puc) {
    const near = text.slice(puc.index, puc.index + 200)
    const dueOn = dateAfter(near, /\b(?:valid (?:till|until|upto|up to)|validity(?: till| upto)?|expir(?:es|y|ing)(?: date)?(?: on)?|expire[sd]? on|due (?:on|by|date)|renew (?:by|before))\b\s*(?:is|on|:|-)?\s*/)
    if (dueOn) return { kind: 'puc', vehicle: vehicleIn(text), dueOn, maker: null, detail: null }
  }

  const service = SERVICE.exec(text)
  if (service && !/\bappointment (?:is )?(?:confirmed|booked)\b/i.test(text)) {
    const near = text.slice(Math.max(0, service.index - 40), service.index + 240)
    const dueOn = dateAfter(near, /\b(?:due (?:on|by|date)|due|on or before|before|by|on|date)\b\s*(?::|-)?\s*/)
    if (dueOn) {
      const nth = /\b(\d(?:st|nd|rd|th) (?:free |paid )?service)\b/i.exec(text)?.[1] ?? null
      const km = /\b(?:at|or|after)\s+(?:the\s+)?(\d{1,3}(?:,\d{3})+|\d{3,6})\s*(?:km|kms|kilometres|kilometers)\b/i.exec(text)
      const detail = [nth, km ? `or at ${km[1]} km` : null].filter(Boolean).join(', ') || null
      return {
        kind: 'service',
        vehicle: vehicleIn(text),
        dueOn,
        maker: MAKERS.find(([re]) => re.test(text))?.[1] ?? null,
        detail,
      }
    }
  }
  return null
}

/** What to call it, the same every time: "PUC · MH12AB1234", "Car service · MH12AB1234 (Maruti Suzuki)". */
export function vehicleNoticeName(n: VehicleNotice): string {
  if (n.kind === 'puc') return `PUC${n.vehicle ? ` · ${n.vehicle}` : ''}`
  const bike = n.maker && ['Hero', 'Bajaj', 'TVS', 'Royal Enfield', 'Yamaha', 'Suzuki', 'Ather', 'Ola Electric'].includes(n.maker)
  return `${bike ? 'Bike' : 'Vehicle'} service${n.vehicle ? ` · ${n.vehicle}` : ''}${n.maker ? ` (${n.maker})` : ''}`
}

/**
 * A service reminder as a dated plan: on the morning it is due, reminded
 * three days ahead to book a slot, kept by vehicle and date so the same
 * reminder is never added twice.
 */
export function serviceAsBooking(n: VehicleNotice): import('./bookings.ts').ParsedBooking {
  const [y, m, d] = n.dueOn.split('-').map(Number)
  return {
    type: 'service',
    title: vehicleNoticeName(n),
    startsAt: new Date(y!, m! - 1, d!, 10, 0),
    timeKnown: true,
    endsOn: null,
    city: null,
    from: null,
    ref: `SERVICE-${n.vehicle ?? n.maker ?? 'VEHICLE'}-${n.dueOn}`,
    notes: n.detail ? `Due: ${n.detail}` : null,
    provider: n.maker,
    durationMinutes: 60,
    remindBeforeMinutes: 3 * 24 * 60,
  }
}

export interface FastagNotice {
  vehicle: string | null
  /** What is left on the tag, when the message says. */
  balancePaise: number | null
  /** Low: recharge it. Recharged: the reminder can go. */
  status: 'low' | 'recharged'
  issuer: string | null
}

const FASTAG_ISSUERS: [RegExp, string][] = [
  [/\bpaytm\b/i, 'Paytm'],
  [/\bicici\b/i, 'ICICI'],
  [/\bhdfc\b/i, 'HDFC'],
  [/\bairtel\b/i, 'Airtel'],
  [/\baxis\b/i, 'Axis'],
  [/\bsbi\b/i, 'SBI'],
  [/\bidfc\b/i, 'IDFC FIRST'],
  [/\bkotak\b/i, 'Kotak'],
  [/\bpark ?\+|\bparkplus\b/i, 'Park+'],
  [/\bbank of baroda\b|\bbob\b/i, 'Bank of Baroda'],
  [/\bindusind\b/i, 'IndusInd'],
  [/\bequitas\b/i, 'Equitas'],
]

function rupees(s: string): number {
  const [whole, frac] = s.replace(/,/g, '').split('.')
  return Number(whole) * 100 + (frac ? Number(frac.padEnd(2, '0').slice(0, 2)) : 0)
}

/** Below this, a toll can bounce and cost double: worth recharging. */
const LOW_FASTAG_PAISE = 200_00

/**
 * A FASTag running low, or recharged. A plain toll deduction is neither,
 * unless what it leaves is too little for the next toll.
 */
export function parseFastag(input: string): FastagNotice | null {
  const text = input.replace(/\s+/g, ' ')
  if (!/\bfas ?tag\b/i.test(text)) return null
  // "Available balance: Rs 60", "balance for MH12AB1234 is Rs 85.50": always with the rupee mark,
  // so the vehicle's digits are never read as money.
  const bal = /\bbal(?:ance)?\.?(?:\s+(?:for|of|on)\s+[A-Z0-9 -]{6,16}?)?(?:\s+(?:is|of|now))?\s*(?::|-)?\s*(?:₹|rs\.?|inr)\s*(-?\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)/i.exec(text)
  const balancePaise = bal ? rupees(bal[1]!) : null
  const issuer = FASTAG_ISSUERS.find(([re]) => re.test(text))?.[1] ?? null
  const vehicle = vehicleIn(text)

  if (/\b(?:recharged|recharge (?:of|for)\b[^.]{0,60}\b(?:successful|done|credited)|successfully (?:recharged|added|credited)|has been credited|credited to your fas ?tag|top[- ]?up (?:successful|done))\b/i.test(text)) {
    return { vehicle, balancePaise, status: 'recharged', issuer }
  }
  const low =
    /\b(?:low balance|minimum (?:threshold|balance)|insufficient balance|below the (?:threshold|minimum)|recharge (?:now|immediately|your fas ?tag|at the earliest)|negative balance|blacklist(?:ed)?)\b/i.test(text) ||
    (balancePaise !== null && balancePaise < LOW_FASTAG_PAISE && /\b(?:deducted|debited|toll (?:paid|charged)|paid at)\b/i.test(text))
  return low ? { vehicle, balancePaise, status: 'low', issuer } : null
}

export interface ChallanNotice {
  /** The challan's number, to find it again when it is paid. */
  number: string | null
  vehicle: string | null
  amountPaise: number | null
  offence: string | null
  /** YYYY-MM-DD. */
  issuedOn: string | null
  /** YYYY-MM-DD: when the message says to pay by. */
  dueOn: string | null
  status: 'issued' | 'paid'
}

const OFFENCES =
  /\b(over ?speeding|red light (?:jumping|violation)|signal jumping|jumping (?:the )?red light|no parking|wrong parking|parking violation|(?:riding )?without helmet|no helmet|without seat ?belt|no seat ?belt|using mobile(?: phone)?(?: while driving)?|wrong side driving|triple riding|without puc|no puc|without insurance|drunk(?:en)? driving|lane violation|stop line violation|dangerous driving|no entry|tinted glass)\b/i

/**
 * A traffic challan, issued or paid. A tax challan (GST, TDS, PF) is not
 * one: it has to be about a vehicle or traffic.
 */
export function parseChallan(input: string): ChallanNotice | null {
  const text = input.replace(/\s+/g, ' ')
  if (!/\be-?challan\b|\bchallan\b/i.test(text)) return null
  if (/\b(?:gst|tds|tax|itns|epf|pf|esic|income)\b[^.]{0,20}\bchallan\b/i.test(text)) return null
  const vehicle = vehicleIn(text)
  if (!vehicle && !/\btraffic\b|\bvehicle\b|\bviolation\b|\boffen[cs]e\b|\bparivahan\b|\be-?challan\b/i.test(text)) return null

  const number = /\bchallan\s*(?:no\.?|number|id)?\s*[:#-]?\s*([A-Z]{0,6}\d{6,}[A-Z0-9]*)\b/i.exec(text)?.[1] ?? null
  if (!number && !vehicle) return null
  const amount =
    /\b(?:fine|penalty|challan amount|total amount|amount(?: due| payable)?)\s*(?:amount\s*)?(?:of|:|-|is)?\s*(?:₹|rs\.?|inr)\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?/i.exec(text) ??
    /(?:₹|rs\.?|inr)\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?\s*(?:fine|penalty)/i.exec(text)
  const offence =
    /\b(?:offen[cs]e|violation)s?\s*(?:name|details|type)?\s*[:-]\s*([A-Za-z][^.;\n]{2,50}?)(?=\s*(?:[.;,]|fine|amount|on\b|$))/i.exec(text)?.[1]?.trim() ??
    OFFENCES.exec(text)?.[1] ??
    null
  const issuedOn = dateAfter(text, /\b(?:issued on|dated|date of (?:offen[cs]e|violation|challan)|offen[cs]e date|violation date)\b\s*(?::|-)?\s*/)
  const dueOn = dateAfter(text, /\b(?:pay (?:before|by|within)|due date|last date(?: to pay| of payment)?|payable by|pay it by)\b\s*(?::|-)?\s*/)
  const paid =
    /\b(?:paid successfully|has been paid|payment (?:has been )?received|successfully paid|disposed)\b/i.test(text) ||
    /\bpayment\b.{0,80}?\b(?:is|was|has been)\s+successful\b/i.test(text)
  return {
    number,
    vehicle,
    amountPaise: amount ? rupees(amount[1]!) : null,
    offence: offence ? offence[0]!.toUpperCase() + offence.slice(1).toLowerCase() : null,
    issuedOn,
    dueOn,
    status: paid ? 'paid' : 'issued',
  }
}
