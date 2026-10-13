import { useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { locale, msg, t } from '../lib/i18n.tsx'

type Range = 'soon' | 'week' | 'next'
type Part = 'any' | 'morning' | 'afternoon'

const LENGTHS = [15, 30, 45, 60, 90, 120]
/** Labels are shown with t(). */
const RANGES: { value: Range; label: string }[] = [
  { value: 'soon', label: msg('Next 3 days') },
  { value: 'week', label: msg('This week') },
  { value: 'next', label: msg('Next week') },
]
const PARTS: { value: Part; label: string }[] = [
  { value: 'any', label: msg('Any time') },
  { value: 'morning', label: msg('Mornings') },
  { value: 'afternoon', label: msg('Afternoons') },
]

function lengthLabel(m: number): string {
  if (m < 60) return t('{n} min', { n: m })
  if (m === 60) return t('1 hour')
  return m === 90 ? t('1½ hours') : t('{n} hours', { n: m / 60 })
}

/** "Tue 13 Oct, 10:00 – 10:30 am" */
function slotText(startIso: string, minutes: number): string {
  const start = new Date(startIso)
  const end = new Date(start.getTime() + minutes * 60_000)
  const day = start.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
  const clock = (d: Date) => d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  return `${day}, ${clock(start)} – ${clock(end)}`
}

/** "IST", or whatever this device calls its zone — times sent abroad need it. */
function zoneName(): string {
  try {
    return (
      new Intl.DateTimeFormat(locale(), { timeZoneName: 'short' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    )
  } catch {
    return ''
  }
}

function compose(slots: string[], minutes: number): string {
  const zone = zoneName()
  return [
    zone
      ? t('Here are a few times that work for me ({length}, {zone}):', { length: lengthLabel(minutes), zone })
      : t('Here are a few times that work for me ({length}):', { length: lengthLabel(minutes) }),
    ...slots.map((s) => `• ${slotText(s, minutes)}`),
    t('Let me know which suits you.'),
  ].join('\n')
}

/**
 * "When are you free?", answered in one go.
 *
 * Real gaps from the calendar — meetings, plans and connected calendars all
 * count — spread over the days asked for, turned into a message to send. When
 * they reply with one, it is booked from here.
 */
export function ShareAvailability({ onDone, initialWith = '' }: { onDone: () => void; initialWith?: string }) {
  const [minutes, setMinutes] = useState(30)
  const [range, setRange] = useState<Range>('soon')
  const [part, setPart] = useState<Part>('any')
  const [slots, setSlots] = useState<string[] | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [edited, setEdited] = useState(false)
  const [copied, setCopied] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [withWhom, setWithWhom] = useState(initialWith)
  const [booked, setBooked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSlots(null)
    setPicked(null)
    api<{ slots: string[] }>('/availability', {
      query: { minutes: String(minutes), range, part, count: '6' },
    })
      .then((r) => {
        if (cancelled) return
        setSlots(r.slots)
        // Five is plenty to offer; six found leaves one spare to swap in.
        setChosen(r.slots.slice(0, 5))
        setEdited(false)
      })
      .catch((err) => !cancelled && setError((err as Error).message))
    return () => {
      cancelled = true
    }
  }, [minutes, range, part])

  // The message follows the chosen times until it is edited by hand.
  useEffect(() => {
    if (!edited && slots) setMessage(compose(chosen, minutes))
  }, [chosen, minutes, edited, slots])

  function toggle(slot: string) {
    setChosen((list) =>
      list.includes(slot)
        ? list.filter((s) => s !== slot)
        : [...list, slot].sort((a, b) => a.localeCompare(b)),
    )
  }

  const text = encodeURIComponent(message)

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
    } catch {
      setError(t('Could not copy — select the message and copy it yourself.'))
    }
  }

  async function book() {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      const title = withWhom.trim() ? `Meeting with ${withWhom.trim()}` : 'Meeting'
      await api('/commitments', {
        method: 'POST',
        body: { title, kind: 'meeting', dueAt: picked, durationMinutes: minutes },
      })
      announceChange()
      setBooked(`${title} — ${slotText(picked, minutes)}`)
    } catch (err) {
      // Something was booked into that time since it was offered.
      setError(
        err instanceof ApiError && err.status === 409
          ? t('That time has been taken since you shared it. Pick another, or offer new times.')
          : (err as Error).message,
      )
    } finally {
      setBusy(false)
    }
  }

  if (booked) {
    return (
      <div className="stack tight">
        <strong>{t('Booked.')}</strong>
        <p className="muted small">{t('{what}. It is on your calendar with a reminder.', { what: booked })}</p>
        <div className="form-actions">
          <button className="primary" onClick={onDone}>
            {t('Done')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stack tight share-free">
      <span className="label-text">{t('How long?')}</span>
      <div className="chips">
        {LENGTHS.map((m) => (
          <button key={m} className={`chip${minutes === m ? ' selected' : ''}`} onClick={() => setMinutes(m)}>
            {lengthLabel(m)}
          </button>
        ))}
      </div>

      <span className="label-text">{t('When?')}</span>
      <div className="chips">
        {RANGES.map((r) => (
          <button key={r.value} className={`chip${range === r.value ? ' selected' : ''}`} onClick={() => setRange(r.value)}>
            {t(r.label)}
          </button>
        ))}
        <span className="chip-gap" />
        {PARTS.map((p) => (
          <button key={p.value} className={`chip${part === p.value ? ' selected' : ''}`} onClick={() => setPart(p.value)}>
            {t(p.label)}
          </button>
        ))}
      </div>

      <span className="label-text">{t('Times to offer')}</span>
      {slots === null ? (
        <p className="muted small">{t('Looking for gaps in your calendar…')}</p>
      ) : slots.length === 0 ? (
        <p className="muted small">
          {t('Nothing free for {length} in that time. Try a shorter length or a later week.', { length: lengthLabel(minutes) })}
        </p>
      ) : (
        <ul className="free-slots">
          {slots.map((s) => (
            <li key={s}>
              <label className="checkbox">
                <input type="checkbox" checked={chosen.includes(s)} onChange={() => toggle(s)} />
                <span>{slotText(s, minutes)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {slots && slots.length > 0 && (
        <>
          <label>
            {t('Message')}
            <textarea
              value={message}
              rows={Math.min(9, chosen.length + 3)}
              onChange={(e) => {
                setMessage(e.target.value)
                setEdited(true)
              }}
            />
          </label>
          {edited && (
            <button className="link small fit-btn" onClick={() => setEdited(false)}>
              {t('Rewrite it from the chosen times')}
            </button>
          )}
          <div className="row nudge-send">
            <button
              className="primary small-btn"
              disabled={chosen.length === 0}
              onClick={() => window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener')}
            >
              WhatsApp
            </button>
            <button
              className="ghost small-btn"
              disabled={chosen.length === 0}
              onClick={() =>
                window.open(`mailto:?subject=${encodeURIComponent(t('A time to meet'))}&body=${text}`, '_blank', 'noopener')
              }
            >
              {t('Email')}
            </button>
            <button className="ghost small-btn" disabled={chosen.length === 0} onClick={() => void copy()}>
              {copied ? t('Copied') : t('Copy')}
            </button>
            {typeof navigator.share === 'function' && (
              <button
                className="ghost small-btn"
                disabled={chosen.length === 0}
                onClick={() => void navigator.share({ text: message }).catch(() => undefined)}
              >
                {t('Share…')}
              </button>
            )}
          </div>

          {/* The other half: they reply with one, and it goes in the calendar. */}
          <span className="label-text">{t('They picked one?')}</span>
          <div className="chips">
            {chosen.map((s) => (
              <button key={s} className={`chip${picked === s ? ' selected' : ''}`} onClick={() => setPicked(s)}>
                {slotText(s, minutes)}
              </button>
            ))}
          </div>
          {picked && (
            <div className="row inline-field-row">
              <input
                value={withWhom}
                onChange={(e) => setWithWhom(e.target.value)}
                placeholder={t('With whom? e.g. Ravi')}
                aria-label={t('With whom')}
                autoFocus
              />
              <button className="primary small-btn" onClick={() => void book()} disabled={busy}>
                {busy ? t('Booking…') : t('Book it')}
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="error small">{error}</p>}
    </div>
  )
}
