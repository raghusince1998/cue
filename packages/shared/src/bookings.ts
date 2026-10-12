/**
 * Bookings, read from the confirmations that IRCTC, airlines, bus and hotel
 * sites, cinemas and clinics send: when it is, where, and the reference to
 * show at the gate. None of them lets another app read a traveller's
 * bookings, but every one of them sends this message, and it says enough.
 */

export type BookingType = 'train' | 'flight' | 'bus' | 'hotel' | 'show' | 'appointment' | 'other'

export interface ParsedBooking {
  type: BookingType
  /** "Train 12951 · Mumbai Central → New Delhi" */
  title: string
  /** Local date and time it starts: departure, check-in, showtime. */
  startsAt: Date
  /** False when the message gave no time and one was assumed. */
  timeKnown: boolean
  /** YYYY-MM-DD: the last day, for a stay. */
  endsOn: string | null
  /** The city it takes you to, for a trip; null when it does not. */
  city: string | null
  /** Where it starts, said plainly: "Mumbai Central", "Bengaluru". */
  from: string | null
  /** PNR or booking ID, to show at the counter. */
  ref: string | null
  /** Notes worth having to hand: class, coach and seat, waitlist, screen. */
  notes: string | null
  /** Who it was booked with: IRCTC, IndiGo, BookMyShow. */
  provider: string | null
  durationMinutes: number
  /** How long before it the reminder goes. */
  remindBeforeMinutes: number
}

/** Common stations: [station name, city]. Anything else stays as its code. */
const STATIONS: Record<string, [string, string]> = {
  NDLS: ['New Delhi', 'Delhi'], DLI: ['Old Delhi', 'Delhi'], NZM: ['Hazrat Nizamuddin', 'Delhi'], ANVT: ['Anand Vihar', 'Delhi'],
  DEE: ['Delhi Sarai Rohilla', 'Delhi'], MMCT: ['Mumbai Central', 'Mumbai'], BCT: ['Mumbai Central', 'Mumbai'],
  CSMT: ['Mumbai CSMT', 'Mumbai'], LTT: ['Lokmanya Tilak Terminus', 'Mumbai'], BDTS: ['Bandra Terminus', 'Mumbai'],
  DR: ['Dadar', 'Mumbai'], TNA: ['Thane', 'Mumbai'], SBC: ['Bengaluru City', 'Bengaluru'], KSR: ['Bengaluru City', 'Bengaluru'],
  YPR: ['Yesvantpur', 'Bengaluru'], SMVB: ['SMVT Bengaluru', 'Bengaluru'], MAS: ['Chennai Central', 'Chennai'],
  MS: ['Chennai Egmore', 'Chennai'], HWH: ['Howrah', 'Kolkata'], SDAH: ['Sealdah', 'Kolkata'], KOAA: ['Kolkata', 'Kolkata'],
  SC: ['Secunderabad', 'Hyderabad'], HYB: ['Hyderabad', 'Hyderabad'], KCG: ['Kacheguda', 'Hyderabad'], PUNE: ['Pune', 'Pune'],
  ADI: ['Ahmedabad', 'Ahmedabad'], JP: ['Jaipur', 'Jaipur'], LKO: ['Lucknow', 'Lucknow'], LJN: ['Lucknow', 'Lucknow'],
  CNB: ['Kanpur Central', 'Kanpur'], BSB: ['Varanasi', 'Varanasi'], PRYJ: ['Prayagraj', 'Prayagraj'], PNBE: ['Patna', 'Patna'],
  BPL: ['Bhopal', 'Bhopal'], RKMP: ['Rani Kamlapati', 'Bhopal'], INDB: ['Indore', 'Indore'], NGP: ['Nagpur', 'Nagpur'],
  AGC: ['Agra Cantt', 'Agra'], GWL: ['Gwalior', 'Gwalior'], CDG: ['Chandigarh', 'Chandigarh'], ASR: ['Amritsar', 'Amritsar'],
  DDN: ['Dehradun', 'Dehradun'], HW: ['Haridwar', 'Haridwar'], JAT: ['Jammu Tawi', 'Jammu'], UDZ: ['Udaipur', 'Udaipur'],
  JU: ['Jodhpur', 'Jodhpur'], AII: ['Ajmer', 'Ajmer'], KOTA: ['Kota', 'Kota'], BBS: ['Bhubaneswar', 'Bhubaneswar'],
  PURI: ['Puri', 'Puri'], GHY: ['Guwahati', 'Guwahati'], ERS: ['Ernakulam', 'Kochi'], ERN: ['Ernakulam Town', 'Kochi'],
  TVC: ['Thiruvananthapuram', 'Thiruvananthapuram'], CBE: ['Coimbatore', 'Coimbatore'], MDU: ['Madurai', 'Madurai'],
  MAO: ['Madgaon', 'Goa'], VSG: ['Vasco da Gama', 'Goa'], MYS: ['Mysuru', 'Mysuru'], UBL: ['Hubballi', 'Hubli'],
  VSKP: ['Visakhapatnam', 'Visakhapatnam'], BZA: ['Vijayawada', 'Vijayawada'], ST: ['Surat', 'Surat'], BRC: ['Vadodara', 'Vadodara'],
  RJT: ['Rajkot', 'Rajkot'], NK: ['Nashik Road', 'Nashik'], R: ['Raipur', 'Raipur'], RNC: ['Ranchi', 'Ranchi'],
  GKP: ['Gorakhpur', 'Gorakhpur'], MTJ: ['Mathura', 'Mathura'], SVDK: ['Katra', 'Katra'], KGM: ['Kathgodam', 'Kathgodam'],
}

