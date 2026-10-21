import https from 'node:https'
import { constants as cryptoConstants } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  EXAMS,
  cutOffsIn,
  datesInNotice,
  examByKey,
  examFit,
  examGroup,
  datesMentioned,
  dateIn,
  examLabel,
  examStage,
  findNumber,
  isLaterExamStage,
  listFoundHi,
  listIn,
  noticeKind,
  noticeLineHi,
  noticeSummary,
  numbersIn,
  proposeFromNotice,
  type ListMeaning,
  type NoticeDate,
  type NoticeDTO,
  type NoticeKind,
  type NoticeProposal,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { env } from '../env.ts'
import { sendToUser } from '../push.ts'
import { localeOf, t } from '../i18n.ts'
import { addNoticeToExam, examsForNotice, langOf, tellOfClashes, updateExam, type ExamRow } from './exams.ts'
import { pdfPages, pdfText } from './pdfText.ts'

/**
 * Watching exam boards' public notice pages. Politely: as CueBot, by name,
 * never as a browser; only pages and files robots.txt leaves open; one page
 * per board twice a day, and a few PDFs at most, a pause between each. A
 * site that refuses robots is not read at all — its notices come from the
 * boards' emails and from the reviewer adding them by hand.
 *
 * Nothing found here reaches anyone until a person has checked it against
 * the notice and approved it (see approveNotice).
 */

export const USER_AGENT = 'CueBot/1.0 (+https://cue.vitelio.in; exam notices for the people who applied)'

export interface NoticeSource {
  id: string
  name: string
  /** The board, as the exams page names it: WATCHED_BOARDS in @cue/shared. */
  board: string
  /** Said before each title, so "Patwari 2025 : …" reads as this board's Patwari. The board, unless set. */
  prefix?: string
  url: string
  /**
   * How the page lists its notices: links; RPSC's table of exam dates; SSC's
   * notice data (the same the browser fetches for its own page) and its
   * calendar; RRB's list of updates by CEN; SBI's cards, one a recruitment.
   */
  read: 'links' | 'rpsc-dates' | 'ssc-api' | 'ssc-calendar' | 'rrb-updates' | 'sbi-careers'
  /** For a page of links: which are notices. */
  linkPattern?: RegExp
  /** What every notice from it is, when the source says so and its titles do not. */
  kind?: NoticeKind
  /** Where a person reads them, when a notice has no link of its own. */
  page?: string
}

/** SSC's own query for a kind of notice, as its website sends it. */
const ssc = (path: string, contentType: string, attributes: string, order = 'key=createdAt&order=DESC') =>
  `https://ssc.gov.in/api/general-website/portal/${path}?page=1&limit=20&contentType=${contentType}&${order}&isAttachment=true&language=english&attributes=${attributes}`
const SSC_FIELDS = 'id,headline,examId,examYear,contentType,startDate,endDate,language,createdAt'

/**
 * The pages watched: those that answer a named robot, allow it, and list
 * notices in the page itself or in data the page fetches. Checked 13 Oct
 * 2026: UPSC and NTA's NEET and JEE Main sites refuse robots; IBPS's
 * certificate cannot be verified; Rajasthan Police builds its page in the
 * browser from nothing CueBot can read; RRB's notice pages turn CueBot away,
 * so its list of updates is read and each update links to them for people.
 */
export const NOTICE_SOURCES: NoticeSource[] = [
  {
    id: 'rssb-news',
    name: 'RSSB: news and notifications',
    board: 'RSSB',
    url: 'https://rssb.rajasthan.gov.in/',
    read: 'links',
    linkPattern: /\/storage\/news_item\//i,
  },
  { id: 'rpsc-exam-dates', name: 'RPSC: exam dates', board: 'RPSC', url: 'https://rpsc.rajasthan.gov.in/proposedexamdate', read: 'rpsc-dates' },
  { id: 'nta-notices', name: 'NTA: notices', board: 'NTA', url: 'https://nta.ac.in/', read: 'links', linkPattern: /\/Download\/Notice\//i },
  { id: 'ugc-net', name: 'UGC NET: notices', board: 'NTA', prefix: 'UGC NET', url: 'https://ugcnet.nta.ac.in/', read: 'links', linkPattern: /\/images\/.+\.pdf$/i },
  { id: 'csir-net', name: 'CSIR NET: notices', board: 'NTA', prefix: 'CSIR NET', url: 'https://csirnet.nta.ac.in/', read: 'links', linkPattern: /\/images\/.+\.pdf$/i },
  {
    id: 'ssc-notice-board',
    name: 'SSC: notice board',
    board: 'SSC',
    url: ssc('notice-boards', 'notice-boards', 'id,headline,examId,contentType,redirectUrl,startDate,endDate,language,createdAt'),
    read: 'ssc-api',
    page: 'https://ssc.gov.in/home/notice-board',
  },
  { id: 'ssc-admit-cards', name: 'SSC: admit cards', board: 'SSC', url: ssc('records', 'admit-card', SSC_FIELDS), read: 'ssc-api', kind: 'admit_card', page: 'https://ssc.gov.in/' },
  { id: 'ssc-answer-keys', name: 'SSC: answer keys', board: 'SSC', url: ssc('records', 'answer-key', SSC_FIELDS), read: 'ssc-api', kind: 'answer_key', page: 'https://ssc.gov.in/' },
  { id: 'ssc-results', name: 'SSC: results', board: 'SSC', url: ssc('records', 'results', SSC_FIELDS), read: 'ssc-api', kind: 'result', page: 'https://ssc.gov.in/' },
  {
    id: 'ssc-calendar',
    name: 'SSC: exam calendar',
    board: 'SSC',
    url: ssc('ssc-calendar', 'ssc-calendar', 'id,headline,examId,examYear,desc,content,contentType,startDate,endDate,language,createdAt', 'key=startDate&order=ASC&isPaginationRequired=false'),
    read: 'ssc-calendar',
    page: 'https://ssc.gov.in/ssc-calender',
  },
  { id: 'rrb-updates', name: 'RRB: updates about recruitments', board: 'RRB', url: 'https://rrb.indianrailways.gov.in/ajmer', read: 'rrb-updates' },
  { id: 'sbi-careers', name: 'SBI: current openings', board: 'SBI', url: 'https://sbi.bank.in/web/careers/current-openings', read: 'sbi-careers' },
  { id: 'lic-careers', name: 'LIC: careers', board: 'LIC', url: 'https://licindia.in/careers', read: 'links', linkPattern: /recruitment/i },
  { id: 'ctet-notices', name: 'CTET: public notices', board: 'CTET', url: 'https://ctet.nic.in/', read: 'links', linkPattern: /s3waas\.gov\.in\/.+\/uploads\//i },
]

/** Notices added by hand, for the pages no robot can read. */
export const MANUAL = { id: 'manual', name: 'Added by hand' }

export interface FoundItem {
  key: string
  url: string
  title: string
  /** A table that gives the exam's day beside it. */
  examDate?: string | null
  /** What the source says it is, when its words do not. */
  kind?: NoticeKind
  /** The round, when the source names it: "CEN 06/2026". */
  cycle?: string | null
  /** Dates the source gives in its own fields: a calendar's last day to apply. */
  dates?: NoticeDate[]
}

const ENTITIES: Record<string, string> = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—' }
const clean = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m)))
    .replace(/\s+/g, ' ')
    .trim()

