import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  findCity,
  formatRupees,
  parseBooking,
  parseDelivery,
  parseDueNotice,
  parseInsurance,
  type ParsedDelivery,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { sendToUser } from '../push.ts'
import { freshAccessToken, type AccountRow } from './oauthConnect.ts'
import { billFromInsurance, billFromNotice } from './bills.ts'
import { saveFoundBooking } from './bookings.ts'
import { recordDelivery } from './deliveries.ts'
import { knownPlaces } from './captureLinks.ts'

/**
 * Reading email for what Cue can act on: a train or flight booked, a parcel
 * on its way, a card statement, an electricity bill. Only messages from the
 * senders that send these are ever opened, and nothing of them is kept but
 * their id and what was found — so a message is read once, and the rest of
 * the inbox is never looked at.
 */

export interface MailMessage {
  id: string
  from: string
  subject: string
  text: string
}

/** Who sends what Cue can act on, as it appears in their address or name. */
export const SENDERS = [
  // Travel and tickets
  'irctc', 'goindigo', 'airindia', 'airindiaexpress', 'spicejet', 'akasaair', 'vistara', 'makemytrip', 'goibibo',
  'cleartrip', 'easemytrip', 'ixigo', 'yatra', 'redbus', 'abhibus', 'booking.com', 'agoda', 'oyorooms', 'airbnb',
  'bookmyshow', 'district', 'pvrcinemas', 'inox', 'practo',
  // Shops and couriers
  'amazon', 'flipkart', 'myntra', 'meesho', 'ajio', 'nykaa', 'jiomart', 'bigbasket', 'tatacliq', 'snapdeal', 'croma',
  'delhivery', 'bluedart', 'ekart', 'xpressbees', 'shadowfax',
  // Cards, power, phone, internet
  'hdfcbank', 'icicibank', 'sbicard', 'axisbank', 'kotak', 'americanexpress', 'aexp', 'idfcfirstbank', 'indusind',
  'yesbank', 'sc.com', 'hsbc', 'rblbank', 'getonecard', 'bescom', 'mahadiscom', 'tangedco', 'bsesdelhi', 'tatapower',
  'adanielectricity', 'jvvnl', 'uppcl', 'wbsedcl', 'kseb', 'cesc', 'airtel', 'jio.com', 'myvi', 'bsnl', 'actcorp',
  'hathway', 'tataplay',
  // Insurance: car, bike, health, life
  'acko', 'godigit', 'icicilombard', 'hdfcergo', 'bajajallianz', 'bajajgeneral', 'tataaig', 'reliancegeneral',
  'sbigeneral', 'newindia', 'uiic', 'orientalinsurance', 'nationalinsurance', 'kotakgeneral', 'futuregenerali',
  'royalsundaram', 'cholams', 'libertyinsurance', 'iffcotokio', 'magmahdi', 'shriramgi', 'hizuno', 'universalsompo',
  'starhealth', 'nivabupa', 'careinsurance', 'adityabirlacapital', 'licindia', 'hdfclife', 'iciciprulife', 'sbilife',
  'maxlifeinsurance', 'tataaia', 'policybazaar', 'insurancedekho', 'coverfox', 'turtlemint',
]

/** Subjects worth opening even from a sender not on the list: a travel agent, a small bank. */
const SUBJECTS = /\b(?:credit card statement|e-?statement|payment due|bill (?:is )?generated|electricity bill|pnr|booking confirm|e-?ticket|out for delivery|has (?:been )?shipped|order (?:has been )?delivered|insurance|policy (?:is )?(?:issued|renewal|expir\w*)|premium due|renewal reminder)\b/i

export function worthOpening(from: string, subject: string): boolean {
  const f = from.toLowerCase()
  return SENDERS.some((s) => f.includes(s)) || SUBJECTS.test(subject)
}

/** The search Gmail runs, so only those messages ever leave the inbox. */
export function gmailQuery(days: number): string {
  const subjects = [
    '"credit card statement"', 'statement', '"payment due"', '"bill generated"', '"electricity bill"', 'PNR',
    '"booking confirmed"', '"e-ticket"', '"out for delivery"', 'shipped', 'delivered',
    'insurance', '"policy issued"', '"policy renewal"', '"premium due"', '"renewal reminder"',
  ]
  return `newer_than:${days}d (from:(${SENDERS.join(' OR ')}) OR subject:(${subjects.join(' OR ')}))`
}

/** Readable text from an email's HTML: what a person would see, in order. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(?:style|script|head)[\s\S]*?<\/(?:style|script|head)>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
  headers?: { name: string; value: string }[]
}

const decode = (data: string) => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')

/** The plain text of a Gmail message: its text part, or its HTML made readable. */
export function gmailText(payload: GmailPart): string {
  const plain: string[] = []
  const html: string[] = []
  const walk = (p: GmailPart) => {
    if (p.body?.data && p.mimeType === 'text/plain') plain.push(decode(p.body.data))
    else if (p.body?.data && p.mimeType === 'text/html') html.push(decode(p.body.data))
    for (const child of p.parts ?? []) walk(child)
  }
  walk(payload)
  const text = plain.join('\n').trim()
  // Some senders put a stub in the text part and everything in the HTML.
  return text.length > 200 || html.length === 0 ? text : htmlToText(html.join('\n'))
}

