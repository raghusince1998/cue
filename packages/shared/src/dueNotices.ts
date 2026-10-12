import type { BillCategory } from './bills.ts'

/**
 * What a statement or a bill notice says is owed: a credit card statement,
 * an electricity bill, a postpaid or broadband bill. Read by its labels —
 * "Total Amount Due", "Payment Due Date" — because a statement is full of
 * other amounts and other dates.
 */

export interface DueNotice {
  /** The bill it belongs to, the same every month: "HDFC Bank credit card ••1234". */
  name: string
  category: BillCategory
  amountPaise: number
  /** YYYY-MM-DD. */
  dueOn: string
  /** The smallest that can be paid, for a card. */
  minimumPaise: number | null
}

const BANKS: [RegExp, string][] = [
  [/\bhdfc\b/i, 'HDFC Bank'],
  [/\bicici\b/i, 'ICICI Bank'],
  [/\bsbi ?card\b|\bsbi\b/i, 'SBI Card'],
  [/\baxis\b/i, 'Axis Bank'],
  [/\bkotak\b/i, 'Kotak'],
  [/\bamex\b|\bamerican express\b/i, 'American Express'],
  [/\bidfc\b/i, 'IDFC FIRST'],
  [/\byes ?bank\b/i, 'YES Bank'],
  [/\bindusind\b/i, 'IndusInd'],
  [/\bau (?:small finance|bank)\b/i, 'AU Bank'],
  [/\bsc\b|\bstandard chartered\b/i, 'Standard Chartered'],
  [/\bhsbc\b/i, 'HSBC'],
  [/\brbl\b/i, 'RBL Bank'],
  [/\bbob\b|\bbank of baroda\b/i, 'Bank of Baroda'],
  [/\bonecard\b/i, 'OneCard'],
]

const UTILITIES: [RegExp, string, BillCategory][] = [
  [/\bbescom\b/i, 'BESCOM', 'electricity'],
  [/\bmsedcl\b|\bmahavitaran\b/i, 'MSEDCL', 'electricity'],
  [/\btangedco\b|\btneb\b/i, 'TANGEDCO', 'electricity'],
  [/\bbses\b/i, 'BSES', 'electricity'],
  [/\btata power\b/i, 'Tata Power', 'electricity'],
  [/\badani electricity\b/i, 'Adani Electricity', 'electricity'],
  [/\bjvvnl\b|\bjaipur vidyut\b/i, 'JVVNL', 'electricity'],
  [/\bavvnl\b|\bajmer vidyut\b/i, 'AVVNL', 'electricity'],
  [/\bjdvvnl\b|\bjodhpur vidyut\b/i, 'JdVVNL', 'electricity'],
  [/\buppcl\b/i, 'UPPCL', 'electricity'],
  [/\bwbsedcl\b/i, 'WBSEDCL', 'electricity'],
  [/\bkseb\b/i, 'KSEB', 'electricity'],
  [/\btsspdcl\b|\bapspdcl\b/i, 'SPDCL', 'electricity'],
  [/\bcesc\b/i, 'CESC', 'electricity'],
  [/\bairtel\b/i, 'Airtel', 'phone'],
  [/\bjio\b/i, 'Jio', 'phone'],
  [/\bvodafone\b|\bvi postpaid\b/i, 'Vi', 'phone'],
  [/\bbsnl\b/i, 'BSNL', 'phone'],
  [/\bact fibernet\b|\bact broadband\b/i, 'ACT Fibernet', 'internet'],
  [/\bhathway\b/i, 'Hathway', 'internet'],
  [/\btata play\b/i, 'Tata Play', 'internet'],
  [/\bmahanagar gas\b|\bigl\b|\bindraprastha gas\b/i, 'Gas', 'gas'],
]

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** A date written right after a label: "15/10/2026", "15-Oct-2026", "Oct 15, 2026", "15 October 2026". */
function dateAfter(text: string): string | null {
  let m = /^\D{0,12}?(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(text)
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]))
    if (d.getMonth() === Number(m[2]) - 1) return `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`
  }
  m = /^\W{0,12}?(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[\s,-]+(\d{4}|\d{2})\b/i.exec(text)
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3))
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    if (mo >= 0) return `${y}-${pad(mo + 1)}-${pad(Number(m[1]))}`
  }
  m = /^\W{0,12}?([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(text)
  if (m) {
    const mo = MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3))
    if (mo >= 0) return `${m[3]}-${pad(mo + 1)}-${pad(Number(m[2]))}`
  }
  return null
}