/** The notices a page of links lists: each link that matches, with its words. */
export function readLinks(html: string, base: string, pattern?: RegExp): FoundItem[] {
  const out = new Map<string, FoundItem>()
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string
    try {
      url = new URL(m[1]!.trim(), base).toString()
    } catch {
      continue
    }
    const title = clean(m[2]!)
    if (title.length < 8 || (pattern && !pattern.test(url)) || out.has(url)) continue
    out.set(url, { key: url, url, title })
  }
  return [...out.values()]
}

/** RPSC's table of exam dates: each row an exam, a round and its day. */
export function readRpscDates(html: string, base: string): FoundItem[] {
  const out: FoundItem[] = []
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => clean(c[1]!))
    if (cells.length < 5) continue
    const [, , exam, title, on] = cells.slice(-5)
    const examDate = dateIn(on ?? '')
    if (!exam || !title || !examDate) continue
    out.push({ key: `${exam}|${title}|${examDate}`, url: base, title: `${exam} — ${title}`, examDate })
  }
  return out
}

// ── robots.txt ───────────────────────────────────────────────────────────

interface Rules {
  allow: string[]
  disallow: string[]
}

/** The rules for CueBot, or for every robot when it is not named. */
export function parseRobots(text: string): Rules {
  const groups: { agents: string[]; rules: Rules }[] = []
  let current: { agents: string[]; rules: Rules } | null = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const field = m[1]!.toLowerCase()
    const value = m[2]!.trim()
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current || !value) continue
    if (field === 'disallow') current.rules.disallow.push(value)
    if (field === 'allow') current.rules.allow.push(value)
  }
  const mine = groups.find((g) => g.agents.some((a) => a.includes('cuebot'))) ?? groups.find((g) => g.agents.includes('*'))
  return mine?.rules ?? { allow: [], disallow: [] }
}

function matches(rule: string, path: string): number {
  const source = rule
    .split('*')
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
    .replace(/\\\$$/, '$')
  return new RegExp(`^${source}`).test(path) ? rule.length : -1
}

/** Whether these rules leave a path open: the longest rule that matches decides. */
export function robotsAllow(rules: Rules, path: string): boolean {
  const disallowed = Math.max(-1, ...rules.disallow.map((r) => matches(r, path)))
  const allowed = Math.max(-1, ...rules.allow.map((r) => matches(r, path)))
  return disallowed < 0 || allowed >= disallowed
}

export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>

/**
 * Boards whose servers still use TLS's old, unsafe renegotiation, which
 * Node refuses by default. Allowed for these hosts only, and only because
 * what is fetched is public, nothing is sent but the request, and every
 * notice is checked by a person before anyone is told of it.
 */
const LEGACY_TLS = new Set(['rssb.rajasthan.gov.in'])
const legacyAgent = new https.Agent({ secureOptions: cryptoConstants.SSL_OP_LEGACY_SERVER_CONNECT })

function legacyFetch(url: string, init: { headers: Record<string, string>; signal: AbortSignal }, hops = 0): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: init.headers, agent: legacyAgent, signal: init.signal }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location && hops < 5) {
        res.resume()
        resolve(legacyFetch(new URL(res.headers.location, url).toString(), init, hops + 1))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status, headers: { 'content-type': String(res.headers['content-type'] ?? '') } })))
      res.on('error', reject)
    })
    req.on('error', reject)
  })
}

/** Fetch, with the old TLS allowed for the boards that still need it. */
export const watchFetch: Fetcher = (url, init) => (LEGACY_TLS.has(new URL(url).hostname) ? legacyFetch(url, init) : fetch(url, init))