/** Common airports: [airport city as said, city]. */
const AIRPORTS: Record<string, [string, string]> = {
  DEL: ['Delhi', 'Delhi'], BOM: ['Mumbai', 'Mumbai'], BLR: ['Bengaluru', 'Bengaluru'], MAA: ['Chennai', 'Chennai'],
  CCU: ['Kolkata', 'Kolkata'], HYD: ['Hyderabad', 'Hyderabad'], AMD: ['Ahmedabad', 'Ahmedabad'], PNQ: ['Pune', 'Pune'],
  GOI: ['Goa', 'Goa'], GOX: ['Goa', 'Goa'], COK: ['Kochi', 'Kochi'], TRV: ['Thiruvananthapuram', 'Thiruvananthapuram'],
  JAI: ['Jaipur', 'Jaipur'], LKO: ['Lucknow', 'Lucknow'], PAT: ['Patna', 'Patna'], IXC: ['Chandigarh', 'Chandigarh'],
  ATQ: ['Amritsar', 'Amritsar'], GAU: ['Guwahati', 'Guwahati'], BBI: ['Bhubaneswar', 'Bhubaneswar'], NAG: ['Nagpur', 'Nagpur'],
  IDR: ['Indore', 'Indore'], VNS: ['Varanasi', 'Varanasi'], SXR: ['Srinagar', 'Srinagar'], IXB: ['Bagdogra', 'Siliguri'],
  IXR: ['Ranchi', 'Ranchi'], RPR: ['Raipur', 'Raipur'], VTZ: ['Visakhapatnam', 'Visakhapatnam'], CJB: ['Coimbatore', 'Coimbatore'],
  IXE: ['Mangaluru', 'Mangalore'], IXM: ['Madurai', 'Madurai'], TRZ: ['Tiruchirappalli', 'Tiruchirappalli'], UDR: ['Udaipur', 'Udaipur'],
  JDH: ['Jodhpur', 'Jodhpur'], BHO: ['Bhopal', 'Bhopal'], DED: ['Dehradun', 'Dehradun'], IXJ: ['Jammu', 'Jammu'],
  IXL: ['Leh', 'Leh'], IXZ: ['Port Blair', 'Port Blair'], STV: ['Surat', 'Surat'], BDQ: ['Vadodara', 'Vadodara'],
  VGA: ['Vijayawada', 'Vijayawada'], CCJ: ['Kozhikode', 'Kozhikode'], HBX: ['Hubballi', 'Hubli'], AYJ: ['Ayodhya', 'Ayodhya'],
  DXB: ['Dubai', 'Dubai'], AUH: ['Abu Dhabi', 'Abu Dhabi'], DOH: ['Doha', 'Doha'], SIN: ['Singapore', 'Singapore'],
  BKK: ['Bangkok', 'Bangkok'], KUL: ['Kuala Lumpur', 'Kuala Lumpur'], LHR: ['London', 'London'], CDG: ['Paris', 'Paris'],
  JFK: ['New York', 'New York'], SFO: ['San Francisco', 'San Francisco'], CMB: ['Colombo', 'Colombo'], KTM: ['Kathmandu', 'Kathmandu'],
  DPS: ['Bali', 'Bali'], MLE: ['Male', 'Maldives'],
}

