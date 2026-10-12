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