/** One fetch, as CueBot: a status and at most `max` bytes of body. */
async function get(fetcher: Fetcher, url: string, max: number): Promise<{ status: number; type: string; body: Buffer | null }> {
  try {
    const res = await fetcher(url, { headers: { 'user-agent': USER_AGENT, accept: '*/*' }, signal: AbortSignal.timeout(25_000) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok) return { status: res.status, type, body: null }
    const body = Buffer.from(await res.arrayBuffer())
    return { status: res.status, type, body: body.length > max ? null : body }
  } catch {
    return { status: 0, type: '', body: null }
  }
}

/** A site's rules, read once a run. A site that refuses its robots.txt to a robot refuses robots. */
async function rulesFor(fetcher: Fetcher, origin: string, cache: Map<string, Rules | 'refused'>): Promise<Rules | 'refused'> {
  const known = cache.get(origin)
  if (known) return known
  const res = await get(fetcher, `${origin}/robots.txt`, 512 * 1024)
  const text = res.body?.toString('utf8') ?? ''
  const rules: Rules | 'refused' =
    res.status === 401 || res.status === 403
      ? 'refused'
      : res.status === 200 && !/^\s*</.test(text)
        ? parseRobots(text)
        : { allow: [], disallow: [] }
  cache.set(origin, rules)
  return rules
}

async function mayRead(fetcher: Fetcher, url: string, cache: Map<string, Rules | 'refused'>): Promise<boolean> {
  const u = new URL(url)
  const rules = await rulesFor(fetcher, u.origin, cache)
  return rules !== 'refused' && robotsAllow(rules, `${u.pathname}${u.search}`)
}

// ── SSC, RRB and SBI ─────────────────────────────────────────────────────

interface SscRecord {
  id: string
  headline?: string | null
  redirectUrl?: string | null
  createdAt?: string | null
  startDate?: string | null
  endDate?: string | null
  examYear?: string | null
  content?: string | null
  attachments?: { path?: string | null; fileName?: string | null }[]
}

function sscRecords(body: string): SscRecord[] {
  try {
    const json = JSON.parse(body) as { statusCode?: string; data?: unknown }
    return String(json.statusCode) === '200' && Array.isArray(json.data) ? (json.data as SscRecord[]) : []
  } catch {
    return []
  }
}

/** An SSC attachment's address: its path, the way SSC's own page builds it. */
const sscFile = (path: string) => encodeURI(`https://ssc.gov.in/api/attachment/${path.replace(/\\/g, '/')}`)

/** SSC's notices, from the data its page fetches: each with its first file, or the page. */
export function readSscNotices(body: string, source: Pick<NoticeSource, 'page' | 'kind'>): FoundItem[] {
  return sscRecords(body).flatMap((x) => {
    const title = clean(x.headline ?? '')
    if (title.length < 8) return []
    const file = x.attachments?.find((a) => a.path)?.path
    const url = file ? sscFile(file) : x.redirectUrl?.startsWith('http') ? x.redirectUrl : (source.page ?? 'https://ssc.gov.in/')
    return [{ key: x.id, url, title, ...(source.kind ? { kind: source.kind } : {}) }]
  })
}

const dm = (on: string) => new Date(`${on}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * SSC's calendar: for each exam, when applications open and close, and the
 * month it is held. The last day to apply is proposed, as tentative: the
 * calendar is SSC's plan, the notification its word.
 */
export function readSscCalendar(body: string, page: string): FoundItem[] {
  return sscRecords(body).flatMap((x) => {
    const headline = clean(x.headline ?? '')
    const end = /^\d{4}-\d{2}-\d{2}/.exec(x.endDate ?? '')?.[0]
    const start = /^\d{4}-\d{2}-\d{2}/.exec(x.startDate ?? '')?.[0]
    if (headline.length < 8 || !end) return []
    const month = clean(x.content ?? '')
    const title = `${headline} — applications ${start ? `${dm(start)} to ` : 'until '}${dm(end)}${month ? `; exam ${month}` : ''} (SSC calendar, tentative)`
    return [
      {
        key: `${x.id}|${end}`,
        url: page,
        title,
        kind: 'notification' as const,
        dates: [{ step: 'apply_by', on: end, at: null, round: null, note: 'Tentative, from the SSC calendar' }],
      },
    ]
  })
}

/** What each of RRB's update categories is. */
const RRB_KINDS: [RegExp, NoticeKind][] = [
  [/e-?call\s+letters?|city\s+intimation/i, 'admit_card'],
  [/exam\s+schedule|special\s+notice\s+on\s+exam/i, 'schedule'],
  [/results?|selection\s+list/i, 'result'],
  [/document\s+verification|medical/i, 'dv'],
  [/objection|answer\s+key/i, 'answer_key'],
  [/indicative\s+notice|notification/i, 'notification'],
]

/**
 * RRB's "Updates About Recruitments": "(06/2026) Exam Schedule (12-10-2026)".
 * It names the CEN, never the exam; the reviewer says which exam a CEN is
 * once, and every later update for it is matched (see examForRound).
 */
export function readRrbUpdates(html: string, base: string): FoundItem[] {
  const out = new Map<string, FoundItem>()
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*getdata[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = clean(m[2]!)
    const said = /^\(\s*((?:RPF\s+)?\d{1,2}\/20\d\d)\s*\)\s*(.+?)\s*\((\d{2})-(\d{2})-(20\d\d)\)$/i.exec(text)
    if (!said) continue
    const [, cen, category, d, mo, y] = said
    const round = /^rpf/i.test(cen!) ? cen!.toUpperCase().replace(/\s+/g, ' ') : `CEN ${cen}`
    const key = `${round}|${category}|${y}-${mo}-${d}`
    if (out.has(key)) continue
    let url: string
    try {
      url = new URL(m[1]!.replace(/&amp;/g, '&'), base).toString()
    } catch {
      continue
    }
    out.set(key, {
      key,
      url,
      title: `RRB ${round}: ${category} (${d}-${mo}-${y})`,
      cycle: round,
      kind: RRB_KINDS.find(([re]) => re.test(category!))?.[1] ?? 'other',
    })
  }
  return [...out.values()]
}

/**
 * SBI's current openings: a card for each recruitment, its heading and the
 * line beside it that says what is new — "(PRELIMINARY EXAMINATION CALL
 * LETTER IS AVAILABLE FOR DOWNLOAD)". A new line is a new notice.
 */
export function readSbiCareers(html: string, base: string): FoundItem[] {
  const out: FoundItem[] = []
  const cards = html.split(/(?=<div\b[^>]*\bdata-articleid\s*=)/i).slice(1)
  for (const card of cards) {
    const advert = /data-articleid\s*=\s*["']([^"']+)["']/i.exec(card)?.[1]
    const heading = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(card)?.[1]
    if (!advert || !heading) continue
    const title = clean(heading)
    if (title.length < 12) continue
    out.push({ key: `${advert}|${title}`, url: `${base}#${encodeURIComponent(advert)}`, title: `${title} — ${advert}` })
  }
  return out
}

