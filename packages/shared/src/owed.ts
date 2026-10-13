import { formatRupees } from './expenses.ts'
import { shortName } from './names.ts'

/**
 * Money people owe you: their share of something you paid for, or money lent.
 * Read from a sentence, and asked for back in a message they can pay from.
 */

export interface ParsedOwed {
  /** Whole paise. */
  amountPaise: number
  /** Who owes it, as it was written: "Ravi", "Dr. Mehta". */
  name: string
  /** What for, if it was said. */
  note: string | null
}

/** An amount, with or without a rupee sign: "owes me 500" is plainly money. */
const MONEY = String.raw`(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?(?:\s*(?:rs\b\.?|rupees?\b|inr\b|\/-))?`
/** A name in either script: "Ravi", "रवि" — Devanagari vowel signs are marks, not letters. */
const NAME = String.raw`(\p{L}[\p{L}\p{M}.' ]{0,40}?)`
const FOR = String.raw`(?:\s+(?:for|towards)\s+(.+?))?`
/** Date words after the name, which are about when, not who. */
const TRAILING_WHEN = /\s+(?:today|tomorrow|yesterday|tonight|this week|next week|(?:on|by|before)\s+.+)$/i

const PATTERNS: { re: RegExp; amount: number; name: number; note: number }[] = [
  // "Ravi owes me 500 for the tickets", "Ravi has to give me ₹500"
  { re: new RegExp(String.raw`^${NAME}\s+(?:owes|has to (?:pay|give|return))\s+me\s+${MONEY}${FOR}$`, 'iu'), name: 1, amount: 2, note: 4 },
  // "lent ₹2,000 to Priya for rent", "gave 500 to Ravi as a loan"
  { re: new RegExp(String.raw`^(?:i\s+)?lent\s+${MONEY}\s+to\s+${NAME}${FOR}$`, 'iu'), amount: 1, name: 3, note: 4 },
  // "lent Priya 2000 rs"
  { re: new RegExp(String.raw`^(?:i\s+)?lent\s+${NAME}\s+${MONEY}${FOR}$`, 'iu'), name: 1, amount: 2, note: 4 },
  // "collect ₹500 from Ravi", "get 300 back from Priya for lunch"
  { re: new RegExp(String.raw`^(?:collect|get|take|recover)\s+${MONEY}\s+(?:back\s+)?from\s+${NAME}${FOR}$`, 'iu'), amount: 1, name: 3, note: 4 },
]

function toPaise(whole: string, fraction?: string): number {
  return Number(whole.replace(/,/g, '')) * 100 + (fraction ? Number(fraction.padEnd(2, '0')) : 0)
}

/** Reads "Ravi owes me ₹500 for tickets" and the like, or null. */
export function parseOwed(input: string): ParsedOwed | null {
  const text = input.trim().replace(/[.!]+$/, '').replace(TRAILING_WHEN, '')
  for (const p of PATTERNS) {
    const m = p.re.exec(text)
    if (!m) continue
    const amountPaise = toPaise(m[p.amount]!, m[p.amount + 1])
    if (!amountPaise || amountPaise > 10_00_000_00) return null
    const name = m[p.name]!.replace(TRAILING_WHEN, '').trim()
    if (!name || /^(?:me|him|her|them|someone|somebody)$/i.test(name)) return null
    const note = m[p.note]?.replace(TRAILING_WHEN, '').trim() || null
    return { amountPaise, name, note }
  }
  return null
}

export interface OwedLine {
  amountPaise: number
  /** What it was for; may be empty. */
  note: string | null
  /** YYYY-MM-DD. */
  on: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`

/**
 * A reminder that is easy to say yes to: what it was for and when, the total,
 * and where to send it.
 */
export function owedMessage(o: { name: string; lines: OwedLine[]; upiId?: string | null }): string {
  const total = o.lines.reduce((s, l) => s + l.amountPaise, 0)
  const what = (l: OwedLine) =>
    l.note ? `${formatRupees(l.amountPaise)} for ${l.note} (${day(l.on)})` : `${formatRupees(l.amountPaise)} from ${day(l.on)}`
  const out: string[] = [`Hi ${shortName(o.name)},`, '']
  if (o.lines.length === 1) {
    out.push(`Just a reminder about ${what(o.lines[0]!)}.`)
  } else {
    out.push(`Just a reminder about ${formatRupees(total)} in all:`)
    for (const l of o.lines) out.push(`• ${what(l)}`)
  }
  out.push('', o.upiId ? `You can send it to my UPI: ${o.upiId}` : 'Send it whenever you can.', '', 'Thanks!')
  return out.join('\n')
}

/**
 * Shares of an amount split equally between you and others, in whole rupees
 * where it divides that way; the odd paise stay with you.
 */
export function splitEqually(totalPaise: number, others: number): number[] {
  if (others < 1) return []
  const each = Math.floor(totalPaise / (others + 1) / 100) * 100 || Math.floor(totalPaise / (others + 1))
  return Array.from({ length: others }, () => each)
}
