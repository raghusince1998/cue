import { shortName } from './names.ts'

/**
 * Quick messages: the things said over and over — thanks for meeting, sorry
 * I missed your call, a gentle reminder — written once and filled in for
 * whoever they are going to.
 */

/** What can be filled in, as written in a message and as offered to insert. */
export const TEMPLATE_FIELDS = [
  { token: '{first}', label: 'Their name' },
  { token: '{name}', label: 'Their full name' },
  { token: '{company}', label: 'Where they work' },
  { token: '{me}', label: 'Your name' },
] as const

export interface TemplateValues {
  /** Their full name, as saved: "Dr. Anil Mehta". */
  name?: string | null
  company?: string | null
  /** Your own name, to sign with. */
  me?: string | null
}

/**
 * The message for one person. {first} is how they are addressed — "Dr. Mehta"
 * for a doctor, "Ravi" for Ravi Kumar. Anything not known is left out without
 * leaving a gap: "Hi {first}," to nobody in particular is "Hi,".
 */
export function fillTemplate(body: string, v: TemplateValues): string {
  const name = v.name?.trim().replace(/\s+/g, ' ') ?? ''
  const values: Record<string, string> = {
    first: name ? shortName(name) : '',
    name,
    company: v.company?.trim() ?? '',
    me: v.me?.trim() ?? '',
  }
  return body
    .replace(/\{(first|name|company|me)\}/gi, (_, key: string) => values[key.toLowerCase()] ?? '')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
}

/** A handful to start from, offered once rather than put there unasked. */
export const STARTER_TEMPLATES: { title: string; body: string }[] = [
  {
    title: 'Thanks for meeting',
    body: 'Hi {first}, thank you for your time today. As discussed, I will send across the details shortly.\n\nRegards,\n{me}',
  },
  {
    title: 'Missed your call',
    body: 'Hi {first}, I tried calling you just now. Please let me know a good time to talk.\n\n{me}',
  },
  {
    title: 'Sharing the details',
    body: 'Hi {first}, sharing the details we spoke about. Happy to answer any questions.\n\nRegards,\n{me}',
  },
  {
    title: 'Gentle reminder',
    body: 'Hi {first}, a gentle reminder about what we discussed. Could you share an update when you get a moment?\n\nThanks,\n{me}',
  },
  {
    title: 'Running late',
    body: 'Hi {first}, apologies, I am running about 10 minutes late. See you shortly.\n\n{me}',
  },
]
