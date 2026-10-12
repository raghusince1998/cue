import { env } from '../env.ts'

/**
 * Reading a line the rules could not.
 *
 * The capture box is a rule-based reader first: instant, free, offline and the
 * same every time, and it gets the ordinary lines right. What it cannot do is
 * Hinglish it has no rule for ("mom ko sham ko call karna hai"), or know when
 * a line is too vague to plan ("doctor", "call him later") and a question is
 * the honest answer. Those lines — and only those — come here, to Claude.
 *
 * What is sent is the line and today's date. Not the person's name, email,
 * contacts or anything else in their account. Nothing is saved from here: the
 * reading becomes a preview, and the person still presses save.
 *
 * Off unless the server has its own key (ANTHROPIC_API_KEY). With no key, or
 * on any error or timeout, the rules' reading stands, exactly as before.
 */

export type AiKind = 'plan' | 'repeat' | 'trip' | 'wish' | 'ask' | 'not_a_plan'
export type AiPart = 'morning' | 'afternoon' | 'evening' | 'night'

export interface AiReading {
  kind: AiKind
  title: string
  /** YYYY-MM-DD. */
  date: string | null
  /** HH:MM, 24-hour, only when said or plainly meant. */
  time: string | null
  partOfDay: AiPart | null
  /** A trip's last day. */
  endDate: string | null
  repeat: { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number; weekdays: number[]; monthDay: number | null } | null
  place: string | null
  person: string | null
  planKind: 'task' | 'meeting' | 'callback' | 'followup'
  /** For an ask: one short question. */
  question: string | null
  /** For an ask: answers to tap, each read naturally on the end of the line. */
  choices: string[]
  /** What was decided that the line did not say. */
  assumptions: string[]
}

export function captureAiEnabled(): boolean {
  return Boolean(env.captureAiKey) || testReader !== null
}

// ------------------------------------------------------------------ the call

const SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['plan', 'repeat', 'trip', 'wish', 'ask', 'not_a_plan'],
      description:
        'plan: once. repeat: regularly. trip: away for whole days. wish: to do when next in a place, no date. ask: a guess would be wrong too often. not_a_plan: nothing to plan.',
    },
    title: { type: 'string', description: 'Short, plain English, their names kept, no date or time words' },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD, never in the past' },
    time: { type: ['string', 'null'], description: 'HH:MM 24-hour, only if said or plainly meant' },
    partOfDay: { type: ['string', 'null'], enum: ['morning', 'afternoon', 'evening', 'night', null] },
    endDate: { type: ['string', 'null'], description: 'Last day, for a trip' },
    repeat: {
      type: ['object', 'null'],
      properties: {
        freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] },
        interval: { type: 'integer', minimum: 1 },
        weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: '0 is Sunday' },
        monthDay: { type: ['integer', 'null'], minimum: 1, maximum: 31 },
      },
      required: ['freq', 'interval', 'weekdays', 'monthDay'],
    },
    place: { type: ['string', 'null'], description: 'A city or place, for a trip or a wish' },
    person: { type: ['string', 'null'] },
    planKind: { type: 'string', enum: ['task', 'meeting', 'callback', 'followup'] },
    question: { type: ['string', 'null'] },
    choices: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    assumptions: { type: 'array', items: { type: 'string' }, maxItems: 2 },
  },
  required: ['kind', 'title', 'date', 'time', 'partOfDay', 'endDate', 'repeat', 'place', 'person', 'planKind', 'question', 'choices', 'assumptions'],
} as const

function system(now: Date): string {
  const today = now.toLocaleString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return [
    'You read one line someone typed into Cue, their planner, and say what they want planned.',
    `It is now ${today}, in India. Lines are often English, Hindi written in English letters, or a mix:`,
    '"kal" is tomorrow or yesterday, "parso" two days away, "subah" morning, "dopahar" afternoon, "sham/shaam ko" in the evening, "raat" night, "karna hai" means they need to.',
    '',
    'Rules:',
    '- One thing to plan. Choose its kind.',
    '- Ask rather than guess when a wrong guess would matter: a meeting or appointment with no time, "call him/her" with no name, a single vague word like "doctor". Then kind is "ask", with one short question and 2 to 4 choices that answer it, each written to read naturally on the end of their line, such as "tomorrow 10am" or "on Friday at 3pm".',
    '- An errand with no time that could happen any time today (buy milk, call mom) is a plan for today with a partOfDay, not a question.',
    '- title: short, in plain English, keeping their names; no date or time words in it.',
    '- date: YYYY-MM-DD, never in the past. time: only if said or plainly meant; a part of the day goes in partOfDay, not time.',
    '- Only facts from the line. Never invent a person, a place or a time.',
    '- assumptions: what you decided that the line did not say, in a few plain words each.',
  ].join('\n')
}

type Reader = (text: string, now: Date) => Promise<unknown>

/** Replaced in tests: no test calls the network. */
let testReader: Reader | null = null
export function setCaptureAiForTest(reader: Reader | null): void {
  testReader = reader
  cache.clear()
  used.clear()
}

