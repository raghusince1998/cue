import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.ts'
import { locale, msg, rich, t } from '../lib/i18n.tsx'
import { waNumber } from './PersonSheet.tsx'

type Format = 'report' | 'standup'

interface Item {
  title: string
  at: string | null
  who: string | null
  note: string | null
}

interface Report {
  date: string
  meetings: Item[]
  visits: Item[]
  /** Who as the title, how it went as `who`, what was said as the note. */
  calls?: Item[]
  done: Item[]
  agreed: Item[]
  waiting: Item[]
  next: { date: string; items: Item[] }
}

interface Recipient {
  reportToName: string | null
  reportToEmail: string | null
  reportToPhone: string | null
}

const parseDay = (ymd: string) => new Date(`${ymd}T00:00:00`)
const dayName = (ymd: string) =>
  parseDay(ymd).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'short' })
const weekday = (ymd: string) => parseDay(ymd).toLocaleDateString(locale(), { weekday: 'long' })
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })

function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000)
}

/**
 * "Dr. Anil Mehta (Mehta Physio Clinic)" after a title that already names
 * the clinic is said twice; only the part the title does not say is kept.
 */
function withoutRepeat(title: string, who: string | null): string | null {
  if (!who) return null
  const m = /^(.*) \((.*)\)$/.exec(who)
  const said = title.toLowerCase()
  if (!m) return said.includes(who.toLowerCase()) ? null : who
  const [, name, org] = m
  const keep = [said.includes(name!.toLowerCase()) ? null : name, said.includes(org!.toLowerCase()) ? null : org]
  if (keep[0] && keep[1]) return who
  return keep[0] ?? keep[1] ?? null
}

function section(lines: string[], heading: string, items: string[]) {
  if (items.length === 0) return
  if (lines.length) lines.push('')
  lines.push(`${heading}:`, ...items)
}

interface Options {
  notes: boolean
  waiting: boolean
  next: boolean
}

function compose(r: Report, format: Format, o: Options, toName: string | null): string {
  const lines: string[] = []
  const meeting = (m: Item) => {
    const who = withoutRepeat(m.title, m.who)
    const what = who ? t('{title} with {who}', { title: m.title, who }) : m.title
    return `• ${m.at ? `${clock(m.at)} ` : ''}${what}${o.notes && m.note ? `. ${m.note}` : ''}`
  }
  const visit = (v: Item) => `• ${v.title}${v.who ? `, ${v.who}` : ''}${o.notes && v.note ? `: ${v.note}` : ''}`
  const call = (c: Item) => `• ${c.title}: ${(c.who ?? t('call')).toLowerCase()}${o.notes && c.note ? `. ${c.note}` : ''}`
  const planned = (n: Item) => `• ${n.at ? `${clock(n.at)} ` : ''}${n.title}`

  if (format === 'report') {
    if (toName?.trim()) lines.push(t('Hi {name},', { name: toName.trim().split(/\s+/)[0]! }), '')
    lines.push(t('Update for {day}:', { day: dayName(r.date) }))
    const body: string[] = []
    section(body, t('Meetings'), r.meetings.map(meeting))
    section(body, t('Visits'), r.visits.map(visit))
    section(body, t('Calls'), (r.calls ?? []).map(call))
    section(body, t('Done'), r.done.map((d) => `• ${d.title}`))
    section(
      body,
      t('Next steps agreed'),
      r.agreed.map((a) => `• ${a.at ? t('{title} (by {day})', { title: a.title, day: shortDay(a.at) }) : a.title}`),
    )
    if (o.waiting) section(body, t('Waiting on'), r.waiting.map((w) => `• ${w.title}`))
    if (o.next) {
      const gap = daysBetween(r.date, r.next.date)
      section(body, gap === 1 ? t('Tomorrow') : weekday(r.next.date), r.next.items.map(planned))
    }
    if (body.length === 0) body.push(t('Nothing recorded for the day.'))
    lines.push('', ...body)
    return lines.join('\n')
  }

  // Standup: the last working day, today, and what is in the way.
  const today = new Date()
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const past = [
    ...r.meetings.map(meeting),
    ...r.visits.map(visit),
    ...(r.calls ?? []).map(call),
    ...r.done.map((d) => `• ${d.title}`),
  ]
  section(
    lines,
    daysBetween(r.date, todayYmd) === 1 ? t('Yesterday') : weekday(r.date),
    past.length ? past : [`• ${t('Nothing recorded')}`],
  )
  section(lines, t('Today'), r.next.items.length ? r.next.items.map(planned) : [`• ${t('Nothing booked yet')}`])
  if (o.waiting) {
    section(
      lines,
      t('Blockers'),
      r.waiting.length ? r.waiting.map((w) => `• ${t('Waiting on {title}', { title: w.title })}`) : [`• ${t('None')}`],
    )
  }
  return lines.join('\n')
}

