/**
 * Names with a title in front.
 *
 * "Dr. Anil Mehta" is how a doctor is saved, and "Dr." is not anybody's first
 * name: read as one, the person page said "Waiting on Dr." and a plan to "Call
 * Dr. Sharma" was taken to be about the only doctor saved.
 */

/** Forms of address that are not part of anyone's name. */
const TITLES = new Set([
  'dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'shri', 'sri', 'smt', 'kumari',
  'er', 'adv', 'ca', 'capt', 'col', 'sir',
])

function isTitle(word: string): boolean {
  return TITLES.has(word.toLowerCase().replace(/\.$/, ''))
}

export interface NameParts {
  /** "Dr.", as typed, or null. */
  title: string | null
  /** The name without the title: "Anil Mehta". */
  bare: string
  /** "Anil". */
  given: string
  /** "Mehta", or null for a one-word name. */
  last: string | null
}

export function nameParts(name: string): NameParts {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const title = words.length > 1 && isTitle(words[0]!) ? words.shift()! : null
  return {
    title,
    bare: words.join(' '),
    given: words[0] ?? '',
    last: words.length > 1 ? words[words.length - 1]! : null,
  }
}

/**
 * How to refer to someone in a sentence: "Dr. Mehta" when they have a title,
 * since that is how they are addressed, otherwise their first name.
 */
export function shortName(name: string): string {
  const p = nameParts(name)
  if (p.title) return `${p.title} ${p.last ?? p.given}`
  return p.given || name.trim()
}
