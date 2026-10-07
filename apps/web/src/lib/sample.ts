/**
 * Sample data carries "[sample]" in its notes so the server can remove exactly
 * what it added and nothing else. That marker is bookkeeping, not something to
 * read: shown raw, it put "[sample]" under every plan on the screen.
 *
 * This splits it off, so a card can show the real note and a quiet tag instead.
 */
const MARK = '[sample]'

export function readNotes(notes: string | null | undefined): {
  notes: string | null
  sample: boolean
} {
  if (!notes || !notes.includes(MARK)) return { notes: notes ?? null, sample: false }
  const rest = notes.replace(MARK, '').trim()
  return { notes: rest || null, sample: true }
}
