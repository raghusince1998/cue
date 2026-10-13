import { useCallback, useEffect, useState } from 'react'
import { ACCOUNT_STAGES, ACCOUNT_STAGE_LABELS, hasClients, type AccountStage, type CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { announceChange } from '../lib/changes.ts'
import { t } from '../lib/i18n.tsx'
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
  const { me } = useAuth()
  /** Prospect to customer: for sales and clients, not a job hunt or a team. */
  const clients = hasClients(me?.uses ?? [])
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
  if (!o) return <p className="muted small">{t('Gathering everything with them…')}</p>

  const count = o.people.length
  // "3 weeks ago" less the "ago", in either language.
  const quietFor = o.lastContact ? relativeDay(o.lastContact).replace(/ ago$| पहले$/, '') : null
  const quietLine =
    o.stage === 'proposal'
      ? quietFor
        ? t('No contact for {span}, with a proposal out. Worth a call before it goes cold.', { span: quietFor })
        : t('No contact on record, with a proposal out. Worth a call before it goes cold.')
      : quietFor
        ? t('No contact for {span}, while in talks. Worth a call before it goes cold.', { span: quietFor })
        : t('No contact on record, while in talks. Worth a call before it goes cold.')

  return (
    <div className="stack tight person account">
      <div className="person-head">
        <div>
          {renaming ? (
            <div className="row inline-field-row">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label={t('Name')} autoFocus />
              <button className="primary small-btn" onClick={() => void rename()} disabled={busy || !newName.trim()}>
                {t('Save')}
              </button>
              <button className="ghost small-btn" onClick={() => setRenaming(false)}>
                {t('Cancel')}
              </button>
            </div>
          ) : (
            <h3 className="details-title">{o.name}</h3>
          )}
          <p className="muted small">
            {count === 0 ? t('Nobody saved here yet') : count === 1 ? t('1 person') : t('{n} people', { n: count })}
            {' · '}
            {o.lastContact ? t('last contact {when}', { when: relativeDay(o.lastContact) }) : t('no contact on record')}
          </p>
        </div>
        {!renaming && (
          <button className="link small" onClick={() => setRenaming(true)}>
            {t('Rename')}
          </button>
        )}
      </div>
      {renaming && (
        <p className="muted small">{t('Renames it on everyone who works here too. An existing name merges the two.')}</p>
      )}

      {/* Already given a stage, it stays in view. */}
      {(clients || o.stage) && (
        <section className="person-part">
          <span className="label-text">{t('Stage')}</span>
          <div className="chips">
            <button className={`chip${o.stage === null ? ' selected' : ''}`} onClick={() => void setStage(null)} disabled={busy}>
              {t('None')}
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
              {t('{stage} since {day}.', { stage: ACCOUNT_STAGE_LABELS[o.stage], day: dayLabel(o.stageChangedAt) })}
            </p>
          )}
          {o.quiet && (
            <p className="small due-now">{quietLine}</p>
          )}
        </section>
      )}

      <section className="person-part">
        <span className="label-text">{t('People there')}</span>
        {o.people.length === 0 && <p className="muted small">{t('Nobody yet.')}</p>}
        {o.people.map((p) => (
          <div className="your-day-line" key={p.id}>
            <span>
              <button className="link" onClick={() => onOpenPerson(p.id)}>
                {p.name}
              </button>
              {p.role && <span className="muted small"> · {p.role}</span>}
              {p.reachOut && <span className="small due-now"> · {t('time to reach out')}</span>}
            </span>
            {p.phone && (
              <a className="ghost tiny-btn link-btn" href={`tel:${p.phone}`} data-contact-id={p.id} data-name={p.name}>
                {t('Call')}
              </a>
            )}
          </div>
        ))}
        <button className="link small fit-btn" onClick={() => onAddPerson(o.name)}>
          {t('+ Add someone who works here')}
        </button>
      </section>

      {o.nextMeetings.length > 0 && (
        <section className="person-part">
          <span className="label-text">{t('Coming up')}</span>
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
          <span className="label-text">{t('Waiting on them')}</span>
          {o.waiting.map((c) => {
            const isDue = new Date(c.dueAt).getTime() <= Date.now()
            return (
              <div className="your-day-line" key={c.id}>
                <span>
                  {c.waitingOn ? `${c.waitingOn}: ` : ''}
                  {waitingWhat(c)}
                  <span className={`small ${isDue ? 'due-now' : 'muted'}`}>
                    {' '}
                    · {isDue ? t('check in now') : t('check in {day}', { day: dayLabel(c.dueAt) })}
                  </span>
                </span>
                <button className="ghost tiny-btn" onClick={() => void close(c.id)} disabled={busy}>
                  {t('Got it')}
                </button>
              </div>
            )
          })}
        </section>
      )}

      {o.owe.length > 0 && (
        <section className="person-part">
          <span className="label-text">{t('You owe them')}</span>
          {o.owe.map((c) => (
            <div className="your-day-line" key={c.id}>
              <span>
                {c.title}
                <span className="muted small"> · {t('due {day}', { day: dayLabel(c.dueAt) })}</span>
              </span>
              <button className="ghost tiny-btn" onClick={() => void close(c.id)} disabled={busy}>
                {t('Done')}
              </button>
            </div>
          ))}
        </section>
      )}

      {o.pastMeetings.length > 0 && (
        <section className="person-part">
          <span className="label-text">{t('Recent meetings')}</span>
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
        {t('Notes')}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={t('Decision maker, budget, what they use today, branches…')}
        />
      </label>
      {notes.trim() !== (o.notes ?? '').trim() && (
        <button className="ghost small-btn fit-btn" onClick={() => void saveNotes()} disabled={busy}>
          {t('Save notes')}
        </button>
      )}

      {error && <p className="error small">{error}</p>}

      <div className="row person-actions">
        <button className="primary small-btn" onClick={() => openAdd({ share: true, shareWith: o.name })}>
          {t('Share when I’m free')}
        </button>
      </div>
    </div>
  )
}
