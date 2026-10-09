import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { KIND_LABELS, PRIORITY_LABELS, WINDOW_LABELS, type CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { dayLabel, formatSpan, overdueBy, relativeDay } from '../lib/time.ts'
import { readNotes } from '../lib/sample.ts'
import { reopenPlan } from '../lib/reopen.ts'
import { Modal } from './Modal.tsx'
import { CommitmentEditor } from './CommitmentEditor.tsx'
import { Checklist } from './Checklist.tsx'
import { WishPicker } from './WishPicker.tsx'
import { WrapUp } from './WrapUp.tsx'
import { Nudge } from './Nudge.tsx'

export type SheetMode = 'view' | 'edit' | 'wrapup' | 'nudge'

function lengthLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)} h`
}

/** Mirrors canBeOverdue on the server: never calendar history, never an all-day calendar entry. */
function isOverdue(c: CommitmentDTO): boolean {
  if (c.status !== 'pending' || c.history) return false
  if (c.feedId && c.allDay) return false
  return new Date(c.dueAt).getTime() < Date.now()
}

function StatusLine({ c }: { c: CommitmentDTO }) {
  if (c.status === 'done') return <span className="status-pill is-done">Done</span>
  if (c.status === 'cancelled') return <span className="status-pill is-cancelled">Cancelled</span>
  // Not in CommitmentStatus, but a deleted plan is still a row with that status.
  if ((c.status as string) === 'deleted') {
    return <span className="status-pill is-cancelled">Deleted</span>
  }
  if (c.history) {
    return (
      <span className="status-pill">
        No status · from your calendar, before Cue was reading it
      </span>
    )
  }
  if (isOverdue(c)) {
    return <span className="status-pill is-late">{overdueBy(c.dueAt)} late</span>
  }
  return <span className="status-pill is-open">Open</span>
}

/**
 * One plan, opened.
 *
 * Tapping a card used to do nothing, and an "Edit" link on every card went
 * straight to a form — the only way to read a plan's full note or checklist
 * was to start editing it. This shows everything about it first, with Edit
 * one tap away inside, and returns here after a save.
 */
interface Prep {
  last: { id: string; title: string; dueAt: string } | null
  earlierCount: number
  open: CommitmentDTO[]
  doneSinceLast: CommitmentDTO[]
}

export function CommitmentSheet({
  commitmentId,
  initialMode = 'view',
  initialNotice,
  onClose,
  onChanged,
  onOpenOther,
}: {
  commitmentId: string
  initialMode?: SheetMode
  /** A line for the editor to open with — after Reopen, when it will remind you. */
  initialNotice?: string
  onClose: () => void
  /** Something was saved, so the page behind should reload. */
  onChanged: () => void
  /** Open a different plan in this sheet — an open item from last time. */
  onOpenOther?: (id: string) => void
}) {
  const [mode, setMode] = useState<SheetMode>(initialMode)
  const [notice, setNotice] = useState<string | undefined>(initialNotice)
  /** Choosing wishes to add to this plan's list, and a key to reload the list after. */
  const [picking, setPicking] = useState(false)
  const [listKey, setListKey] = useState(0)
  const [c, setC] = useState<CommitmentDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await api<CommitmentDTO>(`/commitments/${commitmentId}`)
      setC(next)
      setError(null)
      return next
    } catch (err) {
      setError((err as Error).message)
      return null
    }
  }, [commitmentId])

  useEffect(() => {
    void load()
  }, [load])

  // For a meeting: what is still open from the last ones like it.
  const [prep, setPrep] = useState<Prep | null>(null)
  const loadPrep = useCallback(async () => {
    try {
      setPrep(await api<Prep>(`/commitments/${commitmentId}/prep`))
    } catch {
      setPrep(null)
    }
  }, [commitmentId])
  useEffect(() => {
    if (c?.kind === 'meeting') void loadPrep()
  }, [c?.kind, loadPrep])

  async function closeOther(id: string) {
    setBusy(true)
    try {
      await api(`/commitments/${id}/done`, { method: 'POST' })
      onChanged()
      await loadPrep()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Back to open in one tap, then the editor in case the time wants changing. */
  async function reopen() {
    if (!c) return
    setBusy(true)
    try {
      setNotice(await reopenPlan(c))
      onChanged()
      await load()
      setMode('edit')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function markDone() {
    setBusy(true)
    try {
      await api(`/commitments/${commitmentId}/done`, { method: 'POST' })
      onChanged()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  if (mode === 'nudge' && c) {
    return (
      <Modal title="Nudge" onClose={onClose}>
        <Nudge
          item={c}
          onDone={() => {
            onChanged()
            onClose()
          }}
        />
      </Modal>
    )
  }

  if (mode === 'wrapup' && c) {
    return (
      <Modal title="Wrap up" onClose={onClose} closeOnBackdrop={false}>
        <WrapUp
          meeting={c}
          onDone={() => {
            onChanged()
            onClose()
          }}
        />
      </Modal>
    )
  }

  if (mode === 'edit') {
    return (
      <Modal title="Edit" onClose={onClose} closeOnBackdrop={false}>
        <CommitmentEditor
          commitmentId={commitmentId}
          notice={notice}
          // Cancel goes back to the details, not out of the sheet altogether.
          onClose={() => {
            setNotice(undefined)
            setMode('view')
          }}
          onSaved={async () => {
            onChanged()
            // Deleting is a save too; there is nothing left to show after it.
            const next = await load()
            if (!next || (next.status as string) === 'deleted') onClose()
            else {
              setNotice(undefined)
              setMode('view')
            }
          }}
        />
      </Modal>
    )
  }

  const { notes, sample } = readNotes(c?.notes)
  const when = !c
    ? ''
    : c.flexibility === 'flexible' && c.preferredWindow
      ? `${new Date(c.dueAt).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${WINDOW_LABELS[c.preferredWindow]}, no set time`
      : formatSpan(c.dueAt, c.endsAt, c.allDay)

  return (
    <Modal title="Details" onClose={onClose}>
      {!c ? (
        error ? <p className="error small">{error}</p> : <p className="muted small">Opening…</p>
      ) : (
        <div className="details">
          <div className="details-head">
            <h3 className="details-title">
              {c.title}
              {sample && <span className="sample-tag">Sample</span>}
            </h3>
            <p className="details-when">
              {when}
              {/* "in 3 days" helps next to a date, not next to "Today". */}
              {!/^(today|tomorrow|yesterday)/i.test(when) && (
                <span className="muted"> · {relativeDay(c.dueAt)}</span>
              )}
            </p>
            <StatusLine c={c} />
          </div>

          {/* Before a meeting, the first thing worth knowing: what was left
              open last time, so it gets raised rather than remembered later. */}
          {c.kind === 'meeting' && prep?.last && (
            <section className="prep">
              <span className="label-text">
                From last time · {prep.last.title} · {dayLabel(prep.last.dueAt)}
              </span>
              {prep.open.length === 0 ? (
                <p className="muted small">Nothing left open from earlier meetings like this.</p>
              ) : (
                <ul className="prep-list">
                  {prep.open.map((o) => (
                    <li key={o.id}>
                      <button className="prep-item" onClick={() => onOpenOther?.(o.id)}>
                        {o.waitingOn && <span className="waiting-who">{o.waitingOn}</span>}
                        <span>{o.waitingOn ? o.title.replace(/^Waiting on [^:]+:\s*/i, '') : o.title}</span>
                        <span className="muted small">
                          {' '}
                          · {o.waitingOn ? 'check in' : 'due'} {dayLabel(o.dueAt)}
                          {o.fromTitle && prep.last && o.fromTitle !== prep.last.title
                            ? ` · from ${o.fromTitle}`
                            : ''}
                        </span>
                      </button>
                      <button
                        className="ghost tiny-btn"
                        onClick={() => void closeOther(o.id)}
                        disabled={busy}
                      >
                        {o.waitingOn ? 'Got it' : 'Done'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {prep.doneSinceLast.length > 0 && (
                <p className="muted small prep-done">
                  Done since: {prep.doneSinceLast.map((d) => d.title).join(' · ')}
                </p>
              )}
            </section>
          )}

          <dl className="details-facts">
            <div>
              <dt>Type</dt>
              <dd>{KIND_LABELS[c.kind]}</dd>
            </div>
            {!c.allDay && c.flexibility !== 'flexible' && (
              <div>
                <dt>Length</dt>
                <dd>{lengthLabel(c.durationMinutes)}</dd>
              </div>
            )}
            {c.priority !== 'normal' && (
              <div>
                <dt>Priority</dt>
                <dd>{PRIORITY_LABELS[c.priority]}</dd>
              </div>
            )}
            {(c.placeName || c.placeLabel) && (
              <div>
                <dt>Where</dt>
                <dd>{[c.placeName, c.placeLabel].filter(Boolean).join(' · ')}</dd>
              </div>
            )}
            {c.contactName && (
              <div>
                <dt>With</dt>
                <dd>
                  {c.contactName}
                  {c.contactPhone && (
                    <>
                      {' · '}
                      <a
                        href={`tel:${c.contactPhone}`}
                        data-contact-id={c.contactId ?? undefined}
                        data-name={c.contactName ?? undefined}
                        data-commitment-id={c.id}
                        data-commitment-title={c.title}
                      >
                        Call {c.contactPhone}
                      </a>
                    </>
                  )}
                </dd>
              </div>
            )}
            {c.recurrenceId && (
              <div>
                <dt>Repeats</dt>
                <dd>
                  One of a repeating plan · <Link to="/repeating">See the series</Link>
                </dd>
              </div>
            )}
            {c.waitingOn && (
              <div>
                <dt>Waiting on</dt>
                <dd>{c.waitingOn} — a check-in, not time on your calendar</dd>
              </div>
            )}
            {c.fromTitle && (
              <div>
                <dt>From</dt>
                <dd>The meeting &ldquo;{c.fromTitle}&rdquo;</dd>
              </div>
            )}
            {c.scheduleTitle && (
              <div>
                <dt>Part of</dt>
                <dd>
                  {c.scheduleTitle} · <Link to="/repeating">See the schedule</Link>
                </dd>
              </div>
            )}
            {c.feedId && (
              <div>
                <dt>From</dt>
                <dd>Your connected calendar</dd>
              </div>
            )}
            {c.escalationCount > 0 && c.status === 'pending' && (
              <div>
                <dt>Reminders</dt>
                <dd>
                  Chased {c.escalationCount} {c.escalationCount === 1 ? 'time' : 'times'}
                </dd>
              </div>
            )}
          </dl>

          {notes && (
            <div className="details-notes">
              <span className="label-text">Notes</span>
              <p>{notes}</p>
            </div>
          )}

          {/* Several things to do for one plan, on one list: typed here, or
              taken from the wishlist. Every open plan can have one. */}
          {((c.status === 'pending' && !c.history) || c.checklistCount > 0) && (
            <div className="details-todo">
              <div className="details-todo-head">
                <span className="label-text">Things to do</span>
                {c.status === 'pending' && !c.history && (
                  <button className="link small" onClick={() => setPicking((p) => !p)}>
                    {picking ? 'Close wishlist' : 'Add from wishlist'}
                  </button>
                )}
              </div>
              {picking && (
                <WishPicker
                  plan={c}
                  onAdded={() => {
                    setPicking(false)
                    setListKey((k) => k + 1)
                    onChanged()
                  }}
                />
              )}
              <Checklist key={listKey} commitmentId={c.id} />
            </div>
          )}

          {error && <p className="error small">{error}</p>}

          <div className="form-actions details-actions">
            <button className="primary" onClick={() => setMode('edit')} disabled={busy}>
              Edit
            </button>
            {c.status === 'pending' && c.waitingOn && (
              <button className="ghost" onClick={() => setMode('nudge')} disabled={busy}>
                Nudge
              </button>
            )}
            {c.status === 'pending' &&
              !c.history &&
              c.kind === 'meeting' &&
              !c.allDay &&
              new Date(c.dueAt).getTime() < Date.now() && (
                <button className="ghost" onClick={() => setMode('wrapup')} disabled={busy}>
                  Add follow-ups
                </button>
              )}
            {c.status === 'pending' && !c.history && (
              <button className="ghost" onClick={() => void markDone()} disabled={busy}>
                {busy ? 'Saving…' : 'Mark done'}
              </button>
            )}
            {(c.status === 'done' || c.status === 'cancelled') && (
              <button className="ghost" onClick={() => void reopen()} disabled={busy}>
                {busy ? 'Reopening…' : 'Reopen'}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
