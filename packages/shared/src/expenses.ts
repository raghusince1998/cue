/**
 * Expenses: what was spent on the road, kept until it is claimed back.
 *
 * Amounts are whole paise, never floating-point rupees: ₹0.1 + ₹0.2 must add
 * up to ₹0.30 on a claim someone else checks.
 */

export const EXPENSE_CATEGORIES = [
  { key: 'travel', label: 'Travel', mark: '🚕' },
  { key: 'fuel', label: 'Fuel', mark: '⛽' },
  { key: 'food', label: 'Food', mark: '🍽' },
  { key: 'stay', label: 'Stay', mark: '🏨' },
  { key: 'parking', label: 'Parking & tolls', mark: '🅿' },
  { key: 'phone', label: 'Phone & internet', mark: '📱' },
  { key: 'supplies', label: 'Supplies & courier', mark: '📦' },
  { key: 'other', label: 'Other', mark: '🧾' },
] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]['key']
export const EXPENSE_CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key) as [ExpenseCategory, ...ExpenseCategory[]]

export const CLAIM_STATUSES = ['unclaimed', 'claimed', 'reimbursed'] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

/** Words that say what kind of spend it was. First match wins, so the specific come first. */
const CATEGORY_WORDS: [ExpenseCategory, RegExp][] = [
  ['parking', /\b(?:parking|toll|fastag)\b/i],
  ['fuel', /\b(?:fuel|petrol|diesel|cng)\b/i],
  ['stay', /\b(?:hotel|stay|room|lodge|airbnb|oyo)\b/i],
  ['travel', /\b(?:cab|uber|ola|rapido|taxi|auto|rickshaw|train|flight|bus|metro|travel|ticket|fare)\b/i],
  ['food', /\b(?:lunch|dinner|breakfast|coffee|tea|chai|food|snacks?|meal|swiggy|zomato)\b/i],
  ['phone', /\b(?:recharge|phone|mobile|data|internet|wifi)\b/i],
  ['supplies', /\b(?:courier|printing|prints?|stationery|samples?|brochures?|xerox|photocopy)\b/i],
]

export function categoryOf(text: string): ExpenseCategory {
  for (const [key, re] of CATEGORY_WORDS) if (re.test(text)) return key
  return 'other'
}

export interface ParsedExpense {
  /** Whole paise. */
  amountPaise: number
  category: ExpenseCategory
  /** What it was for, without the amount: "cab to Mehta Physio". */
  note: string
}

