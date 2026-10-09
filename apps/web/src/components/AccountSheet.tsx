import { useCallback, useEffect, useState } from 'react'
import { ACCOUNT_STAGES, ACCOUNT_STAGE_LABELS, type AccountStage, type CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { openAdd } from '../lib/addSheet.ts'
import { dayLabel, formatDateTime, relativeDay } from '../lib/time.ts'
import { waitingWhat } from './Nudge.tsx'

interface Overview {
  name: string
  stage: AccountStage | null
  stageChangedAt: string | null
  notes: string | null
  people: { id: string; name: string; role: string | null; phone: string | null; reachOut: boolean }[]
  waiting: CommitmentDTO[]
  owe: CommitmentDTO[]
  nextMeetings: CommitmentDTO[]
  pastMeetings: CommitmentDTO[]
  lastContact: string | null
  quiet: boolean
}

/**
 * One clinic or company: who you know there, what is open with them, what has
 * happened, and how far along things are — the page to open before walking in.
 */
export function AccountSheet({
  name,
  onOpenPerson,
  onAddPerson,
  onRenamed,
  onChanged,
}: {
  name: string
  onOpenPerson: (id: string) => void
  /** Add someone who works here. */
  onAddPerson: (organization: string) => void
  onRenamed: (to: string) => void
  onChanged: () => void
}) {
  const [o, setO] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(name)

  const load = useCallback(async () => {
    try {
      const r = await api<Overview>('/accounts/overview', { query: { name } })
      setO(r)
      setNotes(r.notes ?? '')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [name])

  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      announceChange()
      onChanged()
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const setStage = (stage: AccountStage | null) =>
    run(() => api('/accounts', { method: 'PUT', body: { name, stage } }))
  const saveNotes = () => run(() => api('/accounts', { method: 'PUT', body: { name, notes } }))
  const close = (id: string) => run(() => api(`/commitments/${id}/done`, { method: 'POST' }))

  async function rename() {
    const to = newName.trim()
    if (!to || to === name) return setRenaming(false)
    setBusy(true)
    try {
      await api('/accounts/rename', { method: 'POST', body: { from: name, to } })
      announceChange()
      onRenamed(to)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  if (error && !o) return <p className="error small">{error}</p>
  if (!o) return <p className="muted small">Gathering everything with them…</p>

  const count = o.people.length
  const quietFor = o.lastContact ? relativeDay(o.lastContact).replace(/ ago$/, '') : null

  return (
    <div className="stack tight person account">
      <div className="person-head">
        <div>
          {renaming ? (
            <div className="row inline-field-row">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Name" autoFocus />
              <button className="primary small-btn" onClick={() => void rename()} disabled={busy || !newName.trim()}>
                Save
              </button>
              <button className="ghost small-btn" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <h3 className="details-title">{o.name}</h3>
          )}
          <p className="muted small">
            {count === 0 ? 'Nobody saved here yet' : `${count} ${count === 1 ? 'person' : 'people'}`}
            {' · '}
            {o.lastContact ? `last contact ${relativeDay(o.lastContact)}` : 'no contact on record'}
          </p>
        </div>
        {!renaming && (
          <button className="link small" onClick={() => setRenaming(true)}>
            Rename
          </button>
        )}
      </div>
      {renaming && (
        <p className="muted small">Renames it on everyone who works here too. An existing name merges the two.</p>
      )}

      <section className="person-part">
        <span className="label-text">Stage</span>
        <div className="chips">
          <button className={`chip${o.stage === null ? ' selected' : ''}`} onClick={() => void setStage(null)} disabled={busy}>
            None
          </button>
          {ACCOUNT_STAGES.map((s) => (
            <button
              key={s}
              className={`chip${o.stage === s ? ' selected' : ''}`}
              onClick={() => void setStage(s)}
              disabled={busy}
            >
              {ACCOUNT_STAGE_LABELS[s]}
            </button>
          ))}
        </div>
        {o.stage && o.stageChangedAt && (
          <p className="muted small">
            {ACCOUNT_STAGE_LABELS[o.stage]} since {dayLabel(o.stageChangedAt)}.
          </p>
        )}
        {o.quiet && (
          <p className="small due-now">
            {quietFor ? `No contact for ${quietFor}` : 'No contact on record'},{' '}
            {o.stage === 'proposal' ? 'with a proposal out' : 'while in talks'}. Worth a call before
            it goes cold.
          </p>
        )}
      </section>

      <section className="person-part">
        <span className="label-text">People there</span>
        {o.people.length === 0 && <p className="muted small">Nobody yet.</p>}
        {o.people.map((p) => (
          <div className="your-day-line" key={p.id}>
            <span>
              <button className="link" onClick={() => onOpenPerson(p.id)}>
                {p.name}
              </button>
              {p.role && <span className="muted small"> · {p.role}</span>}
              {p.reachOut && <span className="small due-now"> · time to reach out</span>}
            </span>
            {p.phone && (
              <a className="ghost tiny-btn link-btn" href={`tel:${p.phone}`} data-contact-id={p.id} data-name={p.name}>
                Call
              </a>
            )}
          </div>
        ))}
        <button className="link small fit-btn" onClick={() => onAddPerson(o.name)}>
          + Add someone who works here
        </button>
      </section>

      {o.nextMeetings.length > 0 && (
        <section className="person-part">
          <span className="label-text">Coming up</span>
          {o.nextMeetings.map((m) => (
            <p key={m.id} className="person-line">
              <strong>{m.title}</strong>
              <span className="muted small">
                {' '}
                · {formatDateTime(m.dueAt)} · {relativeDay(m.dueAt)}
              </span>
            </p>
          ))}
        </section>
      )}

      {o.waiting.length > 0 && (
        <section className="person-part">
          <span className="label-text">Waiting on them</span>
          {o.waiting.map((c) => {
            const isDue = new Date(c.dueAt).getTime() <= Date.now()
            return (
              <div className="your-day-line" key={c.id}>
                <span>
                  {c.waitingOn ? `${c.waitingOn}: ` : ''}
                  {waitingWhat(c)}
                  <span className={`small ${isDue ? 'due-now' : 'muted'}`}>
                    {' '}
                    · {isDue ? 'check in now' : `check in ${dayLabel(c.dueAt)}`}
                  </span>
                </span>
                <button className="ghost tiny-btn" onClick={() => void close(c.id)} disabled={busy}>
                  Got it
                </button>
              </div>
            )
          })}
        </section>
      )}

      {o.owe.length > 0 && (
        <section className="person-part">
          <span className="label-text">You owe them</span>
          {o.owe.map((c) => (
            <div className="your-day-line" key={c.id}>
              <span>
                {c.title}
                <span className="muted small"> · due {dayLabel(c.dueAt)}</span>
              </span>
              <button className="ghost tiny-btn" onClick={() => void close(c.id)} disabled={busy}>
                Done
              </button>
            </div>
          ))}
        </section>
      )}

      {o.pastMeetings.length > 0 && (
        <section className="person-part">
          <span className="label-text">Recent meetings</span>
          <ul className="plain person-followups">
            {o.pastMeetings.map((m) => (
              <li key={m.id}>
                {m.title} <span className="muted small">· {dayLabel(m.dueAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <label>
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Decision maker, budget, what they use today, branches…"
        />
      </label>
      {notes.trim() !== (o.notes ?? '').trim() && (
        <button className="ghost small-btn fit-btn" onClick={() => void saveNotes()} disabled={busy}>
          Save notes
        </button>
      )}

      {error && <p className="error small">{error}</p>}

      <div className="row person-actions">
        <button className="primary small-btn" onClick={() => openAdd({ share: true, shareWith: o.name })}>
          Share when I&rsquo;m free
        </button>
      </div>
    </div>
  )
}
