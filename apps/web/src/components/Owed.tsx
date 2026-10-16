import { useEffect, useState, type FormEvent } from 'react'
import { formatRupees, owedMessage } from '@cue/shared'
import { api } from '../lib/api.ts'
import { openPerson } from '../lib/open.ts'
import { rich, t } from '../lib/i18n.tsx'
import { dayLabel, relativeDay } from '../lib/time.ts'
import { waNumber } from './PersonSheet.tsx'

export interface OwedItem {
  id: string
  amountPaise: number
  note: string | null
  expenseId: string | null
  on: string
  askedAt: string | null
  askCount: number
}

export interface OwedPerson {
  key: string
  contactId: string | null
  name: string
  phone: string | null
  organization: string | null
  totalPaise: number
  since: string
  lastAskedAt: string | null
  items: OwedItem[]
}

interface OwedSummary {
  people: OwedPerson[]
  totalPaise: number
  paidRecentlyPaise: number
}

/** The UPI ID put in reminders, read once and shared by every row. */
export function useUpiId(): [string | null, (v: string | null) => void] {
  const [upiId, setUpiId] = useState<string | null>(null)
  useEffect(() => {
    void api<{ upiId: string | null }>('/me/preferences')
      .then((p) => setUpiId(p.upiId))
      .catch(() => undefined)
  }, [])
  return [upiId, setUpiId]
}

/**
 * One person and what they owe: a reminder they can pay from in one tap, and
 * "Paid" when it arrives. Opened up, each thing they owe for on its own.
 */
