/**
 * Bills and renewals: what comes due again and again — rent, electricity,
 * EMIs, subscriptions — and what expires — a passport, a licence, a policy.
 * Each has a next due date that moves on by its cycle once it is paid, and a
 * reminder some days before.
 */

export const BILL_CATEGORIES = [
  { key: 'rent', label: 'Rent', mark: '🏠', words: /\b(?:rent|lease)\b/i },
  { key: 'electricity', label: 'Electricity', mark: '💡', words: /\b(?:electricity|power|light bill|bescom|msedcl|tneb|tata power|adani)\b/i },
  { key: 'water', label: 'Water', mark: '🚰', words: /\bwater\b/i },
  { key: 'gas', label: 'Gas', mark: '🔥', words: /\b(?:gas|lpg|cylinder|png)\b/i },
  { key: 'phone', label: 'Phone', mark: '📱', words: /\b(?:phone|mobile|postpaid|prepaid|recharge|jio|airtel)\b/i },
  { key: 'internet', label: 'Internet & TV', mark: '🌐', words: /\b(?:internet|broadband|wifi|wi-fi|fibre|fiber|dth|cable|tata play)\b/i },
  { key: 'emi', label: 'Loan & EMI', mark: '🏦', words: /\b(?:emi|loan|mortgage)\b/i },
  { key: 'card', label: 'Credit card', mark: '💳', words: /\b(?:credit ?card|card bill|card payment)\b/i },
  { key: 'insurance', label: 'Insurance', mark: '🛡', words: /\b(?:insurance|premium|policy|lic|mediclaim)\b/i },
  { key: 'subscription', label: 'Subscription', mark: '📺', words: /\b(?:subscription|netflix|prime|hotstar|spotify|youtube|membership|gym|icloud|google one)\b/i },
  { key: 'education', label: 'School & fees', mark: '🎓', words: /\b(?:school|tuition|fees?|college|coaching)\b/i },
  { key: 'tax', label: 'Tax', mark: '🧾', words: /\b(?:tax|gst|itr|tds)\b/i },
  { key: 'maintenance', label: 'Maintenance', mark: '🔧', words: /\b(?:maintenance|society)\b/i },
  { key: 'vehicle', label: 'Vehicle', mark: '🚗', words: /\b(?:puc|pollution|service due|vehicle service|fastag)\b/i },
  { key: 'document', label: 'Document', mark: '🪪', words: /\b(?:passport|licen[cs]e|aadhaar|pan card|visa|puc|pollution|registration|rc book)\b/i },
  { key: 'other', label: 'Other', mark: '📌', words: null },
] as const

export type BillCategory = (typeof BILL_CATEGORIES)[number]['key']
export const BILL_CATEGORY_KEYS = BILL_CATEGORIES.map((c) => c.key) as [BillCategory, ...BillCategory[]]

export const REPEATS = [
  { key: 'none', label: 'Once' },
  { key: 'weekly', label: 'Every week' },
  { key: 'monthly', label: 'Every month' },
  { key: 'quarterly', label: 'Every 3 months' },
  { key: 'half_yearly', label: 'Every 6 months' },
  { key: 'yearly', label: 'Every year' },
] as const

export type Repeat = (typeof REPEATS)[number]['key']
export const REPEAT_KEYS = REPEATS.map((r) => r.key) as [Repeat, ...Repeat[]]

const MONTHS_PER: Partial<Record<Repeat, number>> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 }

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseDay = (s: string) => new Date(`${s}T00:00:00`)
const daysIn = (year: number, month: number) => new Date(year, month + 1, 0).getDate()

export function categoryOfBill(name: string): BillCategory {
  for (const c of BILL_CATEGORIES) if (c.words?.test(name)) return c.key
  return 'other'
}

/**
 * The due date after this one. A bill due on the 31st is due on the last day
 * of a shorter month and back on the 31st after it, so it keeps its day
 * rather than drifting to the 28th for good.
 */
