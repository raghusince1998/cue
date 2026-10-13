import { useCallback, useEffect, useState } from 'react'
import {
  COMMITMENT_KIND,
  SELECTABLE_KINDS,
  DURATION_CHOICES,
  KIND_LABELS,
  type CommitmentDTO,
  type CommitmentStatus,
  type ConflictReport,
  type PlaceDTO,
} from '@cue/shared'
import { ApiError, api } from '../lib/api.ts'
import { msg, rich, t } from '../lib/i18n.tsx'
import { formatDateTime, toLocalInputValue } from '../lib/time.ts'
import { ConflictWarning } from './ConflictWarning.tsx'

const STATUSES: { value: CommitmentStatus; label: string }[] = [
  { value: 'pending', label: msg('Still open') },
  { value: 'done', label: msg('Done') },
  { value: 'cancelled', label: msg('Cancelled') },
]

export function CommitmentEditor({
  commitmentId,
  onSaved,
  onClose,
  notice,
}: {
  commitmentId: string
  onSaved: () => void
  onClose: () => void
  /** Shown at the top: "Reopened. It will remind you at 5:00 PM…" */
  notice?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [places, setPlaces] = useState<PlaceDTO[]>([])

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<(typeof COMMITMENT_KIND)[number]>('callback')
  const [dueAt, setDueAt] = useState<Date>(new Date())
  const [durationMinutes, setDurationMinutes] = useState(15)
  const [status, setStatus] = useState<CommitmentStatus>('pending')
  const [placeId, setPlaceId] = useState<string | null>(null)
  /** Where, in words. Sent only when changed, so coordinates that came with it stay. */
  const [placeLabel, setPlaceLabel] = useState('')
  const [savedLabel, setSavedLabel] = useState('')
  /** From a connected calendar, dated before Cue was reading it. */
  const [history, setHistory] = useState(false)

  const [conflict, setConflict] = useState<ConflictReport | null>(null)
  const [allowConflict, setAllowConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([
      api<CommitmentDTO>(`/commitments/${commitmentId}`),
      api<PlaceDTO[]>('/places'),
    ]).then(([c, p]) => {
      setTitle(c.title)
      setKind(c.kind)
      setDueAt(new Date(c.dueAt))
      setDurationMinutes(c.durationMinutes)
      setStatus(c.status)
      setPlaceId(c.placeId)
      setPlaceLabel(c.placeLabel ?? '')
      setSavedLabel(c.placeLabel ?? '')
      setHistory(Boolean(c.history))
      setPlaces(p)
      setLoaded(true)
    })
  }, [commitmentId])

  const runConflictCheck = useCallback(async () => {
    if (status !== 'pending') {
      setConflict(null)
      return
    }
    try {
      setConflict(
        await api<ConflictReport>('/commitments/check-conflicts', {
          method: 'POST',
          body: {
            dueAt: dueAt.toISOString(),
            durationMinutes,
            // Exclude itself, or every edit reports a clash with its own slot.
            excludeId: commitmentId,
          },
        }),
      )
    } catch {
      setConflict(null)
    }
  }, [commitmentId, dueAt, durationMinutes, status])

  useEffect(() => {
    if (!loaded) return
    setAllowConflict(false)
    const handle = setTimeout(() => void runConflictCheck(), 400)
    return () => clearTimeout(handle)
  }, [loaded, runConflictCheck])

  async function shiftExisting(id: string, to: string) {
    setError(null)
    try {
      await api(`/commitments/${id}/reschedule`, { method: 'POST', body: { dueAt: to } })
      await runConflictCheck()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t('That time does not fit the other commitment either — pick another slot.'))
        return
      }
      setError((err as Error).message)
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api(`/commitments/${commitmentId}`, {
        method: 'PATCH',
        body: {
          title: title.trim(),
          kind,
          dueAt: dueAt.toISOString(),
          durationMinutes,
          status,
          placeId,
          ...(placeLabel.trim() !== savedLabel.trim() ? { placeLabel: placeLabel.trim() || null } : {}),
          allowConflict,
        },
      })
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(err.data as ConflictReport)
        setError(t('That slot was taken while you were editing.'))
        return
      }
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api(`/commitments/${commitmentId}`, { method: 'DELETE' })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  const clashes = conflict?.conflicts ?? []
  const blocked = status === 'pending' && clashes.length > 0 && !allowConflict

  return (
    <div className="stack tight">
      {notice && <p className="editor-notice small">{notice}</p>}
      <label>
        {t('What exactly?')}
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <span className="label-text">{t('Type')}</span>
      <div className="chips">
        {SELECTABLE_KINDS.map((k) => (
          <button
            key={k}
            className={`chip${kind === k ? ' selected' : ''}`}
            onClick={() => setKind(k)}
          >
            {t(KIND_LABELS[k])}
          </button>
        ))}
      </div>

      <label>
        {t('When?')}
        <input
          type="datetime-local"
          value={toLocalInputValue(dueAt)}
          onChange={(e) => {
            const next = new Date(e.target.value)
            if (!Number.isNaN(next.getTime())) setDueAt(next)
          }}
        />
      </label>

      <span className="label-text">{t('How long will it block?')}</span>
      <div className="chips">
        {DURATION_CHOICES.map((minutes) => (
          <button
            key={minutes}
            className={`chip${durationMinutes === minutes ? ' selected' : ''}`}
            onClick={() => setDurationMinutes(minutes)}
          >
            {minutes < 60 ? t('{n} min', { n: minutes }) : t('{n}h', { n: minutes / 60 })}
          </button>
        ))}
      </div>

      <label>
        {t('Where? (optional)')}
        <input
          value={placeLabel}
          onChange={(e) => setPlaceLabel(e.target.value)}
          placeholder={t('e.g. {example}', { example: 'BKC, Mumbai' })}
        />
      </label>
      <p className="muted small">
        {t(
          'A town, area or address. Cue uses it to warn you when two plans are too far apart to get between in time, or clash with a trip.',
        )}
      </p>

      {/* Saved places come from logging a visit somewhere with your location on.
          Most people have none, and a list that only says "none" explains nothing. */}
      {(places.length > 0 || placeId) && (
        <label>
          {t('Saved place')}
          <select value={placeId ?? ''} onChange={(e) => setPlaceId(e.target.value || null)}>
            <option value="">{t('— none —')}</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <span className="label-text">{t('Status')}</span>
      <div className="chips">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            className={`chip${status === s.value ? ' selected' : ''}`}
            onClick={() => setStatus(s.value)}
          >
            {/* Calendar history is not "still open": Cue was not there. */}
            {s.value === 'pending' && history ? t('No status') : t(s.label)}
          </button>
        ))}
      </div>
      {status === 'pending' && history && (
        <p className="muted small">
          {t(
            'This was already in your calendar before Cue started reading it, so Cue does not treat it as done or as overdue. Mark it done or cancelled if you want it on record.',
          )}
        </p>
      )}
      {status === 'pending' && !history && (
        <p className="muted small">
          {t('Reminders restart from {time} — the overdue count resets.', {
            time: formatDateTime(dueAt.toISOString()),
          })}
        </p>
      )}
      {status === 'cancelled' && (
        <p className="muted small">
          {t(
            'Stays on its day with a line through it, and stops reminding you. To take it off your lists entirely, delete it below.',
          )}
        </p>
      )}

      {conflict && (
        <ConflictWarning
          report={conflict}
          allowConflict={allowConflict}
          onAllowConflictChange={setAllowConflict}
          onUseSuggestion={(iso) => setDueAt(new Date(iso))}
          onShiftExisting={(id, to) => void shiftExisting(id, to)}
        />
      )}

      {error && <p className="error small">{error}</p>}

      <div className="row">
        <button className="primary" onClick={save} disabled={busy || blocked || !title.trim()}>
          {busy ? t('Saving…') : blocked ? t('Resolve the clash') : t('Save changes')}
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          {t('Cancel')}
        </button>
      </div>

      <div className="danger-zone">
        {confirmDelete ? (
          <div className="row">
            <button className="danger-btn" onClick={remove} disabled={busy}>
              {t('Yes, take it off my list')}
            </button>
            <button className="ghost small-btn" onClick={() => setConfirmDelete(false)}>
              {t('Keep it')}
            </button>
          </div>
        ) : (
          <button className="link danger-link" onClick={() => setConfirmDelete(true)}>
            {t('Delete this commitment')}
          </button>
        )}
        {/* These do different things and the difference is not guessable, so
            it is spelled out at the moment of choosing. */}
        <p className="muted small">
          {rich(
            '<em>Cancelled</em> above keeps it on its day, struck through, so you can still see the slot is free and why. Deleting takes it off every list — History still shows it, as something you let go.',
            { em: (s) => <em>{s}</em> },
          )}
        </p>
      </div>
    </div>
  )
}
