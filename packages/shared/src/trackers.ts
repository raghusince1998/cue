/**
 * Trackers: things that move through stages until they are done — job
 * applications, candidates, deals. One engine with a board per purpose, each
 * with its own words and stages, and the same promise: every item has a next
 * step, and one that has gone quiet is noticed.
 *
 * Every item is about someone: the company applied to, the candidate, the
 * client. That is its title. What it is about — the role, the deal — is the
 * detail.
 */

export interface Stage {
  key: string
  label: string
  /** A finished stage: the item is closed, for better or worse. */
  closed?: 'won' | 'lost'
  /** Days in this stage without a next step before it counts as gone quiet. */
  quietAfter?: number
}

export interface Board {
  key: 'jobs' | 'hiring' | 'deals'
  /** The page's name. */
  label: string
  /** One of them, in a sentence: "application". */
  noun: string
  titleLabel: string
  titlePlaceholder: string
  detailLabel: string
  detailPlaceholder: string
  /** What a money figure means here, if anything. */
  valueLabel: string
  /** Where something new starts. */
  startStage: string
  stages: Stage[]
  /** What to say about one that has gone quiet. */
  quietLine: (title: string, stage: string, days: number) => string
}

export const BOARDS: Record<Board['key'], Board> = {
  jobs: {
    key: 'jobs',
    label: 'Job hunt',
    noun: 'application',
    titleLabel: 'Company',
    titlePlaceholder: 'e.g. Infosys',
    detailLabel: 'Role',
    detailPlaceholder: 'e.g. Data analyst',
    valueLabel: 'Salary offered (a year)',
    startStage: 'applied',
    stages: [
      { key: 'saved', label: 'Want to apply', quietAfter: 5 },
      { key: 'applied', label: 'Applied', quietAfter: 7 },
      { key: 'interview', label: 'Interviewing', quietAfter: 5 },
      { key: 'offer', label: 'Offer', quietAfter: 3 },
      { key: 'accepted', label: 'Accepted', closed: 'won' },
      { key: 'rejected', label: 'Not this time', closed: 'lost' },
      { key: 'withdrawn', label: 'Withdrew', closed: 'lost' },
    ],
    quietLine: (title, stage, days) =>
      stage === 'saved'
        ? `${title}: saved ${days} days ago and not applied yet`
        : stage === 'applied'
          ? `Applied to ${title} ${days} days ago with no reply`
          : stage === 'offer'
            ? `${title}'s offer has waited ${days} days for an answer`
            : `Nothing heard from ${title} in ${days} days`,
  },
  hiring: {
    key: 'hiring',
    label: 'Hiring',
    noun: 'candidate',
    titleLabel: 'Candidate',
    titlePlaceholder: 'e.g. Priya Nair',
    detailLabel: 'Role',
    detailPlaceholder: 'e.g. Product designer',
    valueLabel: 'Expected salary (a year)',
    startStage: 'new',
    stages: [
      { key: 'new', label: 'New', quietAfter: 3 },
      { key: 'screening', label: 'Screening', quietAfter: 4 },
      { key: 'interview', label: 'Interviewing', quietAfter: 5 },
      { key: 'offer', label: 'Offer made', quietAfter: 4 },
      { key: 'hired', label: 'Hired', closed: 'won' },
      { key: 'rejected', label: 'Not selected', closed: 'lost' },
      { key: 'withdrawn', label: 'Withdrew', closed: 'lost' },
    ],
    quietLine: (title, stage, days) =>
      stage === 'new'
        ? `${title} applied ${days} days ago and has not been looked at`
        : stage === 'offer'
          ? `${title} has not answered the offer in ${days} days`
          : `${title} has waited ${days} days without a next step`,
  },
  deals: {
    key: 'deals',
    label: 'Deals',
    noun: 'deal',
    titleLabel: 'Client',
    titlePlaceholder: 'e.g. Tata Motors',
    detailLabel: 'What',
    detailPlaceholder: 'e.g. 50 laptops',
    valueLabel: 'Value',
    startStage: 'lead',
    stages: [
      { key: 'lead', label: 'Lead', quietAfter: 5 },
      { key: 'contacted', label: 'In touch', quietAfter: 7 },
      { key: 'proposal', label: 'Proposal sent', quietAfter: 5 },
      { key: 'negotiation', label: 'Negotiating', quietAfter: 5 },
      { key: 'won', label: 'Won', closed: 'won' },
      { key: 'lost', label: 'Lost', closed: 'lost' },
    ],
    quietLine: (title, _stage, days) => `${title}: nothing has moved in ${days} days`,
  },
}

export const BOARD_KEYS = Object.keys(BOARDS) as [Board['key'], ...Board['key'][]]
export type BoardKey = Board['key']

export function stageOf(board: BoardKey, key: string): Stage | undefined {
  return BOARDS[board].stages.find((s) => s.key === key)
}

