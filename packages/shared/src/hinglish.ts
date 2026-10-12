/**
 * Hindi time words, in Roman script or Devanagari, turned into what the English
 * parser already understands.
 *
 * "kal subah mandir jaunga 9 baje" is how a lot of people actually say it,
 * typed or dictated. The parser below this is English-only and returned nothing
 * at all for it, which left the whole sentence unplannable.
 *
 * Translating rather than teaching the parser a second grammar keeps one set of
 * rules for what a date means. Only time words are touched: the place, the
 * person and the verb pass through as they were, so the title that comes out is
 * still in the words that were used.
 *
 * Deliberately conservative about spelling. "Sham" and "Shyam" are names, so
 * only "shaam" means evening; "rat" is an animal, so only "raat" means night.
 * Turning "call Sham tomorrow" into "call evening tomorrow" would be a worse
 * failure than not understanding a variant spelling.
 */

/** A letter or a combining mark — Devanagari vowel signs are marks, not letters. */
const LETTER = String.raw`[\p{L}\p{M}]`

/** "ko" after a time word is grammar, not content: "shaam ko" is just "evening". */
const KO = String.raw`(?:\s+(?:ko|को))?`

/**
 * A whole word, optionally followed by "ko".
 *
 * Built with lookarounds because \b is ASCII-only in JavaScript and would match
 * inside a Devanagari word. The alternatives are grouped before "ko" is
 * appended, or it would bind to the last alternative only.
 */
const wordKo = (alternatives: string) =>
  new RegExp(`(?<!${LETTER})(?:${alternatives})${KO}(?!${LETTER})`, 'giu')

type Part = 'morning' | 'afternoon' | 'evening' | 'night'

const PARTS: { part: Part; words: string }[] = [
  { part: 'morning', words: 'subah|subha|सुबह' },
  { part: 'afternoon', words: 'dopahar|dopehar|dupahar|दोपहर' },
  { part: 'evening', words: 'shaam|शाम' },
  { part: 'night', words: 'raat|रात' },
]

/** Longest first, so "parso" is never half-eaten by something shorter. */
const DAYS: { english: string; words: string }[] = [
  { english: 'day after tomorrow', words: 'parso|परसों|परसो' },
  { english: 'tomorrow', words: 'kal|कल' },
  { english: 'today', words: 'aaj|आज' },
]

/**
 * How often: "har sunday", "roz", "har mahine". Only "har" in front of a day
 * or a unit of time — on its own it is too short a word to trust.
 */
const REPEATS: { english: string; pattern: RegExp }[] = [
  { english: ' every day ', pattern: new RegExp(String.raw`(?<!${LETTER})(?:har\s+(?:roz|din)|roz(?:aana|ana)?|rozana|daily|हर\s+(?:रोज़?|दिन)|रोज़?(?:ाना)?)(?!${LETTER})`, 'giu') },
  { english: ' every week ', pattern: new RegExp(String.raw`(?<!${LETTER})(?:har\s+(?:hafte|hafta|week)|हर\s+हफ़?्ते)(?!${LETTER})`, 'giu') },
  { english: ' every month ', pattern: new RegExp(String.raw`(?<!${LETTER})(?:har\s+(?:mahine|mahina|month)|हर\s+महीने)(?!${LETTER})`, 'giu') },
  {
    english: ' every ',
    pattern: new RegExp(String.raw`(?<!${LETTER})(?:har|हर)\s+(?=(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|ravivar|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar)(?!${LETTER}))`, 'giu'),
  },
]

/** The Hindi weekday names, to the English the parser reads. */
const WEEKDAY_NAMES: [string, string][] = [
  ['ravivar|itvaar|रविवार', 'sunday'],
  ['somvar|सोमवार', 'monday'],
  ['mangalvar|मंगलवार', 'tuesday'],
  ['budhvar|बुधवार', 'wednesday'],
  ['guruvar|veervar|गुरुवार', 'thursday'],
  ['shukravar|शुक्रवार', 'friday'],
  ['shanivar|शनिवार', 'saturday'],
]

/** "9 baje", "9:30 baje", "९ बजे" — after digits have been made Western. */
const BAJE = new RegExp(
  String.raw`(?<!\d)(\d{1,2})(?:[:.](\d{2}))?\s*(?:baje|बजे)(?!${LETTER})`,
  'iu',
)

const DEVANAGARI_DIGITS = '०१२३४५६७८९'

function westernDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)))
}

/**
 * "N baje" plus a part of the day, as an unambiguous English time.
 *
 * Has to agree with the English parser's own reading of a day part. Without it
 * "subah 7 baje" would fall to the English convention that a bare 1–7 means the
 * afternoon, and a morning trip to the temple would be booked for 7pm.
 */
function explicitTime(hour: number, minute: string | undefined, part: Part): string {
  // Already 24-hour — say it as a clock reading, which the parser trusts.
  if (hour >= 13) return `${hour}:${minute ?? '00'}`

  let suffix: 'am' | 'pm'
  if (part === 'morning') suffix = hour === 12 ? 'pm' : 'am'
  else if (part === 'afternoon' || part === 'evening') suffix = 'pm'
  // Night: late evening, or the small hours after midnight ("raat 2 baje").
  else suffix = hour === 12 || hour <= 4 ? 'am' : 'pm'

  return minute ? `${hour}:${minute}${suffix}` : `${hour}${suffix}`
}

export function normalizeHinglish(input: string): string {
  let text = westernDigits(input)

  // Which part of the day was named, wherever it sits. In "kal subah mandir
  // jaunga 9 baje" the part and the hour are separated by the activity — the
  // ordinary Hindi order, and invisible to any rule that looks for them side by
  // side.
  const named = PARTS.find((entry) => wordKo(entry.words).test(text)) ?? null

  const baje = BAJE.exec(text)
  if (baje && named) {
    // The part of the day has done its job — it said which half of the clock —
    // so it is folded into an explicit time and removed, rather than left in
    // the title as a stray "morning".
    text = text.replace(baje[0], explicitTime(Number(baje[1]), baje[2], named.part))
    text = text.replace(wordKo(named.words), ' ')
  } else if (baje) {
    // No part of the day: "9 baje" is "at 9", which the parser reads the way
    // English speakers say it and which needs no date to anchor it.
    text = text.replace(baje[0], baje[2] ? `at ${baje[1]}:${baje[2]}` : `at ${baje[1]}`)
  } else if (named) {
    // A part of the day and no hour: a window, not a clock time.
    text = text.replace(wordKo(named.words), ` ${named.part} `)
  }

  for (const day of DAYS) text = text.replace(wordKo(day.words), ` ${day.english} `)
  for (const [words, english] of WEEKDAY_NAMES) text = text.replace(wordKo(words), ` ${english} `)
  for (const repeat of REPEATS) text = text.replace(repeat.pattern, repeat.english)

  return text.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Hindi words left in a title once the time words are gone: "sabzi lana",
 * "mom ko call karna hai". A sign the line was only half understood, and
 * worth a careful second reading when one is on hand.
 */
export const HINDI_LEFTOVER = /\b(?:hai|hain|karna|karni|karne|karo|lana|lani|lena|leni|dena|deni|jana|jaana|wala|wali|raha|rahi|mein|nahi|parso|sabzi|doodh|dawai|kapde|ghar)\b/i