function amountAfter(text: string): number | null {
  const m = /^[^\d₹]{0,25}?(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i.exec(text)
  if (!m) return null
  const [whole, frac] = m[1]!.replace(/,/g, '').split('.')
  const paise = Number(whole) * 100 + (frac ? Number(frac.padEnd(2, '0').slice(0, 2)) : 0)
  return paise > 0 && paise <= 10_000_000_00 ? paise : null
}

/** The first labelled value: whatever follows the earliest of these labels. */
function labelled<T>(text: string, labels: RegExp, read: (rest: string) => T | null): T | null {
  for (const m of text.matchAll(new RegExp(labels.source, 'gi'))) {
    const v = read(text.slice(m.index! + m[0].length, m.index! + m[0].length + 60))
    if (v !== null) return v
  }
  return null
}

/**
 * Reads a card statement or a bill notice, or null. It must name what is due
 * and by when; a promotional mail that mentions a credit card is not one.
 */
export function parseDueNotice(input: string): DueNotice | null {
  const text = input.replace(/\s+/g, ' ')
  // "credit card", or a card with a bank's name or a masked number: "SBI Card XX5678".
  const cardWord =
    /\bcredit card\b/i.test(text) ||
    (/\bcard\b/i.test(text) && (BANKS.some(([re]) => re.test(text)) || /\bcard\s*(?:no\.?\s*)?[x*]{2,}\d{4}\b/i.test(text)))
  const card = cardWord && /\bstatement\b|\bpayment due\b|\btotal (?:amount |amt )?due\b|\bamt due\b/i.test(text)
  const utility = UTILITIES.find(([re]) => re.test(text))
  const billy = /\b(?:electricity|power) bill\b|\bbill (?:is )?(?:generated|amount)\b|\bpostpaid bill\b|\bbroadband bill\b|\byour bill\b/i.test(text)
  if (!card && !utility && !billy) return null

  const amountPaise = labelled(
    text,
    /\b(?:total (?:amount|amt) due|total due|amount due|amt due|amount payable|net amount payable|total payable|bill amount|payable amount|amount to be paid)\b\s*(?:is|of|:|-)?/,
    amountAfter,
  )
  const dueOn = labelled(text, /\b(?:payment due date|due date|pay by|due on|last date(?: of payment| to pay)?|due by|payable by)\b\s*(?:is|:|-)?/, dateAfter)
  if (!amountPaise || !dueOn) return null
  const minimumPaise = card ? labelled(text, /\b(?:minimum (?:amount )?due|min(?:imum)?\.? amt due)\b\s*(?:is|of|:|-)?/, amountAfter) : null

  if (card) {
    const bank = BANKS.find(([re]) => re.test(text))?.[1] ?? null
    const last4 =
      /\b(?:ending|ending with|ending in|xx+|\*{2,}|x{4}[\s-]?x{4}[\s-]?x{4}[\s-]?)\s*(\d{4})\b/i.exec(text)?.[1] ??
      /\bcard (?:no\.?|number)?\s*[:-]?\s*[x*]+\s*(\d{4})\b/i.exec(text)?.[1] ??
      null
    return {
      name: `${bank ?? 'Credit'} credit card${last4 ? ` ••${last4}` : ''}`.replace('Credit credit', 'Credit'),
      category: 'card',
      amountPaise,
      dueOn,
      minimumPaise,
    }
  }
  const [, provider, category] = utility ?? [null, null, /\b(?:electricity|power)\b/i.test(text) ? 'electricity' : 'other']
  const consumer = /\b(?:consumer|ca|account|k|service)\s*(?:no\.?|number|id)\s*[:-]?\s*([A-Z0-9-]{5,})/i.exec(text)?.[1] ?? null
  const label = category === 'electricity' ? 'electricity' : category === 'phone' ? 'postpaid' : category === 'internet' ? 'broadband' : 'bill'
  return {
    name: `${provider ?? 'Electricity'} ${label}${consumer ? ` (${consumer})` : ''}`.replace('Electricity electricity', 'Electricity'),
    category: category as BillCategory,
    amountPaise,
    dueOn,
    minimumPaise: null,
  }
}
