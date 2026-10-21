import { useCallback, useEffect, useRef, useState } from 'react'
import { openPlan, openTrip } from '../lib/open.ts'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api.ts'
import { DictateButton } from './DictateButton.tsx'
import { WhenPicker, type When } from './WhenPicker.tsx'
import { announceChange } from '../lib/changes.ts'
import { DURATION_CHOICES, examplesFor, hasWork, type Sphere, type TimeWindow } from '@cue/shared'
import { useAuth } from '../lib/auth.tsx'
import { language, locale, msg, t } from '../lib/i18n.tsx'
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
import { errorText } from '../lib/errors.ts'

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
    | 'exam'
    | 'bill'
    | 'delivery'
    | 'needsTime'
    | 'needsPerson'
    | 'unclear'
  title: string
  summary: string
  /** When, as read: what the Edit panel starts from. */
  dueAt?: string | null
  flexibility?: 'fixed' | 'flexible'
  preferredWindow?: TimeWindow | null
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
  /** Work or personal, as the words read; null when they say neither. */
  sphere?: Sphere | null
}

interface Choice {
  label: string
  line: string
}

/** The preview, changed by hand before saving: it wins over the words. */
interface Edits {
  title: string
  when: When
  durationMinutes: number
}

/** "Fri 24 Oct, 7:30 pm", or "Fri 24 Oct · Evening". */
function whenWords(w: When): string {
  const day = w.at.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
  if (w.flexibility === 'flexible' && w.window) {
    const label = { morning: msg('Morning'), afternoon: msg('Afternoon'), evening: msg('Evening'), night: msg('Night') }[w.window]
    return `${day} · ${t(label)}`
  }
  return `${day}, ${w.at.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}`
}

const lengthWords = (minutes: number) => (minutes < 60 ? t('{n} min', { n: minutes }) : t('{n}h', { n: minutes / 60 }))

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

/** Shown with t(). */
const KIND_WORD: Record<Plan['kind'], string> = {
  commitment: msg('Planned'),
  intention: msg('Saved for later'),
  trip: msg('Trip planned'),
  recurrence: msg('Repeating'),
  expense: msg('Expense'),
  owed: msg('Owed to you'),
  tracker: msg('Tracking'),
  exam: msg('Tracking'),
  bill: msg('Bill'),
  delivery: msg('Parcel'),
  needsTime: msg('Understood'),
  needsPerson: msg('Which one?'),
  unclear: '',
}

/**
 * One tap each, rather than a date picker for a question this small. The
 * label is shown with t(); the line itself stays English, since that is what
 * the sentence reader reads.
 */
