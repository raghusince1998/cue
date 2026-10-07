import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api.ts'
import { DictateButton } from './DictateButton.tsx'

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
  kind: 'commitment' | 'intention' | 'trip' | 'recurrence' | 'needsTime' | 'needsPerson' | 'unclear'
  title: string
  summary: string
  assumptions: string[]
  problem: string | null
  placeLabel: string | null
  personName: string | null
  people: Person[]
  durationMinutes: number
}

interface Saved extends Plan {
  id: string
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
  needsTime: 'Understood',
  needsPerson: 'Which one?',
  unclear: '',
}

/** One tap each, rather than a date picker for a question this small. */
const WHEN_CHIPS = ['tomorrow 10am', 'tomorrow 3pm', 'friday 11am', 'next monday 10am']

export function QuickAdd({ onSaved }: { onSaved: () => void }) {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [frequent, setFrequent] = useState<Frequent[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clash, setClash] = useState<{ titles: string[]; suggestions: string[] } | null>(null)
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
    const handle = setTimeout(() => {
      api<Plan>('/quick/preview', { method: 'POST', body: { text: value } })
        .then(setPlan)
        .catch(() => setPlan(null))
    }, 250)
    return () => clearTimeout(handle)
  }, [text])

  const save = useCallback(
    async (allowConflict = false) => {
      const value = text.trim()
      if (!value) return
      setBusy(true)
      setError(null)
      setClash(null)
      try {
        const result = await api<Saved>('/quick', {
          method: 'POST',
          body: { text: value, allowConflict },
        })
        setSaved(result)
        setText('')
        setPlan(null)
        onSaved()
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
    [text, onSaved],
  )

  async function undo() {
    if (!saved) return
    setBusy(true)
    try {
      await api(`/quick/${saved.kind}/${saved.id}`, { method: 'DELETE' })
      setText(saved.title)
      setSaved(null)
      onSaved()
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
          placeholder="dentist friday 6pm"
          aria-label="What do you want to plan?"
          autoFocus
        />
        <DictateButton value={text} onChange={setText} />
        <button className="primary" onClick={() => void save()} disabled={!ready || busy}>
          {busy ? 'Saving…' : 'Plan it'}
        </button>
      </div>

      {/* Nothing typed: the fastest capture is the one with no typing at all. */}
      {!text && !saved && frequent.length > 0 && (
        <div className="quick-frequent">
          <span className="muted small">You often add</span>
          {frequent.map((f) => (
            <button key={f.title} className="chip" onClick={() => setText(`${f.title} `)}>
              {f.title}
            </button>
          ))}
        </div>
      )}

      {!text && !saved && frequent.length === 0 && (
        <p className="muted small quick-hint">
          One line is enough. &ldquo;dentist friday 6pm&rdquo; ·
          &ldquo;gym every mon wed fri at 7&rdquo; ·
          &ldquo;go shopping this evening: milk, bread, peda&rdquo; ·
          &ldquo;when I go to Mathura remind me to buy peda&rdquo; ·
          &ldquo;going to Jaipur 12 to 14 October&rdquo;.
        </p>
      )}

      {/* Several people fit that word. Ask, rather than pick one. */}
      {needsPerson && plan && !saved && (
        <div className="quick-plan is-asking">
          <div>
            <span className="quick-kind">{KIND_WORD.needsPerson}</span>
            <strong>{plan.title}</strong>
            <p className="muted small">
              {plan.people.length} people match &ldquo;{plan.personName}&rdquo;.
            </p>
            <div className="quick-frequent">
              {plan.people.map((person) => (
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
            <p className="muted small">When is it?</p>
            <div className="quick-frequent">
              {WHEN_CHIPS.map((c) => (
                <button key={c} className="chip" onClick={() => setText((t) => `${t} ${c}`)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* What it will do, before it does it. */}
      {plan && !needsTime && !saved && (
        <div className={`quick-plan${plan.problem ? ' is-problem' : ''}`}>
          {plan.problem ? (
            <>
              <strong>{plan.problem}</strong>
              <button className="ghost small-btn" onClick={() => navigate('/log?full=1')}>
                Fill it in myself
              </button>
            </>
          ) : (
            <>
              <div>
                <span className="quick-kind">{KIND_WORD[plan.kind]}</span>
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
              {KIND_WORD[saved.kind]} · {saved.summary}
            </strong>
            {saved.assumptions.length > 0 && (
              <p className="muted small">{saved.assumptions.join(' ')}</p>
            )}
          </div>
          <div className="row">
            <button className="ghost small-btn" onClick={() => void undo()} disabled={busy}>
              Undo
            </button>
            <button className="ghost small-btn" onClick={() => navigate('/')}>
              Done
            </button>
          </div>
        </div>
      )}

      {error && <p className="error small">{error}</p>}
    </section>
  )
}