// ── Reading the pages ────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * The exam a round belongs to, as a reviewer has already said: RRB names a
 * CEN, never its exam, so the first update for "CEN 06/2026" is matched by
 * hand and every later one by that.
 */
async function examForRound(cycle: string): Promise<string | null> {
  const [row] = await db
    .select({ proposals: schema.notices.proposals })
    .from(schema.notices)
    .where(and(eq(schema.notices.status, 'approved'), sql`${schema.notices.proposals} @> ${JSON.stringify([{ cycle }])}::jsonb`))
    .orderBy(desc(schema.notices.reviewedAt))
    .limit(1)
  return row?.proposals.find((p) => p.cycle === cycle)?.examKey ?? null
}

/** What a found notice proposes, if it names an exam in the list — or its round was matched before. */
async function propose(source: Pick<NoticeSource, 'board' | 'prefix'>, item: FoundItem): Promise<NoticeProposal[]> {
  const found = proposeFromNotice({ title: item.title, board: source.prefix ?? source.board, examDate: item.examDate ?? null })
  const learned = !found && item.cycle ? await examForRound(item.cycle) : null
  const p: NoticeProposal | null =
    found ?? (learned ? { examKey: learned, cycle: item.cycle ?? null, kind: item.kind ?? noticeKind(item.title), dates: [], list: null } : null)
  if (!p) return []
  if (item.kind) p.kind = item.kind
  if (item.cycle) p.cycle = item.cycle
  if (item.dates?.length) p.dates = [...p.dates, ...item.dates]
  p.list = listIn(p.examKey, p.kind, item.title)
  return [p]
}

async function note(id: string, ok: boolean, message: string, now: Date, baselineDone?: boolean) {
  await db
    .insert(schema.noticeSources)
    .values({ id, checkedAt: now, ok, message, baselineDone: baselineDone ?? false })
    .onConflictDoUpdate({
      target: schema.noticeSources.id,
      set: { checkedAt: now, ok, message, ...(baselineDone !== undefined ? { baselineDone } : {}) },
    })
}

export interface WatchRun {
  source: string
  ok: boolean
  message: string
  added: number
}

/**
 * Each watched page read once, its new notices kept for review. The first
 * time a page is read, what is on it is the baseline, never announced —
 * except a table's dates still to come, which may matter to someone
 * already tracking that exam. A notice's PDF, where robots.txt allows, is
 * read for the dates it mentions, as hints for the reviewer.
 */
