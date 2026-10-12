import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api.ts'
import { DictateButton } from './DictateButton.tsx'
import { announceChange } from '../lib/changes.ts'
import { examplesFor } from '@cue/shared'
import { useAuth } from '../lib/auth.tsx'
import {
  NO_CHOICES,
  QuickLinks,
  SavedForTrip,
  range,
  type LinkChoices,
  type Links,
  type TripLink,
  type UpcomingTrip,
} from './QuickLinks.tsx'

/**
 * Type it, press Enter, it is planned.
 *
 * The capture screen asked seventeen questions to save "dentist friday 6pm" —
 * what kind of thing, how long, how important, whether the time was fixed,
 * where, and so on. Almost all of them were answerable from the sentence or
 * from what this person had done before, and asking anyway cost more time than
 * the app saved.
 *
 * So the default path is one line and one keystroke. Every assumption is shown
 * before saving and repeated after, with undo, because speed is only worth
 * having if the guesses stay checkable.
 */

interface Person {
  id: string
  name: string
  role: string | null
  phone: string | null
  placeLabel: string | null
}

interface Plan {
  kind:
    | 'commitment'
    | 'intention'
    | 'trip'
    | 'recurrence'
    | 'expense'
    | 'owed'
    | 'tracker'
    | 'bill'
    | 'delivery'
    | 'needsTime'
    | 'needsPerson'
    | 'unclear'
  title: string
  summary: string
  assumptions: string[]
  problem: string | null
  placeLabel: string | null
  personName: string | null
  people: Person[]
  durationMinutes: number
  /** Who the preview attached: only ever a certain match. */
  contactId: string | null
  links?: Links
  trip?: TripLink | null
  upcomingTrip?: UpcomingTrip | null
  /** Money spent, when that is what the line was. */
  expense?: { amountPaise: number; note: string | null } | null
  /** Money owed to you, when that is what the line was. */
  owed?: { amountPaise: number; name: string; note: string | null } | null
  /** A booking confirmation: a train, a flight, a hotel, a show. */
  booking?: { type: string; ref: string | null } | null
  /** The rules were unsure and the AI is on: a careful reading, once typing pauses. */
  canReadCarefully?: boolean
  readBy?: 'rules' | 'ai'
  /** When the answer is a question: what to ask, and answers to tap. */
  question?: string | null
  /** Each sets the line to how it reads with that answer. */
  choices?: Choice[]
  /** Better plans on offer, applied on save only if accepted. */
  suggestions?: Suggestion[]
}

interface Choice {
  label: string
  line: string
}

interface Suggestion {
  id: string
  text: string
  action: string
  warning?: boolean
}

interface Saved extends Plan {
  id: string
  /** The line as it was typed: what Undo puts back. */
  typed?: string
  /** Several wishes saved from one line: undo takes all of them. */
  ids?: string[]
  savedTrip?: { id: string; placeLabel: string; startsOn: string; endsOn: string; created?: boolean } | null
  waiting?: { id: string; title: string }[]
  scheduledOnTrip?: UpcomingTrip | null
  /** Added alongside because a suggestion was accepted: undo takes them too. */
  extras?: { kind: string; id: string }[]
  /** What was accepted, to say so once saved. */
  acceptedActions?: string[]
}

interface Frequent {
  title: string
  count: number
}

const KIND_WORD: Record<Plan['kind'], string> = {
  commitment: 'Planned',
  intention: 'Saved for later',
  trip: 'Trip planned',
  recurrence: 'Repeating',
  expense: 'Expense',
  owed: 'Owed to you',
  tracker: 'Tracking',
  bill: 'Bill',
  delivery: 'Parcel',
  needsTime: 'Understood',
  needsPerson: 'Which one?',
  unclear: '',
}

/** One tap each, rather than a date picker for a question this small. */
const WHEN_CHIPS = ['tomorrow 10am', 'tomorrow 3pm', 'friday 11am', 'next monday 10am']

