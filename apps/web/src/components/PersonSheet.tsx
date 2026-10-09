import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { openAdd } from '../lib/addSheet.ts'
import { dayLabel, formatDateTime, relativeDay } from '../lib/time.ts'
import { Modal } from './Modal.tsx'
import { Nudge, waitingWhat } from './Nudge.tsx'
import { WaitingForm } from './WaitingForm.tsx'
import { dueChoices } from './WrapUp.tsx'

interface Contact {
  id: string
  name: string
  role: string | null
  phone: string | null
  email: string | null
  placeName: string | null
  visitCount?: number
}

interface Overview {
  waitingOnThem: CommitmentDTO[]
  youOwe: CommitmentDTO[]
  nextMeetings: CommitmentDTO[]
  lastMeeting: CommitmentDTO | null
  lastMeetingFollowUps: CommitmentDTO[]
  meetingCount: number
  firstMet: string | null
}

function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '')
  return digits.length === 10 ? `91${digits}` : digits
}

/**
 * One person, and everything between you.
 *
 * What they owe you, what you owe them, when you next meet and what came out
 * of the last time — the page to open before a call with them, rather than
 * piecing it together from Today, Waiting and the calendar.
 */
export function PersonSheet({
  contactId,
  onEdit,
  onChanged,
}: {
  contactId: string
  onEdit: () => void
  /** Something was closed or added, so the list behind should reload. */
  onChanged: () => void
}) {
  const [contact, setContact] = useState<Contact | null>(null)
  const [o, setO] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nudging, setNudging] = useState<CommitmentDTO | null>(null)
  const [adding, setAdding] = useState<'waiting' | 'owe' | null>(null)
  const [what, setWhat] = useState('')
  const [due, setDue] = useState('tomorrow')
  const [busy, setBusy] = useState(false)
  const choices = useMemo(() => dueChoices(), [])

  const load = useCallback(async () => {
    try {
      const [c, ov] = await Promise.all([
        api<Contact>(`/contacts/${contactId}`),
        api<Overview>(`/people/${contactId}/overview`),
      ])
      setContact(c)
      setO(ov)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [contactId])

  useEffect(() => {
    void load()
  }, [load])

  async function close(id: string) {
    setBusy(true)
    try {
      await api(`/commitments/${id}/done`, { method: 'POST' })
      announceChange()
      onChanged()
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function addOwe() {
    const at = choices.find((c) => c.key === due)?.at
    if (!at || !what.trim()) return
    setBusy(true)
    try {
      await api('/commitments', {
        method: 'POST',
        body: { title: what.trim(), kind: 'task', dueAt: at.toISOString(), contactId, allowConflict: true },
      })
      announceChange()
      onChanged()
      setWhat('')
      setAdding(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="error small">{error}</p>
  if (!contact || !o) return <p className="muted small">Gathering everything with them…</p>

  const first = contact.name.trim().split(/\s+/)[0]!
  const nothingOpen = !o.waitingOnThem.length && !o.youOwe.length && !o.nextMeetings.length

  return (
    <div className="stack tight person">
      <div className="person-head">
        <div>
          <h3 className="details-title">{contact.name}</h3>
          {(contact.role || contact.placeName) && (
            <p className="muted small">{[contact.role, contact.placeName].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="row person-reach">
          {contact.phone && (
            <a className="ghost small-btn" href={`tel:${contact.phone}`}>
              Call
            </a>
          )}
          {contact.phone && (
            <a className="ghost small-btn" href={`https://wa.me/${waNumber(contact.phone)}`} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          )}
          {contact.email && (
            <a className="ghost small-btn" href={`mailto:${contact.email}`}>
              Email
            </a>
          )}
          <button className="link small" onClick={onEdit}>
            Edit details
          </button>
        </div>
      </div>

      {o.nextMeetings.length > 0 && (
        <section className="person-part">
          <span className="label-text">Next meeting</span>
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

      <section className="person-part">
        <span className="label-text">Waiting on {first}</span>
        {o.waitingOnThem.length === 0 ? (
          <p className="muted small">Nothing.</p>
        ) : (
          o.waitingOnThem.map((c) => {
            const isDue = new Date(c.dueAt).getTime() <= Date.now()
            return (
              <div className="your-day-line" key={c.id}>
                <span>
                  {waitingWhat(c)}
                  <span className={`small ${isDue ? 'due-now' : 'muted'}`}>
                    {' '}
                    · {isDue ? 'check in now' : `check in ${dayLabel(c.dueAt)}`}
                  </span>
                </span>
                <span className="row">
                  <button className="ghost tiny-btn" onClick={() => setNudging(c)}>
                    Nudge
                  </button>
                  <button className="ghost tiny-btn" onClick={() => void close(c.id)} disabled={busy}>
                    Got it
                  </button>
                </span>
              </div>
            )
          })
        )}
      </section>

      <section className="person-part">
        <span className="label-text">You owe {first}</span>
        {o.youOwe.length === 0 ? (
          <p className="muted small">Nothing.</p>
        ) : (
          o.youOwe.map((c) => (
            <div className="your-day-line" key={c.id}>
              <span>
                {c.title}
                <span className="muted small"> · due {dayLabel(c.dueAt)}</span>
              </span>
              <button className="ghost tiny-btn" onClick={() => void close(c.id)} disabled={busy}>
                Done
              </button>
            </div>
          ))
        )}
      </section>

      {o.lastMeeting && (
        <section className="person-part">
          <span className="label-text">
            Last met · {o.lastMeeting.title} · {dayLabel(o.lastMeeting.dueAt)}
          </span>
          {o.lastMeetingFollowUps.length === 0 ? (
            <p className="muted small">No follow-ups were noted from it.</p>
          ) : (
            <ul className="plain person-followups">
              {o.lastMeetingFollowUps.map((f) => (
                <li key={f.id} className={f.status === 'done' ? 'is-done' : ''}>
                  {f.status === 'done' ? '✓ ' : '○ '}
                  {f.waitingOn ? `${f.waitingOn}: ${waitingWhat(f)}` : f.title}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {o.meetingCount > 0 && (
        <p className="muted small">
          {o.meetingCount} meeting{o.meetingCount === 1 ? '' : 's'} in the last year
          {o.firstMet ? `, the first on ${dayLabel(o.firstMet)}` : ''}
          {contact.visitCount ? ` · ${contact.visitCount} visit${contact.visitCount === 1 ? '' : 's'} logged` : ''}.
        </p>
      )}
      {nothingOpen && !o.lastMeeting && (
        <p className="muted small">Nothing open with {first} yet. Add something below, or offer a time to meet.</p>
      )}

      {adding === 'waiting' && (
        <WaitingForm
          initialWho={contact.name}
          onDone={() => {
            setAdding(null)
            onChanged()
            void load()
          }}
        />
      )}
      {adding === 'owe' && (
        <div className="card waiting-form">
          <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder={`What do you owe ${first}?`} autoFocus />
          <div className="wrapup-due">
            <span className="muted small">Due</span>
            {choices.map((c) => (
              <button key={c.key} className={`chip${due === c.key ? ' selected' : ''}`} onClick={() => setDue(c.key)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="primary small-btn" onClick={() => void addOwe()} disabled={busy || !what.trim()}>
              Add
            </button>
            <button className="ghost small-btn" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="row person-actions">
        <button className="ghost small-btn" onClick={() => setAdding('waiting')}>
          + Waiting on {first}
        </button>
        <button className="ghost small-btn" onClick={() => setAdding('owe')}>
          + To do for {first}
        </button>
        <button className="primary small-btn" onClick={() => openAdd({ share: true, shareWith: contact.name })}>
          Share when I&rsquo;m free
        </button>
      </div>

      {nudging && (
        <Modal title="Nudge" onClose={() => setNudging(null)}>
          <Nudge
            item={nudging}
            onDone={() => {
              setNudging(null)
              onChanged()
              void load()
            }}
          />
        </Modal>
      )}
    </div>
  )
}
