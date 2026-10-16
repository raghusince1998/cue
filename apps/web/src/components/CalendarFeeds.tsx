import { useEffect, useState } from 'react'
import { ApiError, api, getToken, BASE as API_BASE } from '../lib/api.ts'
import { formatDateTime } from '../lib/time.ts'
import { msg, t } from '../lib/i18n.tsx'
import { ConnectedCalendars } from './ConnectedCalendars.tsx'
import { errorText } from '../lib/errors.ts'
import { LoadFailed } from './LoadFailed.tsx'

interface FeedDTO {
  id: string
  label: string
  source: 'url' | 'file' | 'google' | 'microsoft'
  fileName: string | null
  historyDays: number | null
  urlHint: string | null
  remind: boolean
  status: string
  calendarName: string | null
  lastSyncedAt: string | null
  lastError: string | null
  lastEventCount: number | null
  lastSkippedCount: number | null
}

interface SyncReport {
  calendarName: string | null
  imported: number
  updated: number
  removed: number
  skipped: number
  repeating: number
  outsideWindow: number
  oldest: string | null
  newest: string | null
  historyDays: number | null
}

function describe(r: SyncReport): string {
  const bits = [
    r.imported ? t('{n} brought in', { n: r.imported }) : null,
    r.repeating ? t('{n} repeating', { n: r.repeating }) : null,
    r.updated ? t('{n} updated', { n: r.updated }) : null,
    r.removed ? t('{n} removed', { n: r.removed }) : null,
    r.skipped ? t('{n} skipped', { n: r.skipped }) : null,
  ].filter(Boolean)
  return bits.length ? bits.join(', ') : t('nothing new')
}

/**
 * Says why a file with plenty in it can import almost nothing.
 *
 * Without this the answer is a bare "1 brought in" and the obvious conclusion
 * is that the import failed, when in fact the calendar was mostly history.
 */
function explainWindow(r: SyncReport): string | null {
  if (!r.outsideWindow) return null
  const span = r.oldest && r.newest ? t('The file covers {from} to {to}.', { from: r.oldest, to: r.newest }) : null
  const kept =
    r.historyDays === null
      ? t('over a year ahead')
      : r.historyDays >= 365
        ? r.historyDays >= 730
          ? t('more than {n} years past, or over a year ahead', { n: Math.round(r.historyDays / 365) })
          : t('more than {n} year past, or over a year ahead', { n: Math.round(r.historyDays / 365) })
        : t('more than {n} days past, or over a year ahead', { n: r.historyDays })
  return [
    r.outsideWindow === 1
      ? t('1 event was outside the window this calendar keeps — {kept}.', { kept })
      : t('{n} events were outside the window this calendar keeps — {kept}.', { n: r.outsideWindow, kept }),
    span,
    t('Change "How much history" below and read it again to pull them in.'),
  ]
    .filter(Boolean)
    .join(' ')
}

/** Show the label with t(). */
const HISTORY_CHOICES: Array<{ label: string; value: number | null }> = [
  { label: msg('2 weeks'), value: 14 },
  { label: msg('1 year'), value: 365 },
  { label: msg('5 years'), value: 1825 },
  { label: msg('Everything'), value: null },
]

function historyLabel(days: number | null | undefined): string {
  if (days === null) return t('Everything')
  const choice = HISTORY_CHOICES.find((c) => c.value === days)
  return choice ? t(choice.label) : t('{n} days', { n: days ?? 0 })
}

/**
 * Subscribing to a Google (or Apple, or Outlook) calendar by its private iCal
 * address.
 *
 * Deliberately not an OAuth "Connect" button. That would mean a Google Cloud
 * project and, to offer it to anyone else, Google's app verification. A secret
 * URL needs none of that and works with every calendar that publishes one. The
 * price is freshness: Google regenerates that feed slowly, so this is for
 * "what does my week look like", not for something booked ten minutes ago.
 */