export function QuickAdd({
  onSaved,
  onDone,
  onFillIn,
  initialText = '',
  autoFocus = true,
  listen = false,
  inline = false,
}: {
  onSaved: () => void
  /** Called by "Done": the sheet this lives in closes. */
  onDone: () => void
  /** "Fill it in myself" — hands the sentence to the detailed form. */
  onFillIn: (text: string) => void
  /** Already written: shared in from another app. */
  initialText?: string
  /** Off on Today, where a keyboard springing up on every visit would be in the way. */
  autoFocus?: boolean
  /** Start listening at once: opened from "Speak a reminder". */
  listen?: boolean
  /** On Today rather than in the Add sheet: examples only once it is in use. */
  inline?: boolean
}) {
  const { me } = useAuth()
  const examples = examplesFor(me?.uses ?? [])
  const [text, setText] = useState(initialText)
  const [focused, setFocused] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [frequent, setFrequent] = useState<Frequent[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clash, setClash] = useState<{ titles: string[]; suggestions: string[] } | null>(null)
  /** What was decided about the people, places and trip the preview offered. */
  const [choices, setChoices] = useState<LinkChoices>(NO_CHOICES)
  /** Bumped to read the sentence again, e.g. after "Pune is where I live". */
  const [reread, setReread] = useState(0)
  /** A careful reading of an unsure line is on its way. */
  const [reading, setReading] = useState(false)
  /** Suggestions accepted for this line, by id. A new line starts with none. */
  const [accepted, setAccepted] = useState<string[]>([])
  useEffect(() => setAccepted([]), [text])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api<{ frequent: Frequent[] }>('/quick/suggestions')
      .then((r) => setFrequent(r.frequent))
      .catch(() => undefined)
  }, [])

  // Debounced, because a preview on every keystroke is a request per character
  // and the interpretation only settles once someone stops typing anyway.
  useEffect(() => {
    const value = text.trim()
    if (value.length < 3) {
      setPlan(null)
      return
    }
    let careful: ReturnType<typeof setTimeout> | undefined
    let stale = false
    const handle = setTimeout(() => {
      api<Plan>('/quick/preview', { method: 'POST', body: { text: value } })
        .then((first) => {
          if (stale) return
          setPlan(first)
          // The rules were unsure of this one. Once typing has paused, ask for
          // a careful reading — never per keystroke, since it is slower and
          // costs something.
          if (!first.canReadCarefully) return
          careful = setTimeout(() => {
            setReading(true)
            api<Plan>('/quick/preview', { method: 'POST', body: { text: value, careful: true } })
              .then((better) => {
                if (!stale) setPlan(better)
              })
              .catch(() => undefined)
              .finally(() => {
                if (!stale) setReading(false)
              })
          }, 700)
        })
        .catch(() => setPlan(null))
    }, 250)
    return () => {
      stale = true
      clearTimeout(handle)
      if (careful) clearTimeout(careful)
      setReading(false)
    }
  }, [text, reread])

  async function setHome(city: string) {
    await api('/me/preferences', { method: 'PATCH', body: { homeCity: city } }).catch(() => undefined)
    setReread((n) => n + 1)
  }

  const save = useCallback(
    async (allowConflict = false) => {
      const value = text.trim()
      if (!value) return
      setBusy(true)
      setError(null)
      setClash(null)
      try {
        // Only choices about what this preview actually offered: a person
        // picked for an earlier sentence must not ride along to a new one.
        const links = plan?.links
        const body: Record<string, unknown> = { text: value, allowConflict }
        if (choices.contactId === null || links?.people.some((p) => p.id === choices.contactId)) {
          body.contactId = choices.contactId
        }
        if (choices.placeId && links?.places.some((p) => p.id === choices.placeId)) body.placeId = choices.placeId
        if (choices.accountName && links?.accounts.some((a) => a.name === choices.accountName)) {
          body.accountName = choices.accountName
        }
        if (plan?.trip && !plan.trip.existing) body.trip = choices.trip
        if (plan?.upcomingTrip) body.onTrip = choices.onTrip
        const offered = (plan?.suggestions ?? []).filter((s) => accepted.includes(s.id))
        if (offered.length) body.accept = offered.map((s) => s.id)
        const result = await api<Saved>('/quick', { method: 'POST', body })
        setSaved({ ...result, typed: text, acceptedActions: offered.map((s) => s.action) })
        setText('')
        setPlan(null)
        setChoices(NO_CHOICES)
        onSaved()
        announceChange()
        inputRef.current?.focus()
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const data = err.data as {
            conflicts?: { title: string }[]
            suggestions?: string[]
          }
          setClash({
            titles: (data.conflicts ?? []).map((c) => c.title),
            suggestions: data.suggestions ?? [],
          })
        } else if (err instanceof ApiError && err.status === 422) {
          const data = err.data as { problem?: string }
          setError(data.problem ?? 'I could not read that.')
        } else {
          setError((err as Error).message)
        }
      } finally {
        setBusy(false)
      }
    },
    [text, onSaved, plan, choices, accepted],
  )

  async function undo() {
    if (!saved) return
    setBusy(true)
    try {
      // A trip made only for this goes with it; several wishes go together.
      const alsoTrip = saved.savedTrip?.created ? `?alsoTrip=${saved.savedTrip.id}` : ''
      for (const id of saved.ids ?? [saved.id]) {
        await api(`/quick/${saved.kind}/${id}${alsoTrip}`, { method: 'DELETE' })
      }
      // And whatever was accepted alongside it.
      for (const extra of saved.extras ?? []) {
        await api(`/quick/${extra.kind}/${extra.id}`, { method: 'DELETE' }).catch(() => undefined)
      }
      // The line as it was typed, time and amount included, to fix and save again.
      setText(saved.typed ?? saved.title)
      setSaved(null)
      onSaved()
      announceChange()
    } finally {
      setBusy(false)
    }
  }

  const ready =
    plan !== null &&
    plan.kind !== 'unclear' &&
    plan.kind !== 'needsTime' &&
    plan.kind !== 'needsPerson' &&
    !plan.problem
  // Everything was understood except when. Asking one short question is
  // honest; inventing an hour and hoping is not.
  const needsTime = plan?.kind === 'needsTime'
  // More than one person answers to that word. One tap settles it; guessing
  // puts the plan against a stranger and offers their phone number.
  const needsPerson = plan?.kind === 'needsPerson'

  return (
    <section className="quick">
      <div className={`quick-field${ready ? ' is-ready' : ''}`}>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setSaved(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready && !busy) {
              e.preventDefault()
              void save()
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={inline ? `Plan something: ${examples[0]}` : examples[0]}
          aria-label="What do you want to plan?"
          autoFocus={autoFocus}
        />
        <DictateButton value={text} onChange={setText} autoStart={listen} label="Speak" />
        <button className="primary" onClick={() => void save()} disabled={!ready || busy}>
          {busy ? 'Saving…' : 'Plan it'}
        </button>
      </div>

      {/* Nothing typed: the fastest capture is the one with no typing at all. */}
      {!text && !saved && frequent.length > 0 && (!inline || focused) && (
        <div className="quick-frequent">
          <span className="muted small">You often add</span>
          {frequent.map((f) => (
            <button key={f.title} className="chip" onClick={() => setText(`${f.title} `)}>
              {f.title}
            </button>
          ))}
        </div>
      )}

      {!text && !saved && frequent.length === 0 && (!inline || focused) && (
        <p className="muted small quick-hint">
          One line is enough.{' '}
          {[
            ...examples,
            'gym every mon wed fri at 7am',
            'pack for the trip tomorrow 8pm: charger, tickets, ID',
            'going to Pune 12 to 14 October',
          ].map((x, i) => (
            <span key={x}>
              {i > 0 && ' · '}&ldquo;{x}&rdquo;
            </span>
          ))}
          . Or paste a shop&rsquo;s delivery message, or a train, flight, hotel or movie booking
          confirmation, and Cue keeps track of it.
        </p>
      )}

      {/* Several people fit that word. Ask, rather than pick one. */}
      {needsPerson && plan && !saved && (
        <div className="quick-plan is-asking">
          <div>
            <span className="quick-kind">{KIND_WORD.needsPerson}</span>
            <strong>{plan.title}</strong>
            <p className="muted small">
              {plan.question
                ? plan.choices?.length
                  ? plan.question
                  : `${plan.question} Type their name in place of “${plan.personName}”.`
                : `${plan.people.length} people match “${plan.personName}”.`}
            </p>
            <div className="quick-frequent">
              {plan.choices?.map((c) => (
                <button key={c.line} className="chip" onClick={() => setText(c.line)}>
                  {c.label}
                </button>
              ))}
              {!plan.choices?.length && plan.people.map((person) => (
                <button
                  key={person.id}
                  className="chip"
                  onClick={() =>
                    // Naming them makes the sentence unambiguous, and the next
                    // preview resolves to exactly one.
                    // The article goes with the word: replacing "plumber"
                    // alone leaves "call the Ramesh Yadav".
                    setText((t) =>
                      t.replace(
                        new RegExp(`(?:\\b(?:the|my|our)\\s+)?\\b${plan.personName}\\b`, 'i'),
                        person.name,
                      ),
                    )
                  }
                >
                  {person.name}
                  {person.role ? ` · ${person.role}` : ''}
                  {person.phone ? ` · ${person.phone}` : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Understood, bar one thing. Ask for exactly that. */}
      {needsTime && plan && !saved && (
        <div className="quick-plan is-asking">
          <div>
            <span className="quick-kind">{KIND_WORD.needsTime}</span>
            <strong>{plan.title}</strong>
            <ul className="quick-assumptions">
              {plan.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p className="muted small">{plan.question ?? 'When is it?'}</p>
            <div className="quick-frequent">
              {(plan.choices?.length
                ? plan.choices
                : plan.question
                  ? []
                  : WHEN_CHIPS.map((c) => ({ label: c, line: `${text.trim()} ${c}` }))
              ).map((c) => (
                <button key={c.line} className="chip" onClick={() => setText(c.line)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* What it will do, before it does it. */}
      {plan && !needsTime && !needsPerson && !saved && (
        <div className={`quick-plan${plan.problem ? ' is-problem' : ''}`}>
          {plan.problem ? (
            <>
              <strong>{plan.problem}</strong>
              <button className="ghost small-btn" onClick={() => onFillIn(text)}>
                Fill it in myself
              </button>
            </>
          ) : (
            <>
              <div>
                <span className="quick-kind">{plan.booking ? 'Booking' : KIND_WORD[plan.kind]}</span>
                {reading && <span className="quick-reading">Reading it more carefully…</span>}
                <strong>{plan.summary}</strong>
                {plan.assumptions.length > 0 && (
                  <ul className="quick-assumptions">
                    {plan.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
              <kbd>Enter</kbd>
            </>
          )}
        </div>
      )}

      {/* A better plan, offered: nothing changes unless it is accepted. */}
      {plan && ready && !saved && (plan.suggestions ?? []).length > 0 && (
        <ul className="quick-suggestions" aria-label="Suggestions">
          {plan.suggestions!.map((s) => {
            const on = accepted.includes(s.id)
            return (
              <li key={s.id} className={`quick-suggestion${s.warning ? ' is-warning' : ''}${on ? ' is-on' : ''}`}>
                <span>{s.text}</span>
                <button
                  className={on ? 'small-btn' : 'ghost small-btn'}
                  aria-pressed={on}
                  onClick={() => setAccepted((a) => (on ? a.filter((x) => x !== s.id) : [...a, s.id]))}
                >
                  {on ? `✓ ${s.action}` : s.action}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* What the sentence already knows about: ask before attaching. */}
      {plan && !saved && !plan.problem && plan.links && (
        <QuickLinks
          contactId={plan.contactId ?? null}
          links={plan.links}
          trip={plan.trip ?? null}
          upcomingTrip={plan.upcomingTrip ?? null}
          choices={choices}
          onChange={setChoices}
          onHome={(city) => void setHome(city)}
        />
      )}

      {clash && (
        <div className="quick-plan is-problem">
          <div>
            <strong>
              That clashes with {clash.titles.join(', ') || 'something already booked'}
            </strong>
            {clash.suggestions.length > 0 && (
              <p className="muted small">
                Free at{' '}
                {clash.suggestions
                  .slice(0, 3)
                  .map((s) => new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
                  .join(', ')}
                .
              </p>
            )}
          </div>
          <button className="ghost small-btn" onClick={() => void save(true)} disabled={busy}>
            Book it anyway
          </button>
        </div>
      )}

      {saved && (
        <div className="quick-saved">
          <div>
            <strong>
              {saved.booking ? 'Booked' : KIND_WORD[saved.kind]} · {saved.summary}
            </strong>
            {saved.assumptions.length > 0 && (
              <p className="muted small">{saved.assumptions.join(' ')}</p>
            )}
            {(saved.acceptedActions ?? []).length > 0 && (
              <p className="muted small">Also done: {saved.acceptedActions!.join(' · ')}.</p>
            )}
            {saved.savedTrip && saved.kind === 'commitment' && (
              <p className="muted small">
                &#9992;{' '}
                {saved.savedTrip.created
                  ? `Trip to ${saved.savedTrip.placeLabel} added for ${range(saved.savedTrip.startsOn, saved.savedTrip.endsOn)}.`
                  : `Part of your ${saved.savedTrip.placeLabel} trip, ${range(saved.savedTrip.startsOn, saved.savedTrip.endsOn)}.`}
              </p>
            )}
            {saved.scheduledOnTrip && (
              <p className="muted small">
                &#9992; On your {saved.scheduledOnTrip.placeLabel} trip, the evening of{' '}
                {range(saved.scheduledOnTrip.startsOn, saved.scheduledOnTrip.startsOn)}.
              </p>
            )}
          </div>
          <div className="row">
            <button className="ghost small-btn" onClick={() => void undo()} disabled={busy}>
              Undo
            </button>
            <button
              className="ghost small-btn"
              onClick={() => {
                setSaved(null)
                onDone()
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* A trip just made or joined: what was saved for there, a tap each. */}
      {saved?.savedTrip && (saved.waiting ?? []).length > 0 && (
        <SavedForTrip key={saved.id} trip={saved.savedTrip} waiting={saved.waiting!} />
      )}

      {error && <p className="error small">{error}</p>}
    </section>
  )
}
