import { findCity } from './cities.ts'
import { parseChecklist } from './parseChecklist.ts'

/**
 * Several wishes in one line.
 *
 * "Jaipur: visit Hawa Mahal, buy lakh chudi" is two things to do in Jaipur,
 * not a plan called "Jaipur" with a list on it, and not two lines typed
 * separately. "wishlist: learn swimming, read Deep Work" is two things with no
 * place at all, waiting for a plan to attach them to.
 */

export interface WishList {
  /** Where they belong, or null for "any time". */
  placeLabel: string | null
  titles: string[]
}

/** "wishlist", "wish list", "someday", "bucket list": no place, just wants. */
const ANYWHERE = /^(?:my\s+)?(?:wish\s*list|wishes|someday|some\s+day|bucket\s*list)$/i

/** "when I go to Jaipur", "next time I'm in Pune", "in Jaipur", "at Pune". */
const CONTEXT =
  /^(?:(?:when(?:ever)?|next\s+time|once)\s+(?:i(?:['’]m|\s+am)?\s+)?(?:go(?:ing)?\s+to|visit(?:ing)?|travel(?:ling)?\s+to|reach|get\s+to|in|at|to)\s+|(?:in|at)\s+)(.+)$/i

function tidy(place: string): string | null {
  const clean = place
    .trim()
    .replace(/^(?:the)\s+/i, '')
    .replace(/[,.;:]+$/, '')
    .trim()
  if (!clean || clean.split(/\s+/).length > 4) return null
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

/**
 * The wishes in a line, or null when it is not a list of them. A bare name
 * before the colon only counts as a place when it is one: a known city, or a
 * place this person has used before — "Groceries: milk, bread" is a list on a
 * plan, not shopping to do in a town called Groceries.
 */
export function parseWishList(input: string, known: readonly string[] = []): WishList | null {
  const list = parseChecklist(input)
  if (!list) return null
  const head = list.title.trim()

  if (ANYWHERE.test(head)) return { placeLabel: null, titles: list.items }

  const context = CONTEXT.exec(head)
  if (context) {
    const place = tidy(context[1]!)
    return place ? { placeLabel: place, titles: list.items } : null
  }

  const city = findCity(head, known)
  if (city && city.toLowerCase() === head.toLowerCase()) return { placeLabel: city, titles: list.items }
  return null
}