export function isOpenStage(board: BoardKey, key: string): boolean {
  const s = stageOf(board, key)
  return Boolean(s && !s.closed)
}

/** Whether moving from one stage to another goes forward through the open ones. */
export function isLaterStage(board: BoardKey, from: string, to: string): boolean {
  const order = BOARDS[board].stages.map((s) => s.key)
  return order.indexOf(to) > order.indexOf(from)
}

/**
 * How long an item has been where it is, and whether that is too long:
 * open, with no next step booked, and past its stage's patience.
 */
export function quietFor(
  board: BoardKey,
  item: { stage: string; stageChangedAt: string | Date; hasNextStep: boolean },
  now = new Date(),
): number | null {
  const stage = stageOf(board, item.stage)
  if (!stage || stage.closed || !stage.quietAfter || item.hasNextStep) return null
  const days = Math.floor((now.getTime() - new Date(item.stageChangedAt).getTime()) / 86_400_000)
  return days >= stage.quietAfter ? days : null
}

export interface TrackerLine {
  board: BoardKey
  stage: string
  /** The company, the candidate, the client. */
  title: string
  /** The role or what it is for. */
  detail: string | null
}

const WHO = String.raw`([a-z0-9][a-z0-9&.,'() -]{0,60}?)`
const ROLE = String.raw`(?:the\s+|a\s+|an\s+)?([a-z0-9][a-z0-9&.,'/+ -]{0,60}?)(?:\s+(?:role|position|job|post|opening|vacancy))?`

const LINES: { re: RegExp; board: BoardKey; stage: string; title: number; detail: number | null }[] = [
  // "applied to Infosys for the data analyst role"
  { re: new RegExp(String.raw`^(?:i\s+)?applied\s+(?:to|at|with|in)\s+${WHO}(?:\s+for\s+${ROLE})?$`, 'i'), board: 'jobs', stage: 'applied', title: 1, detail: 2 },
  // "applied for data analyst at Infosys"
  { re: new RegExp(String.raw`^(?:i\s+)?applied\s+for\s+${ROLE}\s+(?:at|with|in)\s+${WHO}$`, 'i'), board: 'jobs', stage: 'applied', title: 2, detail: 1 },
  // "apply for data analyst at Infosys": one to apply to
  { re: new RegExp(String.raw`^(?:to\s+)?apply\s+for\s+${ROLE}\s+(?:at|with|in)\s+${WHO}$`, 'i'), board: 'jobs', stage: 'saved', title: 2, detail: 1 },
  { re: new RegExp(String.raw`^(?:to\s+)?apply\s+(?:to|at)\s+${WHO}(?:\s+for\s+${ROLE})?$`, 'i'), board: 'jobs', stage: 'saved', title: 1, detail: 2 },
  // "candidate Priya Nair for product designer", "new candidate: Priya"
  { re: new RegExp(String.raw`^(?:new\s+)?candidate\s*[:-]?\s+${WHO}(?:\s+for\s+${ROLE})?$`, 'i'), board: 'hiring', stage: 'new', title: 1, detail: 2 },
  // "shortlisted Priya for the designer role"
  { re: new RegExp(String.raw`^shortlist(?:ed)?\s+${WHO}\s+for\s+${ROLE}$`, 'i'), board: 'hiring', stage: 'screening', title: 1, detail: 2 },
  // "new lead: Tata Motors for 50 laptops", "new deal with Tata Motors"
  { re: new RegExp(String.raw`^new\s+(?:lead|deal)\s*[:-]?\s+(?:with\s+)?${WHO}(?:\s+for\s+${ROLE})?$`, 'i'), board: 'deals', stage: 'lead', title: 1, detail: 2 },
]

/** Reads "applied to Infosys for data analyst" and the like, or null. */
export function parseTrackerLine(input: string): TrackerLine | null {
  const text = input.trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ')
  for (const l of LINES) {
    const m = l.re.exec(text)
    if (!m) continue
    const title = tidy(m[l.title], true)
    if (!title) continue
    const detail = l.detail ? tidy(m[l.detail], false) : null
    return { board: l.board, stage: l.stage, title, detail }
  }
  return null
}

/**
 * Trimmed, with capitals where it was typed all in lowercase: a name or a
 * company gets one on every word ("priya nair" → "Priya Nair"), a role on the
 * first ("data analyst" → "Data analyst").
 */
function tidy(s: string | undefined, isName: boolean): string | null {
  const t = s?.trim().replace(/[,\s]+$/, '')
  if (!t) return null
  if (t !== t.toLowerCase()) return t
  return isName ? t.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : t[0]!.toUpperCase() + t.slice(1)
}

/** Whether a line mentions this item: its title as whole words. */
export function mentions(text: string, title: string): boolean {
  const t = title.trim()
  if (t.length < 2) return false
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(text)
}
