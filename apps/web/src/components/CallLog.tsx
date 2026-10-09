import { useEffect, useMemo, useState } from 'react'
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS, shortName, type CallOutcome } from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import type { PendingCall } from '../lib/calls.ts'
import { dueChoices } from './WrapUp.tsx'
import { QuickMessage } from './QuickMessage.tsx'

type Next = 'none' | 'again' | 'followup' | 'waiting'

/**
 * "How did the call go?" — asked as the call ends, while it is still fresh.
 *
 * How it went, a line of what was said, and what happens next, each a tap.
 * Unanswered, the next try is the default; dialled from a call back, that
 * plan is closed when you spoke or moved when you did not.
 */
export function CallLog({ call, onDone }: { call: PendingCall; onDone: (saved: boolean) => void }) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(null)
  const [notes, setNotes] = useState('')
  const [next, setNext] = useState<Next>('none')
  const [what, setWhat] = useState('')
  const [due, setDue] = useState('tomorrow')
  const [markDone, setMarkDone] = useState(true)
  const [name, setName] = useState(call.name ?? '')
  const [busy, setBusy] = useState(false)
  /** Saved, and now writing them a message: "missed your call", "thanks". */
  const [messaging, setMessaging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const choices = useMemo(() => dueChoices(), [])

  /** Nobody known yet: opened from "Log a call" on the home screen. */
  const unknown = !call.contactId && !call.name
  const [people, setPeople] = useState<{ name: string; phone: string | null }[]>([])
  useEffect(() => {
    if (!unknown) return
    api<{ name: string; phone: string | null }[]>('/contacts')
      .then((list) => setPeople(list.map((p) => ({ name: p.name, phone: p.phone }))))
      .catch(() => undefined)
  }, [unknown])

  // A typed number is a number, not a name.
  const typed = name.trim()
  const typedPhone = /^[+\d][\d\s-]{5,}$/.test(typed) ? typed : null
  const typedName = typedPhone ? null : typed || null
  const who = call.name ?? (typed || call.phone)
  const short = call.name ? shortName(call.name) : typedName ? shortName(typedName) : 'them'
  const answered = outcome === 'spoke' || outcome === 'message'

  function pick(o: CallOutcome) {
    setOutcome(o)
    // Nobody picked up: trying again is what happens next, nearly always.
    if (o === 'no_answer' || o === 'busy') {
      setNext('again')
      setDue(new Date().getHours() < 16 ? 'today' : 'tomorrow')
    } else if (next === 'again') {
      setNext('none')
    }
  }

  async function save(thenMessage = false) {
    if (!outcome) return
    const at = choices.find((c) => c.key === due)?.at ?? choices[1]!.at
    setBusy(true)
    setError(null)
    try {
      await api('/calls', {
        method: 'POST',
        body: {
          contactId: call.contactId,
          name: call.name ?? typedName,
          phone: call.phone || typedPhone,
          outcome,
          notes: notes.trim() || null,
          startedAt: new Date(call.startedAt).toISOString(),
          commitmentId: call.commitmentId,
          markDone: Boolean(call.commitmentId) && answered && markDone,
          next: next === 'none' ? null : { kind: next, title: what.trim() || undefined, dueAt: at.toISOString() },
        },
      })
      announceChange()
      if (thenMessage) setMessaging(true)
      else onDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const dueLabel = choices.find((c) => c.key === due)?.label.toLowerCase() ?? 'tomorrow'

  if (messaging) {
    return (
      <div className="stack tight call-log">
        <p className="muted small">Saved. Now a message to {who}:</p>
        <QuickMessage
          to={{
            name: call.name ?? typedName,
            phone: call.phone || typedPhone || people.find((p) => p.name === typedName)?.phone || null,
          }}
          suggest={answered ? /thank|detail/i : /missed|call/i}
          onDone={() => onDone(true)}
        />
        <button className="ghost small-btn fit-btn" onClick={() => onDone(true)}>
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="stack tight call-log">
      {unknown && !call.phone ? (
        <label>
          Who was it?
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="A name from People, or a number"
            list="call-people"
            autoFocus
          />
          <datalist id="call-people">
            {people.map((p) => (
              <option key={p.name} value={p.name} />
            ))}
          </datalist>
        </label>
      ) : (
        <>
          <p className="call-who">
            <strong>{who}</strong>
            {call.name && call.phone ? <span className="muted small"> · {call.phone}</span> : null}
          </p>
          {unknown && (
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Who was it? (optional)" aria-label="Who" />
          )}
        </>
      )}

      <div className="chips">
        {CALL_OUTCOMES.map((o) => (
          <button key={o} className={`chip${outcome === o ? ' selected' : ''}`} onClick={() => pick(o)}>
            {CALL_OUTCOME_LABELS[o]}
          </button>
        ))}
      </div>

      {outcome && (
        <>
          {answered && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What was said? (optional)"
              aria-label="Notes"
            />
          )}

          {call.commitmentId && call.commitmentTitle && answered && (
            <label className="checkbox">
              <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />
              <span>Mark &ldquo;{call.commitmentTitle}&rdquo; done</span>
            </label>
          )}

          <span className="label-text">What next?</span>
          <div className="chips">
            {(
              [
                ['none', 'Nothing'],
                ['again', 'Call again'],
                ['followup', 'Something to do'],
                ['waiting', `Waiting on ${short}`],
              ] as [Next, string][]
            ).map(([k, label]) => (
              <button key={k} className={`chip${next === k ? ' selected' : ''}`} onClick={() => setNext(k)}>
                {label}
              </button>
            ))}
          </div>
          {next === 'followup' && (
            <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Send the brochure" aria-label="What to do" autoFocus />
          )}
          {next === 'waiting' && (
            <input
              value={what}
              onChange={(e) => setWhat(e.target.value)}
              placeholder={`What will ${short} send or do?`}
              aria-label="What they will do"
              autoFocus
            />
          )}
          {next !== 'none' && (
            <div className="wrapup-due">
              <span className="muted small">{next === 'waiting' ? 'Check in' : 'When'}</span>
              {choices.map((c) => (
                <button key={c.key} className={`chip${due === c.key ? ' selected' : ''}`} onClick={() => setDue(c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {next === 'again' && call.commitmentId && call.commitmentTitle && (
            <p className="muted small">&ldquo;{call.commitmentTitle}&rdquo; moves to {dueLabel}.</p>
          )}
        </>
      )}

      {error && <p className="error small">{error}</p>}

      <div className="row">
        <button className="primary" onClick={() => void save()} disabled={busy || !outcome}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="ghost" onClick={() => void save(true)} disabled={busy || !outcome}>
          Save and send a message
        </button>
        <button className="ghost" onClick={() => onDone(false)} disabled={busy}>
          Not now
        </button>
      </div>
    </div>
  )
}
