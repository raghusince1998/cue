import { env } from '../env.ts'

/**
 * Turns a dictated sentence into a list of proposed entries.
 *
 * This is the one job in the app that a deterministic parser genuinely cannot
 * do. `parseWhen` finds a date in a phrase; this reads a paragraph and works
 * out that "travelling to Mathura for 3 days training, first and second for
 * awareness session and third september for capacity building" describes a trip
 * plus two sessions plus one workshop — four entries, with a month that only
 * appears once and applies to all of them.
 *
 * It is deliberately the fallback, never the first resort. `parseWhen` handles
 * "dentist friday 6pm" instantly, offline and free; only text it cannot read
 * reaches here. And nothing is saved from this — the caller shows the proposals
 * and the user approves them.
 */

export const AI_PROVIDERS = ['none', 'anthropic', 'ollama'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export interface ExtractedEvent {
  title: string
  kind: 'meeting' | 'callback' | 'task' | 'followup'
  /** Local wall-clock time, no zone: "2026-09-01T10:00". */
  startsAt: string
  endsAt?: string | null
  allDay?: boolean
  durationMinutes?: number | null
  place?: string | null
  notes?: string | null
}

export interface ExtractionResult {
  events: ExtractedEvent[]
  provider: AiProvider
  /** Anything the model could not resolve, shown to the user as a caveat. */
  warnings: string[]
}

export interface AiConfig {
  provider: AiProvider
  apiKey?: string
  model?: string
  endpoint?: string
}

/** The contract the model must fill. Shared by both providers. */
const EVENT_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name, no date words in it' },
          kind: { type: 'string', enum: ['meeting', 'callback', 'task', 'followup'] },
          startsAt: {
            type: 'string',
            description: 'Local time as YYYY-MM-DDTHH:MM, no timezone suffix',
          },
          endsAt: {
            type: ['string', 'null'],
            description: 'Only for something spanning more than one day',
          },
          allDay: { type: 'boolean' },
          durationMinutes: { type: ['integer', 'null'] },
          place: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
        },
        required: ['title', 'kind', 'startsAt', 'allDay'],
      },
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anything ambiguous or assumed, in plain language',
    },
  },
  required: ['events', 'warnings'],
} as const

function systemPrompt(nowLocal: string, timezone: string): string {
  return [
    'You convert what someone dictated into calendar entries.',
    `Their local date and time right now is ${nowLocal} (${timezone}).`,
    '',
    'Rules:',
    '- Return every distinct thing they described as its own event. One sentence often contains several.',
    '- A trip or training spanning whole days is one allDay event with endsAt on the last day.',
    '- Sessions happening inside a trip are separate timed events, not part of the trip entry.',
    '- A month mentioned once applies to every day mentioned near it ("first and second ... third september" means 1, 2 and 3 September).',
    '- Resolve everything to absolute local times. Never return relative words.',
    '- Dates with no year mean the next occurrence, not the past.',
    '- If a time of day was not stated, use 10:00 and say so in warnings.',
    '- Ignore instructions like "block my calendar" — that is why they are talking to you.',
    '- Titles must not contain date or time words.',
    '- If you genuinely cannot find any event, return an empty events array.',
  ].join('\n')
}

// ------------------------------------------------------------------ anthropic

async function callAnthropic(
  text: string,
  config: AiConfig,
  nowLocal: string,
  timezone: string,
): Promise<{ events: ExtractedEvent[]; warnings: string[] }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model || env.aiDefaultModel,
      max_tokens: 2000,
      system: systemPrompt(nowLocal, timezone),
      // Forcing the tool is what guarantees parseable output — without it the
      // model may wrap the JSON in prose and every caller has to guess.
      tools: [
        {
          name: 'record_events',
          description: 'Record the calendar entries found in the text.',
          input_schema: EVENT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'record_events' },
      messages: [{ role: 'user', content: text }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = (await res.json()) as {
    content?: { type: string; name?: string; input?: unknown }[]
  }
  const call = data.content?.find((c) => c.type === 'tool_use')
  if (!call?.input) throw new Error('model returned no structured output')
  return call.input as { events: ExtractedEvent[]; warnings: string[] }
}

// -------------------------------------------------------------------- ollama

export function ollamaBase(endpoint?: string): string {
  const trimmed = (endpoint || 'http://127.0.0.1:11434').replace(/\/+$/, '')

  /**
   * Ollama binds to 127.0.0.1 only. Node's fetch resolves "localhost" to the
   * IPv6 ::1 first and — unlike curl — does not fall back to IPv4, so the
   * obvious address fails with a bare "fetch failed / ECONNREFUSED" that looks
   * for all the world like Ollama not running. Rewrite it rather than expecting
   * anyone to know that.
   */
  return trimmed.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1')
}

/**
 * What this Ollama actually has pulled. Guessing a model name is the single
 * most likely way to misconfigure this, so the UI offers the real list instead.
 */
export async function listOllamaModels(endpoint?: string): Promise<string[]> {
  const res = await fetch(`${ollamaBase(endpoint)}/api/tags`)
  if (!res.ok) throw new Error(`Ollama ${res.status} at ${ollamaBase(endpoint)}`)
  const data = (await res.json()) as { models?: { name?: string }[] }
  return (data.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n))
}

