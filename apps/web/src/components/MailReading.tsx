import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { relativeDay } from '../lib/time.ts'

interface ProviderInfo {
  id: string
  label: string
  configured: boolean
}

interface Account {
  id: string
  provider: string
  email: string
  status: string
  mailEnabled: boolean
  mailCheckedAt: string | null
  mailError: string | null
}

interface Find {
  found: string
  at: string
  email: string
}

/** What the sign-in round trip came back with, in words. */
const OUTCOME: Record<string, { text: string; bad: boolean }> = {
  mail_connected: {
    text: 'Connected. Cue is looking through the last two weeks now, and then every 15 minutes.',
    bad: false,
  },
  mail_scope_missing: {
    text: 'Email permission was not granted. Connect again and leave the box for reading email ticked.',
    bad: true,
  },
}

const PROVIDER_NAME: Record<string, string> = { google: 'Gmail', microsoft: 'Outlook' }

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return (err.data as { message?: string })?.message ?? err.message
  return (err as Error).message
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`
  return relativeDay(iso)
}

/**
 * Bookings, parcels and bills, found in email without anyone forwarding or
 * sharing anything. Read-only, and only from the senders that send these.
 */
export function MailReading() {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [finds, setFinds] = useState<Find[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const [status, found] = await Promise.all([
        api<{ providers: ProviderInfo[]; accounts: Account[] }>('/oauth/status'),
        api<Find[]>('/mail/found'),
      ])
      setProviders(status.providers)
      setAccounts(status.accounts)
      setFinds(found)
    } catch (err) {
      setNote({ text: messageOf(err), bad: true })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Back from the provider's consent screen, or sent here from Today.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('connected')
    const asked = params.get('settings') === 'mail'
    if (!asked && !code?.startsWith('mail')) return
    if (code) setNote(OUTCOME[code] ?? { text: 'That did not work. Try connecting again.', bad: true })
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'start' }))
    params.delete('connected')
    params.delete('settings')
    const rest = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
    // The first look, straight away, so what it found is there to see.
    if (code === 'mail_connected') void checkNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect(provider: string) {
    setBusy(true)
    setNote(null)
    try {
      const { url } = await api<{ url: string }>(`/oauth/${provider}/connect`, { method: 'POST', body: { purpose: 'mail' } })
      window.location.assign(url)
    } catch (err) {
      setNote({ text: messageOf(err), bad: true })
      setBusy(false)
    }
  }

  async function checkNow() {
    setBusy(true)
    try {
      const r = await api<{ found: string[]; errors: string[] }>('/mail/check', { method: 'POST', body: {} })
      setNote(
        r.errors.length
          ? { text: r.errors.join(' '), bad: true }
          : { text: r.found.length ? `Found ${r.found.length}: ${r.found.join(' · ')}` : 'Nothing new.', bad: false },
      )
      await load()
      if (r.found.length) announceChange()
    } catch (err) {
      setNote({ text: messageOf(err), bad: true })
    } finally {
      setBusy(false)
    }
  }

  async function stop(account: Account) {
    if (!window.confirm(`Stop reading email from ${account.email}? What was already found stays.`)) return
    await api(`/oauth/accounts/${account.id}/mail-off`, { method: 'POST', body: {} })
    await load()
  }

  const reading = accounts.filter((a) => a.mailEnabled)
  const usable = providers.filter((p) => p.configured)

  return (
    <div className="stack tight mail-reading" ref={root}>
      <p className="muted small">
        Train and flight tickets, hotel and movie bookings, parcels on their way, card dues and
        electricity bills: Cue finds them in your email and adds them here, with reminders. It opens
        only emails from booking sites, airlines, IRCTC, shops, couriers, banks and electricity and
        phone companies. Nothing else is read, and no email is kept.
      </p>

      {reading.map((a) => (
        <div key={a.id} className="mail-account">
          <div>
            <strong>{a.email}</strong>
            <span className={`small ${a.mailError || a.status !== 'active' ? 'error' : 'muted'}`}>
              {a.status !== 'active'
                ? ' · access was withdrawn: connect again'
                : a.mailError
                  ? ` · last look failed: ${a.mailError}`
                  : a.mailCheckedAt
                    ? ` · checked ${ago(a.mailCheckedAt)}`
                    : ' · first look under way'}
            </span>
          </div>
          <div className="row">
            <button className="ghost small-btn" onClick={() => void checkNow()} disabled={busy}>
              {busy ? 'Looking…' : 'Check now'}
            </button>
            {a.status !== 'active' && (
              <button className="primary small-btn" onClick={() => void connect(a.provider)} disabled={busy}>
                Connect again
              </button>
            )}
            <button className="link small danger-text" onClick={() => void stop(a)}>
              Stop
            </button>
          </div>
        </div>
      ))}

      {usable.length === 0 ? (
        <p className="muted small">This server has no Google or Microsoft sign-in set up yet.</p>
      ) : (
        <div className="row">
          {usable.map((p) => (
            <button
              key={p.id}
              className={reading.length ? 'ghost small-btn' : 'primary small-btn'}
              onClick={() => void connect(p.id)}
              disabled={busy}
            >
              {reading.some((a) => a.provider === p.id) ? `Add another ${PROVIDER_NAME[p.id] ?? p.label}` : `Connect ${PROVIDER_NAME[p.id] ?? p.label}`}
            </button>
          ))}
        </div>
      )}

      {note && <p className={`small ${note.bad ? 'error' : 'muted'}`}>{note.text}</p>}

      {finds.length > 0 && (
        <>
          <span className="label-text">Found in your email</span>
          <ul className="plain mail-finds">
            {finds.map((f, i) => (
              <li key={i}>
                {f.found} <span className="muted">· {ago(f.at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