/** "₹1,250.50", "Rs 450", "450 rs", "INR 300", "300 rupees". */
const AMOUNT =
  /(?:₹|\brs\.?|\binr)\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\b|\b(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\s*(?:₹|rs\b\.?|rupees?\b|inr\b|\/-)/i
/** "spent 450 on cab", "paid 300 for parking": a bare number, named as money by the verb. */
const SPENT = /\b(?:spent|paid|expense(?:d)?|cost)\s+(?:₹\s*)?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?\b/i

function toPaise(whole: string, fraction?: string): number {
  return Number(whole.replace(/,/g, '')) * 100 + (fraction ? Number(fraction.padEnd(2, '0')) : 0)
}

/**
 * Reads a spend from a sentence, or null when it is not one. The amount has
 * to be named as money — a rupee sign, "rs", "rupees", or "spent"/"paid" —
 * so "call Ravi at 4" or "meeting room 204" are never read as expenses.
 */
export function parseExpense(input: string): ParsedExpense | null {
  const text = input.trim()
  let amountPaise = 0
  let cut: [number, number] | null = null

  const m = AMOUNT.exec(text)
  if (m) {
    amountPaise = m[1] ? toPaise(m[1], m[2]) : toPaise(m[3]!, m[4])
    cut = [m.index, m.index + m[0].length]
  } else {
    const s = SPENT.exec(text)
    if (!s) return null
    amountPaise = toPaise(s[1]!, s[2])
    cut = [s.index, s.index + s[0].length]
  }
  // Up to ₹10 lakh: a stall at a conference, not a typo with extra zeros.
  if (!amountPaise || amountPaise > 10_00_000_00) return null

  const note = (text.slice(0, cut[0]) + ' ' + text.slice(cut[1]))
    .replace(/\b(?:spent|paid|expense|expensed)\b/gi, ' ')
    .replace(/^\s*(?:on|for)\b/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    .trim()
  return { amountPaise, category: categoryOf(note), note }
}

/** "₹1,250" or "₹1,250.50", grouped the Indian way: ₹1,25,000. */
export function formatRupees(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100)
  const rest = Math.abs(paise) % 100
  const s = String(rupees)
  const grouped = s.length <= 3 ? s : `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}`
  return `${paise < 0 ? '-' : ''}₹${grouped}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAY_WORD = String.raw`(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?`
const MONTH_WORD = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*`

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function weekdayIndex(word: string): number {
  return WEEKDAYS.findIndex((w) => w.startsWith(word.toLowerCase().slice(0, 3)))
}

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.toLowerCase().slice(0, 3))
}

export interface SpentWhen {
  /** YYYY-MM-DD, never after today. */
  day: string
  /** The note without the words that said when. */
  note: string
}

/**
 * When money was spent, read looking back: "yesterday", "on friday" (the last
 * one), "8 oct" (this year's, or last year's if that is still to come).
 *
 * The planner's own date reader looks forward, as plans do — "8 oct" there is
 * the next one — which would date last week's hotel a year from now.
 */
export function spentWhen(note: string, now = new Date()): SpentWhen | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const back = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - days)
  const found = (re: RegExp, toDay: (m: RegExpExecArray) => Date | null): SpentWhen | null => {
    const m = re.exec(note)
    if (!m) return null
    const d = toDay(m)
    if (!d || Number.isNaN(d.getTime()) || d > today) return null
    const rest = (note.slice(0, m.index) + ' ' + note.slice(m.index + m[0].length))
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
      .trim()
    return { day: dayKey(d), note: rest }
  }

  return (
    found(/\b(?:on\s+)?(?:the\s+)?day before yesterday\b/i, () => back(2)) ??
    found(/\b(?:yesterday|yday)(?:\s+(?:morning|afternoon|evening|night))?\b/i, () => back(1)) ??
    found(/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/i, () => today) ??
    // "last friday" is never today; "friday" or "on friday" can be.
    found(new RegExp(String.raw`\b(?:on\s+)?(last\s+)?(${DAY_WORD})\b`, 'i'), (m) => {
      const w = weekdayIndex(m[2]!)
      if (w < 0) return null
      const gap = (today.getDay() - w + 7) % 7
      return back(m[1] && gap === 0 ? 7 : gap)
    }) ??
    found(new RegExp(String.raw`\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_WORD})\b`, 'i'), (m) =>
      pastDate(Number(m[1]), monthIndex(m[2]!), today),
    ) ??
    found(new RegExp(String.raw`\b(?:on\s+)?(${MONTH_WORD})\s+(\d{1,2})(?:st|nd|rd|th)?\b`, 'i'), (m) =>
      pastDate(Number(m[2]), monthIndex(m[1]!), today),
    ) ??
    // Day first, as dates are written in India: 8/10 is the 8th of October.
    found(/\b(?:on\s+)?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?\b/, (m) => {
      const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null
      return year === null
        ? pastDate(Number(m[1]), Number(m[2]) - 1, today)
        : validDate(year, Number(m[2]) - 1, Number(m[1]))
    })
  )
}

/** That day this year, or last year's when this year's has not come yet. */
function pastDate(day: number, month: number, today: Date): Date | null {
  const d = validDate(today.getFullYear(), month, day)
  if (!d) return null
  return d > today ? validDate(today.getFullYear() - 1, month, day) : d
}

function validDate(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  const d = new Date(year, month, day)
  return d.getMonth() === month ? d : null
}
