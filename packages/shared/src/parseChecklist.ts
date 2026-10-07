/**
 * "go shopping this evening: milk, bread, peda"
 *
 * Some plans carry a list. Shopping is the obvious one, but so is packing for a
 * trip, or the three things to raise in a meeting. Until now that went into the
 * notes as a sentence, where nothing could be ticked off and the half you had
 * already done looked exactly like the half you had not.
 *
 * A colon introduces the list. Deliberately nothing cleverer: a comma alone is
 * far too common inside an ordinary title to mean anything, and guessing wrong
 * turns one plan into five.
 */

export interface ParsedChecklist {
  /** The plan itself, with the list removed. */
  title: string
  items: string[]
}

/** Below this it is a phrase with a colon in it, not a list. */
const MIN_ITEMS = 2

/**
 * A colon that introduces a list rather than one inside a value.
 *
 * "Call: https://meet.google.com/x" and "Standup: 9:30" both contain colons
 * and neither is a list, which is why the items themselves have to look like
 * a list before any of this applies.
 */
const LIST_MARKER = /\s*[:–—]\s+|\s+[-–—]\s+/

export function parseChecklist(input: string): ParsedChecklist | null {
  const match = LIST_MARKER.exec(input)
  if (!match || match.index === 0) return null

  const title = input.slice(0, match.index).trim()
  const tail = input.slice(match.index + match[0].length).trim()
  if (!title || !tail) return null

  const items = tail
    // "milk, bread and peda" — the final "and" is how people write the last one.
    .split(/\s*,\s*|\s+and\s+|\s*;\s*/)
    .map((item) =>
      item
        .trim()
        .replace(/^[-*•]\s*/, '')
        .replace(/[.]+$/, '')
        .trim(),
    )
    .filter((item) => item.length > 0 && item.length <= 120)

  if (items.length < MIN_ITEMS) return null
  // A "list" of twenty from one sentence is a sentence that happened to have
  // commas in it, not a list somebody meant.
  if (items.length > 20) return null

  return { title, items }
}