export async function runNoticeWatch(
  now = new Date(),
  fetcher: Fetcher = watchFetch,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<WatchRun[]> {
  const cache = new Map<string, Rules | 'refused'>()
  const runs: WatchRun[] = []
  let pdfBudget = 10
  for (const source of NOTICE_SOURCES) {
    if (!(await mayRead(fetcher, source.url, cache))) {
      const message = 'Its robots.txt asks robots not to read this page, so it is not read.'
      await note(source.id, false, message, now)
      runs.push({ source: source.id, ok: false, message, added: 0 })
      continue
    }
    await pause(1500)
    const page = await get(fetcher, source.url, 4 * 1024 * 1024)
    if (!page.body) {
      const message = page.status ? `The page answered ${page.status}.` : 'The page did not answer.'
      await note(source.id, false, message, now)
      runs.push({ source: source.id, ok: false, message, added: 0 })
      continue
    }
    const html = page.body.toString('utf8')
    const items =
      source.read === 'rpsc-dates'
        ? readRpscDates(html, source.url)
        : source.read === 'ssc-api'
          ? readSscNotices(html, source)
          : source.read === 'ssc-calendar'
            ? readSscCalendar(html, source.page ?? source.url)
            : source.read === 'rrb-updates'
              ? readRrbUpdates(html, source.url)
              : source.read === 'sbi-careers'
                ? readSbiCareers(html, source.url)
                : readLinks(html, source.url, source.linkPattern)
    if (items.length === 0) {
      const message = 'No notices found on the page: it may have changed. Check that it still lists them.'
      await note(source.id, false, message, now)
      runs.push({ source: source.id, ok: false, message, added: 0 })
      continue
    }

    const [state] = await db.select().from(schema.noticeSources).where(eq(schema.noticeSources.id, source.id))
    const first = !state?.baselineDone
    const known = new Set(
      (await db.select({ key: schema.notices.key }).from(schema.notices).where(eq(schema.notices.source, source.id))).map((r) => r.key),
    )
    let added = 0
    for (const item of items.filter((i) => !known.has(i.key))) {
      const proposals = await propose(source, item)
      const today = ymd(now)
      const ahead = Boolean((item.examDate && item.examDate >= today) || item.dates?.some((d) => d.on >= today))
      const status = first && !ahead ? 'baseline' : proposals.length > 0 ? 'pending' : 'unmatched'
      let hints: string[] = []
      if (status === 'pending' && /\.pdf(?:$|\?)/i.test(item.url) && pdfBudget > 0 && (await mayRead(fetcher, item.url, cache))) {
        pdfBudget--
        await pause(1500)
        const file = await get(fetcher, item.url, 5 * 1024 * 1024)
        const text = file.body ? await pdfText(new Uint8Array(file.body), 3) : null
        if (text) {
          hints = datesMentioned(text, now)
          // Each date by what the notice says it is, ready for the reviewer to check rather than type.
          for (const p of proposals) if (p.dates.length === 0) p.dates = datesInNotice(text, p.examKey, p.kind, now)
          // A result's cut-offs, read for the reviewer to confirm.
          const cutoffs = cutOffsIn(text)
          if (cutoffs.length > 0) for (const p of proposals) if (p.kind === 'result') p.cutoffs = cutoffs
        }
      }
      const inserted = await db
        .insert(schema.notices)
        .values({ source: source.id, key: item.key, url: item.url, title: item.title.slice(0, 300), status, proposals, hints, foundAt: now })
        .onConflictDoNothing()
        .returning({ id: schema.notices.id })
      if (inserted.length > 0 && status !== 'baseline') added++
    }
    const message = first ? `Read for the first time: ${items.length} notices noted.` : added > 0 ? `${added} new.` : 'Nothing new.'
    await note(source.id, true, message, now, true)
    runs.push({ source: source.id, ok: true, message, added })
  }
  return runs
}

// ── Review ───────────────────────────────────────────────────────────────

// Who reviews: the admins (ADMIN_EMAILS), the same people as the admin portal.
export { isAdmin } from '../admins.ts'
import { tracked } from './health.ts'

const sourceName = (id: string) => NOTICE_SOURCES.find((s) => s.id === id)?.name ?? (id === MANUAL.id ? MANUAL.name : id)

function toDTO(row: typeof schema.notices.$inferSelect): NoticeDTO {
  return {
    id: row.id,
    source: row.source,
    sourceName: sourceName(row.source),
    url: row.url,
    title: row.title,
    status: row.status,
    proposals: row.proposals,
    hints: row.hints,
    foundAt: row.foundAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    told: row.told,
  }
}

export async function listNotices(status: NoticeDTO['status'], limit = 100): Promise<NoticeDTO[]> {
  const rows = await db
    .select()
    .from(schema.notices)
    .where(eq(schema.notices.status, status))
    .orderBy(status === 'approved' || status === 'dismissed' ? desc(schema.notices.reviewedAt) : desc(schema.notices.foundAt))
    .limit(limit)
  return rows.map(toDTO)
}

export async function noticeCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: schema.notices.status, n: sql<number>`count(*)::int` })
    .from(schema.notices)
    .groupBy(schema.notices.status)
  return Object.fromEntries(rows.map((r) => [r.status, r.n]))
}

export async function sourceStatus() {
  const rows = await db.select().from(schema.noticeSources)
  return NOTICE_SOURCES.map((s) => {
    const r = rows.find((x) => x.id === s.id)
    return { id: s.id, name: s.name, url: s.url, checkedAt: r?.checkedAt?.toISOString() ?? null, ok: r?.ok ?? null, message: r?.message ?? null }
  })
}

/** A notice seen on a page no robot reads, added by the reviewer: proposed from its title, hinted from its text. */
export async function addNotice(input: { url: string; title: string; board?: string | null; text?: string | null }, now = new Date()): Promise<NoticeDTO> {
  const proposals = await propose({ board: input.board ?? '' }, { key: input.url, url: input.url, title: input.title })
  if (input.text) for (const p of proposals) if (p.dates.length === 0) p.dates = datesInNotice(input.text, p.examKey, p.kind, now)
  const [row] = await db
    .insert(schema.notices)
    .values({
      source: MANUAL.id,
      key: `${input.url}#${now.getTime()}`,
      url: input.url,
      title: input.title,
      status: proposals.length > 0 ? 'pending' : 'unmatched',
      proposals,
      hints: input.text ? datesMentioned(input.text, now) : [],
      foundAt: now,
    })
    .returning()
  return toDTO(row!)
}

export async function dismissNotice(id: string, reviewerId: string, now = new Date()): Promise<boolean> {
  const done = await db
    .update(schema.notices)
    .set({ status: 'dismissed', reviewedAt: now, reviewedBy: reviewerId })
    .where(and(eq(schema.notices.id, id), sql`${schema.notices.status} in ('pending', 'unmatched')`))
    .returning({ id: schema.notices.id })
  return done.length > 0
}

// ── Result lists ─────────────────────────────────────────────────────────

/** Reading a list: a public PDF, or one a person handed over, page by page. */
export async function readList(data: Uint8Array): Promise<{ pages: string[][]; numbers: number; text: string } | null> {
  const pages = await pdfPages(data, 1000)
  if (!pages || pages.length === 0) return null
  const numbers = pages.map((p) => numbersIn(p))
  const count = numbers.reduce((s, p) => s + p.length, 0)
  return count > 0 ? { pages: numbers, numbers: count, text: pages.slice(0, 6).join('\n') } : null
}

/** A list kept for a notice, so a roll number added later can still be looked for. */
async function storeList(noticeId: string, list: { pages: string[][]; numbers: number }, now: Date) {
  await db
    .insert(schema.noticeLists)
    .values({ noticeId, pages: list.pages, numbers: list.numbers, readAt: now })
    .onConflictDoUpdate({ target: schema.noticeLists.noticeId, set: { pages: list.pages, numbers: list.numbers, readAt: now } })
}

