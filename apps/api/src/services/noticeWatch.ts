import https from 'node:https'
import { constants as cryptoConstants } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  cutOffsIn,
  datesMentioned,
  dateIn,
  examLabel,
  examStage,
  findNumber,
  isLaterExamStage,
  listFoundHi,
  noticeLineHi,
  noticeSummary,
  numbersIn,
  proposeFromNotice,
  type ListMeaning,
  type NoticeDTO,
  type NoticeProposal,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { env } from '../env.ts'
import { sendToUser } from '../push.ts'
import { addNoticeToExam, examsForNotice, langOf, updateExam, type ExamRow } from './exams.ts'
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
  /** Said before each title, so "Patwari 2025 : …" reads as this board's Patwari. */
  board: string
  url: string
  read: 'links' | 'rpsc-dates'
  /** For a page of links: which are notices. */
  linkPattern?: RegExp
}

/**
 * The pages watched: those that answer a named robot, allow it, and list
 * notices in the page itself. UPSC and NTA's exam sites refuse robots; SSC,
 * IBPS, RRB and Rajasthan Police build theirs in the browser, with nothing
 * to read in the page.
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
]

/** Notices added by hand, for the pages no robot can read. */
export const MANUAL = { id: 'manual', name: 'Added by hand' }

export interface FoundItem {
  key: string
  url: string
  title: string
  /** A table that gives the exam's day beside it. */
  examDate?: string | null
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

// ── Reading the pages ────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** What a found notice proposes, if it names an exam in the list. */
function propose(source: { board: string }, item: FoundItem): NoticeProposal[] {
  const p = proposeFromNotice({ title: item.title, board: source.board, examDate: item.examDate ?? null })
  return p ? [p] : []
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
  let pdfBudget = 5
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
    const items = source.read === 'rpsc-dates' ? readRpscDates(html, source.url) : readLinks(html, source.url, source.linkPattern)
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
      const proposals = propose(source, item)
      const ahead = Boolean(item.examDate && item.examDate >= ymd(now))
      const status = first && !ahead ? 'baseline' : proposals.length > 0 ? 'pending' : 'unmatched'
      let hints: string[] = []
      if (status === 'pending' && /\.pdf(?:$|\?)/i.test(item.url) && pdfBudget > 0 && (await mayRead(fetcher, item.url, cache))) {
        pdfBudget--
        await pause(1500)
        const file = await get(fetcher, item.url, 5 * 1024 * 1024)
        const text = file.body ? await pdfText(new Uint8Array(file.body), 3) : null
        if (text) {
          hints = datesMentioned(text, now)
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

export function isAdmin(email: string | null | undefined): boolean {
  return Boolean(email && env.adminEmails.includes(email.toLowerCase()))
}

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
  const proposals = propose({ board: input.board ?? '' }, { key: input.url, url: input.url, title: input.title })
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
): Promise<{ told: number; checked: number; found: number; listNumbers: number | null; listProblem: string | null } | 'not_found' | 'already'> {
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
        if (p.dates.length > 0) await addNoticeToExam(exam, { url: row.url, kind: p.kind, summary, summaryHi, dates: p.dates }, now)
      } else {
        const added = await addNoticeToExam(exam, { url: row.url, kind: p.kind, summary, summaryHi, dates: p.dates }, now)
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
  await db.update(schema.notices).set({ told: told.size }).where(eq(schema.notices.id, id))
  return { told: told.size, checked, found, listNumbers, listProblem }
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

/** Twice a day, a little after start. Off with NOTICE_WATCH=off. */
export function startNoticeWatch(intervalMs = 12 * 60 * 60_000) {
  if (!env.noticeWatch) return () => undefined
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const runs = await runNoticeWatch()
      const added = runs.reduce((s, r) => s + r.added, 0)
      if (added > 0) console.log(`[notices] ${added} new notice(s) to review`)
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
