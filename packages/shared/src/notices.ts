/**
 * Official notices: what an exam board publishes for everyone — a new
 * notification, exam dates, admit cards out, an answer key, a result, a
 * document verification schedule. Read into a proposal — which exam, what
 * kind of notice, which dates — that a person checks against the notice
 * before anyone tracking that exam is told. A wrong exam date sent to
 * everyone sitting it does real harm; a proposal costs a minute to check.
 */
import { cycleIn, dateIn, examByKey, examStage, findExam, roundIn, type ExamStep } from './exams.ts'
import type { CutOff, ListMeaning } from './results.ts'

export const NOTICE_KINDS = [
  { key: 'notification', label: 'Notification: applications open' },
  { key: 'schedule', label: 'Exam dates' },
  { key: 'admit_card', label: 'Admit cards out' },
  { key: 'answer_key', label: 'Answer key' },
  { key: 'result', label: 'Result' },
  { key: 'dv', label: 'Document verification' },
  { key: 'other', label: 'Other notice' },
] as const
export type NoticeKind = (typeof NOTICE_KINDS)[number]['key']
export const NOTICE_KIND_KEYS = NOTICE_KINDS.map((k) => k.key) as [NoticeKind, ...NoticeKind[]]

export interface NoticeDate {
  step: ExamStep
  on: string
  at: string | null
  round: string | null
  /** What it is, for a date that is not one of an exam's usual ones: "Mains ends". */
  note: string | null
}

/** One exam's part of a notice: which exam and year, what kind of notice, and its dates. */
export interface NoticeProposal {
  examKey: string
  cycle: string | null
  kind: NoticeKind
  dates: NoticeDate[]
  /** A list of roll numbers in it, and what being on it means: checked for each person's number. */
  list?: ListMeaning | null
  /** Cut-offs by category, as the notice gives them. */
  cutoffs?: CutOff[]
}

const KIND_WORDS: [NoticeKind, RegExp][] = [
  ['answer_key', /\b(?:answer\s+keys?|model\s+answers?)\b/i],
  ['result', /\b(?:results?|final\s+recommendation|merit\s+list|cut[\s-]?off|score\s*cards?|selection\s+list)\b/i],
  ['admit_card', /\b(?:admit\s+cards?|hall\s+tickets?|call\s+letters?|e-?admit)\b/i],
  ['dv', /\b(?:document\s+verification|dv\s+schedule|scrutiny\s+form|counsell?ing)\b/i],
  [
    'schedule',
    /\b(?:exam(?:ination)?\s+(?:schedule|dates?|time\s*table|calendar|programme)|time\s*table|date\s+sheet|schedule\s+of\s+(?:the\s+)?exam|press\s+note\s+(?:for|regarding)\s+(?:upcoming\s+)?exam)/i,
  ],
  ['notification', /\b(?:advertisement|notification|online\s+applications?|apply\s+online|recruitment\s+notice|vacanc(?:y|ies))\b/i],
]

/** What kind of notice a title says it is. */
export function noticeKind(title: string): NoticeKind {
  return KIND_WORDS.find(([, re]) => re.test(title))?.[0] ?? 'other'
}

/**
 * Every date still to come in a notice's text, in order: hints for whoever
 * reads it, not proposals — a press note in Hindi, set in an old font, can
 * be read for its dates and nothing else.
 */
export function datesMentioned(text: string, now = new Date()): string[] {
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const out = new Set<string>()
  const re = /\b\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*20\d\d\b|\b\d{1,2}(?:st|nd|rd|th)?[\s-]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.-]*20\d\d\b/gi
  for (const m of text.matchAll(re)) {
    const d = dateIn(m[0])
    if (d && d >= today) out.add(d)
  }
  return [...out].sort().slice(0, 20)
}

const DAY = /\b\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*20\d\d\b|\b\d{1,2}(?:st|nd|rd|th)?[\s-]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.-]*20\d\d\b/gi

/**
 * The dates a notice's own words give, each by what is said beside it: the
 * last day to apply, to pay the fee, the correction window, the exam, the
 * admit card, the window to challenge an answer key. Read out of a PDF, a
 * table often leaves a label on one line and its date on the next, so a
 * line that is only a date takes the words of the line before. Only dates
 * still to come, for the reviewer to check rather than type.
 */
