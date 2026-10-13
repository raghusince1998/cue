import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import { locale, msg, t } from '../lib/i18n.tsx'

/**
 * Clearing what the nagging failed on.
 *
 * Every planner can show a red list. This is the part nobody does: saying the
 * list means the tool stopped working, and helping empty it. Nothing here
 * scolds — the app failed at least as much as the person did, and the copy
 * says so.
 */

type Action = 'done' | 'reschedule' | 'someday' | 'drop'

interface StuckItem {
  id: string
  title: string
  dueAt: string
  daysOverdue: number
  escalationCount: number
  reason: string
  because: string
  suggested: Action
  suggestedAt: string | null
}

interface Report {
  items: StuckItem[]
  worstWeekday: string | null
  merelyLate: number
}

/** Shown with t(). */
const LABEL: Record<Action, string> = {
  done: msg('Already did it'),
  reschedule: msg('Give it a real slot'),
  someday: msg('No deadline'),
  drop: msg('Not happening'),
}

/** The server names the weekday in English; these are its words, for t(). */
const WEEKDAYS = [
  msg('Sunday'),
  msg('Monday'),
  msg('Tuesday'),
  msg('Wednesday'),
  msg('Thursday'),
  msg('Friday'),
  msg('Saturday'),
]

function when(iso: string): string {
  return new Date(iso).toLocaleString(locale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function Triage({
  onClose,
  onApplied,
  all = false,
}: {
  onClose: () => void
  onApplied: () => void
  /** Every overdue item, not only the ones that have stopped moving. */
  all?: boolean
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [choices, setChoices] = useState<Record<string, Action>>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Report>('/triage', { query: all ? { all: '1' } : undefined })
      .then((r) => {
        setReport(r)
        // Pre-selected with what the app would do, so the common case is one
        // press — but every one of them is visible and changeable first.
        setChoices(Object.fromEntries(r.items.map((i) => [i.id, i.suggested])))
      })
      .catch((err) => setError((err as Error).message))
  }, [all])

  async function apply() {
    if (!report) return
    setBusy(true)
    try {
      const decisions = report.items.map((i) => ({
        id: i.id,
        action: choices[i.id] ?? i.suggested,
        at: (choices[i.id] ?? i.suggested) === 'reschedule' ? (i.suggestedAt ?? undefined) : undefined,
      }))
      // Rescheduling with nowhere to go would silently do nothing; those stay
      // for the person to place by hand rather than disappearing.
      const usable = decisions.filter((d) => d.action !== 'reschedule' || d.at)
      setDone(await api<Record<string, number>>('/triage', { method: 'POST', body: { decisions: usable } }))
      onApplied()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="error small">{error}</p>
  if (!report) {
    return (
      <p className="muted small">
        {all ? t('Gathering everything past its time…') : t('Looking at what has stopped moving…')}
      </p>
    )
  }

  if (done) {
    const parts = [
      done.done ? t('{n} marked done', { n: done.done }) : null,
      done.rescheduled ? t('{n} given a new slot', { n: done.rescheduled }) : null,
      done.someday ? t('{n} moved to no deadline', { n: done.someday }) : null,
      done.dropped ? t('{n} let go', { n: done.dropped }) : null,
    ].filter(Boolean)
    return (
      <div className="stack tight">
        <strong>{parts.length ? parts.join(', ') : t('Nothing changed')}.</strong>
        <p className="muted small">
          {t(
            'That is the backlog cleared. The ones you let go are still in your history — what you decided not to do is worth being able to look back on.',
          )}
        </p>
        <button className="primary" onClick={onClose}>
          {t('Good')}
        </button>
      </div>
    )
  }

  if (report.items.length === 0) {
    return (
      <div className="stack tight">
        <strong>{all ? t('Nothing is overdue.') : t('Nothing is stuck.')}</strong>
        <p className="muted small">
          {report.merelyLate > 0
            ? report.merelyLate === 1
              ? t('1 thing is late, but still being chased. They have not been given up on yet.')
              : t('{n} things are late, but still being chased. They have not been given up on yet.', {
                  n: report.merelyLate,
                })
            : t('Nothing overdue at all.')}
        </p>
        <button className="primary" onClick={onClose}>
          {t('Close')}
        </button>
      </div>
    )
  }

  const worstDay = report.worstWeekday
    ? (WEEKDAYS.find((d) => d === report.worstWeekday) ?? report.worstWeekday)
    : null

  return (
    <div className="stack tight">
      <p className="muted small">
        {all
          ? t(
              'Everything past its time — {n}. What the app would do is already picked for each; change any, then apply.',
              { n: report.items.length },
            )
          : t(
              'These stopped moving. The reminders ran out, so chasing them again will not work — and that is the app’s failure as much as yours.',
            )}
        {worstDay && ` ${t('Most of them were due on a {day}.', { day: t(worstDay) })}`}
      </p>

      {report.items.map((item) => (
        <div className="triage-row" key={item.id}>
          <div className="triage-head">
            <strong>{item.title}</strong>
            <span className="muted small">
              {when(item.dueAt)} · {t('{n} days ago', { n: item.daysOverdue })}
            </span>
          </div>
          <p className="muted small">{item.because}</p>

          <div className="chips">
            {(['done', 'reschedule', 'someday', 'drop'] as Action[]).map((action) => {
              const picked = (choices[item.id] ?? item.suggested) === action
              const impossible = action === 'reschedule' && !item.suggestedAt
              return (
                <button
                  key={action}
                  className={`chip${picked ? ' selected' : ''}`}
                  disabled={impossible}
                  title={impossible ? t('No free slot in the next two weeks') : undefined}
                  onClick={() => setChoices((c) => ({ ...c, [item.id]: action }))}
                >
                  {t(LABEL[action])}
                </button>
              )
            })}
          </div>

          {(choices[item.id] ?? item.suggested) === 'reschedule' && (
            <p className="muted small">
              {item.suggestedAt
                ? t('Moves to {time} — your next genuinely free slot.', { time: when(item.suggestedAt) })
                : t('Nothing free in the next two weeks. Pick another option, or move it by hand.')}
            </p>
          )}
        </div>
      ))}

      <div className="row">
        <button className="primary" onClick={() => void apply()} disabled={busy}>
          {busy ? t('Clearing…') : t('Sort out all {n}', { n: report.items.length })}
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          {t('Not now')}
        </button>
      </div>
    </div>
  )
}