const AIRLINES: Record<string, string> = {
  '6E': 'IndiGo', AI: 'Air India', IX: 'Air India Express', SG: 'SpiceJet', QP: 'Akasa Air', UK: 'Vistara', I5: 'AIX Connect',
  G8: 'Go First', EK: 'Emirates', QR: 'Qatar Airways', EY: 'Etihad', SQ: 'Singapore Airlines', TG: 'Thai Airways',
  LH: 'Lufthansa', BA: 'British Airways', UL: 'SriLankan',
}

const PLATFORMS: [RegExp, string][] = [
  [/\birctc\b/i, 'IRCTC'],
  [/\bindigo\b/i, 'IndiGo'],
  [/\bair india express\b/i, 'Air India Express'],
  [/\bair india\b/i, 'Air India'],
  [/\bspicejet\b/i, 'SpiceJet'],
  [/\bakasa\b/i, 'Akasa Air'],
  [/\bmakemytrip\b|\bmmt\b/i, 'MakeMyTrip'],
  [/\bgoibibo\b/i, 'Goibibo'],
  [/\bcleartrip\b/i, 'Cleartrip'],
  [/\beasemytrip\b/i, 'EaseMyTrip'],
  [/\bixigo\b/i, 'ixigo'],
  [/\byatra\b/i, 'Yatra'],
  [/\bredbus\b/i, 'redBus'],
  [/\babhibus\b/i, 'AbhiBus'],
  [/\bbooking\.com\b/i, 'Booking.com'],
  [/\bagoda\b/i, 'Agoda'],
  [/\boyo\b/i, 'OYO'],
  [/\bairbnb\b/i, 'Airbnb'],
  [/\bbookmyshow\b/i, 'BookMyShow'],
  [/\bdistrict\b|\bpaytm insider\b/i, 'District'],
  [/\bpvr\b/i, 'PVR'],
  [/\binox\b/i, 'INOX'],
  [/\bcinepolis\b/i, 'Cinépolis'],
  [/\bpracto\b/i, 'Practo'],
  [/\bapollo\b/i, 'Apollo'],
  [/\burban company\b/i, 'Urban Company'],
  [/\bdineout\b/i, 'Dineout'],
]

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*`

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

interface Found {
  /** Midnight of the day, local. */
  day: Date
  at: number
}

/** Every date written in the message, in order: "15-10-26", "15 Oct 2026", "Wed, Oct 15". */
function datesIn(text: string, now: Date): Found[] {
  const out: Found[] = []
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const year = (y: string | undefined, m: number, d: number) => {
    if (y) return Number(y.length === 2 ? `20${y}` : y)
    const thisYear = new Date(today.getFullYear(), m, d)
    return thisYear.getTime() < today.getTime() - 30 * 86_400_000 ? today.getFullYear() + 1 : today.getFullYear()
  }
  const add = (d: number, m: number, y: string | undefined, at: number) => {
    if (m < 0 || m > 11 || d < 1 || d > 31) return
    const dt = new Date(year(y, m, d), m, d)
    if (dt.getMonth() === m) out.push({ day: dt, at })
  }
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g)) add(Number(m[1]), Number(m[2]) - 1, m[3], m.index!)
  for (const m of text.matchAll(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s-]*${MONTH}[\s,'-]*(\d{4}|\d{2}(?!\s*:|\d))?`, 'gi')))
    add(Number(m[1]), MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3)), m[3], m.index!)
  for (const m of text.matchAll(new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, 'gi')))
    add(Number(m[2]), MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3)), m[3], m.index!)
  return out.sort((a, b) => a.at - b.at)
}

