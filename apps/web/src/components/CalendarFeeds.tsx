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
  const [encryptionReady, setEncryptionReady] = useState(true)
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [remind, setRemind] = useState(true)
  const [history, setHistory] = useState<number | null>(365)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  async function load() {
    try {
      const r = await api<{ feeds: FeedDTO[]; encryptionReady: boolean }>('/calendar-feeds')
      setFeeds(r.feeds)
      setEncryptionReady(r.encryptionReady)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function add() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const r = await api<{ report: SyncReport }>('/calendar-feeds', {
        method: 'POST',
        body: { url: url.trim(), label: label.trim() || 'Google Calendar', remind, historyDays: history },
      })
      setMessage(`Connected — ${describe(r.report)}.`)
      setNote(explainWindow(r.report))
      setUrl('')
      setLabel('')
      setAdding(false)
      await load()
    } catch (err) {
      // The server sends a plain-language reason; it is more use than the code.
      setError(
        err instanceof ApiError
          ? ((err.data as { message?: string })?.message ?? err.message)
          : (err as Error).message,
      )
    } finally {
      setBusy(false)
    }
  }

  /**
   * Importing an exported .ics.
   *
   * The route that always works. A Workspace admin can switch off external
   * sharing, which removes the secret iCal address altogether — and then this
   * is the only way in.
   */
  async function upload(file: File, intoFeedId?: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const text = await file.text()
      const params = new URLSearchParams({
        label: label.trim() || file.name.replace(/\.ics$/i, '') || 'My calendar',
        fileName: file.name,
        remind: String(remind),
        historyDays: history === null ? 'all' : String(history),
      })
      if (intoFeedId) params.set('feedId', intoFeedId)

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
      setLabel('')
      setAdding(false)
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
    try {
      await api(`/calendar-feeds/${feed.id}`, { method: 'PATCH', body: { remind: !feed.remind } })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(feed: FeedDTO) {
    const ok = window.confirm(
      `Disconnect "${feed.label}"?\n\nEverything it brought in will be removed from Cue. Your Google Calendar is not touched.`,
    )
    if (!ok) return
    setBusy(true)
    try {
      await api(`/calendar-feeds/${feed.id}`, { method: 'DELETE' })
      setMessage('Disconnected.')
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!feeds) return <p className="muted small">Loading calendars…</p>

  return (
    <div className="stack tight">
      <span className="label-text">Calendars I read</span>

      <ConnectedCalendars onChanged={() => void load()} />

      {!encryptionReady && (
        <p className="error small">
          Set ENCRYPTION_KEY on the server before connecting a calendar — the address is a
          password in disguise and is not stored without it.
        </p>
      )}

      {feeds.length === 0 && !adding && (
        <p className="muted small">
          Nothing connected yet. Connecting an account above is the quick way — a secret
          address or an exported file still works for anything else.
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
                    if (f) void upload(f, feed.id)
                  }}
                />
              </label>
            ) : (
              <button className="ghost small-btn" onClick={() => void sync(feed)} disabled={busy}>
                Read now
              </button>
            )}
            <button className="ghost small-btn" onClick={() => void remove(feed)} disabled={busy}>
              Disconnect
            </button>
          </div>
        </div>
      ))}

      {adding ? (
        <>
          <label>
            Secret iCal address
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              autoFocus
            />
          </label>
          <label>
            Call it
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Google Calendar"
            />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            <span>Remind me about these too</span>
          </label>
          <label>
            How much history to bring in
            <select
              value={history === null ? 'all' : String(history)}
              onChange={(e) => setHistory(e.target.value === 'all' ? null : Number(e.target.value))}
            >
              {HISTORY_CHOICES.map((c) => (
                <option key={c.label} value={c.value === null ? 'all' : String(c.value)}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            In Google Calendar: <strong>Settings</strong> → pick your calendar under{' '}
            <strong>Settings for my calendars</strong> → <strong>Integrate calendar</strong> →
            copy <strong>Secret address in iCal format</strong>. Treat it like a password: anyone
            with that link can read the calendar.
          </p>
          <div className="row">
            <button className="primary" onClick={() => void add()} disabled={busy || url.length < 10}>
              {busy ? 'Reading…' : 'Connect'}
            </button>
            <button className="ghost" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </button>
          </div>

          <hr className="rule" />

          <span className="label-text">No secret address available?</span>
          <p className="muted small">
            A work account&rsquo;s administrator can switch off external sharing, which removes
            that address entirely — and a calendar you do not own never had one. Exporting a file
            always works. In Google Calendar: <strong>Settings</strong> →{' '}
            <strong>Import &amp; export</strong> → <strong>Export</strong>. You get a .zip; unzip
            it and upload the .ics inside.
          </p>
          <label className="ghost small-btn file-btn">
            {busy ? 'Reading…' : 'Upload an .ics file'}
            <input
              type="file"
              accept=".ics,text/calendar"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void upload(f)
              }}
            />
          </label>
        </>
      ) : (
        <button
          className="ghost small-btn"
          onClick={() => setAdding(true)}
          disabled={busy || !encryptionReady}
        >
          Connect a calendar
        </button>
      )}

      {message && <p className="muted small">{message}</p>}
      {note && <p className="muted small">{note}</p>}
      {error && <p className="error small">{error}</p>}

      <p className="muted small">
        Read-only, and one way: Cue never writes to your calendar. Google refreshes this
        address slowly — usually within a few hours, sometimes a day — so it is for seeing your
        week, not for something you booked minutes ago.
      </p>
    </div>
  )
}
