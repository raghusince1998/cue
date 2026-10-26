/**
 * Work or personal: which half of someone's life a plan belongs to.
 *
 * Read from the plan's own words, the way a person sorts their own day —
 * "client call", "Q3 report", "standup" are work; "mom", "dentist", "gym",
 * "sabzi" are not. A plan that says neither is left unsorted rather than
 * guessed at, and anything the person sorts themselves is kept as they said.
 *
 * Worked out when a plan is read, not stored when it is made, so every way
 * a plan arrives — typed, from a calendar, a repeat, a booking from email —
 * is sorted by the same rules, and better rules sort old plans too.
 */

export type Sphere = 'work' | 'personal'
export const SPHERES = ['work', 'personal'] as const

const WORK_WORDS =
  /\b(?:meeting|client|customer|standup|stand-up|scrum|sync|1:1|one-on-one|review|report|deck|slides|presentation|pr|pull request|deploy(?:ment)?|release|sprint|invoice|proposal|quotation|purchase order|office|team|manager|boss|hr|interview|candidate|offer letter|onboarding|appraisal|payroll|salary|timesheet|vendor|supplier|audit|gst|tds|board|kpi|okr|q[1-4]|quarterly|webinar|conference|workshop|demo|pitch|deal|leads?|colleague|project|deadline|jira|ticket|bug|server|site visit|dispatch|stock|inventory|recruiter|resume|cv|job|shift|business)\b/gi

const PERSONAL_WORDS =
  /\b(?:mom|mum|mummy|maa|mother|dad|papa|father|wife|husband|kids?|son|daughter|baby|family|bhai|didi|brother|sister|uncle|aunty|aunt|nani|nana|dadi|dada|grandma|grandpa|friends?|birthday|bday|anniversary|wedding|party|doctor|dentist|hospital|clinic|health|check-?ups?|medicines?|tablets?|vitamins?|physio(?:therapy)?|vaccin(?:e|ation)|dawai|pharmacy|gym|yoga|walk|jog|swim(?:ming)?|grocer(?:y|ies)|milk|doodh|sabzi|vegetables|fruits|haircut|salon|parlou?r|movie|netflix|temple|mandir|church|masjid|gurudwara|puja|pooja|school|pta|tuition|pickup|laundry|dry ?clean(?:ing)?|ironing|maid|cook|plumber|electrician|carpenter|rent|electricity|cylinder|recharge|car service|bike service|puc|insurance|passport|aadhaar|shopping|parcel|vacation|holiday|picnic|date night|home)\b/gi

/** What a plan is, besides its words, that says which half it is. */
export interface SphereHints {
  kind?: string | null
  /** A train, flight, hotel or show booked: personal, unless it says business. */
  booking?: boolean
  /** The tracker board it is a step of: hiring and deals are work. */
  board?: string | null
}

function hits(re: RegExp, text: string): number {
  return new Set([...text.matchAll(re)].map((m) => m[0]!.toLowerCase())).size
}

/** Work, personal, or null when the plan does not say. */
export function sphereOf(title: string, hints: SphereHints = {}): Sphere | null {
  if (hints.board === 'hiring' || hints.board === 'deals' || hints.board === 'jobs') return 'work'
  const work = hits(WORK_WORDS, title)
  const personal = hits(PERSONAL_WORDS, title)
  if (hints.booking) return work > 0 ? 'work' : 'personal'
  if (hints.kind === 'focus' && personal === 0) return 'work'
  // A festival is home life, unless the words say it is the office's.
  if (hints.kind === 'celebration' && work === 0) return 'personal'
  if (work > personal) return 'work'
  if (personal > work) return 'personal'
  return null
}

// --------------------------------------------------------------- work hours

export interface WorkHours {
  /** 0 is Sunday. */
  days: number[]
  /** Hours in the person's own zone; end is when the working day stops. */
  start: number
  end: number
}

export const DEFAULT_WORK_HOURS: WorkHours = { days: [1, 2, 3, 4, 5], start: 9, end: 18 }

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** The weekday and minute of the day, at that moment, in that zone. */
function localClock(at: Date, timezone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  return { day: WEEKDAY_INDEX[get('weekday')] ?? 0, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

/** Whether that moment falls in the working day, in the person's own zone. */
export function isWorkTime(at: Date, timezone: string, hours: WorkHours): boolean {
  const { day, minutes } = localClock(at, timezone)
  return hours.days.includes(day) && minutes >= hours.start * 60 && minutes < hours.end * 60
}

/**
 * When the current stretch changes: the end of the working day when inside
 * it, the start of the next one when not. Null when no day is a working day.
 * (Zones with daylight saving can be an hour out on the night it changes.)
 */
export function nextWorkBoundary(at: Date, timezone: string, hours: WorkHours): Date | null {
  const { day, minutes } = localClock(at, timezone)
  const base = at.getTime() - at.getSeconds() * 1000 - at.getMilliseconds()
  if (isWorkTime(at, timezone, hours)) return new Date(base + (hours.end * 60 - minutes) * 60_000)
  for (let ahead = 0; ahead <= 7; ahead++) {
    if (!hours.days.includes((day + ahead) % 7)) continue
    const delta = ahead * 1440 + hours.start * 60 - minutes
    if (delta > 0) return new Date(base + delta * 60_000)
  }
  return null
}

/** "Mon–Fri, 9 am – 6 pm": the working week the way it is said. */
export function describeWorkHours(hours: WorkHours): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const sorted = [...hours.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  const run =
    sorted.length > 2 && sorted.every((d, i) => i === 0 || (sorted[i - 1]! + 1) % 7 === d)
      ? `${names[sorted[0]!]}–${names[sorted[sorted.length - 1]!]}`
      : sorted.map((d) => names[d]).join(', ')
  const clock = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`
  return `${run}, ${clock(hours.start)} – ${clock(hours.end)}`
}
