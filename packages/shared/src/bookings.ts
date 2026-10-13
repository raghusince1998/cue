/**
 * Bookings, read from the confirmations that IRCTC, airlines, bus and hotel
 * sites, cinemas and clinics send: when it is, where, and the reference to
 * show at the gate. None of them lets another app read a traveller's
 * bookings, but every one of them sends this message, and it says enough.
 */
import { parseWhen } from './parseWhen.ts'

export type BookingType = 'train' | 'flight' | 'bus' | 'hotel' | 'show' | 'appointment' | 'service' | 'other'

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
  /**
   * The city it leaves from, when the station or airport says: what tells a
   * journey home from a journey out, so the way back joins the same trip.
   */
  fromCity?: string | null
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

// ------------------------------------------------- reading a ticket's parts

/** "MUMBAI CENTRAL" → "Mumbai Central", keeping the abbreviations stations use. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Ksr|Smvt|Csmt|Ltt|Sf|Ac)\b/g, (w) => w.toUpperCase())
}

/** Quotas, classes and statuses written the way stations are: "GENERAL (GN)", "SLEEPER CLASS (SL)". */
const NOT_A_PLACE =
  /\b(?:class|tier|quota|general|tatkal|premium|ladies|senior|chair car|sleeper|first ac|second ac|third ac|economy|business|executive|berth|divyaang|passenger|adult|child|infant|reservation|slip|ticket|transaction|booking|amount|fare|charges?|fees?|insurance|refund)\b/i
const NOT_A_PLACE_CODE = new Set(['GN', 'TQ', 'PT', 'LD', 'SS', 'HP', 'DF', 'PH', 'YU', 'SL', 'CC', 'EC', 'EA', 'FC', 'EV', 'VS', 'CNF', 'RAC', 'WL', 'INR', 'GST', 'PNR'])
/** Words that lead into a place without being part of its name. */
const LEAD_IN = /^(?:(?:from|to|at|via|and|the|in|for|departure|arrival|boarding|booked|origin|destination|departs?|arrives?|depart(?:ing)?|arriv(?:ing)?|station)\s+)+/i

interface Place {
  /** As the message writes it: "MUMBAI CENTRAL", "Pune Jn". */
  name: string
  code: string
  at: number
}

/** Every "NAME (CODE)" in order: how tickets and itineraries name stations and airports. */
function namedPlaces(text: string): Place[] {
  const out: Place[] = []
  for (const m of text.matchAll(/([A-Za-z][A-Za-z.']*(?:[ -][A-Za-z][A-Za-z.']*){0,4})\s*\(([A-Z]{2,5})\)/g)) {
    const name = m[1]!.replace(LEAD_IN, '').trim()
    const code = m[2]!
    if (!name || NOT_A_PLACE.test(name) || NOT_A_PLACE_CODE.has(code)) continue
    // Where the name itself starts, so the label just before it can be read.
    out.push({ name, code, at: m.index! + m[1]!.indexOf(name) })
  }
  return out
}

/** The label a place sits under, if any: "Booked From: …", "Boarding At: …", "To: …". */
function labelOf(text: string, place: Place): 'from' | 'boarding' | 'to' | null {
  const before = text.slice(Math.max(0, place.at - 30), place.at)
  if (/\bboarding(?:\s+(?:at|station|point))?\s*[:|-]?\s*$/i.test(before)) return 'boarding'
  if (/\b(?:booked\s+from|from|source|origin)\s*[:|-]?\s*$/i.test(before)) return 'from'
  if (/\b(?:to|upto|destination|reservation\s+upto)\s*[:|-]?\s*$/i.test(before)) return 'to'
  return null
}

