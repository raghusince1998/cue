/**
 * What someone uses Cue for. One app for very different days — a job hunt,
 * a recruiter's interviews, a household's bills, a salesperson's calls — so
 * every part of it belongs to the kinds of day that need it, and is in front
 * of only those who said that day is theirs. To everyone else it is clutter.
 *
 * Three rules, and nothing shown outside them:
 * - Sections (tabs): the few everybody needs, and each use's own. One that
 *   already has something in it stays, whatever was picked.
 * - Work features — work and personal kept apart, work hours, the standup
 *   and the daily report — for those who picked a kind of work (hasWork).
 * - Client features — a stage on each company, weekly targets of calls and
 *   visits — for sales and freelance only (hasClients).
 */

/** How the choices are grouped when asked, and how the menu is laid out. */
export const USE_GROUPS = [
  { key: 'life', label: 'Life' },
  { key: 'work', label: 'Work' },
  { key: 'career', label: 'Career & studies' },
] as const
export type UseGroup = (typeof USE_GROUPS)[number]['key']

export const USES = [
  {
    key: 'personal',
    group: 'life',
    label: 'Home & personal life',
    hint: 'Bills, birthdays, errands, money lent',
    example: 'pay the electricity bill on the 5th',
  },
  {
    key: 'office',
    group: 'work',
    label: 'Office work',
    hint: 'Meetings, follow-ups, reports',
    example: 'send the report to Anita by friday',
  },
  {
    key: 'sales',
    group: 'work',
    label: 'Sales & clients',
    hint: 'Clients, calls, visits, targets, deals',
    example: 'call Ravi tomorrow 4pm about the order',
  },
  {
    key: 'hiring',
    group: 'work',
    label: 'Hiring & HR',
    hint: 'Candidates, interviews, your people',
    example: 'interview Priya for the designer role tomorrow 3pm',
  },
  {
    key: 'freelance',
    group: 'work',
    label: 'Freelance or own business',
    hint: 'Clients, deals, payments due, expenses',
    example: 'invoice Sharma & Co on the 1st',
  },
  {
    key: 'job_search',
    group: 'career',
    label: 'Looking for a job',
    hint: 'Applications, interviews, follow-ups',
    example: 'interview at Infosys friday 11am',
  },
  {
    key: 'student',
    group: 'career',
    label: 'Studies',
    hint: 'Classes, assignments, exams',
    example: 'maths assignment due monday 9am',
  },
  {
    key: 'exams',
    group: 'career',
    label: 'Competitive exams',
    hint: 'Forms, admit cards, exam days, results',
    example: 'applied for RRB NTPC, RRB Ajmer, reg no 241051234567',
  },
] as const satisfies readonly { key: string; group: UseGroup; label: string; hint: string; example: string }[]

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
  | 'exams'

/** Sections that hold things of their own, so can be kept for having something in them. */
export const FILLABLE: readonly Section[] = ['trips', 'expenses', 'bills', 'jobs', 'hiring', 'deals', 'exams']

/** How the menu groups sections, in this order. */
export const SECTION_GROUPS: readonly { label: string; sections: readonly Section[] }[] = [
  { label: 'Everyday', sections: ['people', 'trips', 'repeating', 'history'] },
  { label: 'Money', sections: ['bills', 'expenses'] },
  { label: 'Work', sections: ['deals', 'hiring'] },
  { label: 'Career & studies', sections: ['exams', 'jobs'] },
]

/** What everybody has, whatever they picked: the people in their life, what repeats, what is done. */
const EVERYONE: readonly Section[] = ['people', 'repeating', 'history']

/** Each use's sections, most useful first: what it adds, and what its tabs lead with. */
const LEADS: Record<Use, readonly Section[]> = {
  personal: ['bills', 'people', 'trips', 'repeating', 'expenses'],
  office: ['people', 'repeating', 'history', 'expenses', 'trips'],
  sales: ['people', 'deals', 'expenses', 'trips', 'history'],
  hiring: ['hiring', 'people', 'repeating', 'history'],
  freelance: ['deals', 'bills', 'expenses', 'people'],
  job_search: ['jobs', 'people', 'history', 'repeating'],
  student: ['repeating', 'exams', 'history', 'people', 'trips'],
  exams: ['exams', 'trips', 'repeating', 'people'],
}

/** Before anyone has said: what everybody has, and trips, which email fills on its own. */
const UNSAID: readonly Section[] = ['people', 'trips', 'repeating', 'history']

/** Tabs a phone can fit beside Today and More. */
export const MAIN_TABS = 4

const picked = (uses: readonly string[]): Use[] => uses.filter((u): u is Use => u in LEADS)

/**
 * The sections this person has, out of those that exist: everybody's, their
 * uses' own, and any that already has something in it (`filled`) — "applied
 * to Infosys" typed without picking a job hunt still has somewhere to go, and
 * a bill found in email shows Bills to someone who never asked for it.
 */
export function sectionsFor(uses: readonly string[], available: readonly Section[], filled: readonly string[] = []): Section[] {
  const known = picked(uses)
  const theirs = new Set<Section>(known.length ? [...EVERYONE, ...known.flatMap((u) => LEADS[u])] : UNSAID)
  return available.filter((s) => theirs.has(s) || filled.includes(s))
}

/**
 * The tabs to show and the rest, for these uses, out of the sections that
 * exist (see sectionsFor; `filled` is the sections with something in them).
 * Several uses take turns, so each gets its first choice in before any gets
 * its second: a job seeker who also runs a home sees Jobs and Bills.
 */
export function tabsFor(
  uses: readonly string[],
  all: readonly Section[],
  filled: readonly string[] = [],
): { main: Section[]; more: Section[] } {
  const available = sectionsFor(uses, all, filled)
  const known = picked(uses)
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

/** The menu's sections under their headings, in the menu's order; empty groups left out. */
export function groupSections(sections: readonly Section[]): { label: string; sections: Section[] }[] {
  return SECTION_GROUPS.map((g) => ({ label: g.label, sections: g.sections.filter((s) => sections.includes(s)) })).filter(
    (g) => g.sections.length > 0,
  )
}

/** Lines to show as examples of what can be typed, for these uses. */
export function examplesFor(uses: readonly string[]): string[] {
  // In the order they were picked: the first is what they came for.
  const chosen = uses.map((k) => USES.find((u) => u.key === k)).filter((u) => u !== undefined)
  const list = (chosen.length ? chosen : USES.filter((u) => u.key === 'office' || u.key === 'personal')).map((u) => u.example)
  return list.slice(0, 3)
}

/**
 * Whether these uses are a kind of work: work and personal kept apart, work
 * hours, the standup and the daily report. Only when they said so.
 */
export function hasWork(uses: readonly string[]): boolean {
  return uses.some((u) => USES.some((x) => x.key === u && x.group === 'work'))
}

/**
 * Whether companies and clients — with a stage each — and weekly targets of
 * calls and visits are part of this person's work. Only when they said so.
 */
export function hasClients(uses: readonly string[]): boolean {
  return uses.some((u) => u === 'sales' || u === 'freelance')
}

/** Whether the companies people work at matter: for work, and for a job hunt. */
export function hasCompanies(uses: readonly string[]): boolean {
  return hasWork(uses) || uses.includes('job_search')
}
