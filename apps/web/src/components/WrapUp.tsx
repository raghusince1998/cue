import { useMemo, useState } from 'react'
import type { CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { formatSpan, toLocalInputValue } from '../lib/time.ts'

interface Due {
  key: string
  label: string
  at: Date
}

/** When a follow-up is due, in the four answers people actually give. */
export function dueChoices(now = new Date()): Due[] {
  const at = (days: number, hour: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0)
  // End of today, unless the day is nearly over — then an hour from now.
  const today = now.getHours() < 17 ? at(0, 18) : new Date(now.getTime() + 60 * 60_000)
  const toFriday = (5 - now.getDay() + 7) % 7 || 7
  const toMonday = (1 - now.getDay() + 7) % 7 || 7
  return [
    { key: 'today', label: 'Today', at: today },
    { key: 'tomorrow', label: 'Tomorrow', at: at(1, 10) },
    { key: 'friday', label: now.getDay() === 5 ? 'Next Friday' : 'Friday', at: at(toFriday, 10) },
    { key: 'monday', label: 'Next Monday', at: at(toMonday, 10) },
  ]
}

interface Line {
  key: number
  title: string
  who: 'me' | 'them'
  name: string
  due: string
  custom: string
}

let nextKey = 0
function blankLine(): Line {
  nextKey += 1
  return { key: nextKey, title: '', who: 'me', name: '', due: 'tomorrow', custom: '' }
}

/**
 * After a meeting: what came out of it.
 *
 * One line per follow-up — yours to do, or someone else's that you are
 * waiting on — each with when it is due. Saving turns every line into a plan
 * with a reminder and closes the meeting; "nothing came out of it" just
 * closes it. Built for the minute after a call ends, so it asks for as little
 * as possible: a few words and a tap for when.
 */
export function WrapUp({
  meeting,
  onDone,
}: {
  meeting: CommitmentDTO
  /** Saved or skipped; the meeting is closed either way. */
  onDone: () => void
}) {
  const choices = useMemo(() => dueChoices(), [])
  const [lines, setLines] = useState<Line[]>(() => [blankLine(), blankLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(key: number, patch: Partial<Line>) {
    setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  const dueOf = (line: Line): Date | null => {
    if (line.due === 'custom') {
      const d = new Date(line.custom)
      return Number.isNaN(d.getTime()) ? null : d
    }
    return choices.find((c) => c.key === line.due)?.at ?? null
  }

  const filled = lines.filter((l) => l.title.trim())
  const missing = filled.filter((l) => (l.who === 'them' && !l.name.trim()) || !dueOf(l))

  async function submit(items: Line[]) {
    setSaving(true)
    setError(null)
    try {
      await api(`/commitments/${meeting.id}/wrap-up`, {
        method: 'POST',
        body: {
          items: items.map((l) => ({
            title: l.title.trim(),
            waitingOn: l.who === 'them' ? l.name.trim() : null,
            dueAt: dueOf(l)!.toISOString(),
          })),
        },
      })
      announceChange()
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="stack tight wrapup">
      <div className="wrapup-meeting">
        <strong>{meeting.title}</strong>
        <span className="muted small">
          {formatSpan(meeting.dueAt, meeting.endsAt, meeting.allDay)}
          {meeting.placeName ? ` · ${meeting.placeName}` : ''}
        </span>
      </div>

      <span className="label-text">What came out of it?</span>
      <ol className="wrapup-lines">
        {lines.map((line, i) => (
          <li className="wrapup-line" key={line.key}>
            <input
              value={line.title}
              onChange={(e) => update(line.key, { title: e.target.value })}
              placeholder={
                i === 0 ? 'Send the revised proposal' : i === 1 ? 'Signed contract' : 'Another follow-up'
              }
              aria-label={`Follow-up ${i + 1}`}
              autoFocus={i === 0}
            />
            <div className="wrapup-who" role="group" aria-label="Whose is it">
              <button
                className={`chip${line.who === 'me' ? ' selected' : ''}`}
                onClick={() => update(line.key, { who: 'me' })}
              >
                I&rsquo;ll do it
              </button>
              <button
                className={`chip${line.who === 'them' ? ' selected' : ''}`}
                onClick={() => update(line.key, { who: 'them' })}
              >
                Waiting on someone
              </button>
              {line.who === 'them' && (
                <input
                  className="wrapup-name"
                  value={line.name}
                  onChange={(e) => update(line.key, { name: e.target.value })}
                  placeholder="Who? e.g. Ravi"
                  aria-label={`Follow-up ${i + 1}: who`}
                />
              )}
            </div>
            <div className="wrapup-due" role="group" aria-label="By when">
              <span className="muted small">{line.who === 'them' ? 'Check in' : 'Due'}</span>
              {choices.map((c) => (
                <button
                  key={c.key}
                  className={`chip${line.due === c.key ? ' selected' : ''}`}
                  onClick={() => update(line.key, { due: c.key })}
                >
                  {c.label}
                </button>
              ))}
              <button
                className={`chip${line.due === 'custom' ? ' selected' : ''}`}
                onClick={() =>
                  update(line.key, {
                    due: 'custom',
                    custom: line.custom || toLocalInputValue(choices[1]!.at),
                  })
                }
              >
                Pick…
              </button>
              {line.due === 'custom' && (
                <input
                  type="datetime-local"
                  value={line.custom}
                  onChange={(e) => update(line.key, { custom: e.target.value })}
                  aria-label={`Follow-up ${i + 1}: when`}
                />
              )}
            </div>
          </li>
        ))}
      </ol>
      <button
        className="ghost small-btn fit-btn"
        onClick={() => setLines((list) => [...list, blankLine()])}
        disabled={lines.length >= 20}
      >
        + Another
      </button>

      {missing.length > 0 && (
        <p className="muted small">
          {missing.length === 1 ? 'One follow-up needs' : `${missing.length} follow-ups need`} a name
          for who you are waiting on, or a time.
        </p>
      )}
      {error && <p className="error small">{error}</p>}

      <div className="form-actions">
        <button
          className="primary"
          onClick={() => void submit(filled)}
          disabled={saving || filled.length === 0 || missing.length > 0}
        >
          {saving
            ? 'Saving…'
            : filled.length > 0
              ? `Save ${filled.length} follow-up${filled.length === 1 ? '' : 's'}`
              : 'Save follow-ups'}
        </button>
        <button className="ghost" onClick={() => void submit([])} disabled={saving}>
          Nothing to add
        </button>
      </div>
    </div>
  )
}