/** Where a journey starts and ends, and where it is boarded when that differs. */
function routeOf(text: string, isKnown: (code: string) => boolean): { from: Place | null; to: Place | null; boarding: Place | null } {
  const places = namedPlaces(text).filter((p) => isKnown(p.code) || p.name.length >= 3)
  const labelled = (which: 'from' | 'boarding' | 'to') => places.find((p) => labelOf(text, p) === which) ?? null
  const unique = places.filter((p, i) => places.findIndex((q) => q.code === p.code) === i)
  const from = labelled('from') ?? unique[0] ?? null
  const to = labelled('to') ?? (unique.length >= 2 ? unique[unique.length - 1]! : null)
  const boarding = labelled('boarding')
  return {
    from,
    to: to && from && to.code === from.code ? null : to,
    boarding: boarding && from && boarding.code !== from.code ? boarding : null,
  }
}

/** The date and the time written after a label, on its own line: "Departure* 17:00 17-Oct-2026". */
function afterLabel(text: string, label: RegExp, now: Date): { day: Date | null; time: { h: number; m: number } | null } | null {
  const m = label.exec(text)
  if (!m) return null
  const line = text.slice(m.index + m[0].length).split('\n')[0]!.slice(0, 90)
  const day = datesIn(line, now)[0]?.day ?? null
  const time = timeIn(line)
  return day || time ? { day, time } : null
}

/** The date and time written just after a place, before the next place begins. */
function afterPlace(text: string, place: Place, next: Place | null, now: Date) {
  const end = next && next.at > place.at ? next.at : place.at + 120
  const span = text.slice(place.at, Math.min(end, place.at + 120))
  return { day: datesIn(span, now)[0]?.day ?? null, time: timeIn(span) }
}

/** The clock time nearest a point in the text, on either side: "07:00, BLR" and "BLR 07:00" alike. */
function timeNear(text: string, index: number): { h: number; m: number } | null {
  const from = Math.max(0, index - 40)
  const window = text.slice(from, index + 100)
  let best: { t: { h: number; m: number }; d: number } | null = null
  for (const m of window.matchAll(/\b(\d{1,2})[:.](\d{2})\s*(am|pm|hrs)?\b/gi)) {
    let h = Number(m[1])
    const min = Number(m[2])
    if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12
    if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0
    if (h > 23 || min > 59) continue
    const d = Math.abs(from + m.index! - index)
    if (!best || d < best.d) best = { t: { h, m: min }, d }
  }
  return best?.t ?? null
}

/** A date that is not when it was booked: "Booking Date: 12-Oct-2026" is not the journey. */
function journeyDay(text: string, now: Date): Date | null {
  const dates = datesIn(text, now)
  return (
    dates.find((d) => !/\b(?:booking date|booked on|booking time|transaction|issued on|invoice date|order date)\b[^\n]{0,25}$/i.test(text.slice(Math.max(0, d.at - 40), d.at)))
      ?.day ?? null
  )
}

const clockLabelOf = (t: { h: number; m: number }) =>
  `${t.h % 12 === 0 ? 12 : t.h % 12}${t.m ? `:${String(t.m).padStart(2, '0')}` : ''} ${t.h < 12 ? 'am' : 'pm'}`
const dayLabelOf = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

// ------------------------------------------------------------------- trains

const TRAIN_KIND =
  'Express|Exp|Mail|Rajdhani|Shatabdi|Duronto|SF|Superfast|Vande Bharat|Garib Rath|Humsafar|Tejas|Passenger|Special|Spl|Intercity|Jan Shatabdi|Sampark Kranti|Antyodaya|Double Decker|Link|Memu|Demu'