export function OwedRow({
  person,
  upiId,
  onChanged,
  compact = false,
}: {
  person: OwedPerson
  upiId: string | null
  onChanged: () => void
  /** In a person's own sheet, where their name is already the heading. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remind() {
    const text = owedMessage({ name: person.name, lines: person.items, upiId })
    const to = person.phone ? waNumber(person.phone) : ''
    window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    try {
      await api('/owed/asked', { method: 'POST', body: { ids: person.items.map((i) => i.id) } })
      onChanged()
    } catch {
      // The message went; not remembering it is only a missed hint next time.
    }
  }

  async function settle(ids: string[]) {
    setBusy(true)
    setError(null)
    try {
      await api('/owed/status', { method: 'POST', body: { ids, status: 'paid' } })
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('Remove this? It will no longer be counted as owed.'))) return
    setBusy(true)
    try {
      await api(`/owed/${id}`, { method: 'DELETE' })
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const asked = person.lastAskedAt ? t('reminded {when}', { when: relativeDay(person.lastAskedAt) }) : null
  return (
    <div className={`owed-row${open ? ' is-open' : ''}`}>
      <button className="owed-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="owed-name">
          {compact ? t('{amount} owed to you', { amount: formatRupees(person.totalPaise) }) : person.name}
        </span>
        <span className="owed-sub">
          {[
            !compact && person.organization,
            t('since {day}', { day: dayLabel(person.since) }),
            person.items.length > 1 && t('{n} things', { n: person.items.length }),
            asked,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      {!compact && <strong className="owed-amount">{formatRupees(person.totalPaise)}</strong>}
      <div className="owed-actions">
        {person.contactId && !compact && (
          <button className="ghost tiny-btn" onClick={() => openPerson(person.contactId!)}>
            {t('Their page')}
          </button>
        )}
        <button className="ghost tiny-btn" onClick={() => void remind()} disabled={busy}>
          {person.phone ? t('Remind') : t('Remind…')}
        </button>
        <button className="ghost tiny-btn" onClick={() => void settle(person.items.map((i) => i.id))} disabled={busy}>
          {t('Paid')}
        </button>
      </div>
      {open && (
        <ul className="owed-items">
          {person.items.map((i) => (
            <li key={i.id}>
              <span>
                {dayLabel(i.on)} · {i.note ?? (i.expenseId ? t('Their share') : t('Lent'))}
              </span>
              <span className="owed-item-side">
                <strong>{formatRupees(i.amountPaise)}</strong>
                {person.items.length > 1 && (
                  <button className="link small" onClick={() => void settle([i.id])} disabled={busy}>
                    {t('Paid')}
                  </button>
                )}
                <button className="link small danger-text" onClick={() => void remove(i.id)} disabled={busy}>
                  {t('Remove')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

/**
 * Money people owe you: their part of something you paid for, or money lent.
 * Each with a reminder ready to send, and where to send the money.
 */
export function OwedCard({
  people: contacts,
  highlight = false,
  reloadKey = 0,
  onChanged,
}: {
  /** For the name box: saved people, so a share is linked to the right one. */
  people: { id: string; name: string }[]
  highlight?: boolean
  /** Bumped by the page when an expense's shares change. */
  reloadKey?: number
  onChanged?: () => void
}) {
  const [data, setData] = useState<OwedSummary | null>(null)
  const [upiId, setUpiId] = useUpiId()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [editingUpi, setEditingUpi] = useState(false)
  const [upiDraft, setUpiDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    void api<OwedSummary>('/owed')
      .then(setData)
      .catch((err) => setError((err as Error).message))
  useEffect(load, [reloadKey])

  const changed = () => {
    load()
    onChanged?.()
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const paise = rupeesToPaise(amount)
    if (!name.trim() || !paise) {
      setError(t('Who, and how much?'))
      return
    }
    const match = contacts.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())
    setBusy(true)
    setError(null)
    try {
      await api('/owed', {
        method: 'POST',
        body: { contactId: match?.id ?? null, personName: name.trim(), amountPaise: paise, note: note.trim() || null },
      })
      setName('')
      setAmount('')
      setNote('')
      setAdding(false)
      changed()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveUpi() {
    setError(null)
    try {
      const p = await api<{ upiId: string | null }>('/me/preferences', { method: 'PATCH', body: { upiId: upiDraft } })
      setUpiId(p.upiId)
      setEditingUpi(false)
    } catch (err) {
      setError((err as Error).message.includes('UPI') ? (err as Error).message : t('A UPI ID looks like name@okaxis.'))
    }
  }

  const people = data?.people ?? []
  return (
    <section className={`card owed-card${highlight ? ' is-highlit' : ''}`} id="owed">
      <div className="row owed-head">
        <h2 className="section-title">{t('Owed to you')}</h2>
        {data && data.totalPaise > 0 && <strong>{formatRupees(data.totalPaise)}</strong>}
      </div>

      {data && people.length === 0 && !adding && (
        <p className="muted small">
          {t(
            'Nobody owes you anything. Split an expense with someone, or note money you lent, and it waits here until they pay you back.',
          )}
          {data.paidRecentlyPaise > 0 &&
            ` ${t('{amount} paid back this month.', { amount: formatRupees(data.paidRecentlyPaise) })}`}
        </p>
      )}

      {people.length > 0 && (
        <div className="owed-list">
          {people.map((p) => (
            <OwedRow key={p.key} person={p} upiId={upiId} onChanged={changed} />
          ))}
        </div>
      )}

      {adding ? (
        <form className="stack tight" onSubmit={(e) => void add(e)}>
          <div className="row owed-add-row">
            <input
              className="grow"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Who? e.g. Ravi')}
              aria-label={t('Who owes you')}
              list="owed-people"
              autoFocus
            />
            <label className="amount-field small-amount">
              <span aria-hidden>₹</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                aria-label={t('How much')}
              />
            </label>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('What for? (optional)')}
            aria-label={t('What for')}
            maxLength={300}
          />
          <div className="row">
            <button className="primary small-btn" type="submit" disabled={busy}>
              {t('Save')}
            </button>
            <button className="ghost small-btn" type="button" onClick={() => setAdding(false)}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button className="link small fit-btn" onClick={() => setAdding(true)}>
          {t('+ Someone owes you')}
        </button>
      )}
      <datalist id="owed-people">
        {contacts.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>

      {/* Where the money goes: in every reminder, so paying back is one tap. */}
      {editingUpi ? (
        <div className="row owed-add-row">
          <input
            className="grow"
            value={upiDraft}
            onChange={(e) => setUpiDraft(e.target.value)}
            placeholder="yourname@okaxis"
            aria-label={t('Your UPI ID')}
            autoFocus
          />
          <button className="primary small-btn" onClick={() => void saveUpi()}>
            {t('Save')}
          </button>
          <button className="ghost small-btn" onClick={() => setEditingUpi(false)}>
            {t('Cancel')}
          </button>
        </div>
      ) : (
        (people.length > 0 || upiId) && (
          <p className="muted small">
            {upiId ? (
              <>
                {rich('Reminders include your UPI ID, {upi}.', { upi: <strong>{upiId}</strong> })}{' '}
              </>
            ) : (
              `${t('Add your UPI ID and reminders say where to send it.')} `
            )}
            <button
              className="link small"
              onClick={() => {
                setUpiDraft(upiId ?? '')
                setEditingUpi(true)
              }}
            >
              {upiId ? t('Change') : t('Add UPI ID')}
            </button>
          </p>
        )
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  )
}

/** "450", "1,250.50", "₹ 300" → paise; null for anything else. */
export function rupeesToPaise(text: string): number | null {
  const s = text.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const paise = Math.round(Number(s) * 100)
  return paise > 0 && paise <= 1_000_000_000 ? paise : null
}
