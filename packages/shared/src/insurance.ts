/**
 * Insurance, from what insurers send: a policy issued, a renewal reminder, a
 * premium due. What matters is when the cover ends and what it costs to keep
 * it — read from the policy period, the expiry date or the premium due date —
 * and which vehicle or person it covers, so next year's email lands on the
 * same reminder.
 */

export interface InsuranceNotice {
  /** The same every year: "Car insurance · MH12AB1234 (ACKO)". */
  name: string
  /** 'renewal' when cover runs out on a date; 'bill' when a premium falls due. */
  kind: 'renewal' | 'bill'
  /** YYYY-MM-DD: when cover ends, or when the premium is due. */
  dueOn: string
  /** The premium, when the email says it. */
  amountPaise: number | null
  /** The registration number, for a car or bike: how next year's email is matched. */
  vehicle: string | null
}

const INSURERS: [RegExp, string][] = [
  [/\backo\b/i, 'ACKO'],
  [/\bgo ?digit\b|\bdigit insurance\b/i, 'Digit'],
  [/\bicici lombard\b/i, 'ICICI Lombard'],
  [/\bhdfc ergo\b/i, 'HDFC ERGO'],
  [/\bbajaj (?:allianz|general)\b/i, 'Bajaj Allianz'],
  [/\btata aig\b/i, 'Tata AIG'],
  [/\breliance general\b/i, 'Reliance General'],
  [/\bsbi general\b/i, 'SBI General'],
  [/\bnew india assurance\b/i, 'New India Assurance'],
  [/\bunited india\b/i, 'United India'],
  [/\boriental insurance\b/i, 'Oriental Insurance'],
  [/\bnational insurance\b/i, 'National Insurance'],
  [/\bkotak (?:general|mahindra general)\b/i, 'Kotak General'],
  [/\bfuture generali\b/i, 'Future Generali'],
  [/\broyal sundaram\b/i, 'Royal Sundaram'],
  [/\bchola ?ms\b|\bcholamandalam\b/i, 'Chola MS'],
  [/\bliberty (?:general|insurance)\b/i, 'Liberty'],
  [/\biffco[- ]?tokio\b/i, 'IFFCO Tokio'],
  [/\bmagma\b/i, 'Magma'],
  [/\bshriram general\b/i, 'Shriram General'],
  [/\bzuno\b|\bedelweiss general\b/i, 'Zuno'],
  [/\bnavi general\b/i, 'Navi'],
  [/\buniversal sompo\b/i, 'Universal Sompo'],
  [/\bstar health\b/i, 'Star Health'],
  [/\bniva bupa\b|\bmax bupa\b/i, 'Niva Bupa'],
  [/\bcare health\b|\bcare insurance\b/i, 'Care Health'],
  [/\baditya birla (?:health|sun life)\b/i, 'Aditya Birla'],
  [/\blic\b|\blife insurance corporation\b/i, 'LIC'],
  [/\bhdfc life\b/i, 'HDFC Life'],
  [/\bicici prudential\b|\bicici pru\b/i, 'ICICI Prudential'],
  [/\bsbi life\b/i, 'SBI Life'],
  [/\bmax life\b|\baxis max life\b/i, 'Max Life'],
  [/\btata aia\b/i, 'Tata AIA'],
  [/\bpolicy ?bazaar\b/i, 'PolicyBazaar'],
  [/\binsurance ?dekho\b/i, 'InsuranceDekho'],
  [/\bcoverfox\b/i, 'Coverfox'],
  [/\bturtlemint\b/i, 'Turtlemint'],
]

/** Which cover, from the words used for it. Vehicles first: "motor" policies name them. */
const TYPES: [RegExp, string][] = [
  [/\b(?:two[- ]wheeler|2[- ]wheeler|bike|scooter|motorcycle|motor ?cycle|scooty)\b/i, 'Bike insurance'],
  [/\b(?:car|private car|four[- ]wheeler|4[- ]wheeler)\b/i, 'Car insurance'],
  [/\b(?:health|mediclaim|medical)\b/i, 'Health insurance'],
  [/\b(?:term|life)\s+(?:insurance|plan|policy)\b|\blife insurance\b/i, 'Life insurance'],
  [/\btravel insurance\b/i, 'Travel insurance'],
  [/\bhome insurance\b|\bhouse(?:hold)? insurance\b/i, 'Home insurance'],
  [/\bmotor\b|\bvehicle\b/i, 'Vehicle insurance'],
]

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** A date at the start of this text: "14/10/2027", "14-Oct-2027", "14 October 2027", "Oct 14, 2027". */
function dateAt(text: string): { day: string; length: number } | null {
  let m = /^\W{0,6}?(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/.exec(text)
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]))
    if (d.getMonth() === Number(m[2]) - 1) return { day: `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`, length: m[0].length }
  }
  m = /^\W{0,6}?(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[\s,-]+(\d{4})\b/i.exec(text)
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3))
    if (mo >= 0) return { day: `${m[3]}-${pad(mo + 1)}-${pad(Number(m[1]))}`, length: m[0].length }
  }
  m = /^\W{0,6}?([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(text)
  if (m) {
    const mo = MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3))
    if (mo >= 0) return { day: `${m[3]}-${pad(mo + 1)}-${pad(Number(m[2]))}`, length: m[0].length }
  }
  return null
}