/** The list a reviewer handed over: read, kept, and its cut-offs read for them to check. */
export async function uploadList(noticeId: string, data: Uint8Array, now = new Date()) {
  const list = await readList(data)
  if (!list) return null
  await storeList(noticeId, list, now)
  return { pages: list.pages.length, numbers: list.numbers, cutoffs: cutOffsIn(list.text) }
}

/**
 * The list for a notice: kept, or fetched from the public PDF — where
 * robots.txt allows, and only from a public https address.
 */
async function listFor(noticeId: string, url: string, fetcher: Fetcher, now: Date): Promise<{ pages: string[][]; numbers: number } | { problem: string }> {
  const [kept] = await db.select().from(schema.noticeLists).where(eq(schema.noticeLists.noticeId, noticeId))
  if (kept) return { pages: kept.pages, numbers: kept.numbers }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { problem: 'The list’s address is not a web address.' }
  }
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || /^(?:localhost|[\d.]+|\[.*\])$/.test(u.hostname)) {
    return { problem: 'Only a public https address is fetched.' }
  }
  if (!(await mayRead(fetcher, url, new Map()))) return { problem: 'Its robots.txt asks robots not to read it: upload the PDF instead.' }
  const file = await get(fetcher, url, 40 * 1024 * 1024)
  if (!file.body) return { problem: file.status ? `It answered ${file.status}: upload the PDF instead.` : 'It did not answer: upload the PDF instead.' }
  const list = await readList(new Uint8Array(file.body))
  if (!list) return { problem: 'No roll numbers could be read from it — a scan, perhaps: check it by hand.' }
  await storeList(noticeId, list, now)
  return list
}

const mask = (n: string) => `…${n.slice(-4)}`

/** Where a find leaves an exam: on to the round it is a shortlist for, or selected. */
function stageAfter(exam: ExamRow, list: ListMeaning): string | null {
  if (list.means === 'selected') return exam.stage === 'selected' ? null : 'selected'
  if (list.means === 'shortlist' && list.round && isLaterExamStage(exam.examKey, list.round, exam.stage)) return list.round
  return null
}

/** One exam looked for in one list: the look kept, the stage moved on a find. */
async function lookIn(exam: ExamRow, noticeId: string, list: ListMeaning, sets: Set<string>[], now: Date) {
  const page = findNumber(sets, [exam.rollNo, exam.registrationNo])
  await db
    .insert(schema.examListChecks)
    .values({ examId: exam.id, noticeId, found: page !== null, page, checkedAt: now })
    .onConflictDoUpdate({ target: [schema.examListChecks.examId, schema.examListChecks.noticeId], set: { found: page !== null, page, checkedAt: now } })
  const stage = page !== null ? stageAfter(exam, list) : null
  if (stage) await updateExam(exam.userId, exam.id, { stage }, now)
  return { found: page !== null, page, stage }
}

/**
 * A notice checked and approved, as the reviewer left it: onto every open
 * exam it is about, as plans with the notice in their notes, and each person
 * told once, with where to read it. Never twice: an approved notice is done.
 *
 * A result list in it is looked through for each person's roll (or
 * registration) number: found, the exam moves on and they are told so; not
 * found, they are told that too, carefully — lists are split by region,
 * category or post more often than not, and the notice is the word on it.
 */
export async function approveNotice(
  id: string,
  reviewerId: string,
  proposals: NoticeProposal[],
  now = new Date(),
  fetcher: Fetcher = watchFetch,
): Promise<{ told: number; checked: number; found: number; listNumbers: number | null; listProblem: string | null; alerted: number } | 'not_found' | 'already'> {
  const [row] = await db.select().from(schema.notices).where(eq(schema.notices.id, id))
  if (!row) return 'not_found'
  if (row.status === 'approved' || row.status === 'dismissed') return 'already'
  // Claimed first, so two reviewers approving at once tell nobody twice.
  const claimed = await db
    .update(schema.notices)
    .set({ status: 'approved', proposals, reviewedAt: now, reviewedBy: reviewerId })
    .where(and(eq(schema.notices.id, id), sql`${schema.notices.status} in ('pending', 'unmatched')`))
    .returning({ id: schema.notices.id })
  if (claimed.length === 0) return 'already'

  const told = new Set<string>()
  let checked = 0
  let found = 0
  let listNumbers: number | null = null
  let listProblem: string | null = null
  for (const p of proposals) {
    const summary = noticeSummary(p)
    const summaryHi = noticeLineHi(p.kind, p.dates, p.list ?? null)
    const exams = await examsForNotice(p.examKey, p.cycle)
    // The list, read once, if anyone tracking it has a number to look for.
    let sets: Set<string>[] | null = null
    if (p.list && exams.some((x) => x.rollNo || x.registrationNo)) {
      const got = await listFor(id, p.list.pdfUrl ?? row.url, fetcher, now)
      if ('pages' in got) {
        sets = got.pages.map((page) => new Set(page))
        listNumbers = got.numbers
      } else listProblem = got.problem
    }
    for (const exam of exams) {
      const number = exam.rollNo ?? exam.registrationNo
      const hi = (await langOf(exam.userId)) === 'hi'
      let body: string | null = null
      if (sets && p.list && number) {
        checked++
        const look = await lookIn(exam, id, p.list, sets, now)
        const roundLabel = p.list.round ? examStage(exam.examKey, p.list.round)?.label : null
        if (hi) {
          if (look.found) found++
          body = listFoundHi(mask(number), look.found, p.list.means, p.list.round)
        } else if (look.found) {
          found++
          body =
            p.list.means === 'selected'
              ? `${mask(number)} is in the list of those selected. Congratulations!`
              : p.list.means === 'shortlist'
                ? `${mask(number)} is in the list${roundLabel ? ` for ${roundLabel}` : ''}. On to the next round!`
                : `${mask(number)} is in the result list. Open the notice for the marks.`
        } else {
          body = `${mask(number)} was not found in this list. Lists are often split by region, category or post, so check the notice to be sure.`
        }
        // Dates still go on; a "go and look" plan is not needed once it has been looked for.
        if (p.dates.length > 0 && (await addNoticeToExam(exam, { url: row.url, kind: p.kind, summary, summaryHi, dates: p.dates }, now)) > 0) {
          await tellOfClashes(exam.userId, exam.id, p.dates.filter((d) => d.step === 'exam').map((d) => d.on), now)
        }
      } else {
        const added = await addNoticeToExam(exam, { url: row.url, kind: p.kind, summary, summaryHi, dates: p.dates }, now)
        // A day that lands on another exam's: said straight away, on its own.
        if (added > 0) await tellOfClashes(exam.userId, exam.id, p.dates.filter((d) => d.step === 'exam').map((d) => d.on), now)
        if (added > 0) {
          body = hi
            ? `${summaryHi}। आधिकारिक सूचना से — देखने के लिए टैप करें।`
            : `${summary.split(': ').slice(1).join(': ')}. From the official notice — tap to see it.`
        }
      }
      if (!body) continue
      told.add(exam.userId)
      await sendToUser(exam.userId, { title: examLabel(exam), body, tag: `notice-${id}-${exam.id}`, url: `/exams?exam=${exam.id}` }).catch(() => 0)
    }
  }
  let alerted = 0
  for (const p of proposals) alerted += await tellOfOpenForm(p, id, told, now)
  await db.update(schema.notices).set({ told: told.size }).where(eq(schema.notices.id, id))
  return { told: told.size, checked, found, listNumbers, listProblem, alerted }
}

