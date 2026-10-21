/**
 * Slowing down password guessing and reset-mail spam.
 *
 * Failures are counted in memory, per address and per account email, over a
 * sliding window. A restart forgets — fine for one server: what matters is
 * that a script cannot try thousands of passwords a minute.
 */

interface Rule {
  /** At most this many in the window... */
  limit: number
  windowMs: number
}

export const RULES = {
  /** Wrong passwords from one address, against any accounts. */
  loginIp: { limit: 20, windowMs: 15 * 60_000 },
  /** Wrong passwords against one account, from anywhere. */
  loginEmail: { limit: 8, windowMs: 15 * 60_000 },
  /** Reset links asked for one account. */
  resetEmail: { limit: 3, windowMs: 60 * 60_000 },
  /** Reset links asked from one address. */
  resetIp: { limit: 10, windowMs: 60 * 60_000 },
} satisfies Record<string, Rule>

export type RuleName = keyof typeof RULES

const hits = new Map<string, number[]>()

const keyOf = (rule: RuleName, subject: string) => `${rule}:${subject.toLowerCase()}`

function recent(key: string, windowMs: number, now: number): number[] {
  const kept = (hits.get(key) ?? []).filter((at) => now - at < windowMs)
  if (kept.length) hits.set(key, kept)
  else hits.delete(key)
  return kept
}

/** Whether this subject has used up its tries under the rule. */
export function isLimited(rule: RuleName, subject: string, now = Date.now()): boolean {
  const { limit, windowMs } = RULES[rule]
  return recent(keyOf(rule, subject), windowMs, now).length >= limit
}

/** One more try (a failure, or a reset asked for) counted against the subject. */
export function count(rule: RuleName, subject: string, now = Date.now()): void {
  const key = keyOf(rule, subject)
  const kept = recent(key, RULES[rule].windowMs, now)
  kept.push(now)
  hits.set(key, kept)
}

/** A right password clears that account's count; the address keeps its own. */
export function clear(rule: RuleName, subject: string): void {
  hits.delete(keyOf(rule, subject))
}

/** For the admin portal: who is held back right now, and until when. */
export function heldNow(now = Date.now()): { rule: RuleName; subject: string; tries: number; until: string }[] {
  const out: { rule: RuleName; subject: string; tries: number; until: string }[] = []
  for (const [key, list] of hits) {
    const at = key.indexOf(':')
    const rule = key.slice(0, at) as RuleName
    const { limit, windowMs } = RULES[rule]
    const kept = list.filter((t) => now - t < windowMs)
    if (kept.length >= limit) {
      out.push({ rule, subject: key.slice(at + 1), tries: kept.length, until: new Date(kept[0]! + windowMs).toISOString() })
    }
  }
  return out
}

/** Tests only. */
export function resetThrottle(): void {
  hits.clear()
}