async function callClaude(text: string, now: Date): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.captureAiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.captureAiModel,
      max_tokens: 600,
      system: system(now),
      // Forcing the tool is what guarantees a reading in the shape below.
      tools: [{ name: 'record_plan', description: 'Record what the line asks to plan.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'record_plan' },
      messages: [{ role: 'user', content: text }],
    }),
    // A preview that hangs is worse than one that reads less well.
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { content?: { type: string; input?: unknown }[] }
  const call = data.content?.find((c) => c.type === 'tool_use')
  if (!call?.input) throw new Error('no structured reading')
  return call.input
}

// ------------------------------------------------------------- the checking

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** A model's answer, made safe: anything malformed is dropped, not trusted. */
export function sanitiseReading(raw: unknown): AiReading | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const kinds: AiKind[] = ['plan', 'repeat', 'trip', 'wish', 'ask', 'not_a_plan']
  const kind = kinds.includes(r.kind as AiKind) ? (r.kind as AiKind) : null
  const title = str(r.title, 120)
  if (!kind || (!title && kind !== 'not_a_plan')) return null

  const date = typeof r.date === 'string' && DATE.test(r.date) && !Number.isNaN(new Date(`${r.date}T00:00:00`).getTime()) ? r.date : null
  const endDate = typeof r.endDate === 'string' && DATE.test(r.endDate) ? r.endDate : null
  const time = typeof r.time === 'string' && TIME.test(r.time) ? r.time : null
  const parts: AiPart[] = ['morning', 'afternoon', 'evening', 'night']
  const partOfDay = parts.includes(r.partOfDay as AiPart) ? (r.partOfDay as AiPart) : null

  let repeat: AiReading['repeat'] = null
  if (typeof r.repeat === 'object' && r.repeat !== null) {
    const p = r.repeat as Record<string, unknown>
    const freqs = ['daily', 'weekly', 'monthly', 'yearly'] as const
    const freq = freqs.find((f) => f === p.freq)
    const interval = Number(p.interval)
    if (freq && Number.isInteger(interval) && interval >= 1 && interval <= 12) {
      const weekdays = Array.isArray(p.weekdays)
        ? [...new Set(p.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
        : []
      const monthDay = Number.isInteger(Number(p.monthDay)) && Number(p.monthDay) >= 1 && Number(p.monthDay) <= 31 ? Number(p.monthDay) : null
      repeat = { freq, interval, weekdays, monthDay }
    }
  }
  if (kind === 'repeat' && !repeat) return null

  const planKinds = ['task', 'meeting', 'callback', 'followup'] as const
  const list = (v: unknown, n: number, max: number) =>
    Array.isArray(v) ? v.map((x) => str(x, max)).filter((x): x is string => x !== null).slice(0, n) : []

  return {
    kind,
    title: title ?? '',
    date,
    time,
    partOfDay,
    endDate,
    repeat,
    place: str(r.place, 60),
    person: str(r.person, 60),
    planKind: planKinds.find((k) => k === r.planKind) ?? 'task',
    question: kind === 'ask' ? str(r.question, 160) : null,
    choices: kind === 'ask' ? list(r.choices, 4, 40) : [],
    assumptions: list(r.assumptions, 2, 160),
  }
}

// ------------------------------------------------------ cost and consistency

/**
 * What was read, per person and line, for a quarter of an hour. Preview and
 * save must agree, so save uses the reading the preview showed rather than
 * asking again and perhaps getting a different answer.
 */
const cache = new Map<string, { reading: AiReading; at: number }>()
const CACHE_MS = 15 * 60_000

/** Readings per person per day, so one account cannot run up the bill. */
const used = new Map<string, { day: string; n: number }>()

const keyOf = (userId: string, text: string) => `${userId}\n${text.trim().toLowerCase()}`

/** The reading the preview already showed for this line, if any. */
export function cachedReading(userId: string, text: string): AiReading | null {
  const hit = cache.get(keyOf(userId, text))
  if (!hit || Date.now() - hit.at > CACHE_MS) return null
  return hit.reading
}

/**
 * Reads a line with Claude, or null when it is off, over today's allowance,
 * or anything at all goes wrong — in which case the rules' reading stands.
 */
export async function readWithAi(
  userId: string,
  text: string,
  now: Date,
  opts: { isDemo?: boolean } = {},
): Promise<AiReading | null> {
  if (!captureAiEnabled()) return null
  const hit = cachedReading(userId, text)
  if (hit) return hit

  const day = now.toDateString()
  const count = used.get(userId)
  const n = count && count.day === day ? count.n : 0
  if (n >= (opts.isDemo ? env.captureAiDemoLimit : env.captureAiDailyLimit)) return null
  used.set(userId, { day, n: n + 1 })

  try {
    const raw = testReader ? await testReader(text, now) : await callClaude(text, now)
    const reading = sanitiseReading(raw)
    if (!reading) return null
    if (cache.size > 2000) cache.clear()
    cache.set(keyOf(userId, text), { reading, at: Date.now() })
    return reading
  } catch (err) {
    console.warn('[capture-ai] reading failed:', (err as Error).message)
    return null
  }
}