/**
 * A form that has opened, told to those it may matter to: anyone tracking an
 * exam of the same family (SSC, railways, banks…) who is not tracking this
 * one, has not said no to these, and has not said they studied less than it
 * plainly asks for. Once per form: a later notice for the same exam and round
 * (a corrigendum, an extension) is not news. A board's calendar is a plan,
 * not an opening, and tells nobody.
 */
export async function formOpenedFor(p: NoticeProposal, noticeId: string, now: Date): Promise<{ userIds: string[]; applyBy: string } | null> {
  const today = ymd(now)
  const by = p.dates.find((d) => d.step === 'apply_by' && d.on >= today && !/tentative/i.test(d.note ?? ''))
  const exam = examByKey(p.examKey)
  if (!by || !exam) return null
  const before = await db
    .select({ id: schema.notices.id, proposals: schema.notices.proposals })
    .from(schema.notices)
    .where(and(eq(schema.notices.status, 'approved'), sql`${schema.notices.proposals} @> ${JSON.stringify([{ examKey: p.examKey, dates: [{ step: 'apply_by' }] }])}::jsonb`))
  const announced = before.some(
    (r) =>
      r.id !== noticeId &&
      r.proposals.some((x) => x.examKey === p.examKey && x.cycle === p.cycle && x.dates.some((d) => d.step === 'apply_by' && !/tentative/i.test(d.note ?? ''))),
  )
  if (announced) return null

  const family = EXAMS.filter((x) => examGroup(x) === examGroup(exam)).map((x) => x.key)
  const rows = await db
    .select({ userId: schema.exams.userId, examKey: schema.exams.examKey, cycle: schema.exams.cycle, closedAt: schema.exams.closedAt })
    .from(schema.exams)
    .where(inArray(schema.exams.examKey, family))
  const tracking = new Set(rows.filter((r) => r.examKey === p.examKey && (!r.cycle || !p.cycle || r.cycle === p.cycle)).map((r) => r.userId))
  const candidates = [...new Set(rows.filter((r) => !r.closedAt).map((r) => r.userId))].filter((u) => !tracking.has(u))
  if (candidates.length === 0) return { userIds: [], applyBy: by.on }
  const people = await db
    .select({ id: schema.users.id, level: schema.users.examLevel, training: schema.users.examTraining, alerts: schema.users.examFormAlerts })
    .from(schema.users)
    .where(inArray(schema.users.id, candidates))
  return {
    userIds: people.filter((x) => x.alerts && examFit(exam, { level: x.level, training: x.training }) !== 'needs').map((x) => x.id),
    applyBy: by.on,
  }
}

async function tellOfOpenForm(p: NoticeProposal, noticeId: string, already: Set<string>, now: Date): Promise<number> {
  const opened = await formOpenedFor(p, noticeId, now)
  const exam = examByKey(p.examKey)
  if (!opened || !exam) return 0
  const label = examLabel({ name: exam.name, cycle: p.cycle })
  let sent = 0
  for (const userId of opened.userIds.filter((u) => !already.has(u))) {
    const lang = await langOf(userId)
    const day = new Date(`${opened.applyBy}T00:00:00`).toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' })
    sent += await sendToUser(userId, {
      title: t(lang, '{exam}: forms open', { exam: label }),
      body: t(lang, 'Last date {day}. Add it, and its dates and reminders come with it.', { day }),
      tag: `form-${noticeId}`,
      url: '/exams',
    }).catch(() => 0)
  }
  return sent
}

/**
 * An exam's number looked for in the lists already kept for it — a roll
 * number added after its result came out. Nobody is notified: they are in
 * the app, adding it, and see the answer there.
 */
