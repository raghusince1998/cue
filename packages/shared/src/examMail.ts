/**
 * What an exam board's email says about one person's exam: a registration
 * gone through, a fee still to pay, the exam city, an admit card out, an
 * answer key, a result, a shortlist for the next round. Read from the email
 * only; nothing is fetched from any portal.
 *
 * An OTP or a password reset is none of these, and a password a board puts
 * in a registration email is never read out of it: only the exam, its
 * numbers, its round and its dates are.
 */
import { findCity } from './cities.ts'
import {
  cycleIn,
  dateIn,
  examStages,
  examStepOf,
  findExam,
  registrationNoIn,
  rollNoIn,
  roundIn,
  timesIn,
  valueOf,
  type ExamDateSaid,
} from './exams.ts'

export type ExamMailKind =
  | 'registered'
  | 'fee_due'
  | 'fee_paid'
  | 'city_slip'
  | 'admit_card'
  | 'answer_key'
  | 'result'
  | 'shortlisted'
  | 'selected'
  | 'schedule'

export interface ExamMail {
  kind: ExamMailKind
  examKey: string
  name: string
  cycle: string | null
  registrationNo: string | null
  rollNo: string | null
  /** The round it is about: the one its admit card, city or result is for. */
  round: string | null
  /** For a shortlist: the round they go on to. */
  nextRound: string | null
  /** The exam's city, from a city intimation slip. */
  city: string | null
  dates: ExamDateSaid[]
}

/**
 * Sent by the body itself — a government, board or testing-agency address —
 * rather than a coaching site passing on the news. Only these can start an
 * exam; anyone else can only add to one already tracked.
 */
