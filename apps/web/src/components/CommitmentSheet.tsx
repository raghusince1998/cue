import { useCallback, useEffect, useState } from 'react'
import { openPerson } from '../lib/open.ts'
import { Link } from 'react-router-dom'
import { KIND_LABELS, PRIORITY_LABELS, WINDOW_LABELS, hasWork, type CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { locale, t } from '../lib/i18n.tsx'
import { dayLabel, formatSpan, overdueBy, relativeDay } from '../lib/time.ts'
import { readNotes } from '../lib/sample.ts'
import { reopenPlan } from '../lib/reopen.ts'
import { Modal } from './Modal.tsx'
import { CommitmentEditor } from './CommitmentEditor.tsx'
import { Checklist } from './Checklist.tsx'
import { WishPicker } from './WishPicker.tsx'
import { WrapUp } from './WrapUp.tsx'
import { Nudge } from './Nudge.tsx'
import { errorText } from '../lib/errors.ts'

export type SheetMode = 'view' | 'edit' | 'wrapup' | 'nudge'

function lengthLabel(minutes: number): string {
  if (minutes < 60) return t('{n} min', { n: minutes })
  const hours = minutes / 60
  return t('{n} h', { n: hours % 1 === 0 ? hours : hours.toFixed(1) })
}

/** Mirrors canBeOverdue on the server: never calendar history, never an all-day calendar entry. */
function isOverdue(c: CommitmentDTO): boolean {
  if (c.status !== 'pending' || c.history) return false
  if (c.feedId && c.allDay) return false
  return new Date(c.dueAt).getTime() < Date.now()
}

function StatusLine({ c }: { c: CommitmentDTO }) {
  if (c.status === 'done') return <span className="status-pill is-done">{t('Done')}</span>
  if (c.status === 'cancelled') return <span className="status-pill is-cancelled">{t('Cancelled')}</span>
  // Not in CommitmentStatus, but a deleted plan is still a row with that status.
  if ((c.status as string) === 'deleted') {
    return <span className="status-pill is-cancelled">{t('Deleted')}</span>
  }
  if (c.history) {
    return (
      <span className="status-pill">
        {t('No status · from your calendar, before Cue was reading it')}
      </span>
    )
  }
  if (isOverdue(c)) {
    return <span className="status-pill is-late">{t('{span} late', { span: overdueBy(c.dueAt) })}</span>
  }
  return <span className="status-pill is-open">{t('Still open')}</span>
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
  const { me } = useAuth()
  const working = hasWork(me?.uses ?? [])

  const load = useCallback(async () => {
    try {
      const next = await api<CommitmentDTO>(`/commitments/${commitmentId}`)
      setC(next)
      setError(null)
      return next
    } catch (err) {
      setError(errorText(err))
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
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  /** Work, personal, or (tapped again) back to what its words say. */
  async function setSphere(sphere: 'work' | 'personal' | null) {
    setBusy(true)
    try {
      await api(`/commitments/${commitmentId}`, { method: 'PATCH', body: { sphere } })
      await load()
      onChanged()
    } catch (err) {
      setError(errorText(err))
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
      setError(errorText(err))
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
      setError(errorText(err))
      setBusy(false)
    }
  }

  if (mode === 'nudge' && c) {
    return (
      <Modal title={t('Nudge')} onClose={onClose}>
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
      <Modal title={t('Wrap up')} onClose={onClose} closeOnBackdrop={false}>
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
      <Modal title={t('Edit')} onClose={onClose} closeOnBackdrop={false}>
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
      ? t('{day} · {window}, no set time', {
          day: new Date(c.dueAt).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' }),
          window: t(WINDOW_LABELS[c.preferredWindow]),
        })
      : formatSpan(c.dueAt, c.endsAt, c.allDay)

  return (
    <Modal title={t('Details')} onClose={onClose}>
      {!c ? (
        error ? <p className="error small">{error}</p> : <p className="muted small">{t('Opening…')}</p>
      ) : (
        <div className="details">
          <div className="details-head">
            <h3 className="details-title">
              {c.title}
              {sample && <span className="sample-tag">{t('Sample')}</span>}
            </h3>
            <p className="details-when">
              {when}
              {/* "in 3 days" helps next to a date, not next to "Today". */}
              {![t('Today'), t('Tomorrow'), t('Yesterday')].some((w) =>
                when.toLowerCase().startsWith(w.toLowerCase()),
              ) && (
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
                {t('From last time · {title} · {day}', {
                  title: prep.last.title,
                  day: dayLabel(prep.last.dueAt),
                })}
              </span>
              {prep.open.length === 0 ? (
                <p className="muted small">{t('Nothing left open from earlier meetings like this.')}</p>
              ) : (
                <ul className="prep-list">
                  {prep.open.map((o) => (
                    <li key={o.id}>
                      <button className="prep-item" onClick={() => onOpenOther?.(o.id)}>
                        {o.waitingOn && <span className="waiting-who">{o.waitingOn}</span>}
                        <span>{o.waitingOn ? o.title.replace(/^Waiting on [^:]+:\s*/i, '') : o.title}</span>
                        <span className="muted small">
                          {' '}
                          ·{' '}
                          {o.waitingOn
                            ? t('check in {day}', { day: dayLabel(o.dueAt) })
                            : t('due {day}', { day: dayLabel(o.dueAt) })}
                          {o.fromTitle && prep.last && o.fromTitle !== prep.last.title
                            ? ` · ${t('from {title}', { title: o.fromTitle })}`
                            : ''}
                        </span>
                      </button>
                      <button
                        className="ghost tiny-btn"
                        onClick={() => void closeOther(o.id)}
                        disabled={busy}
                      >
                        {o.waitingOn ? t('Got it') : t('Done')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {prep.doneSinceLast.length > 0 && (
                <p className="muted small prep-done">
                  {t('Done since: {titles}', { titles: prep.doneSinceLast.map((d) => d.title).join(' · ') })}
                </p>
              )}
            </section>
          )}

          <dl className="details-facts">
            <div>
              <dt>{t('Type')}</dt>
              <dd>{t(KIND_LABELS[c.kind])}</dd>
            </div>
            {!c.allDay && c.flexibility !== 'flexible' && (
              <div>
                <dt>{t('Length')}</dt>
                <dd>{lengthLabel(c.durationMinutes)}</dd>
              </div>
            )}
            {c.priority !== 'normal' && (
              <div>
                <dt>{t('Priority')}</dt>
                <dd>{t(PRIORITY_LABELS[c.priority])}</dd>
              </div>
            )}
            {/* Work or personal: as its words read, and one tap to say otherwise. */}
            {working && (
              <div>
                <dt>{t('Part of')}</dt>
                <dd className="sphere-pick" role="group" aria-label={t('Work or personal')}>
                  {(['work', 'personal'] as const).map((s) => (
                    <button
                      key={s}
                      className={`sphere-tag is-${s}${c.sphere === s ? ' is-on' : ''}`}
                      aria-pressed={c.sphere === s}
                      disabled={busy}
                      onClick={() => void setSphere(c.sphere === s && c.sphereSaid ? null : s)}
                    >
                      {s === 'work' ? t('Work') : t('Personal')}
                    </button>
                  ))}
                </dd>
              </div>
            )}
            {(c.placeName || c.placeLabel) && (
              <div>
                <dt>{t('Where')}</dt>
                <dd>
                  {c.placeId && c.placeName ? (
                    <Link className="plan-link" to={`/places?place=${c.placeId}`} onClick={onClose}>
                      {c.placeName}
                    </Link>
                  ) : (
                    c.placeName
                  )}
                  {c.placeName && c.placeLabel ? ' · ' : ''}
                  {c.placeLabel}
                </dd>
              </div>
            )}
            {c.contactName && (
              <div>
                <dt>{t('With')}</dt>
                <dd>
                  {c.contactId ? (
                    <button className="plan-link" onClick={() => openPerson(c.contactId!)}>
                      {c.contactName}
                    </button>
                  ) : (
                    c.contactName
                  )}
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
                        {t('Call {phone}', { phone: c.contactPhone })}
                      </a>
                    </>
                  )}
                </dd>
              </div>
            )}
            {c.recurrenceId && (
              <div>
                <dt>{t('Repeats')}</dt>
                <dd>
                  {t('One of a repeating plan')} ·{' '}
                  <Link to={`/repeating?series=${c.recurrenceId}`} onClick={onClose}>
                    {t('See the series')}
                  </Link>
                </dd>
              </div>
            )}
            {c.waitingOn && (
              <div>
                <dt>{t('Waiting on')}</dt>
                <dd>{t('{who} — a check-in, not time on your calendar', { who: c.waitingOn })}</dd>
              </div>
            )}
            {c.fromTitle && (
              <div>
                <dt>{t('Came from')}</dt>
                <dd>
                  {c.fromId && onOpenOther ? (
                    <button className="plan-link" onClick={() => onOpenOther(c.fromId!)}>
                      {t('The meeting “{title}”', { title: c.fromTitle })}
                    </button>
                  ) : (
                    t('The meeting “{title}”', { title: c.fromTitle })
                  )}
                </dd>
              </div>
            )}
            {c.scheduleTitle && (
              <div>
                <dt>{t('Part of')}</dt>
                <dd>
                  {c.scheduleTitle} ·{' '}
                  <Link to="/repeating" onClick={onClose}>
                    {t('See the schedule')}
                  </Link>
                </dd>
              </div>
            )}
            {c.feedId && (
              <div>
                <dt>{t('Came from')}</dt>
                <dd>{t('Your connected calendar')}</dd>
              </div>
            )}
            {c.escalationCount > 0 && c.status === 'pending' && (
              <div>
                <dt>{t('Reminders')}</dt>
                <dd>
                  {c.escalationCount === 1
                    ? t('Chased 1 time')
                    : t('Chased {n} times', { n: c.escalationCount })}
                </dd>
              </div>
            )}
          </dl>

          {notes && (
            <div className="details-notes">
              <span className="label-text">{t('Notes')}</span>
              <p>{notes}</p>
            </div>
          )}

          {/* Several things to do for one plan, on one list: typed here, or
              taken from the wishlist. Every open plan can have one. */}
          {((c.status === 'pending' && !c.history) || c.checklistCount > 0) && (
            <div className="details-todo">
              <div className="details-todo-head">
                <span className="label-text">{t('Things to do')}</span>
                {c.status === 'pending' && !c.history && (
                  <button className="link small" onClick={() => setPicking((p) => !p)}>
                    {picking ? t('Close wishlist') : t('Add from wishlist')}
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
              {t('Edit')}
            </button>
            {c.status === 'pending' && c.waitingOn && (
              <button className="ghost" onClick={() => setMode('nudge')} disabled={busy}>
                {t('Nudge')}
              </button>
            )}
            {c.status === 'pending' &&
              !c.history &&
              c.kind === 'meeting' &&
              !c.allDay &&
              new Date(c.dueAt).getTime() < Date.now() && (
                <button className="ghost" onClick={() => setMode('wrapup')} disabled={busy}>
                  {t('Add follow-ups')}
                </button>
              )}
            {c.status === 'pending' && !c.history && (
              <button className="ghost" onClick={() => void markDone()} disabled={busy}>
                {busy ? t('Saving…') : t('Mark done')}
              </button>
            )}
            {(c.status === 'done' || c.status === 'cancelled') && (
              <button className="ghost" onClick={() => void reopen()} disabled={busy}>
                {busy ? t('Reopening…') : t('Reopen')}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