/** The date after the first of these labels that has one. */
function dateAfterLabel(text: string, label: RegExp): string | null {
  for (const m of text.matchAll(new RegExp(label.source, 'gi'))) {
    const d = dateAt(text.slice(m.index! + m[0].length, m.index! + m[0].length + 40))
    if (d) return d.day
  }
  return null
}

/** "Policy Period: 15/10/2026 to 14/10/2027": the end of it. */
function periodEnd(text: string): string | null {
  for (const m of text.matchAll(/\b(?:policy period|period of (?:insurance|cover)|policy (?:term|tenure)|cover(?:age)? period|valid(?:ity)?|period)\b\s*(?:is|:|-|from)?\s*/gi)) {
    const rest = text.slice(m.index! + m[0].length, m.index! + m[0].length + 80)
    const from = dateAt(rest)
    if (!from) continue
    const tail = rest.slice(from.length).replace(/^[^a-z0-9]*?(?:to|till|until|upto|–|-)\s*/i, '')
    const to = dateAt(tail.replace(/^\(?\s*(?:midnight of|mid ?night|00:00 (?:hrs|hours) of)\s*/i, ''))
    if (to) return to.day
  }
  return null
}

function amountAfterLabel(text: string, label: RegExp): number | null {
  for (const m of text.matchAll(new RegExp(label.source, 'gi'))) {
    const rest = text.slice(m.index! + m[0].length, m.index! + m[0].length + 40)
    const a = /^[^\d₹]{0,15}?(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i.exec(rest)
    if (!a) continue
    const [whole, frac] = a[1]!.replace(/,/g, '').split('.')
    const paise = Number(whole) * 100 + (frac ? Number(frac.padEnd(2, '0').slice(0, 2)) : 0)
    if (paise >= 100_00 && paise <= 10_000_000_00) return paise
  }
  return null
}

/**
 * Reads an insurer's email, or null. It has to be about a policy — an insurer
 * or the word insurance with a policy — and say when cover ends or a premium
 * is due; a sale on premiums is not a policy.
 */
export function parseInsurance(input: string): InsuranceNotice | null {
  const text = input.replace(/\s+/g, ' ')
  const insurer = INSURERS.find(([re]) => re.test(text))?.[1] ?? null
  if (!/\binsurance\b|\bpolicy\b|\bpremium\b/i.test(text)) return null
  if (!insurer && !/\binsurance\b[\s\S]{0,200}\bpolicy\b|\bpolicy\b[\s\S]{0,200}\binsurance\b/i.test(text)) return null

  // When cover ends: the end of the policy period, or what the email calls the expiry.
  const expiry =
    periodEnd(text) ??
    dateAfterLabel(
      text,
      /\b(?:expir(?:es|y|ing)(?: date)?|expire[sd]? on|due for renewal on|renewal (?:due )?date|valid (?:till|until|upto)|policy end date|end date|cover ends on|lapses on|renew (?:by|before|on))\b\s*(?:is|on|:|-)?\s*/,
    )
  const premiumDue = dateAfterLabel(
    text,
    /\b(?:premium due date|premium (?:is )?due(?: on)?|next premium due|due date|(?:is )?due on)\b\s*(?:is|on|:|-)?\s*/,
  )
  if (!expiry && !premiumDue) return null

  const type = TYPES.find(([re]) => re.test(text))?.[1] ?? null
  const vehicleMatch = /\b([A-Z]{2})[ -]?(\d{1,2})[ -]?([A-Z]{1,3})[ -]?(\d{4})\b/.exec(text)
  // About a policy of yours — not an offer that is "valid till" the end of the month.
  const yours =
    /\byour\b[^.!]{0,80}\b(?:policy|insurance|cover|plan|premium)\b|\bpolicy\s*(?:no\.?|number|#|id)\b|\bpolicy\s+[A-Z0-9/-]*\d/i.test(text) ||
    Boolean(vehicleMatch)
  if (!yours) return null
  const vehicle = vehicleMatch && (type === 'Car insurance' || type === 'Bike insurance' || type === 'Vehicle insurance')
    ? `${vehicleMatch[1]}${vehicleMatch[2]!.padStart(2, '0')}${vehicleMatch[3]}${vehicleMatch[4]}`
    : null
  const amountPaise = amountAfterLabel(
    text,
    /\b(?:renewal premium|total premium(?: payable)?|premium amount|premium payable|premium of|premium|amount payable|total payable)\b\s*(?:is|of|:|-)?\s*/,
  )

  // A premium falling due on a running policy is a bill; cover running out is a renewal.
  const asBill = Boolean(premiumDue && !expiry)
  const label = type ?? 'Insurance'
  return {
    name: `${label}${vehicle ? ` · ${vehicle}` : ''}${insurer ? ` (${insurer})` : ''}`,
    kind: asBill ? 'bill' : 'renewal',
    dueOn: (asBill ? premiumDue : expiry)!,
    amountPaise,
    vehicle,
  }
}
