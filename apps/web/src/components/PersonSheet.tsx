import { useCallback, useEffect, useMemo, useState } from 'react'
import { KEEP_IN_TOUCH_CHOICES, shortName, type CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { openAdd } from '../lib/addSheet.ts'
import { dayLabel, formatDateTime, relativeDay } from '../lib/time.ts'
import { Modal } from './Modal.tsx'
import { CallLog } from './CallLog.tsx'
import type { PendingCall } from '../lib/calls.ts'
import { Nudge, waitingWhat } from './Nudge.tsx'
import { WaitingForm } from './WaitingForm.tsx'
import { dueChoices } from './WrapUp.tsx'

interface Contact {
  id: string
  name: string
  role: string | null
  organization: string | null
  keepInTouchDays: number | null
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
  keepInTouch: {
    cadenceDays: number
    lastTouch: string | null
    dueAt: string
    due: boolean
    snoozedUntil: string | null
  } | null
  colleagues: { id: string; name: string; role: string | null }[]
  calls: { at: string; outcome: string | null; notes: string | null; connected: boolean }[]
}

/** "Physiotherapist at Mehta Physio Clinic", or whichever half is known. */
export function personLine(c: {
  role: string | null
  organization?: string | null
  placeName?: string | null
}): string {
  const org = c.organization?.trim()
  const head = c.role && org ? `${c.role} at ${org}` : (c.role ?? org ?? '')
  const place = c.placeName && c.placeName.toLowerCase() !== org?.toLowerCase() ? c.placeName : null
  return [head || null, place].filter(Boolean).join(' · ')
}

/** A number as wa.me wants it: digits only, with India's code on a bare ten-digit mobile. */
export function waNumber(phone: string): string {
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
  onOpenPerson,
  onOpenAccount,
}: {
  contactId: string
  onEdit: () => void
  /** Something was closed or added, so the list behind should reload. */
  onChanged: () => void
  /** Open someone else's page — a colleague at the same place. */
  onOpenPerson?: (id: string) => void
  /** Open the clinic or company they work at. */
  onOpenAccount?: (name: string) => void
}) {
  const [contact, setContact] = useState<Contact | null>(null)
  const [o, setO] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nudging, setNudging] = useState<CommitmentDTO | null>(null)
  /** A call made outside Cue — from the phone's own dialler — being logged. */
  const [loggingCall, setLoggingCall] = useState<PendingCall | null>(null)
  const [adding, setAdding] = useState<'waiting' | 'owe' | null>(null)
  const [what, setWhat] = useState('')
  const [due, setDue] = useState('tomorrow')
  const [busy, setBusy] = useState(false)
  const choices = useMemo(() => dueChoices(), [])

  /** True when the person loaded but what is open with them could not. */
  const [partial, setPartial] = useState(false)

  const load = useCallback(async () => {
    try {
      setContact(await api<Contact>(`/contacts/${contactId}`))
    } catch (err) {
      setError((err as Error).message)
      return
    }
    // The person still opens if this part fails — their number and Edit
    // details matter more than the summary, and a half-deployed server or a
    // dropped request should not lock anyone out of a contact.
    try {
      setO(await api<Overview>(`/people/${contactId}/overview`))
      setPartial(false)
    } catch {
      setO({
        waitingOnThem: [],
        youOwe: [],
        nextMeetings: [],
        lastMeeting: null,
        lastMeetingFollowUps: [],
        meetingCount: 0,
        firstMet: null,
        keepInTouch: null,
        colleagues: [],
        calls: [],
      })
      setPartial(true)
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

  /** Starts, changes or stops keeping in touch, straight from the page. */
  async function setCadence(days: number | null) {
    setBusy(true)
    try {
      await api(`/contacts/${contactId}`, { method: 'PATCH', body: { keepInTouchDays: days } })
      onChanged()
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function touch(action: 'touched' | 'touch-later') {
    setBusy(true)
    try {
      await api(`/contacts/${contactId}/${action}`, { method: 'POST', body: action === 'touch-later' ? { days: 7 } : {} })
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

  // "Dr. Mehta", not "Dr.": how they are addressed, in "Waiting on …".
  const first = shortName(contact.name)
  const nothingOpen = !o.waitingOnThem.length && !o.youOwe.length && !o.nextMeetings.length

  return (
    <div className="stack tight person">
      <div className="person-head">
        <div>
          <h3 className="details-title">{contact.name}</h3>
          {personLine(contact) && <p className="muted small">{personLine(contact)}</p>}
          {contact.organization && onOpenAccount && (
            <button className="link small fit-btn" onClick={() => onOpenAccount(contact.organization!)}>
              Open {contact.organization} &rarr;
            </button>
          )}
        </div>
        <div className="row person-reach">
          {contact.phone && (
            <a className="ghost small-btn" href={`tel:${contact.phone}`} data-contact-id={contact.id} data-name={contact.name}>
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
          <button
            className="link small"
            onClick={() =>
              setLoggingCall({
                phone: contact.phone ?? '',
                contactId: contact.id,
                name: contact.name,
                commitmentId: null,
                commitmentTitle: null,
                startedAt: Date.now(),
              })
            }
          >
            Log a call
          </button>
          <button className="link small" onClick={onEdit}>
            Edit details
          </button>
        </div>
      </div>

      {partial && (
        <p className="muted small">
          Could not load what is open with {first} just now. Their details are here; try again
          in a moment for the rest.
        </p>
      )}

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

      {/* Unknown is not "Nothing": hidden when it could not be loaded. */}
      {!partial && (
        <>
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
        </>
      )}

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

      <section className="person-part">
        <span className="label-text">Keep in touch</span>
        <div className="chips">
          <button
            className={`chip${contact.keepInTouchDays === null ? ' selected' : ''}`}
            onClick={() => void setCadence(null)}
            disabled={busy}
          >
            Off
          </button>
          {KEEP_IN_TOUCH_CHOICES.map((k) => (
            <button
              key={k.days}
              className={`chip${contact.keepInTouchDays === k.days ? ' selected' : ''}`}
              onClick={() => void setCadence(k.days)}
              disabled={busy}
            >
              {k.label}
            </button>
          ))}
        </div>
        {o.keepInTouch && (
          <div className="your-day-line">
            <span className="small">
              {o.keepInTouch.lastTouch
                ? `Last contact ${relativeDay(o.keepInTouch.lastTouch)}`
                : 'No contact on record yet'}
              <span className={`small ${o.keepInTouch.due ? 'due-now' : 'muted'}`}>
                {' '}
                ·{' '}
                {o.keepInTouch.due
                  ? 'time to reach out'
                  : o.keepInTouch.snoozedUntil
                    ? `reminding you ${dayLabel(o.keepInTouch.snoozedUntil)}`
                    : `next due ${dayLabel(o.keepInTouch.dueAt)}`}
              </span>
            </span>
            <span className="row">
              <button className="ghost tiny-btn" onClick={() => void touch('touched')} disabled={busy}>
                Talked today
              </button>
              {o.keepInTouch.due && (
                <button className="ghost tiny-btn" onClick={() => void touch('touch-later')} disabled={busy}>
                  Next week
                </button>
              )}
            </span>
          </div>
        )}
      </section>

      {o.calls.length > 0 && (
        <section className="person-part">
          <span className="label-text">Recent calls</span>
          <ul className="plain person-followups">
            {o.calls.map((c) => (
              <li key={c.at} className={c.connected ? '' : 'muted'}>
                {relativeDay(c.at).replace(/^./, (ch) => ch.toUpperCase())} · {c.outcome ?? 'Call'}
                {c.notes ? <span className="muted"> — {c.notes}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.colleagues.length > 0 && contact.organization && (
        <section className="person-part">
          <span className="label-text">Also at {contact.organization}</span>
          <div className="chips">
            {o.colleagues.map((p) => (
              <button key={p.id} className="chip" onClick={() => onOpenPerson?.(p.id)}>
                {p.name}
                {p.role ? <span className="muted"> · {p.role}</span> : null}
              </button>
            ))}
          </div>
        </section>
      )}

      {o.meetingCount > 0 && (
        <p className="muted small">
          {o.meetingCount} meeting{o.meetingCount === 1 ? '' : 's'} in the last year
          {o.firstMet ? `, the first on ${dayLabel(o.firstMet)}` : ''}
          {contact.visitCount ? ` · ${contact.visitCount} visit${contact.visitCount === 1 ? '' : 's'} logged` : ''}.
        </p>
      )}
      {nothingOpen && !o.lastMeeting && !partial && (
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

      {loggingCall && (
        <Modal title="Log a call" onClose={() => setLoggingCall(null)}>
          <CallLog
            call={loggingCall}
            onDone={(saved) => {
              setLoggingCall(null)
              if (saved) {
                onChanged()
                void load()
              }
            }}
          />
        </Modal>
      )}

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
