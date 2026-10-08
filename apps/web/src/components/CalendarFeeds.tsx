import { useEffect, useState } from 'react'
import { ApiError, api, getToken, BASE as API_BASE } from '../lib/api.ts'
import { formatDateTime } from '../lib/time.ts'
import { ConnectedCalendars } from './ConnectedCalendars.tsx'

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
    r.imported ? `${r.imported} brought in` : null,
    r.repeating ? `${r.repeating} repeating` : null,
    r.updated ? `${r.updated} updated` : null,
    r.removed ? `${r.removed} removed` : null,
    r.skipped ? `${r.skipped} skipped` : null,
  ].filter(Boolean)
  return bits.length ? bits.join(', ') : 'nothing new'
}

/**
 * Says why a file with plenty in it can import almost nothing.
 *
 * Without this the answer is a bare "1 brought in" and the obvious conclusion
 * is that the import failed, when in fact the calendar was mostly history.
 */
function explainWindow(r: SyncReport): string | null {
  if (!r.outsideWindow) return null
  const span = r.oldest && r.newest ? ` The file covers ${r.oldest} to ${r.newest}.` : ''
  const kept =
    r.historyDays === null
      ? 'over a year ahead'
      : r.historyDays >= 365
        ? `more than ${Math.round(r.historyDays / 365)} year${r.historyDays >= 730 ? 's' : ''} past, or over a year ahead`
        : `more than ${r.historyDays} days past, or over a year ahead`
  return `${r.outsideWindow} ${r.outsideWindow === 1 ? 'event was' : 'events were'} outside the window this calendar keeps — ${kept}.${span} Change "How much history" below and read it again to pull them in.`
}

const HISTORY_CHOICES: Array<{ label: string; value: number | null }> = [
  { label: '2 weeks', value: 14 },
  { label: '1 year', value: 365 },
  { label: '5 years', value: 1825 },
  { label: 'Everything', value: null },
]

function historyLabel(days: number | null | undefined): string {
  if (days === null) return 'Everything'
  return HISTORY_CHOICES.find((c) => c.value === days)?.label ?? `${days} days`
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
export function CalendarFeeds() {
  const [feeds, setFeeds] = useState<FeedDTO[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const r = await api<{ feeds: FeedDTO[] }>('/calendar-feeds')
      setFeeds(r.feeds)
    } catch (err) {
      setError((err as Error).message)
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
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? 'Could not read that file.')

      setMessage(`Imported ${file.name} — ${describe(data.report as SyncReport)}.`)
      setNote(explainWindow(data.report as SyncReport))
      await load()
    } catch (err) {
      setError((err as Error).message)
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
          : (err as Error).message,
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
        setMessage('Saved. Upload the file again with "Replace file" to pull in the extra events.')
        setNote(null)
      }
      await load()
    } catch (err) {
      setError((err as Error).message)
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
            ? `Reminders on for ${name} — ${n} upcoming event${n === 1 ? '' : 's'} will notify you at the time.`
            : `Reminders on for ${name}. Nothing ahead in it yet; new events will notify you.`
          : `Reminders off for ${name}.`,
      )
      setNote(null)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(feed: FeedDTO) {
    const ok = window.confirm(
      `Stop reading "${feed.calendarName ?? feed.label}"?\n\nEverything it brought in will be removed from Cue. The calendar itself is not touched.`,
    )
    if (!ok) return
    setBusy(true)
    try {
      await api(`/calendar-feeds/${feed.id}`, { method: 'DELETE' })
      setMessage('Stopped reading it.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!feeds) return <p className="muted small">Loading calendars…</p>

  return (
    <div className="stack tight">
      <ConnectedCalendars
        onChanged={() => void load()}
        refreshKey={feeds.map((f) => f.id).join(',')}
      />

      <div className="accounts-head">
        <span className="label-text">Calendars I read</span>
        <span className="accounts-count">{feeds.length}</span>
      </div>

      {feeds.length === 0 && (
        <p className="muted small">
          None yet. Connect an account above, then choose which of its calendars to read — their
          events appear in Cue and count towards clashes.
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
                  {feed.lastEventCount ?? 0} events
                  {feed.lastSkippedCount ? ` · ${feed.lastSkippedCount} skipped` : ''}
                  {feed.lastSyncedAt ? ` · read ${formatDateTime(feed.lastSyncedAt)}` : ''}
                  {` · keeps ${historyLabel(feed.historyDays)}`}
                  {feed.source === 'file'
                    ? ` · from ${feed.fileName ?? 'a file'} (does not update on its own)`
                    : feed.source === 'google'
                      ? ' · from your Google account'
                      : feed.source === 'microsoft'
                        ? ' · from your Microsoft account'
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
              <span className="muted small">Remind me about these too</span>
            </label>
            <label className="inline-field">
              <span className="muted small">How much history</span>
              <select
                value={feed.historyDays === null ? 'all' : String(feed.historyDays ?? 365)}
                disabled={busy}
                onChange={(e) =>
                  void setFeedHistory(feed, e.target.value === 'all' ? null : Number(e.target.value))
                }
              >
                {HISTORY_CHOICES.map((c) => (
                  <option key={c.label} value={c.value === null ? 'all' : String(c.value)}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="stack tight">
            {feed.source === 'file' ? (
              <label className="ghost small-btn file-btn">
                Replace file
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
                Read now
              </button>
            )}
            <button className="ghost small-btn" onClick={() => void remove(feed)} disabled={busy}>
              Stop reading
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
