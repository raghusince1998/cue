/**
 * "create appointment for dentist who lives in sirsi regarding software demo"
 *
 * That sentence carries four separate facts — what kind of thing, who with,
 * where, and what it is about — and until now all four went into the title as
 * one undifferentiated string. The app then knew nothing: no place to check
 * travel against, no person to offer a call button for, no subject to match
 * against next time.
 *
 * This reads the roles out of it. Deliberately a grammar rather than a model:
 * role markers in English are a small closed set ("with", "regarding", "who
 * lives in"), and a grammar is instant, free, private, works offline, and can
 * show which words produced which field. A sentence it cannot read is handed
 * on untouched rather than guessed at — the optional LLM path already exists
 * for the genuinely hard ones.
 */

/** Imperative scaffolding that carries no information about the plan itself. */
const LEAD =
  /^\s*(?:please\s+)?(?:can\s+you\s+)?(?:create|add|make|set\s*up|setup|schedule|book|fix|arrange|put|plan)\s+(?:an?\s+|the\s+)?/i

/**
 * Words that name a kind of meeting. Doubles as a signal that what follows is
 * structured rather than a free-text title.
 */
const KINDS: { pattern: RegExp; kind: ExtractedKind }[] = [
  { pattern: /\bappointments?\b/i, kind: 'appointment' },
  { pattern: /\b(?:meetings?|meet)\b/i, kind: 'meeting' },
  { pattern: /\b(?:calls?|ring|phone)\b/i, kind: 'call' },
  { pattern: /\b(?:visits?|site\s+visit)\b/i, kind: 'visit' },
  { pattern: /\b(?:demos?|demonstration)\b/i, kind: 'demo' },
  { pattern: /\b(?:reviews?|catch[-\s]?up|sync|standup|stand[-\s]?up)\b/i, kind: 'meeting' },
  { pattern: /\binterviews?\b/i, kind: 'interview' },
]

export type ExtractedKind =
  | 'appointment'
  | 'meeting'
  | 'call'
  | 'visit'
  | 'demo'
  | 'interview'
  | null

/**
 * Occupations and relationships, so "for dentist" reads as a person while
 * "for the demo" reads as a subject.
 *
 * Deliberately weighted towards the kinds of people someone in India actually
 * books time with, rather than a generic English word list.
 */
const PERSON_WORDS =
  /\b(?:dentist|doctor|dr|physician|surgeon|therapist|physio|physiotherapist|counsellor|counselor|lawyer|advocate|ca|accountant|auditor|banker|agent|broker|architect|contractor|plumber|electrician|carpenter|mechanic|tailor|barber|teacher|tutor|professor|principal|client|customer|vendor|supplier|partner|investor|founder|manager|director|boss|hr|recruiter|candidate|landlord|tenant|neighbour|neighbor|chemist|pharmacist|optician|vet|veterinarian|priest|pandit|guruji|mum|mom|dad|amma|appa|papa|mummy|daddy|bhai|didi|uncle|aunty|aunt)\b/i

/** A capitalised run, which is how a name looks in the middle of a sentence. */
const NAME = /^(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Shri|Smt)?\s*[A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,2}$/

/** Phrases that introduce what the thing is about. */
const SUBJECT_MARKERS =
  /\b(?:regarding|reg|re|about|concerning|w\.?r\.?t\.?|with\s+regard\s+to|to\s+discuss|to\s+talk\s+about|for\s+the\s+purpose\s+of|on\s+the\s+topic\s+of)\b/i

/** Phrases that introduce a person. */
const PERSON_MARKERS = /\b(?:with|for|alongside|and\s+meet)\b/i

/**
 * Phrases that introduce a place. "who lives in" is listed first and matched
 * first, because the relative clause attaches the place to the person and the
 * bare "in" inside it would otherwise be read on its own.
 */
const PLACE_CLAUSES = [
  /\bwho\s+(?:lives?|stays?|works?|sits?|is\s+based)\s+(?:in|at|near)\s+/i,
  /\b(?:located|based|situated)\s+(?:in|at|near)\s+/i,
  /\b(?:at|in|near)\s+(?:his|her|their|the)?\s*(?:office|clinic|place|home|shop|residence)\s+(?:in|at)\s+/i,
]

