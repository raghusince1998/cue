import { useMemo, useState } from 'react'
import type { CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { formatSpan, toLocalInputValue } from '../lib/time.ts'
import { msg, t } from '../lib/i18n.tsx'
import { errorText } from '../lib/errors.ts'

interface Due {
  key: string
  label: string
  at: Date
}

/** When a follow-up is due, in the four answers people actually give. Show the label with t(). */
export function dueChoices(now = new Date()): Due[] {
  const at = (days: number, hour: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0)
  // End of today, unless the day is nearly over — then an hour from now.
  const today = now.getHours() < 17 ? at(0, 18) : new Date(now.getTime() + 60 * 60_000)
  const toFriday = (5 - now.getDay() + 7) % 7 || 7
  const toMonday = (1 - now.getDay() + 7) % 7 || 7
  return [
    { key: 'today', label: msg('Today'), at: today },
    { key: 'tomorrow', label: msg('Tomorrow'), at: at(1, 10) },
    { key: 'friday', label: now.getDay() === 5 ? msg('Next Friday') : msg('Friday'), at: at(toFriday, 10) },
    { key: 'monday', label: msg('Next Monday'), at: at(toMonday, 10) },
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
      setError(errorText(err))
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

      <span className="label-text">{t('What came out of it?')}</span>
      <ol className="wrapup-lines">
        {lines.map((line, i) => (
          <li className="wrapup-line" key={line.key}>
            <input
              value={line.title}
              onChange={(e) => update(line.key, { title: e.target.value })}
              placeholder={
                i === 0 ? 'Send the revised proposal' : i === 1 ? 'Signed contract' : t('Another follow-up')
              }
              aria-label={t('Follow-up {n}', { n: i + 1 })}
              autoFocus={i === 0}
            />
            <div className="wrapup-who" role="group" aria-label={t('Whose is it')}>
              <button
                className={`chip${line.who === 'me' ? ' selected' : ''}`}
                onClick={() => update(line.key, { who: 'me' })}
              >
                {t('I’ll do it')}
              </button>
              <button
                className={`chip${line.who === 'them' ? ' selected' : ''}`}
                onClick={() => update(line.key, { who: 'them' })}
              >
                {t('Waiting on someone')}
              </button>
              {line.who === 'them' && (
                <input
                  className="wrapup-name"
                  value={line.name}
                  onChange={(e) => update(line.key, { name: e.target.value })}
                  placeholder={t('Who? e.g. Ravi')}
                  aria-label={t('Follow-up {n}: who', { n: i + 1 })}
                />
              )}
            </div>
            <div className="wrapup-due" role="group" aria-label={t('By when')}>
              <span className="muted small">{line.who === 'them' ? t('Check in') : t('Due')}</span>
              {choices.map((c) => (
                <button
                  key={c.key}
                  className={`chip${line.due === c.key ? ' selected' : ''}`}
                  onClick={() => update(line.key, { due: c.key })}
                >
                  {t(c.label)}
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
                {t('Pick…')}
              </button>
              {line.due === 'custom' && (
                <input
                  type="datetime-local"
                  value={line.custom}
                  onChange={(e) => update(line.key, { custom: e.target.value })}
                  aria-label={t('Follow-up {n}: when', { n: i + 1 })}
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
        {t('+ Another')}
      </button>

      {missing.length > 0 && (
        <p className="muted small">
          {missing.length === 1
            ? t('One follow-up needs a name for who you are waiting on, or a time.')
            : t('{n} follow-ups need a name for who you are waiting on, or a time.', { n: missing.length })}
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
            ? t('Saving…')
            : filled.length > 0
              ? filled.length === 1
                ? t('Save 1 follow-up')
                : t('Save {n} follow-ups', { n: filled.length })
              : t('Save follow-ups')}
        </button>
        <button className="ghost" onClick={() => void submit([])} disabled={saving}>
          {t('Nothing to add')}
        </button>
      </div>
    </div>
  )
}
