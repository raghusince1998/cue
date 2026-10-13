/**
 * What someone uses Cue for. One app for very different days — a job hunt,
 * a recruiter's interviews, a household's bills, a salesperson's calls — so
 * the screens lead with what this person needs and keep the rest a tap away.
 * What only one kind of day needs — job applications, candidates, deals —
 * is not there at all until someone says it is theirs: to everyone else it
 * is clutter.
 */

export const USES = [
  {
    key: 'personal',
    label: 'Home & personal life',
    hint: 'Bills, birthdays, errands, money lent',
    example: 'pay the electricity bill on the 5th',
  },
  {
    key: 'job_search',
    label: 'Looking for a job',
    hint: 'Applications, interviews, follow-ups',
    example: 'interview at Infosys friday 11am',
  },
  {
    key: 'hiring',
    label: 'Hiring & HR',
    hint: 'Candidates, interviews, your people',
    example: 'interview Priya for the designer role tomorrow 3pm',
  },
  {
    key: 'sales',
    label: 'Sales & clients',
    hint: 'Clients, calls, visits, targets',
    example: 'call Ravi tomorrow 4pm about the order',
  },
  {
    key: 'office',
    label: 'Office work',
    hint: 'Meetings, follow-ups, reports',
    example: 'send the report to Anita by friday',
  },
  {
    key: 'freelance',
    label: 'Freelance or own business',
    hint: 'Clients, payments due, expenses',
    example: 'invoice Sharma & Co on the 1st',
  },
  {
    key: 'student',
    label: 'Studies',
    hint: 'Classes, assignments, exams',
    example: 'maths assignment due monday 9am',
  },
] as const

export type Use = (typeof USES)[number]['key']
export const USE_KEYS = USES.map((u) => u.key) as [Use, ...Use[]]

/** The sections of the app that can have a tab, besides Today. */
export type Section =
  | 'people'
  | 'history'
  | 'trips'
  | 'repeating'
  | 'expenses'
  | 'jobs'
  | 'hiring'
  | 'deals'
  | 'bills'

/** What each use leads with, most useful first. */
const LEADS: Record<Use, Section[]> = {
  personal: ['bills', 'people', 'trips', 'repeating', 'expenses'],
  job_search: ['jobs', 'people', 'history', 'repeating'],
  hiring: ['hiring', 'people', 'repeating', 'history'],
  sales: ['people', 'deals', 'expenses', 'trips', 'history'],
  office: ['people', 'repeating', 'history', 'expenses'],
  freelance: ['deals', 'bills', 'expenses', 'people'],
  student: ['repeating', 'history', 'people', 'trips'],
}

/**
 * Sections only some uses need, and which. Hidden from everyone else — and
 * from anyone who has not said yet — unless something is already in them.
 */
const ONLY_FOR: Partial<Record<Section, readonly Use[]>> = {
  jobs: ['job_search'],
  hiring: ['hiring'],
  deals: ['sales', 'freelance'],
}

/**
 * The sections this person has, out of those that exist: everything anyone
 * can use, and the ones only some need when they picked one of those uses
 * or already have something in them ("applied to Infosys" typed without
 * picking a job hunt still has somewhere to go).
 */
export function sectionsFor(uses: readonly string[], available: readonly Section[], filled: readonly string[] = []): Section[] {
  return available.filter((s) => {
    const only = ONLY_FOR[s]
    return !only || only.some((u) => uses.includes(u)) || filled.includes(s)
  })
}

/** Before anyone has said: the sections everybody can use. */
const UNSAID: Section[] = ['people', 'trips', 'repeating', 'history']

/** Tabs a phone can fit beside Today and More. */
export const MAIN_TABS = 4

/**
 * The tabs to show and the rest, for these uses, out of the sections that
 * exist (see sectionsFor; `filled` is the boards with something in them).
 * Several uses take turns, so each gets its first choice in before any gets
 * its second: a job seeker who also runs a home sees Jobs and Bills.
 */
export function tabsFor(
  uses: readonly string[],
  all: readonly Section[],
  filled: readonly string[] = [],
): { main: Section[]; more: Section[] } {
  const available = sectionsFor(uses, all, filled)
  const known = uses.filter((u): u is Use => u in LEADS)
  const lists = known.length ? known.map((u) => LEADS[u]) : [UNSAID]
  const main: Section[] = []
  for (let i = 0; main.length < MAIN_TABS && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const s = l[i]
      if (s && available.includes(s) && !main.includes(s) && main.length < MAIN_TABS) main.push(s)
    }
  }
  return { main, more: available.filter((s) => !main.includes(s)) }
}

/** Lines to show as examples of what can be typed, for these uses. */
export function examplesFor(uses: readonly string[]): string[] {
  // In the order they were picked: the first is what they came for.
  const chosen = uses.map((k) => USES.find((u) => u.key === k)).filter((u) => u !== undefined)
  const list = (chosen.length ? chosen : USES.filter((u) => u.key === 'office' || u.key === 'personal')).map((u) => u.example)
  return list.slice(0, 3)
}

/** Whether these uses are about a job, so reports to a manager and targets make sense. */
export function hasWork(uses: readonly string[]): boolean {
  return uses.length === 0 || uses.some((u) => u === 'sales' || u === 'office' || u === 'hiring' || u === 'freelance')
}

/**
 * Whether companies and clients — with a stage each — and weekly targets of
 * calls and visits are part of this person's work. Only when they said so.
 */
export function hasClients(uses: readonly string[]): boolean {
  return uses.some((u) => u === 'sales' || u === 'freelance')
}