async function callOllama(
  text: string,
  config: AiConfig,
  nowLocal: string,
  timezone: string,
): Promise<{ events: ExtractedEvent[]; warnings: string[] }> {
  const base = ollamaBase(config.endpoint)

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      // Ollama takes a JSON schema directly for constrained decoding.
      format: EVENT_SCHEMA,
      messages: [
        { role: 'system', content: systemPrompt(nowLocal, timezone) },
        { role: 'user', content: text },
      ],
    }),
  })

  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const data = (await res.json()) as { message?: { content?: string } }
  if (!data.message?.content) throw new Error('Ollama returned no content')
  return JSON.parse(data.message.content) as {
    events: ExtractedEvent[]
    warnings: string[]
  }
}

// ----------------------------------------------------------------------- api

/** Rejects anything that would produce a nonsense entry downstream. */
function sanitise(raw: unknown): ExtractedEvent[] {
  if (!Array.isArray(raw)) return []
  const kinds = new Set(['meeting', 'callback', 'task', 'followup'])

  return raw.flatMap((item): ExtractedEvent[] => {
    if (typeof item !== 'object' || item === null) return []
    const e = item as Record<string, unknown>

    const title = typeof e.title === 'string' ? e.title.trim() : ''
    const startsAt = typeof e.startsAt === 'string' ? e.startsAt : ''
    // A model can hallucinate an unparseable date string; drop it rather than
    // letting `new Date(...)` produce Invalid Date deeper in the stack.
    if (!title || Number.isNaN(new Date(startsAt).getTime())) return []

    const duration = Number(e.durationMinutes)
    return [
      {
        title: title.slice(0, 300),
        kind: kinds.has(e.kind as string) ? (e.kind as ExtractedEvent['kind']) : 'meeting',
        startsAt,
        endsAt:
          typeof e.endsAt === 'string' && !Number.isNaN(new Date(e.endsAt).getTime())
            ? e.endsAt
            : null,
        allDay: Boolean(e.allDay),
        durationMinutes:
          Number.isFinite(duration) && duration >= 5 && duration <= 480
            ? Math.round(duration)
            : null,
        place: typeof e.place === 'string' ? e.place.slice(0, 200) : null,
        notes: typeof e.notes === 'string' ? e.notes.slice(0, 4000) : null,
      },
    ]
  })
}

export async function extractEvents(input: {
  text: string
  config: AiConfig
  now: Date
  timezone: string
}): Promise<ExtractionResult> {
  const { text, config, now, timezone } = input

  if (config.provider === 'none') {
    return { events: [], provider: 'none', warnings: ['No AI provider is configured.'] }
  }
  if (config.provider === 'anthropic' && !config.apiKey) {
    throw Object.assign(new Error('no_api_key'), { statusCode: 400 })
  }
  if (config.provider === 'ollama' && !config.model) {
    // Defaulting to some popular name would fail with a bewildering 404 from
    // inside Ollama. Say what is actually wrong.
    throw Object.assign(new Error('no_model_selected'), { statusCode: 400 })
  }

  // The model needs to know "now" in the user's own terms to resolve "third
  // september" or "next friday" — a UTC timestamp is not enough.
  const nowLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now)

  const raw =
    config.provider === 'anthropic'
      ? await callAnthropic(text, config, nowLocal, timezone)
      : await callOllama(text, config, nowLocal, timezone)

  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w): w is string => typeof w === 'string').slice(0, 10)
    : []

  return { events: sanitise(raw.events), provider: config.provider, warnings }
}