const WHEN_CHIPS = [msg('tomorrow 10am'), msg('tomorrow 3pm'), msg('friday 11am'), msg('next monday 10am')]

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
  const navigate = useNavigate()
  const examples = examplesFor(me?.uses ?? [], language())
  const [text, setText] = useState(initialText)
  const [focused, setFocused] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  /** Changed by hand in the preview; a new line starts over. */
  const [edits, setEdits] = useState<Edits | null>(null)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)

  /** What "Open it" does for what was just saved: the thing itself, or its page. */
  function openSaved(s: Saved): (() => void) | null {
    if (s.kind === 'commitment' && !s.ids) return () => openPlan(s.id)
    if (s.kind === 'trip') return () => openTrip(s.savedTrip?.id ?? s.id)
    if (s.kind === 'recurrence') {
      return () => {
        setSaved(null)
        onDone()
        navigate(`/repeating?series=${s.id}`)
      }
    }
    return null
  }
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
  /** Work or personal, flipped by hand from what the words read. */
  const [sphere, setSphere] = useState<Sphere | null>(null)
  useEffect(() => {
    setAccepted([])
    setSphere(null)
  }, [text])
  const working = hasWork(me?.uses ?? [])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api<{ frequent: Frequent[] }>('/quick/suggestions')
      .then((r) => setFrequent(r.frequent))
      .catch(() => undefined)
  }, [])

  // A different line is a different plan: what was changed for the old one goes.
  useEffect(() => {
    setEdits(null)
    setEditing(false)
  }, [text])

  // Opened but left as it was read: nothing to say, nothing to send.
  const changed =
    edits !== null &&
    plan !== null &&
    (plan.kind === 'needsTime' ||
      edits.title.trim() !== plan.title ||
      edits.durationMinutes !== plan.durationMinutes ||
      !plan.dueAt ||
      edits.when.at.getTime() !== new Date(plan.dueAt).getTime() ||
      edits.when.flexibility !== (plan.flexibility === 'flexible' && plan.preferredWindow ? 'flexible' : 'fixed') ||
      (edits.when.flexibility === 'flexible' && edits.when.window !== plan.preferredWindow))
  // One plan with a day and time: the preview can be changed by hand.
  const editable = plan !== null && !plan.problem && (plan.kind === 'commitment' || plan.kind === 'needsTime')

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
        if (sphere && sphere !== plan?.sphere) body.sphere = sphere
        if (edits && changed) {
          body.edits = {
            title: edits.title.trim() || undefined,
            dueAt: edits.when.at.toISOString(),
            durationMinutes: edits.durationMinutes,
            flexibility: edits.when.flexibility,
            preferredWindow: edits.when.flexibility === 'flexible' ? edits.when.window : null,
          }
        }
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
          setError(data.problem ?? t('I could not read that.'))
        } else {
          setError(errorText(err))
        }
      } finally {
        setBusy(false)
      }
    },
    [text, onSaved, plan, choices, accepted, sphere, edits, changed],
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
    (plan.kind !== 'needsTime' || edits !== null) &&
    plan.kind !== 'needsPerson' &&
    !plan.problem
  // Everything was understood except when. Asking one short question is
  // honest; inventing an hour and hoping is not.
  const needsTime = plan?.kind === 'needsTime' && !edits
  function startEditing() {
    if (!plan) return
    if (!edits) {
      const read = plan.dueAt ? new Date(plan.dueAt) : null
      const fallback = new Date()
      fallback.setDate(fallback.getDate() + 1)
      fallback.setHours(10, 0, 0, 0)
      const flexible = plan.flexibility === 'flexible' && plan.preferredWindow
      setEdits({
        title: plan.title,
        when: {
          at: read ?? fallback,
          flexibility: flexible ? 'flexible' : 'fixed',
          window: flexible ? plan.preferredWindow! : null,
        },
        durationMinutes: plan.durationMinutes,
      })
    }
    setEditing(true)
  }
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
          placeholder={inline ? t('Plan something: {example}', { example: examples[0] ?? '' }) : examples[0]}
          aria-label={t('What do you want to plan?')}
          autoFocus={autoFocus}
        />
        {/* Start over: what was typed or said, and what it was read as. */}
        {text && (
          <button
            type="button"
            className="quick-clear"
            aria-label={t('Clear')}
            title={t('Clear')}
            onClick={() => {
              setText('')
              setPlan(null)
              setClash(null)
              setError(null)
              setChoices(NO_CHOICES)
              inputRef.current?.focus()
            }}
          >
            ×
          </button>
        )}
        <DictateButton value={text} onChange={setText} autoStart={listen} label={t('Speak')} redo />
        <button className="primary" onClick={() => void save()} disabled={!ready || busy}>
          {busy ? t('Saving…') : t('Plan it')}
        </button>
      </div>

      {/* Nothing typed: the fastest capture is the one with no typing at all. */}
      {!text && !saved && frequent.length > 0 && (!inline || focused) && (
        <div className="quick-frequent">
          <span className="muted small">{t('You often add')}</span>
          {frequent.map((f) => (
            <button key={f.title} className="chip" onClick={() => setText(`${f.title} `)}>
              {f.title}
            </button>
          ))}
        </div>
      )}

      {!text && !saved && frequent.length === 0 && (!inline || focused) && (
        <p className="muted small quick-hint">
          {t('One line is enough.')}{' '}
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
          .{' '}
          {t(
            'Or paste a shop’s delivery message, or a train, flight, hotel or movie booking confirmation, and Cue keeps track of it.',
          )}
        </p>
      )}

      {/* Several people fit that word. Ask, rather than pick one. */}
      {needsPerson && plan && !saved && (
        <div className="quick-plan is-asking">
          <div>
            <span className="quick-kind">{t(KIND_WORD.needsPerson)}</span>
            <strong>{plan.title}</strong>
            <p className="muted small">
              {plan.question
                ? plan.choices?.length
                  ? plan.question
                  : `${plan.question} ${t('Type their name in place of “{name}”.', { name: plan.personName ?? '' })}`
                : t('{n} people match “{name}”.', { n: plan.people.length, name: plan.personName ?? '' })}
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
                    setText((line) =>
                      line.replace(
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
            <span className="quick-kind">{t(KIND_WORD.needsTime)}</span>
            <strong>{plan.title}</strong>
            <ul className="quick-assumptions">
              {plan.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p className="muted small">{plan.question ?? t('When is it?')}</p>
            <div className="quick-frequent">
              {(plan.choices?.length
                ? plan.choices
                : plan.question
                  ? []
                  : WHEN_CHIPS.map((c) => ({ label: t(c), line: `${text.trim()} ${c}` }))
              ).map((c) => (
                <button key={c.line} className="chip" onClick={() => setText(c.line)}>
                  {c.label}
                </button>
              ))}
              <button className="chip" onClick={startEditing}>
                {t('Pick a day and time…')}
              </button>
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
                {t('Fill it in myself')}
              </button>
            </>
          ) : (
            <>
              <div>
                <span className="quick-kind">
                  {plan.booking ? t('Booking') : t(KIND_WORD[edits && plan.kind === 'needsTime' ? 'commitment' : plan.kind])}
                  {changed && <span className="quick-edited">{t('Changed by you')}</span>}
                </span>
                {reading && <span className="quick-reading">{t('Reading it more carefully…')}</span>}
                <strong>
                  {changed && edits
                    ? `${edits.title.trim() || plan.title} — ${whenWords(edits.when)} · ${lengthWords(edits.durationMinutes)}`
                    : plan.summary}
                </strong>
                {plan.assumptions.length > 0 && (
                  <ul className="quick-assumptions">
                    {plan.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
                {/* Which half of the day it is part of, as read, and one tap to change. */}
                {working && (plan.kind === 'commitment' || plan.kind === 'recurrence') && (
                  <div className="sphere-pick" role="group" aria-label={t('Work or personal')}>
                    {(['work', 'personal'] as const).map((s) => {
                      const on = (sphere ?? plan.sphere) === s
                      return (
                        <button key={s} className={`sphere-tag is-${s}${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setSphere(s)}>
                          {s === 'work' ? t('Work') : t('Personal')}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              {editable && !editing ? (
                <button className="ghost small-btn quick-edit-btn" onClick={startEditing}>
                  {t('Edit')}
                </button>
              ) : (
                <kbd>Enter</kbd>
              )}
            </>
          )}
        </div>
      )}

      {/* The preview, changed by hand: what, when and how long. */}
      {editing && edits && plan && !saved && (
        <div className="quick-edit">
          <label>
            {t('What exactly?')}
            <input value={edits.title} onChange={(e) => setEdits({ ...edits, title: e.target.value })} />
          </label>
          <span className="label-text">{t('When?')}</span>
          <WhenPicker value={edits.when} onChange={(when) => setEdits({ ...edits, when })} />
          <span className="label-text">{t('How long will it block?')}</span>
          <div className="chips">
            {DURATION_CHOICES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`chip${edits.durationMinutes === minutes ? ' selected' : ''}`}
                aria-pressed={edits.durationMinutes === minutes}
                onClick={() => setEdits({ ...edits, durationMinutes: minutes })}
              >
                {lengthWords(minutes)}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="primary small-btn" onClick={() => setEditing(false)}>
              {t('Done')}
            </button>
            <button
              className="ghost small-btn"
              onClick={() => {
                setEdits(null)
                setEditing(false)
              }}
            >
              {t('Undo changes')}
            </button>
          </div>
        </div>
      )}

      {/* A better plan, offered: nothing changes unless it is accepted. */}
      {plan && ready && !saved && (plan.suggestions ?? []).length > 0 && (
        <ul className="quick-suggestions" aria-label={t('Suggestions')}>
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
              {t('That clashes with {what}', { what: clash.titles.join(', ') || t('something already booked') })}
            </strong>
            {clash.suggestions.length > 0 && (
              <p className="muted small">
                {t('Free at {times}.', {
                  times: clash.suggestions
                    .slice(0, 3)
                    .map((s) => new Date(s).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }))
                    .join(', '),
                })}
              </p>
            )}
          </div>
          <button className="ghost small-btn" onClick={() => void save(true)} disabled={busy}>
            {t('Book it anyway')}
          </button>
        </div>
      )}

      {saved && (
        <div className="quick-saved">
          <div>
            <strong>
              {saved.booking ? t('Booked') : t(KIND_WORD[saved.kind])} · {saved.summary}
            </strong>
            {saved.assumptions.length > 0 && (
              <p className="muted small">{saved.assumptions.join(' ')}</p>
            )}
            {(saved.acceptedActions ?? []).length > 0 && (
              <p className="muted small">{t('Also done: {actions}.', { actions: saved.acceptedActions!.join(' · ') })}</p>
            )}
            {saved.savedTrip && saved.kind === 'commitment' && (
              <p className="muted small">
                &#9992;{' '}
                {saved.savedTrip.created
                  ? t('Trip to {place} added for {dates}.', {
                      place: saved.savedTrip.placeLabel,
                      dates: range(saved.savedTrip.startsOn, saved.savedTrip.endsOn),
                    })
                  : t('Part of your {place} trip, {dates}.', {
                      place: saved.savedTrip.placeLabel,
                      dates: range(saved.savedTrip.startsOn, saved.savedTrip.endsOn),
                    })}
              </p>
            )}
            {saved.kind === 'exam' && (
              <p className="muted small">
                {t('On the Exams page, its dates as reminders.')}{' '}
                <button
                  className="link small"
                  onClick={() => {
                    setSaved(null)
                    onDone()
                    navigate('/exams')
                  }}
                >
                  {t('Open Exams')}
                </button>
              </p>
            )}
            {saved.scheduledOnTrip && (
              <p className="muted small">
                &#9992;{' '}
                {t('On your {place} trip, the evening of {date}.', {
                  place: saved.scheduledOnTrip.placeLabel,
                  date: range(saved.scheduledOnTrip.startsOn, saved.scheduledOnTrip.startsOn),
                })}
              </p>
            )}
          </div>
          <div className="row">
            {openSaved(saved) && (
              <button className="ghost small-btn" onClick={openSaved(saved)!}>
                {t('Open it')}
              </button>
            )}
            <button className="ghost small-btn" onClick={() => void undo()} disabled={busy}>
              {t('Undo')}
            </button>
            <button
              className="ghost small-btn"
              onClick={() => {
                setSaved(null)
                onDone()
              }}
            >
              {t('Done')}
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