export function nextDue(due: string, repeat: Repeat, anchorDay?: number | null): string | null {
  if (repeat === 'none') return null
  const d = parseDay(due)
  if (repeat === 'weekly') return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7))
  const months = MONTHS_PER[repeat]!
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const day = Math.min(anchorDay ?? d.getDate(), daysIn(target.getFullYear(), target.getMonth()))
  return ymd(new Date(target.getFullYear(), target.getMonth(), day))
}

/** Whole days from today to the due date: negative when it has passed. */
export function daysToDue(due: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((parseDay(due).getTime() - today.getTime()) / 86_400_000)
}

/** "due today", "due in 3 days", "3 days overdue" — or, for a renewal, "expires …". */
export function dueLabel(due: string, kind: 'bill' | 'renewal', now = new Date()): string {
  const n = daysToDue(due, now)
  const verb = kind === 'renewal' ? 'expires' : 'due'
  if (n < 0) return kind === 'renewal' ? `expired ${-n === 1 ? 'yesterday' : `${-n} days ago`}` : `${-n} day${n === -1 ? '' : 's'} overdue`
  if (n === 0) return `${verb} today`
  if (n === 1) return `${verb} tomorrow`
  if (n < 45) return `${verb} in ${n} days`
  if (n < 730) return `${verb} in ${Math.round(n / 30.44)} months`
  return `${verb} in ${Math.round(n / 365.25)} years`
}

export interface ParsedBill {
  name: string
  kind: 'bill' | 'renewal'
  category: BillCategory
  amountPaise: number | null
  dueOn: string
  repeat: Repeat
}

const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*`
const MONTH_INDEX = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const TRIGGER = /\b(?:bill|rent|emi|premium|subscription|fees?|renewal|renew|expires?|expiry|expiring|valid (?:till|until|upto)|insurance|maintenance|loan)\b/i
const RENEWAL = /\b(?:renewal|renew|expires?|expiry|expiring|valid (?:till|until|upto))\b/i

const REPEAT_WORDS: [RegExp, Repeat][] = [
  [/\b(?:every|each)\s+week\b|\bweekly\b/i, 'weekly'],
  [/\b(?:every|each)\s+(?:3|three)\s+months\b|\bquarterly\b/i, 'quarterly'],
  [/\b(?:every|each)\s+(?:6|six)\s+months\b|\bhalf[- ]yearly\b/i, 'half_yearly'],
  [/\b(?:every|each)\s+(?:year|yr)\b|\b(?:yearly|annually|annual|every year)\b/i, 'yearly'],
  [/\b(?:every|each)\s+month\b|\bmonthly\b|\bof every month\b/i, 'monthly'],
]

/** An amount named as money, or a plain number big enough to be one and not a year. */
function findAmount(text: string): { paise: number; at: [number, number] } | null {
  const marked =
    /(?:₹|\brs\.?|\binr)\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\b|\b(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\s*(?:rs\b\.?|rupees?\b|inr\b|\/-)/i.exec(text)
  if (marked) {
    const whole = (marked[1] ?? marked[3])!.replace(/,/g, '')
    const frac = marked[2] ?? marked[4]
    return { paise: Number(whole) * 100 + (frac ? Number(frac.padEnd(2, '0')) : 0), at: [marked.index, marked.index + marked[0].length] }
  }
  const bare = /(?<![\d/.-])(\d{1,3}(?:,\d{2,3})+|\d{3,7})(?![\d/.:-]|\s*(?:am|pm|st|nd|rd|th)\b)/i.exec(text)
  if (!bare) return null
  const n = Number(bare[1]!.replace(/,/g, ''))
  if (n >= 1900 && n <= 2100 && !bare[1]!.includes(',')) return null
  return { paise: n * 100, at: [bare.index, bare.index + bare[0].length] }
}

/** The due date written in the line, and where it was. */
function findDate(text: string, now: Date): { day: string; at: [number, number]; dayOfMonth: boolean } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const make = (y: number, m: number, d: number) => {
    const dt = new Date(y, m, d)
    return dt.getMonth() === m ? dt : null
  }
  const ahead = (m: number, d: number, y: string | undefined) => {
    if (y) return make(Number(y.length === 2 ? `20${y}` : y), m, d)
    const thisYear = make(today.getFullYear(), m, d)
    return thisYear && thisYear >= today ? thisYear : make(today.getFullYear() + 1, m, d)
  }
  let m = new RegExp(String.raw`\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}(?:,?\s+(\d{4}))?\b`, 'i').exec(text)
  if (m) {
    const d = ahead(MONTH_INDEX.indexOf(m[2]!.toLowerCase().slice(0, 3)), Number(m[1]), m[3])
    if (d) return { day: ymd(d), at: [m.index, m.index + m[0].length], dayOfMonth: false }
  }
  m = new RegExp(String.raw`\b(?:on\s+)?${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, 'i').exec(text)
  if (m) {
    const d = ahead(MONTH_INDEX.indexOf(m[1]!.toLowerCase().slice(0, 3)), Number(m[2]), m[3])
    if (d) return { day: ymd(d), at: [m.index, m.index + m[0].length], dayOfMonth: false }
  }
  m = /\b(?:on\s+)?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(text)
  if (m) {
    const d = make(Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]), Number(m[2]) - 1, Number(m[1]))
    if (d) return { day: ymd(d), at: [m.index, m.index + m[0].length], dayOfMonth: false }
  }
  // "on the 5th", "due 5th": the next 5th.
  m = /\b(?:(?:on|by|before)\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text)
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 31) {
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), Math.min(n, daysIn(today.getFullYear(), today.getMonth())))
      const d =
        thisMonth >= today
          ? thisMonth
          : new Date(today.getFullYear(), today.getMonth() + 1, Math.min(n, daysIn(today.getFullYear(), today.getMonth() + 1)))
      return { day: ymd(d), at: [m.index, m.index + m[0].length], dayOfMonth: true }
    }
  }
  m = /\b(today|tomorrow)\b/i.exec(text)
  if (m) {
    const d = m[1]!.toLowerCase() === 'today' ? today : new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    return { day: ymd(d), at: [m.index, m.index + m[0].length], dayOfMonth: false }
  }
  return null
}