export function datesInNotice(text: string, examKey: string, kind: NoticeKind, now = new Date()): NoticeDate[] {
  if (kind === 'result' || kind === 'dv') return []
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const out: NoticeDate[] = []
  const add = (step: ExamStep, on: string, round: string | null = null) => {
    if (on >= today && !out.some((d) => d.step === step && d.round === round)) out.push({ step, on, at: null, round, note: null })
  }
  // Lines, and sentences within them: "Admit cards from 5 Nov. The exam will be held on 12 Nov."
  const lines = text
    .split(/\r?\n|(?<=[.।])\s+(?=[A-Zऀ-ॿ])/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  let label = ''
  for (const line of lines) {
    const days = [...line.matchAll(DAY)].map((m) => dateIn(m[0])).filter((d): d is string => d !== null)
    if (days.length === 0) {
      label = line.length <= 200 ? line : ''
      continue
    }
    const own = line.replace(DAY, ' ').replace(/[\s:–\-(),.]|to|from|hours?|hrs/gi, '')
    const words = own.length < 8 ? `${label} ${line}` : line
    label = ''
    const first = days[0]!
    const last = days[days.length - 1]!
    const range = days.length > 1
    if (/\b(?:opening|commencement|starting)\s+date\b|\bstart\s+date\b/i.test(words) && !/\b(?:last|closing)\b/i.test(words)) continue
    if (/objection|challenge|representation|आपत्ति/i.test(words)) {
      if (kind === 'answer_key' || /answer\s*key|उत्तर\s*कुंजी/i.test(words)) add('answer_key', last)
      continue
    }
    if (kind === 'answer_key') continue
    if (/correction|edit\s+window|संशोधन|सुधार/i.test(words)) add('correction', last)
    else if (/\bfee\b|\bfees\b|payment|शुल्क/i.test(words) && /\b(?:last|closing|up\s*to|till)\b|अंतिम|अन्तिम/i.test(words)) add('fee_by', last)
    else if (
      (/\b(?:last|closing)\s+date\b|\bup\s*to\b|\btill\b|अंतिम\s+तिथि|अन्तिम\s+तिथि|अंतिम\s+दिनांक/i.test(words) || range) &&
      /appli|registration|submission|form|आवेदन/i.test(words)
    )
      add('apply_by', last)
    else if (/admit\s*cards?|e-?admit|call\s+letters?|hall\s+tickets?|प्रवेश\s*पत्र/i.test(words)) add('admit_card', first)
    else if (
      /date\s+of\s+(?:the\s+)?(?:exam(?:ination)?|test|cbt)|(?:exam(?:ination)?|test|cbt)\s+(?:date|will\s+be\s+(?:held|conducted))|\b(?:held|conducted|scheduled)\s+(?:on|from)\b|परीक्षा\s+(?:तिथि|दिनांक)|परीक्षा\s+का\s+आयोजन/i.test(words)
    )
      add('exam', first, roundIn(examKey, words))
  }
  return out
}

/**
 * What a notice proposes for the exam it names: from its title — with the
 * board's name before it, so "Patwari 2025 : …" on RSSB's page reads as
 * RSSB's Patwari — and, where the board publishes one, the exam date beside
 * it. Null when it names no exam in the list.
 */
export function proposeFromNotice(input: { title: string; board?: string; examDate?: string | null }): NoticeProposal | null {
  const text = input.board ? `${input.board} ${input.title}` : input.title
  const found = findExam(text)
  if (!found) return null
  const examKey = found.exam.key
  const round = roundIn(examKey, input.title)
  const dates: NoticeDate[] = []
  if (input.examDate) {
    // A range comes as two rows, its start and its end: the start is the exam.
    const ends = /\(\s*end\s+date\s*\)/i.test(input.title)
    const label = round ? (examStage(examKey, round)?.label ?? 'Exam') : 'Exam'
    dates.push(
      ends
        ? { step: 'other', on: input.examDate, at: null, round, note: `${label} ends` }
        : { step: 'exam', on: input.examDate, at: null, round, note: null },
    )
  }
  const kind = input.examDate ? 'schedule' : noticeKind(input.title)
  return { examKey, cycle: cycleIn(text, found).cycle, kind, dates, list: listIn(examKey, kind, input.title) }
}

/**
 * Whether a notice is a list of roll numbers, and what being on it means:
 * a final result or recommendation is selection; a shortlist, or a call to
 * document verification, is the next round; any other result, just marks.
 */
export function listIn(examKey: string, kind: NoticeKind, title: string): ListMeaning | null {
  if (kind === 'dv') {
    const dv = examStage(examKey, 'dv') ? 'dv' : null
    return { means: 'shortlist', round: dv, pdfUrl: null }
  }
  if (kind !== 'result') return null
  if (/\bfinal\s+(?:result|selection|recommendation|merit)|\brecommend|\bselected\b/i.test(title)) return { means: 'selected', round: null, pdfUrl: null }
  if (/\bshort[\s-]?list|\bqualified\b|\bprovisional/i.test(title)) return { means: 'shortlist', round: roundIn(examKey, title.replace(/^.*?\bfor\b/i, '')), pdfUrl: null }
  return { means: 'result', round: null, pdfUrl: null }
}

const day = (on: string) => {
  const [y, m, d] = on.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** What everyone tracking the exam is told, in one line. */
export function noticeSummary(p: NoticeProposal): string {
  const exam = examByKey(p.examKey)
  const name = exam ? `${exam.name}${p.cycle && !exam.name.includes(p.cycle) ? ` ${p.cycle}` : ''}` : p.examKey
  const said = p.dates.map((d) => {
    const round = d.round ? examStage(p.examKey, d.round)?.label : null
    switch (d.step) {
      case 'exam':
        return `${round && round !== 'Exam' ? round : 'exam'} on ${day(d.on)}`
      case 'apply_by':
        return `apply by ${day(d.on)}`
      case 'fee_by':
        return `fee by ${day(d.on)}`
      case 'correction':
        return `correction window ${day(d.on)}`
      case 'admit_card':
        return `admit cards from ${day(d.on)}`
      case 'answer_key':
        return `objections till ${day(d.on)}`
      case 'result':
        return `result ${day(d.on)}`
      default:
        return d.note ? `${d.note[0]!.toLowerCase()}${d.note.slice(1)} ${day(d.on)}` : day(d.on)
    }
  })
  // A list says what it is: "CBT 2 shortlist out", "final result out".
  const listRound = p.list?.round ? examStage(p.examKey, p.list.round)?.label : null
  const listed =
    p.list?.means === 'shortlist'
      ? `${listRound ? `${listRound} ` : ''}shortlist out`
      : p.list?.means === 'selected'
        ? 'final result out'
        : null
  const what =
    said.length > 0
      ? said.join(', ')
      : listed ?? {
          notification: 'applications open',
          schedule: 'exam dates announced',
          admit_card: 'admit cards out',
          answer_key: 'answer key out',
          result: 'result out',
          dv: 'document verification schedule out',
          other: 'new notice',
        }[p.kind]
  return `${name}: ${what}`
}
