/**
 * Phrases the recogniser heard, put together into what was said.
 *
 * Android's recogniser repeats itself: it sends a phrase again with more on
 * the end ("call", "call mom", "call mom tomorrow"), sends the same phrase
 * twice, or sends everything said so far as one new phrase. Adding each one
 * up wrote "call call mom call mom tomorrow" into the box. Here a phrase that
 * only repeats or grows what came before replaces it instead of adding to it.
 */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** The phrases so far, with one more final phrase taken in. */
export function addPhrase(parts: string[], phrase: string): string[] {
  const next = norm(phrase)
  if (!next) return parts
  const said = phrase.trim().replace(/\s+/g, ' ')
  const last = parts.at(-1)
  if (last !== undefined) {
    const prev = norm(last)
    // The same phrase again, or a shorter echo of it.
    if (next === prev || prev.startsWith(next)) return parts
    // The same phrase, grown.
    if (next.startsWith(prev)) return [...parts.slice(0, -1), said]
  }
  // Everything said so far, sent again with more on the end.
  const all = norm(parts.join(' '))
  if (all && next.startsWith(all)) return [said]
  return [...parts, said]
}

/** What to show: the phrases so far, then whatever is still being said. */
export function spoken(parts: string[], interim = ''): string {
  const said = parts.join(' ')
  const now = interim.trim().replace(/\s+/g, ' ')
  if (!now) return said
  const sofar = norm(said)
  // Still being said, but already carrying everything before it.
  if (sofar && norm(now).startsWith(sofar)) return now
  return said ? `${said} ${now}` : now
}