export function CalendarFeeds({ pickerOnly = false }: { pickerOnly?: boolean } = {}) {
  const [feeds, setFeeds] = useState<FeedDTO[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const r = await api<{ feeds: FeedDTO[] }>('/calendar-feeds')
      setFeeds(r.feeds)
    } catch (err) {
      setError(errorText(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  /**
   * A newer export for a calendar that was added from a file.
   *
   * Adding calendars this way is no longer offered, but one added before still
   * has to be refreshable — a file never updates on its own.
   *
   * The feed's own settings go with it. The server applies `historyDays` on a
   * replace whenever it differs from the stored value, so sending a default
   * here would quietly reset a calendar set to "all history" back to a year on
   * every upload.
   */
  async function replaceFile(file: File, feed: FeedDTO) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const text = await file.text()
      const params = new URLSearchParams({
        feedId: feed.id,
        label: feed.label,
        fileName: file.name,
        remind: String(feed.remind),
        historyDays: feed.historyDays === null ? 'all' : String(feed.historyDays ?? 365),
      })

      const res = await fetch(`${API_BASE}/calendar-feeds/upload?${params}`, {
        method: 'POST',
        headers: {
          'content-type': 'text/calendar',
          ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
        },
        body: text,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? t('Could not read that file.'))

      setMessage(t('Imported {file} — {what}.', { file: file.name, what: describe(data.report as SyncReport) }))
      setNote(explainWindow(data.report as SyncReport))
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function sync(feed: FeedDTO) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const r = await api<{ report: SyncReport }>(`/calendar-feeds/${feed.id}/sync`, {
        method: 'POST',
      })
      setMessage(`${feed.label}: ${describe(r.report)}.`)
      setNote(explainWindow(r.report))
      await load()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? ((err.data as { message?: string })?.message ?? err.message)
          : errorText(err),
      )
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function setFeedHistory(feed: FeedDTO, days: number | null) {
    setBusy(true)
    setError(null)
    try {
      await api(`/calendar-feeds/${feed.id}`, { method: 'PATCH', body: { historyDays: days } })
      // Anything with a live source can re-read itself immediately; a file
      // one needs the file again, so say so rather than appearing to do nothing.
      if (feed.source !== 'file') {
        const r = await api<{ report: SyncReport }>(`/calendar-feeds/${feed.id}/sync`, {
          method: 'POST',
        })
        setMessage(`${feed.label}: ${describe(r.report)}.`)
        setNote(explainWindow(r.report))
      } else {
        setMessage(t('Saved. Upload the file again with "Replace file" to pull in the extra events.'))
        setNote(null)
      }
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggleRemind(feed: FeedDTO) {
    setBusy(true)
    setError(null)
    try {
      const on = !feed.remind
      const r = await api<{ reminders: number | null }>(`/calendar-feeds/${feed.id}`, {
        method: 'PATCH',
        body: { remind: on },
      })
      const n = r.reminders ?? 0
      const name = feed.calendarName ?? feed.label
      // Say what changed, so ticking the box is not an act of faith.
      setMessage(
        on
          ? n > 0
            ? n === 1
              ? t('Reminders on for {name} — 1 upcoming event will notify you at the time.', { name })
              : t('Reminders on for {name} — {n} upcoming events will notify you at the time.', { name, n })
            : t('Reminders on for {name}. Nothing ahead in it yet; new events will notify you.', { name })
          : t('Reminders off for {name}.', { name }),
      )
      setNote(null)
      await load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(feed: FeedDTO) {
    const ok = window.confirm(
      `${t('Stop reading "{name}"?', { name: feed.calendarName ?? feed.label })}\n\n${t('Everything it brought in will be removed from Cue. The calendar itself is not touched.')}`,
    )
    if (!ok) return
    setBusy(true)
    try {
      await api(`/calendar-feeds/${feed.id}`, { method: 'DELETE' })
      setMessage(t('Stopped reading it.'))
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!feeds && error) return <LoadFailed what={error} onRetry={() => void load()} />
  if (!feeds) return <p className="muted small">{t('Loading calendars…')}</p>

  return (
    <div className="stack tight">
      <ConnectedCalendars
        onChanged={() => void load()}
        refreshKey={feeds.map((f) => f.id).join(',')}
        pickerOnly={pickerOnly}
      />

      <div className="accounts-head">
        <span className="label-text">{t('Calendars I read')}</span>
        <span className="accounts-count">{feeds.length}</span>
      </div>

      {feeds.length === 0 && (
        <p className="muted small">
          {t(
            'None yet. Connect an account above, then choose which of its calendars to read — their events appear in Cue and count towards clashes.',
          )}
        </p>
      )}

      {feeds.map((feed) => (
        <div className="parsed-preview" key={feed.id}>
          <div>
            <p className="commitment-title">{feed.calendarName ?? feed.label}</p>
            <p className="muted small">
              {feed.lastError ? (
                <span className="error">{feed.lastError}</span>
              ) : (
                <>
                  {feed.lastEventCount === 1 ? t('1 event') : t('{n} events', { n: feed.lastEventCount ?? 0 })}
                  {feed.lastSkippedCount ? ` · ${t('{n} skipped', { n: feed.lastSkippedCount })}` : ''}
                  {feed.lastSyncedAt ? ` · ${t('read {when}', { when: formatDateTime(feed.lastSyncedAt) })}` : ''}
                  {` · ${t('keeps {span}', { span: historyLabel(feed.historyDays) })}`}
                  {feed.source === 'file'
                    ? ` · ${t('from {file} (does not update on its own)', { file: feed.fileName ?? t('a file') })}`
                    : feed.source === 'google'
                      ? ` · ${t('from your {provider} account', { provider: 'Google' })}`
                      : feed.source === 'microsoft'
                        ? ` · ${t('from your {provider} account', { provider: 'Microsoft' })}`
                        : ''}
                </>
              )}
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={feed.remind}
                disabled={busy}
                onChange={() => void toggleRemind(feed)}
              />
              <span className="muted small">{t('Remind me about these too')}</span>
            </label>
            <label className="inline-field">
              <span className="muted small">{t('How much history')}</span>
              <select
                value={feed.historyDays === null ? 'all' : String(feed.historyDays ?? 365)}
                disabled={busy}
                onChange={(e) =>
                  void setFeedHistory(feed, e.target.value === 'all' ? null : Number(e.target.value))
                }
              >
                {HISTORY_CHOICES.map((c) => (
                  <option key={c.label} value={c.value === null ? 'all' : String(c.value)}>
                    {t(c.label)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="stack tight">
            {feed.source === 'file' ? (
              <label className="ghost small-btn file-btn">
                {t('Replace file')}
                <input
                  type="file"
                  accept=".ics,text/calendar"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    // Cleared so picking the same filename twice still fires.
                    e.target.value = ''
                    if (f) void replaceFile(f, feed)
                  }}
                />
              </label>
            ) : (
              <button className="ghost small-btn" onClick={() => void sync(feed)} disabled={busy}>
                {t('Read now')}
              </button>
            )}
            <button className="ghost small-btn" onClick={() => void remove(feed)} disabled={busy}>
              {t('Stop reading')}
            </button>
          </div>
        </div>
      ))}

      {message && <p className="muted small">{message}</p>}
      {note && <p className="muted small">{note}</p>}
      {error && <p className="error small">{error}</p>}

    </div>
  )
}
