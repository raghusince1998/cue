/**
 * Deliveries, read from the messages shops and couriers send: "Out for
 * delivery", "Shipped … will be delivered by Wed, Oct 15", "Delivered". No
 * shop lets another app read a shopper's orders, but every one of them sends
 * these, and a message shared into Cue says enough to track the parcel.
 */

export const DELIVERY_STATUSES = ['ordered', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

/** How far along: a later message never moves a parcel back. */
export const STATUS_RANK: Record<DeliveryStatus, number> = {
  ordered: 0,
  shipped: 1,
  out_for_delivery: 2,
  delivered: 3,
  cancelled: 3,
}

export const STATUS_LABEL: Record<DeliveryStatus, string> = {
  ordered: 'Ordered',
  shipped: 'On the way',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

/** Shops, as they appear in messages, and how to write their names. */
const STORES: [RegExp, string][] = [
  [/\bamazon\b|\bamzn\b/i, 'Amazon'],
  [/\bflipkart\b|\bfkrt\b/i, 'Flipkart'],
  [/\bmyntra\b|\bmyntr\b/i, 'Myntra'],
  [/\bmeesho\b/i, 'Meesho'],
  [/\bajio\b/i, 'Ajio'],
  [/\bnykaa\b/i, 'Nykaa'],
  [/\bjiomart\b/i, 'JioMart'],
  [/\bbig ?basket\b/i, 'BigBasket'],
  [/\btata ?cliq\b/i, 'Tata CLiQ'],
  [/\bsnapdeal\b/i, 'Snapdeal'],
  [/\bcroma\b/i, 'Croma'],
  [/\breliance digital\b/i, 'Reliance Digital'],
  [/\bfirstcry\b/i, 'FirstCry'],
  [/\blenskart\b/i, 'Lenskart'],
  [/\bpepperfry\b/i, 'Pepperfry'],
  [/\bdecathlon\b/i, 'Decathlon'],
  [/\bikea\b/i, 'IKEA'],
  [/\bpharmeasy\b/i, 'PharmEasy'],
  [/\b1mg\b/i, 'Tata 1mg'],
  [/\bnetmeds\b/i, 'Netmeds'],
]

const COURIERS: [RegExp, string][] = [
  [/\bdelhivery\b/i, 'Delhivery'],
  [/\bekart\b/i, 'Ekart'],
  [/\bblue ?dart\b/i, 'Blue Dart'],
  [/\bxpressbees\b/i, 'Xpressbees'],
  [/\becom express\b/i, 'Ecom Express'],
  [/\bshadowfax\b/i, 'Shadowfax'],
  [/\bdtdc\b/i, 'DTDC'],
  [/\bindia ?post\b|\bspeed ?post\b/i, 'India Post'],
  [/\bvalmo\b/i, 'Valmo'],
]

const DELIVERY_WORD =
  /\b(?:deliver(?:ed|y|ing)?|arriving|arrives?|out for delivery|shipped|dispatched|in transit|on (?:its|the) way|picked up|order (?:placed|confirmed|received)|cancel+ed)\b/i

export interface ParsedDelivery {
  /** The shop, or the courier when no shop is named, or null. */
  store: string | null
  /** What is coming, as far as the message says. */
  item: string | null
  status: DeliveryStatus
  /** YYYY-MM-DD, when the message gives a day. */
  expectedOn: string | null
  /** Cash to have ready on delivery, in paise. */
  codPaise: number | null
  /** The order or tracking number, to recognise the next message about it. */
  orderRef: string | null
  trackingUrl: string | null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*`
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The day it is expected, looking ahead: a delivery date is never in the past. */
/**
 * The day it is expected. Said next to "arriving" or "delivered by" first: an
 * email also carries the day it was ordered, which is not when it comes.
 */
function expectedDay(text: string, now: Date): string | null {
  for (const m of text.matchAll(/\b(?:arriv\w*|deliver\w*|expected|estimated|eta|reach(?:es)?)\b[^.]{0,40}/gi)) {
    const d = dayIn(m[0], now)
    if (d) return d
  }
  return dayIn(text, now)
}

function dayIn(text: string, now: Date): string | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const ahead = (month: number, day: number) => {
    const d = new Date(today.getFullYear(), month, day)
    if (d.getMonth() !== month) return null
    // A date well behind today is next year's; one a few days behind is late, not next year.
    return d.getTime() < today.getTime() - 60 * 86_400_000 ? new Date(today.getFullYear() + 1, month, day) : d
  }
  let m = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH}\b`, 'i').exec(text)
  if (m) {
    const d = ahead(MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3)), Number(m[1]))
    if (d) return ymd(d)
  }
  m = new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?\b`, 'i').exec(text)
  if (m) {
    const d = ahead(MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3)), Number(m[2]))
    if (d) return ymd(d)
  }
  if (/\btoday\b|\btonight\b/i.test(text)) return ymd(today)
  if (/\btomorrow\b/i.test(text)) return ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))
  m = /\b(?:by|on|before|arriving|arrives|delivered)\s+(?:this\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i.exec(text)
  if (m) {
    const target = WEEKDAYS.indexOf(m[1]!.toLowerCase())
    const gap = (target - today.getDay() + 7) % 7
    return ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + gap))
  }
  return null
}

function statusOf(text: string): DeliveryStatus {
  if (/\bcancel+ed\b/i.test(text)) return 'cancelled'
  if (/^\s*delivered\b|\b(?:has been|was|been|is|successfully)\s+delivered\b|\bdelivered (?:successfully|today at|to you)\b/i.test(text))
    return 'delivered'
  if (/\bout for delivery\b|\barriving today\b|\b(?:will be|being) delivered today\b|\breach(?:es)? you today\b|\bdelivery today\b/i.test(text))
    return 'out_for_delivery'
  if (/\bshipped\b|\bdispatched\b|\bin transit\b|\bon (?:its|the) way\b|\bpicked up\b|\bwill be delivered\b|\barriving\b/i.test(text))
    return 'shipped'
  return 'ordered'
}

function money(s: string): number {
  const [whole, frac] = s.replace(/,/g, '').split('.')
  return Number(whole) * 100 + (frac ? Number(frac.padEnd(2, '0').slice(0, 2)) : 0)
}

function codOf(text: string): number | null {
  const after =
    /(?:cash on delivery|\bcod\b|pay(?:able)?|keep|collect(?:ed)?|amount (?:to be )?(?:paid|collected))[^.]{0,40}?(?:₹|\brs\.?|\binr)\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i.exec(text)
  const before =
    /(?:₹|\brs\.?|\binr)\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)[^.]{0,30}?(?:cash on delivery|\bcod\b|(?:at the time of|on|at) delivery)/i.exec(text)
  const m = after ?? before
  if (!m) return null
  const paise = money(m[1]!)
  return paise > 0 && paise <= 10_00_000_00 ? paise : null
}

function orderRefOf(text: string): string | null {
  const m =
    /\b(\d{3}-\d{7}-\d{7})\b/.exec(text) ??
    /\b(OD\d{12,})\b/.exec(text) ??
    /\border\s*(?:id|no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,})/i.exec(text) ??
    /\bAWB\s*(?:no\.?|number)?\s*[:#-]?\s*([A-Z0-9]{6,})/i.exec(text) ??
    /\border\s+#\s*([A-Z0-9][A-Z0-9-]{5,})/i.exec(text) ??
    // "Your Nykaa order NYK-12345678 has been dispatched".
    /\border\s+([A-Z]{2,5}-?\d{6,})\b/.exec(text)
  return m ? m[1]!.toUpperCase() : null
}

/** Words a product name does not start with, or contain: lines about the order, not the thing. */
const NOT_AN_ITEM =
  /^(?:hi|hello|dear|your|we|thank|thanks|track|view|manage|order|delivery|delivered|arriving|expected|estimated|shipped|dispatched|out for|size|qty|quantity|price|total|amount|sold by|seller|payment|pay|cash|address|ship to|deliver to|need help|download|get the app|https?:)\b|[@₹]|\brs\.?\s*\d|\border\b|\bdelivery\b/i

function cleanItem(raw: string, store: string | null): string | null {
  let item = raw
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .replace(/(?:\.{3}|…)+["'”’]?$/, '')
    .replace(/["'”’]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (store) item = item.replace(new RegExp(`^${store}(?:\\.in)?\\s+`, 'i'), '')
  if (!item || item.length < 3 || /^(?:order|package|shipment|parcel|item|items|product)s?$/i.test(item)) return null
  return item.length > 80 ? `${item.slice(0, 79).trimEnd()}…` : item
}

/**
 * What is coming, one line at a time — the subject first, where shops name
 * it: 'Your Amazon.in order of "boAt Rockerz 450…" has shipped', "Shipped:
 * Your Flipkart order for Redmi Note 13 5G". Then a line that says so
 * ("Items: …"), then the product line a shop puts under "shipped". Never
 * across lines, which is how a name used to run on into the sender's address.
 */
function itemFromLines(input: string, store: string | null): string | null {
  const lines = input
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const patterns = [
    /\border of\s+["“'‘](.+?)(?:["”'’]|…|\.{3})/i,
    /^(?:out for delivery|delivered|shipped|dispatched|arriving (?:today|tomorrow)|on its way)\s*:\s*(?:your\s+(?:\S+\s+)?(?:order|package)\s+(?:of|for)\s+)?["“'‘]?(.+?)["”'’]?$/i,
    /\b(?:order|package|shipment)\s+(?:#?\s*[A-Z0-9-]{6,}\s+)?(?:for|of|containing|with)\s+["“'‘]?(.+?)["”'’]?(?:\s+(?:has|have|is|was|will|from)\b|$)/i,
    /(?:^|\b)(?:items?|products?|item name|product name)\s*[:-]\s*(.+?)(?:\.\s|\s+\||$)/i,
  ]
  for (const re of patterns) {
    for (const line of lines.slice(0, 40)) {
      const m = re.exec(line)
      const item = m ? cleanItem(m[1]!, store) : null
      if (item && !NOT_AN_ITEM.test(item)) return item
    }
  }
  // The product line under "shipped": a short name, not a sentence about the order.
  const shippedAt = lines.findIndex((l) => /\b(?:shipped|dispatched|on its way|out for delivery|delivered)\b/i.test(l))
  for (const line of lines.slice(Math.max(0, shippedAt + 1), shippedAt + 6)) {
    const words = line.split(' ')
    if (words.length < 2 || words.length > 14 || NOT_AN_ITEM.test(line) || /[.!?:]$/.test(line) || /<|>/.test(line)) continue
    if (words.filter((w) => /^[A-Z0-9]/.test(w)).length < 2) continue
    const item = cleanItem(line, store)
    if (item) return item
  }
  return null
}

function itemOf(text: string, store: string | null): string | null {
  const ref = String.raw`(?:\s*(?:#|no\.?|id)?\s*[A-Z0-9][A-Z0-9-]{5,})?`
  const m =
    new RegExp(String.raw`\b(?:package|order|shipment|parcel)${ref}\s+(?:with|for|of|containing)\s+['"‘“]?(.+?)['"’”]?\s+(?:will|has|is|was|from|with|are|have)\b`, 'i').exec(text) ??
    // Anywhere, not only at the start: in an email the subject line comes first.
    /\b(?:out for delivery|shipped|delivered|dispatched|arriving (?:today|tomorrow)|order (?:placed|confirmed))\s*[:-]\s*(?:your\s+)?(.+?)\s+(?:from\s+\S+\s+)?(?:will|has|is|was|with order|with)\b/i.exec(text)
  if (!m) return null
  let item = m[1]!
    .replace(/\s+from\s+\S+$/i, '')
    .replace(/^(?:your\s+)?(?:\S+\s+)?(?:order|package|shipment)\s*/i, (s) => (store && new RegExp(store, 'i').test(s) ? '' : s))
    .replace(/(?:\.{3}|…)+$/, '')
    .trim()
  if (store) item = item.replace(new RegExp(`^${store}\\s+`, 'i'), '')
  if (!item || item.length < 2 || /^(?:order|package|shipment|parcel|item)s?$/i.test(item)) return null
  return item.length > 80 ? `${item.slice(0, 79).trimEnd()}…` : item
}

/**
 * Reads a shop's or courier's message about a parcel, or null for anything
 * else. A line that only mentions delivering — "deliver the report to Anita
 * friday" — is not one: it has to name a shop or courier, or read like a
 * shipping message (a tracking link, an order number, "your order").
 */
export function parseDelivery(input: string, now = new Date()): ParsedDelivery | null {
  const text = input.replace(/\s+/g, ' ').trim()
  if (!DELIVERY_WORD.test(text)) return null
  const store = STORES.find(([re]) => re.test(text))?.[1] ?? null
  const courier = COURIERS.find(([re]) => re.test(text))?.[1] ?? null
  const url = /https?:\/\/\S+/i.exec(text)?.[0]?.replace(/[.,)]+$/, '') ?? null
  const orderRef = orderRefOf(text)
  const messagey = Boolean(store || courier || url || orderRef || /\byour\s+(?:order|package|parcel|shipment)\b/i.test(text))
  if (!messagey) return null

  const status = statusOf(text)
  let expectedOn = status === 'delivered' || status === 'cancelled' ? null : expectedDay(text, now)
  if (!expectedOn && status === 'out_for_delivery') expectedOn = ymd(now)
  return {
    store: store ?? courier,
    // By line when there are lines (an email); as one sentence when not (a message).
    item: (input.includes('\n') ? itemFromLines(input, store) : null) ?? itemOf(text, store),
    status,
    expectedOn,
    codPaise: status === 'delivered' || status === 'cancelled' ? null : codOf(text),
    orderRef,
    trackingUrl: url,
  }
}
