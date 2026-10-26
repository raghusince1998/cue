/**
 * Things that happen rather than things to do: a wedding, a concert, a
 * conference, Diwali, a birthday. They sit on the calendar and remind you, but
 * they are never overdue, never chased, and never counted as work done — once
 * the day has passed, it has passed.
 */
export const HAPPENING_KINDS = ['event', 'celebration'] as const
export type HappeningKind = (typeof HAPPENING_KINDS)[number]

export function isHappening(kind: string): kind is HappeningKind {
  return (HAPPENING_KINDS as readonly string[]).includes(kind)
}

/**
 * A festival or a day to mark: a whole day, not a slot. Hindi and Hinglish
 * spellings too, since that is how many people type them.
 */
const CELEBRATION =
  /\b(?:diwali|deepavali|holi|eid|bakri\s*d|christmas|xmas|navr[a]?tri|durga\s+puja|ganesh\s+chaturthi|ganpati|raksha\s*bandhan|rakhi|dussehra|dasara|pongal|onam|lohri|baisakhi|vaisakhi|karva\s*chauth|karwa\s*chauth|janmashtami|bhai\s*dooj|makar\s*sankranti|sankranti|ugadi|gudi\s*padwa|chhath|gurpurab|guru\s*purab|new\s+year|festival|tyoh?aa?r|tyohar|birthday|b'?day|anniversary|puja|pooja)\b|दिवाली|दीपावली|होली|ईद|क्रिसमस|त्योहार|त्यौहार|जन्मदिन|सालगिरह|पूजा|राखी|रक्षाबंधन|नवरात्रि|दशहरा|छठ/i

/** An occasion at a time: something you go to. */
const EVENT =
  /\b(?:wedding|marriage|shaadi|shadi|reception|sangeet|mehe?ndi|haldi|engagement|sagai|roka|(?:dinner|birthday|office|farewell|house|kitty|cocktail|team|anniversary|christmas|diwali|holi|new\s+year'?s?|college|school)\s+party|party\s+(?:at|on|tonight|tomorrow)|concert|function|ceremony|event|mela|exhibition|expo|conference|summit|seminar|gathering|get[-\s]?together|reunion|graduation|convocation|farewell|housewarming|griha\s*pravesh|annual\s+day|sports\s+day|match\s+at|movie|play\s+at)\b|शादी|सगाई|समारोह|कार्यक्रम|पार्टी/i

/**
 * Something to do about the occasion is a task: "buy diwali sweets", "wish Ravi
 * happy birthday", "book the wedding hall".
 */
const ACTION =
  /\b(?:call|ring|phone|email|mail|message|text|whatsapp|send|pay|buy|book|order|wish|greet|gift|plan|prepare|arrange|organi[sz]e|invite|decorate|clean|shop|pick\s+up|collect|remind|ask|tell|submit|finish|write|check|confirm|reply|return|renew|print|make|fix|update|review|test|deploy|debug)\b|खरीद|भेज|बुक|तैयार/i

/** A birthday or an anniversary is a day to mark — unless there is a party to go to. */
const DAY_TO_MARK = /\b(?:birthday|b'?day|anniversary)\b|जन्मदिन|सालगिरह/i
const GOING = /\b(?:party|function|dinner|lunch|reception|ceremony)\b|पार्टी|समारोह/i

/** What a line names, when it is an occasion rather than a job: or null. */
export function happeningKind(title: string): HappeningKind | null {
  if (ACTION.test(title)) return null
  if (DAY_TO_MARK.test(title) && !GOING.test(title)) return 'celebration'
  if (EVENT.test(title)) return 'event'
  if (CELEBRATION.test(title)) return 'celebration'
  return null
}