const PLACE_MARKERS = /\b(?:at|in|near|around)\b/i

/** Words that end a captured phrase, because they start the next role. */
const BOUNDARY =
  /\b(?:regarding|reg|re|about|concerning|who|which|that|with|for|at|in|near|on|tomorrow|today|tonight|next|this|every|from|by|before|after|once)\b/i

/**
 * Anything that is part of when it happens rather than what it is.
 *
 * The date parser owns these words; letting a captured phrase keep them names
 * the meeting after its own timestamp.
 */
const DATE_WORD =
  /^(?:tomorrow|today|tonight|yesterday|next|this|on|at|by|before|after|from|until|till|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|\d{1,2}(?::\d{2})?(?:am|pm)?|\d{1,2}(?:st|nd|rd|th))$/i

export interface RoleEvidence {
  field: 'kind' | 'person' | 'place' | 'subject'
  /** The words that produced it, so the reading can be checked at a glance. */
  from: string
}

export interface ExtractedRoles {
  kind: ExtractedKind
  person: string | null
  place: string | null
  subject: string | null
  /** What to call it: the subject if there is one, else the person. */
  title: string
  evidence: RoleEvidence[]
}

/** Trims a captured phrase at the first word that belongs to another role. */
function clip(text: string): string {
  const words = text.trim().split(/\s+/)
  const out: string[] = []
  for (const word of words) {
    if (out.length > 0 && BOUNDARY.test(word)) break
    out.push(word)
    if (out.length >= 6) break
  }
  return out
    .join(' ')
    .replace(/^(?:a|an|the|my|our|his|her|their)\s+/i, '')
    .replace(/[,.;:]+$/, '')
    .trim()
}

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function looksLikePerson(text: string): boolean {
  return PERSON_WORDS.test(text) || NAME.test(text)
}

/**
 * Reads the roles out of a sentence, or returns null when there are none to
 * read.
 *
 * Null rather than a half-filled object: a sentence like "dentist friday 6pm"
 * has no roles in it and is already handled perfectly well by the plain
 * parser, so claiming otherwise would only make the simple case worse.
 */