export async function checkKeptLists(exam: ExamRow, now = new Date()): Promise<number> {
  if (!exam.examKey || !(exam.rollNo || exam.registrationNo)) return 0
  const rows = await db
    .select({ id: schema.notices.id, proposals: schema.notices.proposals, pages: schema.noticeLists.pages })
    .from(schema.notices)
    .innerJoin(schema.noticeLists, eq(schema.noticeLists.noticeId, schema.notices.id))
    .where(and(eq(schema.notices.status, 'approved'), sql`${schema.notices.proposals} @> ${JSON.stringify([{ examKey: exam.examKey }])}::jsonb`))
  let n = 0
  for (const r of rows) {
    const p = r.proposals.find((x) => x.examKey === exam.examKey && x.list && (!x.cycle || !exam.cycle || x.cycle === exam.cycle))
    if (!p?.list) continue
    await lookIn(exam, r.id, p.list, r.pages.map((page) => new Set(page)), now)
    n++
  }
  return n
}

/** The result lists an exam's number was looked for in, newest first. */
export async function checksForExam(examId: string, examKey: string | null) {
  const rows = await db
    .select({
      noticeId: schema.examListChecks.noticeId,
      found: schema.examListChecks.found,
      page: schema.examListChecks.page,
      checkedAt: schema.examListChecks.checkedAt,
      title: schema.notices.title,
      url: schema.notices.url,
      proposals: schema.notices.proposals,
    })
    .from(schema.examListChecks)
    .innerJoin(schema.notices, eq(schema.notices.id, schema.examListChecks.noticeId))
    .where(eq(schema.examListChecks.examId, examId))
    .orderBy(desc(schema.examListChecks.checkedAt))
  return rows.map((r) => {
    const list = r.proposals.find((p) => p.examKey === examKey)?.list
    return {
      noticeId: r.noticeId,
      title: r.title,
      url: r.url,
      found: r.found,
      page: r.page,
      means: list?.means ?? 'result',
      round: list?.round ?? null,
      checkedAt: r.checkedAt.toISOString(),
    }
  })
}

/** The approved notices about one exam, newest first, for its page. */
export async function noticesForExam(examKey: string | null, cycle: string | null) {
  if (!examKey) return []
  const rows = await db
    .select()
    .from(schema.notices)
    .where(and(eq(schema.notices.status, 'approved'), sql`${schema.notices.proposals} @> ${JSON.stringify([{ examKey }])}::jsonb`))
    .orderBy(desc(schema.notices.reviewedAt))
    .limit(10)
  return rows
    .map((r) => ({ row: r, p: r.proposals.find((p) => p.examKey === examKey && (!p.cycle || !cycle || p.cycle === cycle)) }))
    .filter((x): x is { row: typeof x.row; p: NoticeProposal } => Boolean(x.p))
    .map(({ row, p }) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      summary: noticeSummary(p),
      reviewedAt: row.reviewedAt!.toISOString(),
      cutoffs: p.cutoffs ?? [],
    }))
}

/**
 * The newest cut-offs Cue holds for an exam, of any year: what an expected
 * score is held against before this year's result is out. From the most
 * recently approved result notice that gave them.
 */
export async function lastCutoffsFor(examKey: string | null) {
  if (!examKey) return null
  const rows = await db
    .select({ title: schema.notices.title, url: schema.notices.url, proposals: schema.notices.proposals })
    .from(schema.notices)
    .where(and(eq(schema.notices.status, 'approved'), sql`${schema.notices.proposals} @> ${JSON.stringify([{ examKey }])}::jsonb`))
    .orderBy(desc(schema.notices.reviewedAt))
    .limit(30)
  for (const r of rows) {
    const p = r.proposals.find((x) => x.examKey === examKey && (x.cutoffs ?? []).length > 0)
    if (p) return { title: r.title, url: r.url, cycle: p.cycle, round: p.list?.round ?? null, cutoffs: p.cutoffs! }
  }
  return null
}

/** Twice a day, a little after start. Off with NOTICE_WATCH=off. */
/**
 * The reviewers, told when a watch found new notices: nothing reaches an
 * aspirant until one is approved, so a queue nobody looks at is dates nobody
 * gets. One push per run, to each admin, naming the boards.
 */
export async function tellReviewers(runs: WatchRun[], send: typeof sendToUser = sendToUser): Promise<number> {
  const found = runs.filter((r) => r.added > 0)
  const added = found.reduce((n, r) => n + r.added, 0)
  if (added === 0 || env.adminEmails.length === 0) return 0
  const reviewers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(sql`lower(${schema.users.email})`, env.adminEmails.map((e) => e.toLowerCase())))
  const boards = [...new Set(found.map((r) => NOTICE_SOURCES.find((s) => s.id === r.source)?.board ?? r.source))].join(', ')
  let sent = 0
  for (const r of reviewers) {
    sent += await send(r.id, {
      title: added === 1 ? 'An exam notice to check' : `${added} exam notices to check`,
      body: `New from ${boards}. Nobody tracking those exams hears of them until you approve.`,
      url: '/admin/notices',
      tag: 'notices-review',
    })
  }
  return sent
}

export function startNoticeWatch(intervalMs = 12 * 60 * 60_000) {
  if (!env.noticeWatch) return () => undefined
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const runs = await tracked('exam-notices', intervalMs, runNoticeWatch)
      const added = runs.reduce((s, r) => s + r.added, 0)
      if (added > 0) console.log(`[notices] ${added} new notice(s) to review`)
      await tellReviewers(runs)
    } catch (err) {
      console.error('[notices] run failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  const first = setTimeout(run, 2 * 60_000)
  const handle = setInterval(run, intervalMs)
  return () => {
    clearTimeout(first)
    clearInterval(handle)
  }
}