async function getJson<T>(url: string, token: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, ...headers } })
  if (!res.ok) throw new Error(`mail provider answered ${res.status}`)
  return (await res.json()) as T
}

/** New messages worth opening, from Gmail. */
async function fromGmail(token: string, days: number, seen: (ids: string[]) => Promise<Set<string>>): Promise<MailMessage[]> {
  const list = await getJson<{ messages?: { id: string }[] }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30&q=${encodeURIComponent(gmailQuery(days))}`,
    token,
  )
  const ids = (list.messages ?? []).map((m) => m.id)
  const already = await seen(ids)
  const out: MailMessage[] = []
  for (const id of ids.filter((x) => !already.has(x)).slice(0, 25)) {
    const msg = await getJson<{ id: string; payload: GmailPart }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      token,
    )
    const header = (name: string) => msg.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? ''
    out.push({ id, from: header('from'), subject: header('subject'), text: gmailText(msg.payload) })
  }
  return out
}

/** New messages worth opening, from Outlook: their senders first, and only theirs opened. */
async function fromOutlook(token: string, since: Date, seen: (ids: string[]) => Promise<Set<string>>): Promise<MailMessage[]> {
  const heads = await getJson<{ value?: { id: string; subject?: string; from?: { emailAddress?: { name?: string; address?: string } } }[] }>(
    `https://graph.microsoft.com/v1.0/me/messages?$top=50&$orderby=receivedDateTime desc&$select=id,subject,from&$filter=receivedDateTime ge ${since.toISOString()}`,
    token,
  )
  const wanted = (heads.value ?? [])
    .map((m) => ({ id: m.id, subject: m.subject ?? '', from: `${m.from?.emailAddress?.name ?? ''} <${m.from?.emailAddress?.address ?? ''}>` }))
    .filter((m) => worthOpening(m.from, m.subject))
  const already = await seen(wanted.map((m) => m.id))
  const out: MailMessage[] = []
  for (const m of wanted.filter((x) => !already.has(x.id)).slice(0, 25)) {
    const full = await getJson<{ body?: { content?: string; contentType?: string } }>(
      `https://graph.microsoft.com/v1.0/me/messages/${m.id}?$select=body`,
      token,
      { prefer: 'outlook.body-content-type="text"' },
    )
    const body = full.body?.content ?? ''
    out.push({ ...m, text: full.body?.contentType === 'html' ? htmlToText(body) : body })
  }
  return out
}

/** A parcel worth tracking: on its way with something to know it by — not an offer that says "free delivery". */
function worthTracking(p: ParsedDelivery): boolean {
  if (p.status === 'ordered') return Boolean(p.orderRef && p.expectedOn)
  return Boolean(p.item || p.orderRef || p.trackingUrl)
}

