/**
 * Official notices: what an exam board publishes for everyone — a new
 * notification, exam dates, admit cards out, an answer key, a result, a
 * document verification schedule. Read into a proposal — which exam, what
 * kind of notice, which dates — that a person checks against the notice
 * before anyone tracking that exam is told. A wrong exam date sent to
 * everyone sitting it does real harm; a proposal costs a minute to check.
 */
import { cycleIn, dateIn, examByKey, examStage, findExam, roundIn, type ExamStep } from './exams.ts'

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
  return { examKey, cycle: cycleIn(text, found).cycle, kind: input.examDate ? 'schedule' : noticeKind(input.title), dates }
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
  const what =
    said.length > 0
      ? said.join(', ')
      : {
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