/**
 * Reads "electricity bill ₹1,200 on the 5th every month" or "passport
 * expires 12 march 2028". Null for anything that is not a bill with a date,
 * and for a one-off with no amount — "pay the electricity bill on the 5th" is
 * a to-do, not a bill to keep.
 */
export function parseBill(input: string, now = new Date()): ParsedBill | null {
  const text = input.trim().replace(/[.!]+$/, '')
  if (!TRIGGER.test(text)) return null
  const renewal = RENEWAL.test(text)

  let repeat: Repeat | null = null
  let rest = text
  for (const [re, key] of REPEAT_WORDS) {
    if (re.test(rest)) {
      repeat = key
      rest = rest.replace(re, ' ')
      break
    }
  }
  const date = findDate(rest, now)
  if (!date) return null
  rest = rest.slice(0, date.at[0]) + ' ' + rest.slice(date.at[1])
  const amount = findAmount(rest)
  if (amount) rest = rest.slice(0, amount.at[0]) + ' ' + rest.slice(amount.at[1])

  // A bare "on the 5th" with a bill word repeats monthly; anything else said once is once.
  if (!repeat) repeat = date.dayOfMonth ? 'monthly' : 'none'
  if (!amount && repeat === 'none' && !renewal) return null
  if (amount && (amount.paise <= 0 || amount.paise > 100_000_000_00)) return null

  const name = rest
    .replace(/\b(?:pay|paying|payment|due|is|are|on|of|by|before|the|my|for|amount|expires?|expiry|expiring|renewal|renew|valid (?:till|until|upto)|every|each)\b/gi, ' ')
    .replace(/[,:;-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const category = categoryOfBill(text)
  const label = BILL_CATEGORIES.find((c) => c.key === category)!.label
  const tidy = name ? name[0]!.toUpperCase() + name.slice(1) : label
  return {
    name: tidy,
    kind: renewal ? 'renewal' : 'bill',
    category,
    amountPaise: amount?.paise ?? null,
    dueOn: date.day,
    repeat,
  }
}