export function isExamBody(from: string): boolean {
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from
  return /@(?:[\w-]+\.)*(?:gov\.in|nic\.in|ibps\.in|nta\.ac\.in|sbi\.co\.in|sbi\.bank\.in|bank\.sbi|rbi\.org\.in|licindia\.(?:in|com)|jeeadv\.ac\.in|iimcat\.ac\.in|consortiumofnlus\.ac\.in|cdac\.in)\s*$/i.test(address.trim())
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Not about an exam at all, whatever exam it names: a code to type, a password to reset. */
const ACCOUNT_ONLY = /\b(?:otp|one[\s-]time\s+password|verification\s+code|reset\s+(?:your\s+)?password|password\s+reset|forgot\s+password)\b/i

const KINDS: [ExamMailKind, RegExp][] = [
  ['selected', /\b(?:finally|provisionally)\s+selected\b|\bselected\s+for\s+appointment\b/i],
  ['shortlisted', /\b(?:shortlisted|have\s+qualified|are\s+qualified|declared\s+qualified)\s+(?:provisionally\s+)?for\b/i],
  ['city_slip', /\b(?:city\s+intimation|advance\s+(?:city\s+)?intimation|exam(?:ination)?\s+city\s+(?:slip|details|intimation))\b/i],
  ['answer_key', /\banswer\s+keys?\b/i],
  ['result', /\bresults?\b[^.\n]{0,80}\b(?:declared|announced|published|out|released|available)\b|\b(?:declared|announced|published)\b[^.\n]{0,40}\bresults?\b/i],
  ['admit_card', /\b(?:e-?admit\s+card|admit\s+card|hall\s+ticket|call\s+letter)\b/i],
  ['fee_paid', /\b(?:fee|payment)\b[^.\n]{0,60}\b(?:received|successful(?:ly)?|confirmed)\b/i],
  ['fee_due', /\b(?:complete\s+(?:your\s+)?application|pay(?:ment\s+of)?\s+(?:the\s+)?(?:application\s+|examination\s+)?fee|fee\s+(?:payment\s+)?(?:is\s+)?pending|fee\s+(?:has\s+)?not\s+(?:yet\s+)?(?:been\s+)?(?:received|paid))\b/i],
  ['registered', /\b(?:successfully\s+(?:registered|submitted)|registration\s+(?:is\s+)?(?:successful|complete[d]?)|application\s+(?:has\s+been\s+|is\s+)?(?:successfully\s+)?(?:submitted|received|completed)|thank\s+you\s+for\s+(?:registering|applying))\b/i],
  ['schedule', /\bexam(?:ination)?\s+(?:will\s+be|is\s+(?:being\s+)?|shall\s+be\s+)(?:held|conducted|scheduled)\b|\bschedule\s+of\s+(?:the\s+)?exam/i],
]

/** The exam's day as an admit card or a city slip prints it. */
const EXAM_DAY = /date\s+of\s+(?:the\s+)?(?:exam(?:ination)?|test|cbt)|(?:exam(?:ination)?|test|cbt)\s+date/
const EXAM_CITY = /(?:exam(?:ination)?|test)\s+city|city\s+of\s+(?:the\s+)?exam(?:ination)?|allotted\s+city/

/** "KOTA (RAJASTHAN)" is Kota. */
function cityFrom(value: string): string | null {
  const known = findCity(value)
  if (known) return known
  const word = value.replace(/\(.*?\)/g, '').replace(/[^A-Za-z\s-]/g, ' ').trim()
  return word.length >= 3 ? word.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null
}

/**
 * An exam board's email, read for the one exam it is about. Null when it
 * names no exam in the list, says nothing an exam can act on, or is only a
 * code or a password.
 */
export function parseExamEmail(text: string, now = new Date()): ExamMail | null {
  const found = findExam(text)
  if (!found) return null
  const kind = KINDS.find(([, re]) => re.test(text))?.[0] ?? null
  if (!kind) return null
  if (ACCOUNT_ONLY.test(text) && (kind === 'registered' || kind === 'fee_due')) {
    // "Your OTP for registration is 482913": a code, not a registration.
    if (!/\b(?:successfully|submitted|registration\s+(?:no|number|id))\b/i.test(text)) return null
  }
  const { exam } = found
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const round = roundIn(exam.key, text)
  const today = ymd(now)

  // The days it gives, each by the words beside it.
  const dates: ExamDateSaid[] = []
  const add = (d: ExamDateSaid) => {
    if (d.on >= today && !dates.some((x) => x.step === d.step && x.on === d.on)) dates.push(d)
  }
  const examDay = valueOf(lines, EXAM_DAY)
  const examOn = examDay ? dateIn(examDay.value) : null
  const timeOf = (s: string) => timesIn(s)[0] ?? null
  if (examOn && kind !== 'result') add({ step: 'exam', on: examOn, at: null, round })
  for (const line of lines) {
    // A range — "from 10/11/2026 to 13/11/2026" — means its last day.
    const all = [...line.matchAll(/\b\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*20\d\d\b|\b\d{1,2}(?:st|nd|rd|th)?[\s-]*[A-Za-z]{3,9}[\s,.-]*20\d\d\b/g)]
      .map((m) => dateIn(m[0]))
      .filter((d): d is string => d !== null)
    if (all.length === 0) continue
    const on = all[all.length - 1]!
    if (kind === 'answer_key' && /\b(?:objection|challenge|representation)s?\b/i.test(line)) {
      add({ step: 'answer_key', on, at: timeOf(line), round })
    } else if ((kind === 'fee_due' || kind === 'registered') && /\bfee\b|\bcomplete\b/i.test(line)) {
      add({ step: 'fee_by', on, at: timeOf(line), round: null })
    } else if (kind === 'admit_card' && /\b(?:available|download)\b[^.]*\bfrom\b/i.test(line)) {
      add({ step: 'admit_card', on: all[0]!, at: null, round })
    } else if (kind !== 'result' && kind !== 'answer_key') {
      const step = examStepOf(line)
      // "…to be held on 24.05.2027": the exam's day, whatever else the line names.
      const held = /\b(?:held|conducted|scheduled)\s+(?:on|from)\b/i.test(line)
      if (held || step === 'exam') {
        add({ step: 'exam', on: all[0]!, at: null, round: roundIn(exam.key, line) ?? round })
      } else if (step === 'apply_by') add({ step: 'apply_by', on, at: timeOf(line), round: null })
    }
  }

  // A shortlist: which round it leads to.
  let nextRound: string | null = null
  if (kind === 'shortlisted') {
    const m = /\b(?:shortlisted|qualified)\s+(?:provisionally\s+)?for\s+(?:the\s+)?([^.,\n]{3,60})/i.exec(text)
    nextRound = m ? roundIn(exam.key, m[1]!) : null
    if (!nextRound) {
      // "qualified for the next stage": the round after this one.
      const order = examStages(exam.key).filter((s) => !s.closed)
      const i = round ? order.findIndex((s) => s.key === round) : -1
      nextRound = i >= 0 && order[i + 1] ? order[i + 1]!.key : null
    }
  }

  const cityLine = kind === 'city_slip' || kind === 'admit_card' ? valueOf(lines, EXAM_CITY) : null
  return {
    kind,
    examKey: exam.key,
    name: exam.name,
    cycle: cycleIn(text, found).cycle,
    registrationNo: registrationNoIn(text),
    rollNo: rollNoIn(text),
    round,
    nextRound,
    city: cityLine ? cityFrom(cityLine.value) : null,
    dates,
  }
}
