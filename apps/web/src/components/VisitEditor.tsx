import { useEffect, useState } from 'react'
import {
  OUTCOME_OPTIONS,
  PURPOSE,
  type PlaceDTO,
  type Purpose,
  type VisitDTO,
} from '@cue/shared'
import { api } from '../lib/api.ts'
import { formatDateTime, toLocalInputValue } from '../lib/time.ts'
import { VoiceNotes } from './VoiceNotes.tsx'
import { DictateButton } from './DictateButton.tsx'

export function VisitEditor({
  visitId,
  onSaved,
  onClose,
  onEditCommitment,
}: {
  visitId: string
  onSaved: () => void
  onClose: () => void
  /** Hands off to the commitment editor rather than nesting a second modal. */
  onEditCommitment: (commitmentId: string) => void
}) {
  const [visit, setVisit] = useState<VisitDTO | null>(null)
  const [places, setPlaces] = useState<PlaceDTO[]>([])

  const [placeId, setPlaceId] = useState<string | null>(null)
  const [purpose, setPurpose] = useState<Purpose>('business')
  const [contactName, setContactName] = useState('')
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const [startedAt, setStartedAt] = useState<Date>(new Date())

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([api<VisitDTO>(`/visits/${visitId}`), api<PlaceDTO[]>('/places')]).then(
      ([v, p]) => {
        setVisit(v)
        setPlaceId(v.placeId)
        setPurpose(v.purpose)
        setContactName(v.contactName ?? '')
        setOutcome(v.outcome ?? '')
        setNotes(v.notes ?? '')
        setStartedAt(new Date(v.startedAt))
        setPlaces(p)
      },
    )
  }, [visitId])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api(`/visits/${visitId}`, {
        method: 'PATCH',
        body: {
          placeId,
          purpose,
          contactName: contactName.trim() || null,
          outcome: outcome || null,
          notes: notes.trim() || null,
          startedAt: startedAt.toISOString(),
        },
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api(`/visits/${visitId}`, { method: 'DELETE' })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!visit) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  const linked = visit.commitments ?? []

  return (
    <div className="stack tight">
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

      <span className="label-text">Purpose</span>
      <div className="chips">
        {PURPOSE.map((p) => (
          <button
            key={p}
            className={`chip${purpose === p ? ' selected' : ''}`}
            onClick={() => setPurpose(p)}
          >
            {p === 'unknown' ? 'Not sure' : p[0]!.toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      <label>
        Who was it with?
        <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
      </label>

      <span className="label-text">Outcome</span>
      <div className="chips">
        {OUTCOME_OPTIONS.map((o) => (
          <button
            key={o}
            className={`chip${outcome === o ? ' selected' : ''}`}
            onClick={() => setOutcome(outcome === o ? '' : o)}
          >
            {o}
          </button>
        ))}
      </div>

      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
      </label>
      <div className="row">
        <DictateButton value={notes} onChange={setNotes} />
      </div>

      <span className="label-text">Voice notes</span>
      <VoiceNotes interactionId={visitId} />

      <label>
        When did this happen?
        <input
          type="datetime-local"
          value={toLocalInputValue(startedAt)}
          onChange={(e) => {
            const next = new Date(e.target.value)
            if (!Number.isNaN(next.getTime())) setStartedAt(next)
          }}
        />
      </label>

      {linked.length > 0 && (
        <>
          <span className="label-text">Follow-ups from this visit</span>
          <ul className="plain">
            {linked.map((c) => (
              <li key={c.id}>
                <button className="link" onClick={() => onEditCommitment(c.id)}>
                  {c.title} · {formatDateTime(c.dueAt)}
                  {c.status !== 'pending' ? ` (${c.status})` : ''}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p className="error small">{error}</p>}

      <div className="row">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>

      <div className="danger-zone">
        {confirmDelete ? (
          <div className="row">
            <button className="danger-btn" onClick={remove} disabled={busy}>
              Yes, delete it
            </button>
            <button className="ghost small-btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button className="link danger-link" onClick={() => setConfirmDelete(true)}>
            Delete this entry
          </button>
        )}
        <p className="muted small">
          {linked.length > 0
            ? `The ${linked.length} follow-up${linked.length === 1 ? '' : 's'} above will survive — a promise you made does not disappear because you deleted the note about the meeting.`
            : 'This removes the record only.'}
        </p>
      </div>
    </div>
  )
}