/** A time of day near a word that says what it is for, else the first one. */
function timeIn(text: string, near?: RegExp): { h: number; m: number } | null {
  const T = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|hrs|hours)?`
  const read = (m: RegExpExecArray | null) => {
    if (!m) return null
    let h = Number(m[1])
    const min = m[2] ? Number(m[2]) : 0
    const mer = m[3]?.toLowerCase()
    // A bare number with no colon and no am/pm is not a time: "B2 45".
    if (!m[2] && !mer) return null
    if (mer === 'pm' && h < 12) h += 12
    if (mer === 'am' && h === 12) h = 0
    return h <= 23 && min <= 59 ? { h, m: min } : null
  }
  if (near) {
    // "Departure* : 17:00", "Dep 06:15", "Reporting time 21:30".
    const m = new RegExp(String.raw`(?:${near.source})[\s*]*(?:time)?[\s*]*(?:is|at|:|-)?\s*${T}`, 'i').exec(text)
    const t = read(m)
    if (t) return t
  }
  // 4-digit 24-hour times: "1700 hrs".
  const compact = /\b([01]\d|2[0-3])([0-5]\d)\s*hrs\b/i.exec(text)
  if (compact) return { h: Number(compact[1]), m: Number(compact[2]) }
  for (const m of text.matchAll(new RegExp(String.raw`\b${T}\b`, 'gi'))) {
    const t = read(m as RegExpExecArray)
    if (t) return t
  }
  return null
}

const at = (day: Date, t: { h: number; m: number } | null, fallbackHour: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), t ? t.h : fallbackHour, t ? t.m : 0)

const provider = (text: string) => PLATFORMS.find(([re]) => re.test(text))?.[1] ?? null

function train(text: string, now: Date): ParsedBooking | null {
  const pnr = /\bPNR\s*(?:no\.?|number)?\s*[:-]?\s*(\d{10})\b/i.exec(text)?.[1] ?? null
  // "TRN:12951" in a message, "Train No./Name : 12951/MUMBAI RAJDHANI" in the e-ticket.
  const trn =
    /\b(?:TRN|TRAIN)\s*(?:no\.?|number)?\s*[:-]?\s*(\d{5})\b/i.exec(text)?.[1] ?? /\btrain\b[^\d]{0,20}?(\d{5})\b/i.exec(text)?.[1] ?? null
  if (!pnr || (!trn && !/\b(?:irctc|doj|train)\b/i.test(text))) return null
  const doj =
    /\bDOJ\s*[:-]?\s*([^,;]+)/i.exec(text)?.[1] ?? /\b(?:date of journey|journey date)\s*[:-]?\s*([^,;]+)/i.exec(text)?.[1] ?? text
  const date = datesIn(doj, now)[0] ?? datesIn(text, now)[0]
  if (!date) return null
  // "From : MUMBAI CENTRAL (MMCT) … To : NEW DELHI (NDLS)" in the e-ticket, "MMCT-NDLS" in a message.
  const route =
    /\bfrom\b[\s:]*[^()]{0,40}\(([A-Z]{2,5})\)[\s\S]{0,200}?\bto\b[\s:]*[^()]{0,40}\(([A-Z]{2,5})\)/i.exec(text) ??
    /\b([A-Z]{1,5})\s*(?:-|to|→)\s*([A-Z]{1,5})\b/.exec(text.replace(/\bPNR\b|\bTRN\b|\bDOJ\b|\bDP\b/g, ' '))
  const fromCode = route?.[1] ?? null
  const toCode = route?.[2] ?? null
  const from = fromCode ? (STATIONS[fromCode]?.[0] ?? fromCode) : null
  const to = toCode ? (STATIONS[toCode]?.[0] ?? toCode) : null
  const time = timeIn(text, /\b(?:DP|DEP|Dept?|Departure|Departs?)\b/)
  const cls = /\b(1A|2A|3A|3E|SL|CC|EC|2S|FC|EA)\b/.exec(text)?.[1] ?? null
  const seat = /\b((?:[ABHS]|CC|EC|C|D|E|M|GS)\d{1,2})[\s,/-]+(\d{1,3})\b/.exec(text)
  const wl = /\b((?:GN|PQ|RL|TQ|CK)?WL|RAC|RLWL|PQWL)\s*[:/-]?\s*(\d{1,3})\b/i.exec(text)
  const notes = [
    `PNR ${pnr}`,
    cls,
    seat ? `${seat[1]} ${seat[2]}` : null,
    wl ? `Waitlisted (${wl[1]!.toUpperCase()} ${wl[2]}): check the chart before you go` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    type: 'train',
    title: [`Train${trn ? ` ${trn}` : ''}`, from && to ? `${from} → ${to}` : null].filter(Boolean).join(' · '),
    startsAt: at(date.day, time, 8),
    timeKnown: Boolean(time),
    endsOn: null,
    city: toCode ? (STATIONS[toCode]?.[1] ?? null) : null,
    from,
    ref: pnr,
    notes,
    provider: 'IRCTC',
    durationMinutes: 60,
    remindBeforeMinutes: 120,
  }
}

function flight(text: string, now: Date): ParsedBooking | null {
  const fl = /\b(6E|AI|IX|SG|QP|UK|I5|G8|EK|QR|EY|SQ|TG|LH|BA|UL)\s?-?\s?(\d{2,4})\b/.exec(text)
  const named = /\b(?:indigo|air india|spicejet|akasa|vistara|emirates|qatar|etihad)\b/i.test(text)
  const flighty = /\b(?:flight|boarding|departure|depart|terminal|e-?ticket|itinerary|pnr)\b/i.test(text)
  if (!(fl || named) || !flighty) return null
  const date = datesIn(text, now)[0]
  if (!date) return null
  // "BLR-DEL" in a message, "Bengaluru (BLR) → Delhi (DEL)" in an itinerary.
  const route =
    /\b([A-Z]{3})\s*(?:-|–|—|→|to)\s*([A-Z]{3})\b/.exec(text) ?? /\(([A-Z]{3})\)[^()]{0,40}?\(([A-Z]{3})\)/.exec(text)
  const fromCode = route && AIRPORTS[route[1]!] ? route[1]! : null
  const toCode = route && AIRPORTS[route[2]!] ? route[2]! : null
  const from = fromCode ? AIRPORTS[fromCode]![0] : null
  const to = toCode ? AIRPORTS[toCode]![0] : null
  const time = timeIn(text, /\b(?:dep(?:arture|arts?)?|std|boarding|at)\b/)
  const pnr = /\bPNR\s*(?:is|no\.?|number)?\s*[:-]?\s*([A-Z0-9]{6})\b/i.exec(text)?.[1] ?? /\bbooking (?:ref(?:erence)?|id)\s*[:-]?\s*([A-Z0-9]{6,})\b/i.exec(text)?.[1] ?? null
  const airline = fl ? (AIRLINES[fl[1]!] ?? null) : provider(text)
  const number = fl ? `${fl[1]} ${fl[2]}` : null
  return {
    type: 'flight',
    title: [`Flight${number ? ` ${number}` : ''}`, from && to ? `${from} → ${to}` : null].filter(Boolean).join(' · '),
    startsAt: at(date.day, time, 8),
    timeKnown: Boolean(time),
    endsOn: null,
    city: toCode ? AIRPORTS[toCode]![1] : null,
    from,
    ref: pnr,
    notes: [pnr ? `PNR ${pnr}` : null, airline].filter(Boolean).join(' · ') || null,
    provider: airline,
    durationMinutes: 120,
    remindBeforeMinutes: 180,
  }
}

/** "from Pune to Goa": two places, either known cities or words with capitals. */
function fromTo(text: string): { from: string; to: string } | null {
  const m = /\bfrom\s+([A-Z][A-Za-z .]{1,30}?)\s+to\s+([A-Z][A-Za-z .]{1,30}?)(?=\s+(?:on|for|at|dated|departing|,)|[,.]|$)/.exec(text)
  return m ? { from: m[1]!.trim(), to: m[2]!.trim() } : null
}

function bus(text: string, now: Date): ParsedBooking | null {
  if (!/\b(?:redbus|abhibus|bus|volvo|sleeper|seater|travels)\b/i.test(text) || !/\b(?:booking|ticket|confirmed|seat|boarding|reporting)\b/i.test(text)) return null
  const date = datesIn(text, now)[0]
  if (!date) return null
  const route = fromTo(text)
  const time = timeIn(text, /\b(?:reporting|boarding|departure|dep)\b/)
  const ref = /\b(?:ticket|booking|pnr)\s*(?:no\.?|id|number)?\s*[:-]?\s*([A-Z0-9]{6,})\b/i.exec(text)?.[1] ?? null
  const seat = /\bseats?\s*(?:no\.?)?\s*[:-]?\s*([A-Z]?\d{1,2}(?:\s*,\s*[A-Z]?\d{1,2})*)/i.exec(text)?.[1] ?? null
  const boarding = /\bboarding (?:point|at)\s*[:-]?\s*([^,.;]+)/i.exec(text)?.[1]?.trim() ?? null
  return {
    type: 'bus',
    title: ['Bus', route ? `${route.from} → ${route.to}` : null].filter(Boolean).join(' · '),
    startsAt: at(date.day, time, 20),
    timeKnown: Boolean(time),
    endsOn: null,
    city: route?.to ?? null,
    from: route?.from ?? null,
    ref,
    notes: [ref ? `Ticket ${ref}` : null, seat ? `Seat ${seat}` : null, boarding ? `Boarding: ${boarding}` : null].filter(Boolean).join(' · ') || null,
    provider: provider(text),
    durationMinutes: 60,
    remindBeforeMinutes: 90,
  }
}

function hotel(text: string, now: Date): ParsedBooking | null {
  if (!/\bcheck[- ]?in\b/i.test(text) || !/\b(?:hotel|resort|stay|room|booking|reservation|oyo|airbnb|agoda|booking\.com)\b/i.test(text)) return null
  const checkInAt = /\bcheck[- ]?in\b/i.exec(text)!.index
  const dates = datesIn(text, now)
  const checkIn = dates.find((d) => d.at >= checkInAt) ?? dates[0]
  if (!checkIn) return null
  const outAt = /\bcheck[- ]?out\b/i.exec(text)?.index
  const checkOut = outAt !== undefined ? dates.find((d) => d.at >= outAt) : dates.find((d) => d !== checkIn && d.day > checkIn.day)
  const time = timeIn(text.slice(checkInAt, outAt ?? undefined), /\bcheck[- ]?in\b/)
  const name =
    /\b(?:at|stay at|booking at|reservation at)\s+((?:hotel\s+)?[A-Z][\w&'. -]{2,50}?)(?=\s+(?:is|has|for|from|on|in)\b|[,.]|$)/.exec(text)?.[1]?.trim() ??
    /\b(hotel\s+[A-Z][\w&'. -]{2,40}?)(?=\s+(?:is|has|for|from|on|in)\b|[,.]|$)/i.exec(text)?.[1]?.trim() ??
    null
  const ref = /\b(?:booking|confirmation|reservation)\s*(?:id|no\.?|number|code)?\s*[:#-]?\s*([A-Z0-9-]{6,})\b/i.exec(text)?.[1] ?? null
  return {
    type: 'hotel',
    title: name ? `Check in: ${name}` : 'Hotel check-in',
    startsAt: at(checkIn.day, time, 14),
    timeKnown: Boolean(time),
    endsOn: checkOut ? ymd(checkOut.day) : null,
    city: null,
    from: null,
    ref,
    notes: [ref ? `Booking ${ref}` : null, checkOut ? `Check out ${checkOut.day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}` : null]
      .filter(Boolean)
      .join(' · ') || null,
    provider: provider(text),
    durationMinutes: 30,
    remindBeforeMinutes: 300,
  }
}

function show(text: string, now: Date): ParsedBooking | null {
  if (!/\b(?:bookmyshow|district|insider|pvr|inox|cinepolis|movie|film|screen|show|concert|event|match|tickets?)\b/i.test(text)) return null
  if (!/\b(?:booked|confirmed|booking|tickets?)\b/i.test(text)) return null
  const date = datesIn(text, now)[0]
  const time = timeIn(text, /\b(?:show ?time|starts?|at)\b/)
  if (!date || !time) return null
  const what = /\btickets?\s+(?:for|to)\s+['"‘“]?(.+?)['"’”]?\s+(?:at|on|is|are|has|have)\b/i.exec(text)?.[1]?.trim() ?? null
  const venue = /\bat\s+([A-Z][\w&'. -]{2,50}?)(?=\s*(?:,|on|for|screen|\(|\.|$))/.exec(text)?.[1]?.trim() ?? null
  const screen = /\b(screen|audi|audi\.?)\s*[:-]?\s*(\w+)/i.exec(text)
  const seats = /\bseats?\s*[:-]?\s*([A-Z]{1,2}\d{1,3}(?:\s*,\s*[A-Z]{1,2}\d{1,3})*)/i.exec(text)?.[1] ?? null
  const ref = /\bbooking\s*(?:id|no\.?|code)\s*[:#-]?\s*([A-Z0-9]{6,})\b/i.exec(text)?.[1] ?? null
  return {
    type: 'show',
    title: [what, venue ? `at ${venue}` : null].filter(Boolean).join(' ') || `${provider(text) ?? 'Show'} booking`,
    startsAt: at(date.day, time, 19),
    timeKnown: true,
    endsOn: null,
    city: null,
    from: null,
    ref,
    notes: [screen ? `${screen[1]![0]!.toUpperCase()}${screen[1]!.slice(1).toLowerCase()} ${screen[2]}` : null, seats ? `Seats ${seats}` : null, ref ? `Booking ${ref}` : null]
      .filter(Boolean)
      .join(' · ') || null,
    provider: provider(text),
    durationMinutes: 150,
    remindBeforeMinutes: 60,
  }
}

function appointment(text: string, now: Date): ParsedBooking | null {
  if (!/\bappointment\b/i.test(text) || !/\b(?:confirmed|booked|scheduled|fixed)\b/i.test(text)) return null
  const date = datesIn(text, now)[0]
  const time = timeIn(text, /\bat\b/)
  if (!date || !time) return null
  const who = /\bappointment\s+with\s+((?:Dr\.?\s+)?[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,3})/.exec(text)?.[1]?.trim() ?? null
  const where = /\bat\s+([A-Z][\w&'. -]{2,50}?)(?=\s*(?:,|on|\.|$))/.exec(text)?.[1]?.trim() ?? null
  return {
    type: 'appointment',
    title: who ? `Appointment with ${who}` : `${provider(text) ?? 'Appointment'}${where ? ` at ${where}` : ''}`,
    startsAt: at(date.day, time, 10),
    timeKnown: true,
    endsOn: null,
    city: null,
    from: where,
    ref: /\b(?:booking|appointment)\s*(?:id|no\.?)\s*[:#-]?\s*([A-Z0-9]{5,})\b/i.exec(text)?.[1] ?? null,
    notes: where && who ? `At ${where}` : null,
    provider: provider(text),
    durationMinutes: 30,
    remindBeforeMinutes: 60,
  }
}

function other(text: string, now: Date): ParsedBooking | null {
  if (!/\b(?:booking|reservation|table|order)\s+(?:is\s+|has been\s+)?confirmed\b|\bconfirmed\s+(?:booking|reservation)\b|\byour booking\b/i.test(text)) return null
  const date = datesIn(text, now)[0]
  const time = timeIn(text, /\bat\b/)
  if (!date || !time) return null
  const p = provider(text)
  const where = /\bat\s+([A-Z][\w&'. -]{2,50}?)(?=\s*(?:,|on|for|\.|$))/.exec(text)?.[1]?.trim() ?? null
  return {
    type: 'other',
    title: where ? `Booking at ${where}` : `${p ?? 'Booking'}`,
    startsAt: at(date.day, time, 10),
    timeKnown: true,
    endsOn: null,
    city: null,
    from: where,
    ref: /\bbooking\s*(?:id|no\.?|ref)\s*[:#-]?\s*([A-Z0-9]{5,})\b/i.exec(text)?.[1] ?? null,
    notes: p,
    provider: p,
    durationMinutes: 60,
    remindBeforeMinutes: 60,
  }
}

/**
 * Reads a booking confirmation, or null for anything else. Ordered from the
 * most particular — a PNR and a train number can only be a train — to the
 * most general, so a hotel near a station is still a hotel.
 */
export function parseBooking(input: string, now = new Date()): ParsedBooking | null {
  const text = input.replace(/\s+/g, ' ').trim()
  if (text.length < 20) return null
  for (const read of [train, flight, hotel, bus, show, appointment, other]) {
    const b = read(text, now)
    if (b) return b
  }
  return null
}

/** "3 hours", "90 minutes", "the morning of" — how long before the reminder goes. */
export function leadLabel(minutes: number): string {
  if (minutes >= 300) return 'that morning'
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'} before`
  return `${minutes} minutes before`
}
