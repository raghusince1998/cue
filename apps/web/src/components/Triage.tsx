import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'

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

const LABEL: Record<Action, string> = {
  done: 'Already did it',
  reschedule: 'Give it a real slot',
  someday: 'No deadline',
  drop: 'Not happening',
}

function when(iso: string): string {
  return new Date(iso).toLocaleString([], {
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
        {all ? 'Gathering everything past its time…' : 'Looking at what has stopped moving…'}
      </p>
    )
  }

  if (done) {
    const parts = [
      done.done ? `${done.done} marked done` : null,
      done.rescheduled ? `${done.rescheduled} given a new slot` : null,
      done.someday ? `${done.someday} moved to no deadline` : null,
      done.dropped ? `${done.dropped} let go` : null,
    ].filter(Boolean)
    return (
      <div className="stack tight">
        <strong>{parts.length ? parts.join(', ') : 'Nothing changed'}.</strong>
        <p className="muted small">
          That is the backlog cleared. The ones you let go are still in your history — what you
          decided not to do is worth being able to look back on.
        </p>
        <button className="primary" onClick={onClose}>
          Good
        </button>
      </div>
    )
  }

  if (report.items.length === 0) {
    return (
      <div className="stack tight">
        <strong>{all ? 'Nothing is overdue.' : 'Nothing is stuck.'}</strong>
        <p className="muted small">
          {report.merelyLate > 0
            ? `${report.merelyLate} ${report.merelyLate === 1 ? 'thing is' : 'things are'} late, but still being chased. They have not been given up on yet.`
            : 'Nothing overdue at all.'}
        </p>
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    )
  }

  return (
    <div className="stack tight">
      <p className="muted small">
        {all
          ? `Everything past its time — ${report.items.length}. What the app would do is already picked for each; change any, then apply.`
          : 'These stopped moving. The reminders ran out, so chasing them again will not work — and that is the app\u2019s failure as much as yours.'}
        {report.worstWeekday && ` Most of them were due on a ${report.worstWeekday}.`}
      </p>

      {report.items.map((item) => (
        <div className="triage-row" key={item.id}>
          <div className="triage-head">
            <strong>{item.title}</strong>
            <span className="muted small">
              {when(item.dueAt)} · {item.daysOverdue} days ago
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
                  title={impossible ? 'No free slot in the next two weeks' : undefined}
                  onClick={() => setChoices((c) => ({ ...c, [item.id]: action }))}
                >
                  {LABEL[action]}
                </button>
              )
            })}
          </div>

          {(choices[item.id] ?? item.suggested) === 'reschedule' && (
            <p className="muted small">
              {item.suggestedAt
                ? `Moves to ${when(item.suggestedAt)} — your next genuinely free slot.`
                : 'Nothing free in the next two weeks. Pick another option, or move it by hand.'}
            </p>
          )}
        </div>
      ))}

      <div className="row">
        <button className="primary" onClick={() => void apply()} disabled={busy}>
          {busy ? 'Clearing…' : `Sort out all ${report.items.length}`}
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          Not now
        </button>
      </div>
    </div>
  )
}
