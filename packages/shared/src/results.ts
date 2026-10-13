/**
 * Results: a board's list of roll numbers — shortlisted for the next round,
 * finally selected — checked for one person's number, and its cut-offs by
 * category. Lists are public; a person's roll number is matched against one
 * on Cue's own server and goes nowhere else.
 */

/** Reservation categories, as boards write them. MBC is Rajasthan's. */
export const CATEGORIES = [
  { key: 'UR', label: 'General (UR)' },
  { key: 'EWS', label: 'EWS' },
  { key: 'OBC', label: 'OBC (non-creamy layer)' },
  { key: 'MBC', label: 'MBC (Rajasthan)' },
  { key: 'SC', label: 'SC' },
  { key: 'ST', label: 'ST' },
] as const
export type Category = (typeof CATEGORIES)[number]['key']
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as [Category, ...Category[]]

/** One category's cut-off, as a list gives it. */
export interface CutOff {
  category: Category
  marks: number
}

/** What a list of roll numbers means for those on it. */
export interface ListMeaning {
  /** shortlist: on to a round; selected: finally selected; result: marks or a result, nothing to move. */
  means: 'shortlist' | 'selected' | 'result'
  /** For a shortlist: the round they go on to. */
  round: string | null
  /** The list's own PDF, when it is not the notice itself. */
  pdfUrl: string | null
}

/** A roll or registration number, however it was written: "24 1234-5678" is 2412345678. */
export function normalizeNumber(s: string): string {
  return s.toUpperCase().replace(/[\s/-]+/g, '')
}

/** Every roll-number-like token in a page of a list: digits, or a few letters then digits. */
export function numbersIn(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?<![A-Za-z\d])[A-Za-z]{0,4}\d{5,16}(?![A-Za-z\d])/g)) out.add(normalizeNumber(m[0]))
  return [...out]
}

/** Whether a person's number is in a list's numbers: the page it is on (1-based), or null. */
export function findNumber(pages: string[][] | Set<string>[], numbers: (string | null | undefined)[]): number | null {
  const wanted = numbers.filter((n): n is string => Boolean(n && n.trim())).map(normalizeNumber)
  if (wanted.length === 0) return null
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!
    const has = (n: string) => (page instanceof Set ? page.has(n) : page.includes(n))
    if (wanted.some(has)) return i + 1
  }
  return null
}

const CATEGORY_WORDS: [Category, RegExp][] = [
  ['EWS', /\bEWS\b/i],
  ['MBC', /\bMBC\b/i],
  ['OBC', /\bOBC\b/i],
  ['SC', /\bSC\b/],
  ['ST', /\bST\b/],
  ['UR', /\b(?:UR|GEN(?:ERAL)?|UNRESERVED)\b/i],
]

/**
 * Cut-offs a result PDF states: lines after a "cut-off" heading that name a
 * category and give marks. For a reviewer to confirm, never sent as read:
 * tables of cut-offs come in as many shapes as there are boards.
 */
export function cutOffsIn(text: string): CutOff[] {
  const lines = text.split(/\n|(?<=\d)\s{2,}/)
  const start = lines.findIndex((l) => /\bcut[\s-]?off/i.test(l))
  if (start < 0) return []
  const out = new Map<Category, number>()
  for (const line of lines.slice(start, start + 40)) {
    // Category, then marks: "UR 72.50", "OBC-NCL | 68.25", "General: 74".
    for (const [category, re] of CATEGORY_WORDS) {
      if (out.has(category)) continue
      const m = new RegExp(`${re.source}[^\\d\\n]{0,24}?(\\d{1,3}(?:\\.\\d{1,5})?)(?!\\d)`, re.flags).exec(line)
      const marks = m ? Number(m[1]) : NaN
      if (Number.isFinite(marks) && marks > 0 && marks <= 1000) out.set(category, marks)
    }
  }
  return CATEGORIES.filter((c) => out.has(c.key)).map((c) => ({ category: c.key, marks: out.get(c.key)! }))
}
