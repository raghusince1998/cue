import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  KEEP_IN_TOUCH_CHOICES,
  OCCASION_MESSAGES,
  daysUntil,
  monthDayLabel,
  nextMonthDay,
  shortName,
  type CommitmentDTO,
  type OccasionKind,
} from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { openAdd } from '../lib/addSheet.ts'
import { dayLabel, formatDateTime, relativeDay } from '../lib/time.ts'
import { locale, t } from '../lib/i18n.tsx'
import { readNotes } from '../lib/sample.ts'
import { Modal } from './Modal.tsx'
import { CallLog } from './CallLog.tsx'
import { QuickMessage } from './QuickMessage.tsx'
import type { PendingCall } from '../lib/calls.ts'
import { Nudge, waitingWhat } from './Nudge.tsx'
import { WaitingForm } from './WaitingForm.tsx'
import { dueChoices } from './WrapUp.tsx'
import { OwedRow, useUpiId, type OwedPerson } from './Owed.tsx'

interface Contact {
  id: string
  name: string
  role: string | null
  organization: string | null
  keepInTouchDays: number | null
  birthday?: string | null
  anniversary?: string | null
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
  /** Money they owe you, if any. */
  owesYou: OwedPerson | null
}

/** "Physiotherapist at Mehta Physio Clinic", or whichever half is known. */
export function personLine(c: {
  role: string | null
  organization?: string | null
  placeName?: string | null
}): string {
  const org = c.organization?.trim()
  const head = c.role && org ? t('{role} at {org}', { role: c.role, org }) : (c.role ?? org ?? '')
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
  const [messaging, setMessaging] = useState(false)
  /** Wishes for an occasion: the message starts as "Happy birthday". */
  const [wishing, setWishing] = useState<OccasionKind | null>(null)
  const [adding, setAdding] = useState<'waiting' | 'owe' | null>(null)
  const [what, setWhat] = useState('')
  const [due, setDue] = useState('tomorrow')
  const [busy, setBusy] = useState(false)
  const choices = useMemo(() => dueChoices(), [])
  const [upiId] = useUpiId()

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
        owesYou: null,
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
  if (!contact || !o) return <p className="muted small">{t('Gathering everything with them…')}</p>

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
              {t('Open {org} →', { org: contact.organization })}
            </button>
          )}
        </div>
        <div className="row person-reach">
          {contact.phone && (
            <a className="ghost small-btn" href={`tel:${contact.phone}`} data-contact-id={contact.id} data-name={contact.name}>
              {t('Call')}
            </a>
          )}
          {contact.phone && (
            <a className="ghost small-btn" href={`https://wa.me/${waNumber(contact.phone)}`} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          )}
          {contact.email && (
            <a className="ghost small-btn" href={`mailto:${contact.email}`}>
              {t('Email')}
            </a>
          )}
          <button className="ghost small-btn" onClick={() => setMessaging(true)}>
            {t('Message')}
          </button>
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
            {t('Log a call')}
          </button>
          <button className="link small" onClick={onEdit}>
            {t('Edit details')}
          </button>
        </div>
      </div>

      {partial && (
        <p className="muted small">
          {t(
            'Could not load what is open with {name} just now. Their details are here; try again in a moment for the rest.',
            { name: first },
          )}
        </p>
      )}

      {o.nextMeetings.length > 0 && (
        <section className="person-part">
          <span className="label-text">{t('Next meeting')}</span>
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
        <span className="label-text">{t('Waiting on {name}', { name: first })}</span>
        {o.waitingOnThem.length === 0 ? (
          <p className="muted small">{t('Nothing.')}</p>
        ) : (
          o.waitingOnThem.map((c) => {
            const isDue = new Date(c.dueAt).getTime() <= Date.now()
            return (
              <div className="your-day-line" key={c.id}>
                <span>
                  {waitingWhat(c)}
                  <span className={`small ${isDue ? 'due-now' : 'muted'}`}>
                    {' '}
                    · {isDue ? t('check in now') : t('check in {day}', { day: dayLabel(c.dueAt) })}
                  </span>
                </span>
                <span className="row">
                  <button className="ghost tiny-btn" onClick={() => setNudging(c)}>
                    {t('Nudge')}
                  </button>
                  <button className="ghost tiny-btn" onClick={() => void close(c.id)} disabled={busy}>
                    {t('Got it')}
                  </button>
                </span>
              </div>
            )
          })
        )}
      </section>

      <section className="person-part">
        <span className="label-text">{t('You owe {name}', { name: first })}</span>
        {o.youOwe.length === 0 ? (
          <p className="muted small">{t('Nothing.')}</p>
        ) : (
          o.youOwe.map((c) => (
            <div className="your-day-line" key={c.id}>
              <span>
                {c.title}
                <span className="muted small"> · {t('due {day}', { day: dayLabel(c.dueAt) })}</span>
              </span>
              <button className="ghost tiny-btn" onClick={() => void close(c.id)} disabled={busy}>
                {t('Done')}
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
            {t('Last met · {title} · {day}', { title: o.lastMeeting.title, day: dayLabel(o.lastMeeting.dueAt) })}
          </span>
          {o.lastMeetingFollowUps.length === 0 ? (
            <p className="muted small">{t('No follow-ups were noted from it.')}</p>
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
        <span className="label-text">{t('Keep in touch')}</span>
        <div className="chips">
          <button
            className={`chip${contact.keepInTouchDays === null ? ' selected' : ''}`}
            onClick={() => void setCadence(null)}
            disabled={busy}
          >
            {t('Off')}
          </button>
          {KEEP_IN_TOUCH_CHOICES.map((k) => (
            <button
              key={k.days}
              className={`chip${contact.keepInTouchDays === k.days ? ' selected' : ''}`}
              onClick={() => void setCadence(k.days)}
              disabled={busy}
            >
              {t(k.label)}
            </button>
          ))}
        </div>
        {o.keepInTouch && (
          <div className="your-day-line">
            <span className="small">
              {o.keepInTouch.lastTouch
                ? t('Last contact {when}', { when: relativeDay(o.keepInTouch.lastTouch) })
                : t('No contact on record yet')}
              <span className={`small ${o.keepInTouch.due ? 'due-now' : 'muted'}`}>
                {' '}
                ·{' '}
                {o.keepInTouch.due
                  ? t('time to reach out')
                  : o.keepInTouch.snoozedUntil
                    ? t('reminding you {day}', { day: dayLabel(o.keepInTouch.snoozedUntil) })
                    : t('next due {day}', { day: dayLabel(o.keepInTouch.dueAt) })}
              </span>
            </span>
            <span className="row">
              <button className="ghost tiny-btn" onClick={() => void touch('touched')} disabled={busy}>
                {t('Talked today')}
              </button>
              {o.keepInTouch.due && (
                <button className="ghost tiny-btn" onClick={() => void touch('touch-later')} disabled={busy}>
                  {t('Next week')}
                </button>
              )}
            </span>
          </div>
        )}
      </section>

      {(contact.birthday || contact.anniversary) && (
        <section className="person-part">
          {(['birthday', 'anniversary'] as const)
            .filter((k) => contact[k])
            .map((k) => {
              const next = nextMonthDay(contact[k]!)
              const away = next ? daysUntil(next) : null
              return (
                <div className="your-day-line" key={k}>
                  <span className="small">
                    {k === 'birthday' ? t('Birthday') : t('Anniversary')} · {monthDayLabel(contact[k]!, locale())}
                    <span className={`small ${away === 0 ? 'due-now' : 'muted'}`}>
                      {' '}
                      · {away === 0 ? t('today') : away === 1 ? t('tomorrow') : t('in {n} days', { n: String(away) })}
                    </span>
                  </span>
                  {away !== null && away <= 1 && (
                    <button className="ghost tiny-btn" onClick={() => setWishing(k)}>
                      {t('Send wishes')}
                    </button>
                  )}
                </div>
              )
            })}
        </section>
      )}

      {o.owesYou && (
        <section className="person-part">
          <span className="label-text">{t('Money {name} owes you', { name: first })}</span>
          <OwedRow person={o.owesYou} upiId={upiId} onChanged={() => void load()} compact />
        </section>
      )}

      {o.calls.length > 0 && (
        <section className="person-part">
          <span className="label-text">{t('Recent calls')}</span>
          <ul className="plain person-followups">
            {o.calls.map((c) => (
              <li key={c.at} className={c.connected ? '' : 'muted'}>
                {/* The outcome is saved as its English label: shown in the reader's language. */}
                {relativeDay(c.at).replace(/^./, (ch) => ch.toUpperCase())} · {c.outcome ? t(c.outcome) : t('Called')}
                {readNotes(c.notes).notes ? <span className="muted"> — {readNotes(c.notes).notes}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.colleagues.length > 0 && contact.organization && (
        <section className="person-part">
          <span className="label-text">{t('Also at {org}', { org: contact.organization })}</span>
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
          {t('{text}.', {
            text:
              (o.meetingCount === 1
                ? t('1 meeting in the last year')
                : t('{n} meetings in the last year', { n: o.meetingCount })) +
              (o.firstMet ? `, ${t('the first on {day}', { day: dayLabel(o.firstMet) })}` : '') +
              (contact.visitCount
                ? ` · ${contact.visitCount === 1 ? t('1 visit logged') : t('{n} visits logged', { n: contact.visitCount })}`
                : ''),
          })}
        </p>
      )}
      {nothingOpen && !o.lastMeeting && !partial && (
        <p className="muted small">
          {t('Nothing open with {name} yet. Add something below, or offer a time to meet.', { name: first })}
        </p>
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
          <input
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder={t('What do you owe {name}?', { name: first })}
            autoFocus
          />
          <div className="wrapup-due">
            <span className="muted small">{t('Due')}</span>
            {choices.map((c) => (
              <button key={c.key} className={`chip${due === c.key ? ' selected' : ''}`} onClick={() => setDue(c.key)}>
                {t(c.label)}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="primary small-btn" onClick={() => void addOwe()} disabled={busy || !what.trim()}>
              {t('Add')}
            </button>
            <button className="ghost small-btn" onClick={() => setAdding(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="row person-actions">
        <button className="ghost small-btn" onClick={() => setAdding('waiting')}>
          {t('+ Waiting on {name}', { name: first })}
        </button>
        <button className="ghost small-btn" onClick={() => setAdding('owe')}>
          {t('+ To do for {name}', { name: first })}
        </button>
        <button className="primary small-btn" onClick={() => openAdd({ share: true, shareWith: contact.name })}>
          {t('Share when I’m free')}
        </button>
      </div>

      {wishing && (
        <Modal title={t('Wish {name}', { name: first })} onClose={() => setWishing(null)}>
          <QuickMessage
            to={{ name: contact.name, company: contact.organization, phone: contact.phone, email: contact.email }}
            preset={{
              title: wishing === 'birthday' ? t('Birthday wishes') : t('Anniversary wishes'),
              body: t(OCCASION_MESSAGES[wishing]),
            }}
            onDone={() => setWishing(null)}
          />
        </Modal>
      )}

      {messaging && (
        <Modal title={t('Message {name}', { name: first })} onClose={() => setMessaging(false)}>
          <QuickMessage
            to={{ name: contact.name, company: contact.organization, phone: contact.phone, email: contact.email }}
            onDone={() => setMessaging(false)}
          />
        </Modal>
      )}

      {loggingCall && (
        <Modal title={t('Log a call')} onClose={() => setLoggingCall(null)}>
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
        <Modal title={t('Nudge')} onClose={() => setNudging(null)}>
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
