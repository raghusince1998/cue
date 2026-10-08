import { useCallback, useEffect, useState } from 'react'
import {
  COMMITMENT_KIND,
  DURATION_CHOICES,
  KIND_LABELS,
  type CommitmentDTO,
  type CommitmentStatus,
  type ConflictReport,
  type PlaceDTO,
} from '@cue/shared'
import { ApiError, api } from '../lib/api.ts'
import { formatDateTime, toLocalInputValue } from '../lib/time.ts'
import { ConflictWarning } from './ConflictWarning.tsx'

const STATUSES: { value: CommitmentStatus; label: string }[] = [
  { value: 'pending', label: 'Still open' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function CommitmentEditor({
  commitmentId,
  onSaved,
  onClose,
}: {
  commitmentId: string
  onSaved: () => void
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [places, setPlaces] = useState<PlaceDTO[]>([])

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<(typeof COMMITMENT_KIND)[number]>('callback')
  const [dueAt, setDueAt] = useState<Date>(new Date())
  const [durationMinutes, setDurationMinutes] = useState(15)
  const [status, setStatus] = useState<CommitmentStatus>('pending')
  const [placeId, setPlaceId] = useState<string | null>(null)
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
        setError('That time does not fit the other commitment either — pick another slot.')
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
          allowConflict,
        },
      })
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(err.data as ConflictReport)
        setError('That slot was taken while you were editing.')
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
      <label>
        What exactly?
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <span className="label-text">Type</span>
      <div className="chips">
        {COMMITMENT_KIND.map((k) => (
          <button
            key={k}
            className={`chip${kind === k ? ' selected' : ''}`}
            onClick={() => setKind(k)}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <label>
        When?
        <input
          type="datetime-local"
          value={toLocalInputValue(dueAt)}
          onChange={(e) => {
            const next = new Date(e.target.value)
            if (!Number.isNaN(next.getTime())) setDueAt(next)
          }}
        />
      </label>

      <span className="label-text">How long will it block?</span>
      <div className="chips">
        {DURATION_CHOICES.map((minutes) => (
          <button
            key={minutes}
            className={`chip${durationMinutes === minutes ? ' selected' : ''}`}
            onClick={() => setDurationMinutes(minutes)}
          >
            {minutes < 60 ? `${minutes} min` : `${minutes / 60}h`}
          </button>
        ))}
      </div>

      <label>
        Place
        <select value={placeId ?? ''} onChange={(e) => setPlaceId(e.target.value || null)}>
          <option value="">— none —</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <span className="label-text">Status</span>
      <div className="chips">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            className={`chip${status === s.value ? ' selected' : ''}`}
            onClick={() => setStatus(s.value)}
          >
            {/* Calendar history is not "still open": Cue was not there. */}
            {s.value === 'pending' && history ? 'No status' : s.label}
          </button>
        ))}
      </div>
      {status === 'pending' && history && (
        <p className="muted small">
          This was already in your calendar before Cue started reading it, so Cue does not treat it
          as done or as overdue. Mark it done or cancelled if you want it on record.
        </p>
      )}
      {status === 'pending' && !history && (
        <p className="muted small">
          Reminders restart from {formatDateTime(dueAt.toISOString())} — the overdue count resets.
        </p>
      )}
      {status === 'cancelled' && (
        <p className="muted small">
          Stays on its day with a line through it, and stops reminding you. To take it off your
          lists entirely, delete it below.
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
          {busy ? 'Saving…' : blocked ? 'Resolve the clash' : 'Save changes'}
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>

      <div className="danger-zone">
        {confirmDelete ? (
          <div className="row">
            <button className="danger-btn" onClick={remove} disabled={busy}>
              Yes, take it off my list
            </button>
            <button className="ghost small-btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button className="link danger-link" onClick={() => setConfirmDelete(true)}>
            Delete this commitment
          </button>
        )}
        {/* These do different things and the difference is not guessable, so
            it is spelled out at the moment of choosing. */}
        <p className="muted small">
          <em>Cancelled</em> above keeps it on its day, struck through, so you can still see the
          slot is free and why. Deleting takes it off every list — History still shows it, as
          something you let go.
        </p>
      </div>
    </div>
  )
}