/** The train's number and its name: "12951/MUMBAI RAJDHANI", "12779 Goa Express", "TRN:12951". */
function trainOf(text: string): { number: string | null; name: string | null } {
  const named = (raw: string) =>
    titleCase(raw.trim())
      .replace(/\bExp\b\.?/, 'Express')
      .replace(/\bSpl\b\.?/, 'Special')
  // The name ends where the next field begins: a line break, a bar, or the
  // next label on the same line ("… RAJDHANI Class : AC 3 TIER").
  let m = /\b(\d{5})\s*\/\s*([A-Z][A-Z0-9 .'-]{2,40}?)(?=\s*(?:\||\n|,|$)|\s{2,}|\s+(?:AC|SLEEPER|CLASS|Class|SECOND|FIRST|THIRD|Quota|QUOTA|From|FROM|Date|DOJ)\b)/.exec(text)
  if (m) return { number: m[1]!, name: named(m[2]!) }
  m = new RegExp(String.raw`\b(\d{5})\s+((?:[A-Za-z][A-Za-z.]*\s+){0,4}(?:${TRAIN_KIND}))\b`, 'i').exec(text)
  if (m) return { number: m[1]!, name: named(m[2]!) }
  m = /\b(?:TRN|TRAIN)\s*(?:no\.?|number|#)?\s*[:-]?\s*(\d{5})\b/i.exec(text) ?? /\btrain\b[^\d\n]{0,20}?(\d{5})\b/i.exec(text)
  return { number: m?.[1] ?? null, name: null }
}

const CLASSES = '1A|2A|3A|3E|SL|CC|EC|2S|FC|EA|EV'

/** Where everyone is sitting, or how far down the waiting list they are. */
function seatsOf(text: string): { seats: string[]; waiting: string | null } {
  const seats: string[] = []
  let waiting: string | null = null
  const STATUS = /\b(CNF|RAC|GNWL|RLWL|PQWL|TQWL|RSWL|CKWL|WL)\s*\/?\s*(?:([A-Z]{1,2}\d{1,2})\s*\/\s*)?(\d{1,3})(?:\s*\/\s*(SIDE LOWER|SIDE UPPER|LOWER|MIDDLE|UPPER|WINDOW SIDE|WINDOW|AISLE|NO CHOICE))?/gi
  // One passenger to a line; the last status on it is the current one. A
  // ticket laid out as labels says which: only "Current Status" counts.
  const lines = text.split('\n')
  const current = lines.filter((l) => /\bcurrent status\b/i.test(l))
  for (const line of current.length > 0 ? current : lines) {
    const found = [...line.matchAll(STATUS)]
    const now = found[found.length - 1]
    if (!now) continue
    const status = now[1]!.toUpperCase()
    if (status === 'CNF' && now[2]) seats.push([now[2], now[3], now[4] ? titleCase(now[4]) : null].filter(Boolean).join(' '))
    else if (status !== 'CNF') waiting ??= `${status} ${now[3]}`
  }
  if (seats.length === 0 && !waiting) {
    // A message: "B2 45,B2 46".
    for (const m of text.matchAll(/\b((?:[ABHS]|CC|EC|C|D|E|M|GS)\d{1,2})[\s,/-]+(\d{1,3})\b/g)) seats.push(`${m[1]} ${m[2]}`)
  }
  return { seats: [...new Set(seats)], waiting }
}

function stationName(p: Place): string {
  return STATIONS[p.code]?.[0] ?? titleCase(p.name)
}
function stationCity(p: Place): string {
  return STATIONS[p.code]?.[1] ?? cityIn(p.name) ?? titleCase(p.name.replace(/\b(?:jn|junction|central|cantt|terminus|city|road|station)\b\.?/gi, '').trim()) ?? p.code
}

function train(text: string, now: Date): ParsedBooking | null {
  const pnr = /\bPNR\b[^\d\n]{0,30}?(\d{10})\b/i.exec(text)?.[1] ?? /\bPNR\b[\s\S]{0,60}?\b(\d{10})\b/i.exec(text)?.[1] ?? null
  const { number, name } = trainOf(text)
  if (!pnr || (!number && !/\b(?:irctc|doj|train|rail)\b/i.test(text))) return null

  let { from, to, boarding } = routeOf(text, (code) => Boolean(STATIONS[code]))
  // Named in the text, "MUMBAI CENTRAL (MMCT)": what follows a name is its time.
  const named = Boolean(from && to)
  if (!from || !to) {
    // A message: "MMCT-NDLS".
    const codes = /\b([A-Z]{2,5})\s*(?:-|to|→)\s*([A-Z]{2,5})\b/.exec(text.replace(/\bPNR\b|\bTRN\b|\bDOJ\b|\bDP\b|\bIRCTC\b/g, ' '))
    if (codes) {
      from = { name: STATIONS[codes[1]!]?.[0] ?? codes[1]!, code: codes[1]!, at: codes.index }
      to = { name: STATIONS[codes[2]!]?.[0] ?? codes[2]!, code: codes[2]!, at: codes.index + codes[0].length }
      boarding = null
    }
  }

  // When it leaves: said after "Departure", or beside the station it leaves from.
  const dep = afterLabel(text, /\b(?:departure|dep|dp|departs?)\b\*?\s*[:-]?/i, now)
  const start = afterLabel(text, /\b(?:start date|doj|date of journey|journey date)\b\*?\s*[:-]?/i, now)
  const beside = named && from ? afterPlace(text, from, to, now) : null
  const day = dep?.day ?? start?.day ?? beside?.day ?? journeyDay(text, now)
  if (!day) return null
  const time = dep?.time ?? beside?.time ?? null
  const arr = afterLabel(text, /\b(?:arrival|arr|arrives?)\b\*?\s*[:-]?/i, now) ?? (named && to ? afterPlace(text, to, null, now) : null)

  const cls =
    new RegExp(String.raw`\((${CLASSES})\)`).exec(text)?.[1] ??
    new RegExp(String.raw`\bclass\b\s*[:-]?\s*(${CLASSES})\b`, 'i').exec(text)?.[1] ??
    new RegExp(String.raw`,\s*(${CLASSES})\s*,`).exec(text)?.[1] ??
    new RegExp(String.raw`\b(${CLASSES.replace('|SL', '')})\b`).exec(text)?.[1] ??
    null
  const { seats, waiting } = seatsOf(text)
  const fromName = from ? stationName(from) : null
  const toName = to ? stationName(to) : null
  const notes = [
    `PNR ${pnr}`,
    cls,
    seats.length ? seats.join(', ') : null,
    waiting ? `Waitlisted (${waiting}): check the chart before you go` : null,
    boarding ? `Board at ${stationName(boarding)}` : null,
    arr?.time && toName ? `Arrives ${toName} ${clockLabelOf(arr.time)}${arr.day ? `, ${dayLabelOf(arr.day)}` : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    type: 'train',
    title: [`Train${number ? ` ${number}` : ''}${name ? ` ${name}` : ''}`, fromName && toName ? `${fromName} → ${toName}` : null]
      .filter(Boolean)
      .join(' · '),
    startsAt: at(day, time, 8),
    timeKnown: Boolean(time),
    endsOn: null,
    city: to ? stationCity(to) : null,
    from: boarding ? stationName(boarding) : fromName,
    fromCity: from ? stationCity(from) : null,
    ref: pnr,
    notes,
    provider: /\birctc\b/i.test(text) ? 'IRCTC' : (provider(text) ?? 'IRCTC'),
    durationMinutes: 60,
    remindBeforeMinutes: 120,
  }
}

// ------------------------------------------------------------------ flights

const FLIGHT_NO = /\b(6E|AI|IX|SG|QP|UK|I5|G8|EK|QR|EY|SQ|TG|LH|BA|UL)\s?-?\s?(\d{2,4})\b/

/** The airports a flight goes between: "(BLR)", or a known code on its own, in order. */
function airportsOf(text: string): { code: string; at: number }[] {
  const out: { code: string; at: number }[] = []
  for (const m of text.matchAll(/\b([A-Z]{3})\b/g)) {
    if (!AIRPORTS[m[1]!]) continue
    // Not the letters of a PNR or a flight number.
    const around = text.slice(Math.max(0, m.index! - 2), m.index! + 5)
    if (/[A-Z0-9]{4,}/.test(around.replace(m[1]!, ''))) continue
    out.push({ code: m[1]!, at: m.index! })
  }
  return out
}

function flight(text: string, now: Date): ParsedBooking | null {
  const fl = FLIGHT_NO.exec(text)
  const named = /\b(?:indigo|air india|spicejet|akasa|vistara|emirates|qatar|etihad)\b/i.test(text)
  const flighty = /\b(?:flight|boarding|departure|depart|terminal|e-?ticket|itinerary|pnr)\b/i.test(text)
  if (!(fl || named) || !flighty) return null

  const airports = airportsOf(text)
  const fromAp = airports[0] ?? null
  const toAp = airports.find((a) => a.code !== fromAp?.code) ?? null
  let from = fromAp ? AIRPORTS[fromAp.code]![0] : null
  let to = toAp ? AIRPORTS[toAp.code]![0] : null
  let city = toAp ? AIRPORTS[toAp.code]![1] : null
  let fromCity = fromAp ? AIRPORTS[fromAp.code]![1] : null
  if (!from || !to) {
    // "Bengaluru → Goa", "Mumbai to Delhi": cities the lists know.
    const m = /\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s*(?:→|->|–|to)\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/.exec(text)
    if (m && cityIn(m[1]!) && cityIn(m[2]!)) {
      from = cityIn(m[1]!)
      to = cityIn(m[2]!)
      fromCity = from
      city = to
    }
  }

  // When it leaves: after "Departure", else the time beside the airport it leaves from.
  const dep = afterLabel(text, /\b(?:departure|departs?|dep|std)\b\*?\s*[:-]?/i, now)
  const day = dep?.day ?? (fromAp ? afterPlace(text, { name: '', code: fromAp.code, at: fromAp.at }, null, now).day : null) ?? journeyDay(text, now)
  if (!day) return null
  const time = dep?.time ?? (fromAp ? timeNear(text, fromAp.at) : null) ?? timeIn(text, /\b(?:boarding|at)\b/)
  const arr = afterLabel(text, /\b(?:arrival|arrives?|arr|sta)\b\*?\s*[:-]?/i, now)
  const arrTime = arr?.time ?? (toAp ? timeNear(text, toAp.at) : null)
  const terminal = fromAp ? /\bterminal\s*[:-]?\s*(T?\d[A-Z]?|[A-Z]\d?)\b/i.exec(text.slice(fromAp.at, fromAp.at + 140))?.[1] : null

  // "PNR: X7K2LM", "Your PNR is X7K2LM", "Booking Reference (PNR): 8HJ2KQ".
  const pnr =
    /\b(?:airline\s+pnr|pnr|booking\s+ref(?:erence)?(?:\s*\(pnr\))?)\b(?:\s*(?:is|no\.?|number|code|[:#-]))*\s*([A-Z0-9]{6})\b/i.exec(text)?.[1] ??
    /\bbooking\s+id\s*[:-]?\s*([A-Z0-9]{6,})\b/i.exec(text)?.[1] ??
    null
  const airline = fl ? (AIRLINES[fl[1]!] ?? null) : provider(text)
  const number = fl ? `${fl[1]} ${fl[2]}` : null
  return {
    type: 'flight',
    title: [`Flight${number ? ` ${number}` : ''}`, from && to ? `${from} → ${to}` : null].filter(Boolean).join(' · '),
    startsAt: at(day, time, 8),
    timeKnown: Boolean(time),
    endsOn: null,
    city,
    from,
    fromCity,
    ref: pnr,
    notes:
      [
        pnr ? `PNR ${pnr}` : null,
        airline,
        terminal ? `Terminal ${terminal.replace(/^T/i, '')}` : null,
        arrTime && to ? `Lands in ${to} ${clockLabelOf(arrTime)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
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
    fromCity: route?.from ?? null,
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
    // Not "hotel check-in …", which is the thing being described, not its name.
    /\b(hotel\s+(?!check)[A-Z][\w&'. -]{2,40}?)(?=\s+(?:is|has|for|from|on|in)\b|[,.]|$)/i.exec(text)?.[1]?.trim() ??
    null
  const ref = /\b(?:booking|confirmation|reservation)\s*(?:id|no\.?|number|code)?\s*[:#-]?\s*([A-Z0-9-]{6,})\b/i.exec(text)?.[1] ?? null
  const label = name ?? typedName(text)
  return {
    type: 'hotel',
    title: label ? `Check in: ${label}` : 'Hotel check-in',
    startsAt: at(checkIn.day, time, 14),
    timeKnown: Boolean(time),
    endsOn: checkOut ? ymd(checkOut.day) : null,
    // Only from a line someone typed. A confirmation email names cities in its
    // footer and its offers, and a wrong city is a wrong trip.
    city: text.length <= 120 ? cityIn(text) : null,
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

/** Every city the station and airport lists know, longest first so "New Delhi" beats "Delhi". */
const CITIES = [...new Set([...Object.values(STATIONS), ...Object.values(AIRPORTS)].map(([, city]) => city))].sort(
  (a, b) => b.length - a.length,
)

/** Old names people still say, to the name the lists use. */
const CITY_ALIASES: Record<string, string> = {
  bangalore: 'Bengaluru', bombay: 'Mumbai', madras: 'Chennai', calcutta: 'Kolkata', mysore: 'Mysuru',
  cochin: 'Kochi', trivandrum: 'Thiruvananthapuram', gurgaon: 'Gurugram', vizag: 'Visakhapatnam', poona: 'Pune',
  allahabad: 'Prayagraj', benaras: 'Varanasi', banaras: 'Varanasi',
}

/** A city named anywhere in a short line: "hotel check-in Taj Jaipur 10 Nov" is in Jaipur. */
export function cityIn(text: string): string | null {
  for (const [alias, city] of Object.entries(CITY_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(text)) return city
  }
  return CITIES.find((city) => new RegExp(`\\b${city.replace(/ /g, '\\s+')}\\b`, 'i').test(text)) ?? null
}

/** Cities outside India the airport list knows: a trip there wants a passport. */
const ABROAD = new Set(
  ['DXB', 'AUH', 'DOH', 'SIN', 'BKK', 'KUL', 'LHR', 'CDG', 'JFK', 'SFO', 'CMB', 'KTM', 'DPS', 'MLE'].map((code) =>
    AIRPORTS[code]![1].toLowerCase(),
  ),
)

export function isAbroad(city: string | null | undefined): boolean {
  return Boolean(city && ABROAD.has(city.trim().toLowerCase()))
}

/**
 * The same city, under either name: "Bangalore" is Bengaluru, "Bombay" is
 * Mumbai. A home city typed one way and a ticket printed the other must not
 * make a trip to where someone lives.
 */
export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const canon = (s: string) => {
    const said = s.trim().replace(/\s+/g, ' ').toLowerCase()
    return (CITY_ALIASES[said] ?? said).toLowerCase()
  }
  return canon(a) === canon(b)
}

/** A place as typed, under the name the lists use when they know it. */
function cityName(raw: string): string {
  const said = raw.trim().replace(/\s+/g, ' ')
  const known = CITY_ALIASES[said.toLowerCase()] ?? CITIES.find((c) => c.toLowerCase() === said.toLowerCase())
  return known ?? said.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * The name in a short typed line, once the words about checking in and the
 * date are gone: "hotel check-in Taj Jaipur 10 Nov" is the Taj Jaipur.
 */
function typedName(text: string): string | null {
  if (text.length > 70) return null
  const name = text
    .replace(new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?[\s-]*${MONTH}\b|\b${MONTH}\s+\d{1,2}\b`, 'gi'), ' ')
    .replace(/\b(?:hotel|check[- ]?in|check[- ]?out|stay|booking|reservation|at|on|from|in|till|until|to|the|my|tomorrow|today|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/gi, ' ')
    .replace(/[,.:;-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return name.length >= 3 ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : null
}

/**
 * A journey typed as a plan rather than pasted from a confirmation: "flight to
 * Bangalore on 25 Oct 6am", "train 12127 to Pune friday 7:10am". No PNR, but
 * it is still a departure to be at on time, and a city to be in.
 */
function typed(text: string, now: Date): ParsedBooking | null {
  const m =
    /^(?:my\s+)?(flight|train|bus)\b\s*(?:no\.?\s*)?([A-Z0-9]{2}\s?-?\d{2,4}\b|\d{5}\b)?\s*(?:from\s+([A-Za-z][A-Za-z .]{1,30}?)\s+)?to\s+([A-Za-z][A-Za-z .]{1,30}?)(?=\s+(?:on|at|by|this|next|coming|tomorrow|today|tonight|day|in|morning|evening|night|\d)\b|\s+\d|[,.]|$)/i.exec(
      text,
    )
  if (!m) return null
  // A city, or at least a name: "bus to office at 9" is a commute, not a trip.
  if (!cityIn(m[4]!) && !/^[A-Z]/.test(m[4]!)) return null
  const when = parseWhen(text, now)
  if (!when) return null
  const type = m[1]!.toLowerCase() as 'flight' | 'train' | 'bus'
  const number = m[2]?.toUpperCase().replace(/\s+/g, ' ') ?? null
  const from = m[3] ? cityName(m[3]) : null
  const to = cityName(m[4]!)
  const pnr = /\bpnr\s*(?:no\.?)?\s*[:#-]?\s*(\d{10})\b/i.exec(text)?.[1] ?? null
  const word = type[0]!.toUpperCase() + type.slice(1)
  return {
    type,
    title: `${word}${number ? ` ${number}` : ''} ${from ? `${from} → ${to}` : `to ${to}`}`,
    startsAt: when.date,
    timeKnown: !when.timeAssumed,
    endsOn: null,
    city: to,
    from,
    fromCity: from,
    ref: pnr,
    notes: [pnr ? `PNR ${pnr}` : null, type === 'flight' && number ? AIRLINES[number.slice(0, 2)] ?? null : null]
      .filter(Boolean)
      .join(' · ') || null,
    provider: provider(text) ?? (type === 'flight' && number ? (AIRLINES[number.slice(0, 2)] ?? null) : null),
    durationMinutes: type === 'flight' ? 120 : 60,
    remindBeforeMinutes: type === 'flight' ? 180 : type === 'train' ? 120 : 90,
  }
}

/**
 * Reads a booking confirmation, or null for anything else. Ordered from the
 * most particular — a PNR and a train number can only be a train — to the
 * most general, so a hotel near a station is still a hotel.
 */
export function parseBooking(input: string, now = new Date()): ParsedBooking | null {
  // Lines kept: an email's lines are its structure — a passenger to a line,
  // "Departure: …" on one and "Arrival: …" on the next.
  const text = input.replace(/[ \t\r]+/g, ' ').replace(/ *\n[\n ]*/g, '\n').trim()
  if (text.length >= 20) {
    for (const read of [train, flight, hotel, bus, show, appointment, other]) {
      const b = read(text, now)
      if (b) return b
    }
  }
  // Last, and for short lines too: a journey typed as a plan.
  return typed(text, now)
}

/** "3 hours", "90 minutes", "the morning of" — how long before the reminder goes. */
export function leadLabel(minutes: number): string {
  if (minutes >= 300) return 'that morning'
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'} before`
  return `${minutes} minutes before`
}