/**
 * The day, written up for whoever you report to: meetings with who and what
 * came of them, visits, what got done, next steps agreed, what you are waiting
 * on, and what is next. Or, in the morning, the same as a standup. Edited
 * freely before it goes; sent where it is going in one tap.
 */
export function DailyReport({ initialFormat = 'report' }: { initialFormat?: Format }) {
  const [format, setFormat] = useState<Format>(initialFormat)
  const [r, setR] = useState<Report | null>(null)
  const [opts, setOpts] = useState<Options>({ notes: true, waiting: true, next: true })
  const [to, setTo] = useState<Recipient>({ reportToName: null, reportToEmail: null, reportToPhone: null })
  const [editingTo, setEditingTo] = useState(false)
  const [draftTo, setDraftTo] = useState({ name: '', email: '', phone: '' })
  const [message, setMessage] = useState('')
  const [edited, setEdited] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api<Recipient>('/me/preferences').then(setTo).catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    setR(null)
    setEdited(false)
    api<Report>('/report/day', { query: format === 'standup' ? { standup: '1' } : {} })
      .then((res) => !cancelled && setR(res))
      .catch((err) => !cancelled && setError((err as Error).message))
    return () => {
      cancelled = true
    }
  }, [format])

  // The message follows the day and the options until it is edited by hand.
  useEffect(() => {
    if (r && !edited) setMessage(compose(r, format, opts, to.reportToName))
  }, [r, format, opts, to.reportToName, edited])

  const subject = useMemo(
    () =>
      r
        ? format === 'report'
          ? t('Daily update: {day}', { day: dayName(r.date) })
          : t('Standup: {day}', { day: dayName(r.next.date) })
        : '',
    [r, format],
  )

  async function saveRecipient() {
    setError(null)
    try {
      const saved = await api<Recipient>('/me/preferences', {
        method: 'PATCH',
        body: { reportToName: draftTo.name, reportToEmail: draftTo.email, reportToPhone: draftTo.phone },
      })
      setTo(saved)
      setEditingTo(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
    } catch {
      setError(t('Could not copy — select the message and copy it yourself.'))
    }
  }

  const toggle = (key: keyof Options) => {
    setEdited(false)
    setOpts((o) => ({ ...o, [key]: !o[key] }))
  }
  const first = to.reportToName?.trim().split(/\s+/)[0] ?? null
  const text = encodeURIComponent(message)

  return (
    <div className="stack tight daily-report">
      <div className="viewswitch">
        <button className={format === 'report' ? 'selected' : ''} onClick={() => setFormat('report')}>
          {t('Today’s report')}
        </button>
        <button className={format === 'standup' ? 'selected' : ''} onClick={() => setFormat('standup')}>
          {t('Standup')}
        </button>
      </div>
      <p className="muted small">
        {format === 'report'
          ? t('What happened today, for whoever you report to.')
          : t('Your last working day, today, and anything blocking you, for the morning standup.')}
      </p>

      <div className="chips">
        {format === 'report' && (
          <button className={`chip${opts.notes ? ' selected' : ''}`} onClick={() => toggle('notes')}>
            {t('Meeting notes')}
          </button>
        )}
        <button className={`chip${opts.waiting ? ' selected' : ''}`} onClick={() => toggle('waiting')}>
          {format === 'report' ? t('Waiting on') : t('Blockers')}
        </button>
        {format === 'report' && (
          <button className={`chip${opts.next ? ' selected' : ''}`} onClick={() => toggle('next')}>
            {t('What’s next')}
          </button>
        )}
      </div>

      {r === null ? (
        <p className="muted small">{t('Writing up your day…')}</p>
      ) : (
        <>
          <textarea
            className="report-text"
            value={message}
            rows={Math.min(18, Math.max(8, message.split('\n').length + 1))}
            onChange={(e) => {
              setMessage(e.target.value)
              setEdited(true)
              setCopied(false)
            }}
            aria-label={t('Report')}
          />
          {edited && (
            <button className="link small fit-btn" onClick={() => setEdited(false)}>
              {t('Rewrite it from the day')}
            </button>
          )}
        </>
      )}

      {/* Who it goes to: saved once, so sending is one tap every evening. */}
      {editingTo ? (
        <div className="card waiting-form">
          <input
            value={draftTo.name}
            onChange={(e) => setDraftTo((d) => ({ ...d, name: e.target.value }))}
            placeholder={t('Their name, e.g. Suresh')}
            aria-label={t('Name')}
            autoFocus
          />
          <input
            type="email"
            value={draftTo.email}
            onChange={(e) => setDraftTo((d) => ({ ...d, email: e.target.value }))}
            placeholder={t('Email (optional)')}
            aria-label={t('Email')}
          />
          <input
            type="tel"
            value={draftTo.phone}
            onChange={(e) => setDraftTo((d) => ({ ...d, phone: e.target.value }))}
            placeholder={t('WhatsApp number (optional)')}
            aria-label={t('WhatsApp number')}
          />
          <div className="row">
            <button className="primary small-btn" onClick={() => void saveRecipient()}>
              {t('Save')}
            </button>
            <button className="ghost small-btn" onClick={() => setEditingTo(false)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <p className="muted small">
          {to.reportToName || to.reportToEmail || to.reportToPhone ? (
            <>
              {rich(
                to.reportToEmail && to.reportToPhone
                  ? msg('Goes to {who} by email or WhatsApp.')
                  : to.reportToEmail
                    ? msg('Goes to {who} by email.')
                    : to.reportToPhone
                      ? msg('Goes to {who} by WhatsApp.')
                      : msg('Goes to {who}.'),
                { who: <strong>{to.reportToName ?? to.reportToEmail ?? to.reportToPhone}</strong> },
              )}{' '}
            </>
          ) : (
            `${t('Save who you send it to, and it is one tap from here every day.')} `
          )}
          <button
            className="link small"
            onClick={() => {
              setDraftTo({
                name: to.reportToName ?? '',
                email: to.reportToEmail ?? '',
                phone: to.reportToPhone ?? '',
              })
              setEditingTo(true)
            }}
          >
            {to.reportToName || to.reportToEmail || to.reportToPhone ? t('Change') : t('Set who it goes to')}
          </button>
        </p>
      )}

      <div className="row nudge-send">
        <button
          className="primary small-btn"
          disabled={!message.trim()}
          onClick={() =>
            window.open(
              `https://wa.me/${to.reportToPhone ? waNumber(to.reportToPhone) : ''}?text=${text}`,
              '_blank',
              'noopener',
            )
          }
        >
          {to.reportToPhone && first ? t('WhatsApp {name}', { name: first }) : 'WhatsApp'}
        </button>
        <button
          className="ghost small-btn"
          disabled={!message.trim()}
          onClick={() =>
            window.open(
              `mailto:${to.reportToEmail ?? ''}?subject=${encodeURIComponent(subject)}&body=${text}`,
              '_blank',
              'noopener',
            )
          }
        >
          {to.reportToEmail && first ? t('Email {name}', { name: first }) : t('Email')}
        </button>
        <button className="ghost small-btn" disabled={!message.trim()} onClick={() => void copy()}>
          {copied ? t('Copied') : t('Copy')}
        </button>
        {typeof navigator.share === 'function' && (
          <button
            className="ghost small-btn"
            disabled={!message.trim()}
            onClick={() => void navigator.share({ title: subject, text: message }).catch(() => undefined)}
          >
            {t('Share…')}
          </button>
        )}
      </div>

      {error && <p className="error small">{error}</p>}
    </div>
  )
}
