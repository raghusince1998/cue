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

/** Month names as Hindi writes them, to English: "15 नवंबर" is 15 November. */
const MONTHS: [string, string][] = [
  ['जनवरी|janvari', 'january'],
  ['फ़रवरी|फरवरी|farvari|farwari', 'february'],
  ['मार्च', 'march'],
  ['अप्रैल|अप्रेल', 'april'],
  ['मई', 'may'],
  ['जून', 'june'],
  ['जुलाई', 'july'],
  ['अगस्त', 'august'],
  ['सितंबर|सितम्बर|sitambar', 'september'],
  ['अक्टूबर|अक्तूबर|aktubar', 'october'],
  ['नवंबर|नवम्बर|navambar', 'november'],
  ['दिसंबर|दिसम्बर|disambar', 'december'],
]

/** "5 तारीख", "1 tarikh": a day of the month. */
const TARIKH = new RegExp(String.raw`(?<!\d)(\d{1,2})\s*(?:तारीख़?|tarikh|tareekh|tareek|tarik)(?:\s+(?:को|ko))?(?!${LETTER})`, 'giu')

const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`

/** Counting words, for "दो दिन बाद". Roman ones only ever before a unit and "baad". */
const NUMBER_WORDS: Record<string, number> = {
  एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10,
}

const UNITS: { english: string; words: string }[] = [
  { english: 'minute', words: 'मिनट|minute|minutes|minat' },
  { english: 'hour', words: 'घंटे|घंटा|घंटों|ghante|ghanta|ghanton' },
  { english: 'day', words: 'दिन|दिनों|din|dino|dinon' },
  { english: 'week', words: 'हफ़्ते|हफ्ते|हफ़्ता|हफ्ता|hafte|hafta' },
  { english: 'month', words: 'महीने|महीना|mahine|mahina' },
]

/** "2 दिन बाद", "do din baad", "3 घंटे में": from now, as English says it. */
const AFTER = new RegExp(
  String.raw`(?<!${LETTER}|\d)(\d+|${Object.keys(NUMBER_WORDS).join('|')})\s+(${UNITS.map((u) => u.words).join('|')})\s+(?:बाद|baad|में|mein|me)(?!${LETTER})`,
  'giu',
)

/** "आधे घंटे में": half an hour from now. */
const HALF_HOUR = new RegExp(String.raw`(?<!${LETTER})(?:आधे|aadhe|adhe)\s+(?:घंटे|ghante)\s+(?:बाद|baad|में|mein|me)(?!${LETTER})`, 'giu')

/** A sum of money said in Hindi: "500 रुपये" is ₹500. */
const RUPEES = new RegExp(String.raw`(?<!\d)(\d{1,3}(?:,\d{2,3})+|\d+)\s*(?:रुपये|रुपए|रुपया|रुपयों|रु\.?|rupaye|rupaiye|rupay|rupiya|rupiye)(?!${LETTER})`, 'giu')

const WEEKDAYS = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday'

/**
 * Next and this, once the days are English. "अगले सोमवार" is said of the
 * coming Monday, so it is simply Monday; "अगले हफ़्ते" is next week.
 */
const NEXT_THIS: { pattern: RegExp; english: string }[] = [
  { pattern: new RegExp(String.raw`(?<!${LETTER})(?:अगले|अगला|अगली|agle|agla|agli|इस)\s+(${WEEKDAYS})(?!${LETTER})`, 'giu'), english: '$1' },
  { pattern: wordKo('(?:अगले|agle|agla)\\s+(?:हफ़्ते|हफ्ते|hafte|hafta)'), english: ' next week ' },
  { pattern: wordKo('(?:अगले|agle|agla)\\s+(?:महीने|mahine|mahina)'), english: ' next month ' },
  { pattern: wordKo('(?:अगले|agle|agla)\\s+(?:साल|saal)'), english: ' next year ' },
  { pattern: wordKo('(?:इस|is)\\s+(?:हफ़्ते|हफ्ते|hafte)'), english: ' this week ' },
]

/** "शुक्रवार तक", "kal shaam 5 baje tak": a deadline, as English says it. */
const BY = new RegExp(
  String.raw`(?<!${LETTER})(today|tomorrow|day after tomorrow|${WEEKDAYS}|next week|this week|next month)((?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?(?:am|pm)?)?)\s+(?:तक|tak)(?!${LETTER})`,
  'giu',
)

/** One to three words of a name, in either script: "रवि", "Ravi Kumar". */
const WHO = String.raw`([\p{L}\p{M}][\p{L}\p{M}.']*(?:\s+[\p{L}\p{M}][\p{L}\p{M}.']*){0,2}?)`
const SUM = String.raw`(₹\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*)`
const HAI = String.raw`(?:\s+(?:हैं|है|hain|hai|थे|the))?`

/**
 * Money owed, the ways Hindi says it, to the English the money reader knows.
 * Only with a word that makes it a loan — "रवि को 500 दिए" alone could as well
 * be a payment, and a payment is an expense, not money to chase.
 */
const OWED: { pattern: RegExp; english: string }[] = [
  // "रवि को 500 रुपये उधार दिए", "Ravi ko 500 udhaar diye"
  {
    pattern: new RegExp(String.raw`^${WHO}\s+(?:को|ko)\s+${SUM}\s+(?:उधार|udhaar|udhar|udhaar)\s+(?:दिए|दिये|दिया|दी|diye|diya|di|de\s+diye|दे\s+दिए)${HAI}$`, 'iu'),
    english: 'lent $1 $2',
  },
  // "रवि ने 500 उधार लिए": they borrowed, so they owe
  {
    pattern: new RegExp(String.raw`^${WHO}\s+(?:ने|ne)\s+${SUM}\s+(?:उधार|udhaar|udhar)\s+(?:लिए|लिये|लिया|liye|liya)${HAI}$`, 'iu'),
    english: 'lent $1 $2',
  },
  // "रवि से 500 लेने हैं", "Ravi se 500 wapas lene hain"
  {
    pattern: new RegExp(String.raw`^${WHO}\s+(?:से|se)\s+${SUM}\s+(?:(?:वापस|wapas|vapas)\s+)?(?:लेने|lene)${HAI}$`, 'iu'),
    english: 'collect $2 from $1',
  },
  // "रवि पर 500 बाकी हैं", "Ravi ke 500 baaki hain"
  {
    pattern: new RegExp(String.raw`^${WHO}\s+(?:पर|par|के|ke)\s+${SUM}\s+(?:बाकी|बाक़ी|baaki|baki|उधार|udhaar)${HAI}$`, 'iu'),
    english: '$1 owes me $2',
  },
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

  // Money first, so the loan sentences below see "₹500" however it was said.
  text = text.replace(RUPEES, '₹$1')

  // From now: "2 दिन बाद" is "in 2 days", which the parser already reads.
  text = text.replace(HALF_HOUR, ' in 30 minutes ')
  text = text.replace(AFTER, (_, count: string, unit: string) => {
    const n = /^\d+$/.test(count) ? Number(count) : NUMBER_WORDS[count.toLowerCase()]!
    const english = UNITS.find((u) => new RegExp(`^(?:${u.words})$`, 'iu').test(unit))!.english
    return ` in ${n} ${english}${n === 1 ? '' : 's'} `
  })

  // A date: "15 नवंबर को", "5 तारीख को".
  for (const [words, english] of MONTHS) text = text.replace(wordKo(words), ` ${english} `)
  text = text.replace(TARIKH, (_, day: string) => ` on the ${ordinal(Number(day))} `)

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
  for (const { pattern, english } of NEXT_THIS) text = text.replace(pattern, english)
  // A deadline goes last, where English says it — "send the report by friday" —
  // so the title that is left is the task, not "by".
  let deadline = ''
  text = text.replace(BY, (_, day: string, time: string) => {
    deadline = ` by ${day}${time.replace(/\s+/g, ' ')}`
    return ' '
  })
  for (const repeat of REPEATS) text = text.replace(repeat.pattern, repeat.english)

  text = `${text.replace(/\s{2,}/g, ' ').trim()}${deadline}`

  // Money owed, said the Hindi way, as a whole sentence.
  for (const { pattern, english } of OWED) {
    if (pattern.test(text)) return text.replace(pattern, english).replace(/\s{2,}/g, ' ').trim()
  }
  return text
}

/**
 * Hindi words left in a title once the time words are gone: "sabzi lana",
 * "mom ko call karna hai". A sign the line was only half understood, and
 * worth a careful second reading when one is on hand.
 */
export const HINDI_LEFTOVER = /\b(?:hai|hain|karna|karni|karne|karo|lana|lani|lena|leni|dena|deni|jana|jaana|wala|wali|raha|rahi|mein|nahi|parso|sabzi|doodh|dawai|kapde|ghar)\b/i
