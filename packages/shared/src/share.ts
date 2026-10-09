/**
 * What another app hands over when something is shared into Cue: a title, a
 * text and a url, any of which may be missing or repeat another. Turned into
 * one line for the capture box, with the original kept when it had to be
 * shortened.
 */

export interface Shared {
  /** One line, ready for the box. */
  text: string
  /** What arrived, when it had to be flattened or shortened to fit. */
  original: string | null
}

const MAX = 280

export function composeShared(title: string | null, text: string | null, url: string | null): Shared | null {
  const parts: string[] = []
  for (const raw of [title, text, url]) {
    const clean = raw?.trim()
    if (!clean) continue
    // Already said: a url repeated inside the text, a title that is the text.
    if (parts.some((p) => p.includes(clean))) continue
    // Says more than something already there: keep the fuller one.
    const covered = parts.findIndex((p) => clean.includes(p))
    if (covered >= 0) parts[covered] = clean
    else parts.push(clean)
  }
  const original = parts.join(' — ')
  if (!original) return null
  const line = original.replace(/\s+/g, ' ').trim()
  const short = line.length > MAX ? `${line.slice(0, MAX - 1).trimEnd()}…` : line
  return { text: short, original: short === original ? null : original }
}