const dayWords = (d: Date | string) =>
  new Date(typeof d === 'string' ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * What one message is, made into what Cue keeps: a bill, a booking, a parcel.
 * Returns what was found, in words, or null when it was none of these — or
 * already known.
 */
export async function actOn(orgId: string, userId: string, msg: MailMessage, now = new Date()): Promise<string | null> {
  // The sender too: an insurer or a shop is often named only there.
  const text = `${msg.subject}\n${msg.from}\n${msg.text}`.slice(0, 15_000)

  // A card statement first: it can mention insurance (a card's cover plan) too.
  const notice = parseDueNotice(text)
  if (notice?.category === 'card') {
    const r = await billFromNotice(orgId, userId, notice)
    return r ? `${notice.name}: ${formatRupees(notice.amountPaise)} due ${dayWords(notice.dueOn)}` : null
  }

  const booking = parseBooking(text, now)
  // From email, only with its reference: an airline's sale is not a flight.
  if (booking && (booking.ref || booking.type === 'appointment')) {
    const city = booking.city ?? (booking.type === 'hotel' || booking.type === 'bus' ? findCity(text, await knownPlaces(userId)) : null)
    const saved = await saveFoundBooking(orgId, userId, booking, city, now)
    return saved ? `${saved.title}, ${dayWords(booking.startsAt)}` : null
  }

  // Car, bike, health, life: when cover ends, or a premium is due.
  const policy = parseInsurance(text)
  if (policy) {
    const r = await billFromInsurance(orgId, userId, policy)
    return r
      ? `${policy.name}: ${policy.kind === 'renewal' ? 'renew by' : 'premium due'} ${dayWords(policy.dueOn)}${policy.amountPaise ? ` (${formatRupees(policy.amountPaise)})` : ''}`
      : null
  }

  if (notice) {
    const r = await billFromNotice(orgId, userId, notice)
    return r ? `${notice.name}: ${formatRupees(notice.amountPaise)} due ${dayWords(notice.dueOn)}` : null
  }

  const parcel = parseDelivery(text, now)
  if (parcel && worthTracking(parcel)) {
    const { delivery } = await recordDelivery(orgId, userId, parcel)
    const what = [delivery.store, delivery.item].filter(Boolean).join(' · ') || 'A parcel'
    return delivery.status === 'delivered'
      ? `${what}: delivered`
      : `${what}${delivery.expectedOn ? `, expected ${dayWords(delivery.expectedOn)}` : ''}`
  }
  return null
}

/** How far back to look: a fortnight the first time, then from the last look, with a day's overlap. */
function lookBack(account: AccountRow, now: Date): Date {
  const first = new Date(now.getTime() - 14 * 86_400_000)
  if (!account.mailCheckedAt) return first
  const since = new Date(account.mailCheckedAt.getTime() - 86_400_000)
  return since > first ? since : first
}

/**
 * Reads one account's new mail and acts on it. Each message is marked read
 * whatever it held, so it is never opened twice.
 */
export async function readMail(
  account: AccountRow,
  now = new Date(),
  token: () => Promise<string> = () => freshAccessToken(account),
): Promise<string[]> {
  const seen = async (ids: string[]) => {
    if (ids.length === 0) return new Set<string>()
    const rows = await db
      .select({ id: schema.mailSeen.messageId })
      .from(schema.mailSeen)
      .where(and(eq(schema.mailSeen.accountId, account.id), inArray(schema.mailSeen.messageId, ids)))
    return new Set(rows.map((r) => r.id))
  }
  try {
    const since = lookBack(account, now)
    const access = await token()
    const messages =
      account.provider === 'microsoft'
        ? await fromOutlook(access, since, seen)
        : await fromGmail(access, Math.max(1, Math.ceil((now.getTime() - since.getTime()) / 86_400_000)), seen)

    const found: string[] = []
    for (const msg of messages) {
      let what: string | null = null
      try {
        what = await actOn(account.orgId, account.userId, msg, now)
      } catch (err) {
        console.error('[mail] could not act on a message', (err as Error).message)
      }
      await db.insert(schema.mailSeen).values({ accountId: account.id, messageId: msg.id, found: what }).onConflictDoNothing()
      if (what) found.push(what)
    }
    await db.update(schema.oauthAccounts).set({ mailCheckedAt: now, mailError: null }).where(eq(schema.oauthAccounts.id, account.id))
    return found
  } catch (err) {
    await db
      .update(schema.oauthAccounts)
      .set({ mailError: (err as Error).message.slice(0, 300) })
      .where(eq(schema.oauthAccounts.id, account.id))
    throw err
  }
}

/** Every account reading mail, once; one notification per person for what turned up. */
export async function runMailReading(now = new Date()): Promise<number> {
  const accounts = await db
    .select()
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.mailEnabled, true), eq(schema.oauthAccounts.status, 'active')))
  const byUser = new Map<string, string[]>()
  for (const account of accounts) {
    try {
      const found = await readMail(account, now)
      if (found.length) byUser.set(account.userId, [...(byUser.get(account.userId) ?? []), ...found])
    } catch (err) {
      console.error('[mail] reading failed for an account:', (err as Error).message)
    }
  }
  for (const [userId, found] of byUser) {
    await sendToUser(userId, {
      title: found.length === 1 ? 'Found in your email' : `${found.length} things found in your email`,
      body: found.slice(0, 4).join(' · ') + (found.length > 4 ? ' …' : ''),
      url: '/',
      tag: 'mail',
    }).catch(() => undefined)
  }
  return [...byUser.values()].reduce((s, f) => s + f.length, 0)
}

/** "Check now", for one person's accounts. */
export async function checkMailFor(userId: string): Promise<{ found: string[]; errors: string[] }> {
  const accounts = await db
    .select()
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.mailEnabled, true), eq(schema.oauthAccounts.status, 'active')))
  const found: string[] = []
  const errors: string[] = []
  for (const account of accounts) {
    try {
      found.push(...(await readMail(account)))
    } catch (err) {
      errors.push(`${account.email}: ${(err as Error).message}`)
    }
  }
  return { found, errors }
}

/** What has turned up lately, newest first: so a person can see exactly what Cue took from their mail. */
export async function recentFinds(userId: string, limit = 20) {
  return db
    .select({ found: schema.mailSeen.found, at: schema.mailSeen.seenAt, email: schema.oauthAccounts.email })
    .from(schema.mailSeen)
    .innerJoin(schema.oauthAccounts, eq(schema.oauthAccounts.id, schema.mailSeen.accountId))
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.mailEnabled, true)))
    .orderBy(desc(schema.mailSeen.seenAt))
    .limit(limit * 3)
    .then((rows) => rows.filter((r) => r.found).slice(0, limit))
}

export function startMailWorker(intervalMs = 15 * 60_000) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const n = await runMailReading()
      if (n > 0) console.log(`[mail] found ${n} thing(s) in email`)
    } catch (err) {
      console.error('[mail] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  void run()
  const handle = setInterval(run, intervalMs)
  console.log(`[mail] email reader checking every ${intervalMs / 60_000} min`)
  return () => clearInterval(handle)
}
