import { stripWaitingOn } from '@cue/shared'
import { useEffect, useMemo, useState } from 'react'
import type { CommitmentDTO, ContactDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { loadContacts } from '../lib/cache.ts'
import { dueChoices } from './WrapUp.tsx'
import { t } from '../lib/i18n.tsx'
import { errorText } from '../lib/errors.ts'

/** "Waiting on Ravi: signed contract" → "signed contract". */
export function waitingWhat(c: CommitmentDTO): string {
  return stripWaitingOn(c.title)
}

/**
 * The person in People this is waiting on, when it is clear which one.
 *
 * The full name first; then a first name, but only when exactly one contact
 * has it — messaging the wrong Ravi is worse than asking which one.
 */
function matchContact(name: string, contacts: ContactDTO[]): ContactDTO | null {
  const wanted = name.trim().toLowerCase()
  const exact = contacts.filter((c) => c.name.trim().toLowerCase() === wanted)
  if (exact.length === 1) return exact[0]!
  const byFirst = contacts.filter((c) => c.name.trim().toLowerCase().split(/\s+/)[0] === wanted)
  return byFirst.length === 1 ? byFirst[0]! : null
}

/** A number WhatsApp can open: digits only, with India's code on a bare ten-digit mobile. */
function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '')
  return digits.length === 10 ? `91${digits}` : digits
}

/**
 * Chasing something someone owes you, in one tap.
 *
 * The message is written for you — short, polite, about the one thing — and
 * goes out on WhatsApp or email, to their number or address when People
 * knows it. Then the only question left is when to check again.
 */
export function Nudge({ item, onDone }: { item: CommitmentDTO; onDone: () => void }) {
  const person = item.waitingOn ?? t('them')
  const what = waitingWhat(item)
  const first = person.split(/\s+/)[0] ?? ''
  const [contacts, setContacts] = useState<ContactDTO[]>([])
  const [message, setMessage] = useState(() =>
    t('Hi {name}, just checking in on "{what}" — any update?', { name: first, what }),
  )
  const [sent, setSent] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const choices = useMemo(() => dueChoices(), [])

  useEffect(() => {
    void loadContacts().then((r) => setContacts(r.contacts))
  }, [])

  const contact = matchContact(person, contacts)
  const text = encodeURIComponent(message)
  const whatsapp = contact?.phone
    ? `https://wa.me/${waNumber(contact.phone)}?text=${text}`
    : `https://wa.me/?text=${text}`
  const email = `mailto:${contact?.email ?? ''}?subject=${encodeURIComponent(what)}&body=${text}`

  function open(url: string) {
    window.open(url, '_blank', 'noopener')
    setSent(true)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setSent(true)
    } catch {
      setError(t('Could not copy — select the message and copy it yourself.'))
    }
  }

  async function share() {
    try {
      await navigator.share({ text: message })
      setSent(true)
    } catch {
      // Dismissed the share sheet: nothing was sent, nothing to say.
    }
  }

  /** Check again later: the check-in moves, and its reminder with it. */
  async function checkAgain(at: Date) {
    setBusy(true)
    setError(null)
    try {
      await api(`/commitments/${item.id}/reschedule`, {
        method: 'POST',
        body: { dueAt: at.toISOString(), allowConflict: true },
      })
      announceChange()
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  async function gotIt() {
    setBusy(true)
    try {
      await api(`/commitments/${item.id}/done`, { method: 'POST' })
      announceChange()
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const later = choices.filter((c) => c.key !== 'today')

  return (
    <div className="stack tight nudge">
      <div className="wrapup-meeting">
        <strong>
          {person}: {what}
        </strong>
        <span className="muted small">
          {contact
            ? `${contact.name}${contact.phone ? ` · ${contact.phone}` : ''}${contact.email ? ` · ${contact.email}` : ''}`
            : t('Not in People — WhatsApp will ask who to send it to.')}
          {item.fromTitle ? ` · ${t('from "{title}"', { title: item.fromTitle })}` : ''}
        </span>
      </div>

      <label>
        {t('Message')}
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
      </label>

      <div className="row nudge-send">
        <button className="primary small-btn" onClick={() => open(whatsapp)}>
          WhatsApp
        </button>
        <button className="ghost small-btn" onClick={() => open(email)}>
          {t('Email')}
        </button>
        <button className="ghost small-btn" onClick={() => void copy()}>
          {copied ? t('Copied') : t('Copy')}
        </button>
        {typeof navigator.share === 'function' && (
          <button className="ghost small-btn" onClick={() => void share()}>
            {t('Share…')}
          </button>
        )}
      </div>

      <span className="label-text">{sent ? t('Sent. Check again…') : t('Or just check again…')}</span>
      <div className="chips">
        {later.map((c) => (
          <button key={c.key} className="chip" disabled={busy} onClick={() => void checkAgain(c.at)}>
            {t(c.label)}
          </button>
        ))}
      </div>

      {error && <p className="error small">{error}</p>}

      <div className="form-actions">
        <button className="ghost" onClick={() => void gotIt()} disabled={busy}>
          {t('Got it — they sent it')}
        </button>
      </div>
    </div>
  )
}