export function extractRoles(input: string): ExtractedRoles | null {
  const evidence: RoleEvidence[] = []
  let rest = input.replace(LEAD, '').trim()
  if (!rest) return null

  /**
   * Whether a word actually assigned a role, rather than a role being inferred
   * from a lexicon alone. "call mom" has two findable fields and no structure;
   * reading it as a kind and a person turns a two-word capture that already
   * worked into "Call with mom", which is worse.
   */
  let usedMarker = false

  // ------------------------------------------------------------------ kind
  let kind: ExtractedKind = null
  for (const candidate of KINDS) {
    const m = candidate.pattern.exec(rest)
    if (!m) continue
    kind = candidate.kind
    evidence.push({ field: 'kind', from: m[0] })
    // The kind word is only removed when it leads; "software demo" is a
    // subject that happens to contain one, and gutting it would be wrong.
    if (m.index <= 2) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`.trim()
    break
  }

  // --------------------------------------------------------------- subject
  let subject: string | null = null
  const subjectMarker = SUBJECT_MARKERS.exec(rest)
  if (subjectMarker) {
    const after = rest.slice(subjectMarker.index + subjectMarker[0].length)
    // Stops at the first word that belongs to the date, or the subject
    // swallows it: "regarding the software demo next tuesday 4pm" would name
    // the meeting after the time it happens.
    const words: string[] = []
    for (const word of after.trim().split(/\s+/)) {
      if (words.length > 0 && (DATE_WORD.test(word) || BOUNDARY.test(word))) break
      words.push(word)
      if (words.length >= 8) break
    }
    const captured = words
      .join(' ')
      .replace(/^(?:a|an|the)\s+/i, '')
      .replace(/[,.;:]+$/, '')
      .trim()
    if (captured) {
      subject = captured
      evidence.push({ field: 'subject', from: `${subjectMarker[0]} ${captured}` })
      usedMarker = true
      rest = rest.slice(0, subjectMarker.index).trim()
    }
  }

  // ----------------------------------------------------------------- place
  let place: string | null = null
  for (const clause of PLACE_CLAUSES) {
    const m = clause.exec(rest)
    if (!m) continue
    const captured = clip(rest.slice(m.index + m[0].length))
    if (captured) {
      place = captured
      evidence.push({ field: 'place', from: `${m[0].trim()} ${captured}` })
      usedMarker = true
      rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length + captured.length)}`.trim()
    }
    break
  }

  // ---------------------------------------------------------------- person
  let person: string | null = null
  const personMarker = PERSON_MARKERS.exec(rest)
  if (personMarker) {
    const captured = clip(rest.slice(personMarker.index + personMarker[0].length))
    // "for the demo" is a subject, not a person; the lexicon is what tells
    // the two apart, since the marker word alone cannot.
    if (captured && looksLikePerson(captured)) {
      person = captured
      evidence.push({ field: 'person', from: `${personMarker[0]} ${captured}` })
      usedMarker = true
      rest = `${rest.slice(0, personMarker.index)} ${rest.slice(personMarker.index + personMarker[0].length + captured.length)}`.trim()
    }
  }

  // A bare occupation with no marker at all: "dentist appointment in Sirsi".
  if (!person) {
    const bare = PERSON_WORDS.exec(rest)
    if (bare) {
      // A title followed by a name is one person: "Dr Shah", not "Dr". Taking
      // only the honorific loses the only part anyone would recognise.
      const after = rest.slice(bare.index + bare[0].length)
      const named = /^\.?\s+([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*)?)/.exec(after)
      const whole = named ? `${bare[0]} ${named[1]}` : bare[0]
      const consumed = bare[0].length + (named ? named[0].length : 0)

      person = whole
      evidence.push({ field: 'person', from: whole })
      rest = `${rest.slice(0, bare.index)} ${rest.slice(bare.index + consumed)}`.trim()
    }
  }

  // A plain "at X" or "in X", looked for only after the person is out of the
  // way so "meet Ravi in accounts" does not make a place of a department.
  if (!place) {
    const marker = PLACE_MARKERS.exec(rest)
    if (marker) {
      const captured = clip(rest.slice(marker.index + marker[0].length))
      // Capitalised, or a known place word. A lowercase run after "in" is
      // usually the rest of a sentence, not somewhere you can travel to.
      if (captured && /^[A-Z]/.test(captured)) {
        place = captured
        evidence.push({ field: 'place', from: `${marker[0]} ${captured}` })
        usedMarker = true
        // Taken out of the remainder like every other role, or the leftover
        // title ends up being the place that was just extracted from it.
        rest = `${rest.slice(0, marker.index)} ${rest.slice(marker.index + marker[0].length + captured.length + 1)}`.trim()
      }
    }
  }

  // Roles are only worth claiming when at least two were found, or when a
  // subject was named outright. One lonely guess is how a parser earns
  // distrust.
  const found = [kind, person, place, subject].filter(Boolean).length
  if (found < 2 && !subject) return null
  // Structure, not just findable words. Without a marker this is an ordinary
  // short sentence the plain parser already handles better.
  if (!usedMarker && !subject) return null

  // What is left once every role is accounted for — "site visit" in "site
  // visit at Chakan plant" — which is often the most natural name for it.
  const leftover = rest
    .replace(PLACE_MARKERS, ' ')
    // Dates belong to the date parser, not to the name of the thing.
    .replace(
      /\b(?:tomorrow|today|tonight|yesterday|next\s+\w+|this\s+\w+|on\s+\w+day)\b/gi,
      ' ',
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .trim()

  const title = subject
    ? titleCase(subject)
    : person
      ? `${kind ? titleCase(kind) : 'Meeting'} with ${person}`
      : leftover.length >= 3
        ? titleCase(leftover)
        : kind && place
          ? `${titleCase(kind)} at ${place}`
          : ''

  if (!title) return null

  return { kind, person, place, subject, title, evidence }
}
