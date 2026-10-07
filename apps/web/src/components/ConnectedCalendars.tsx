import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api.ts'

/**
 * Connecting a Google or Microsoft account, and choosing what to mirror.
 *
 * This replaces hunting for the "secret address in iCal format" buried in the
 * provider's settings — an option an administrator can switch off entirely,
 * which is exactly where the old flow dead-ended on a work account.
 */

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
  lastError: string | null
  createdAt: string
  /** How many of its calendars Cue is reading. */
  calendarCount: number
}

interface Calendar {
  id: string
  name: string
  primary: boolean
  accessRole: string
  hidden: boolean
  added: boolean
}

/**
 * The callback can only hand back a fixed code, never free text — it arrives
 * in a URL the browser was sent to by a third party. The wording lives here.
 */
const OUTCOME: Record<string, { text: string; bad: boolean }> = {
  connected: { text: 'Connected. Choose which calendars to mirror.', bad: false },
  cancelled: { text: 'No change — you cancelled at the sign-in screen.', bad: false },
  access_denied: { text: 'No change — you cancelled at the sign-in screen.', bad: false },
  no_refresh_token: {
    text: 'That account did not grant lasting access. Remove Cue from your account permissions, then connect again.',
    bad: true,
  },
  scope_missing: {
    text: 'Calendar permission was not granted, so there is nothing to read. Connect again and leave the calendar box ticked.',
    bad: true,
  },
  bad_state: { text: 'That sign-in link had already been used. Start again.', bad: true },
  // You signed in, but the provider would not hand the connection over. With
  // a sign-in that otherwise works, this is almost always the server's client
  // id or secret for that provider being wrong or swapped.
  exchange_failed: {
    text: 'You signed in, but the provider would not hand the connection to Cue. The client id or secret this server has for it is probably wrong.',
    bad: true,
  },
  expired_state: { text: 'That sign-in took too long. Start again.', bad: true },
  not_configured: { text: 'This server has no credentials for that provider.', bad: true },
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    return (err.data as { message?: string })?.message ?? err.message
  }
  return (err as Error).message
}

function calendarsLine(n: number): string {
  if (n === 0) return 'no calendars chosen yet'
  return `reading ${n} calendar${n === 1 ? '' : 's'}`
}

export function ConnectedCalendars({
  onChanged,
  refreshKey,
}: {
  onChanged: () => void
  /** Changes when a calendar is added or removed below, so the counts follow. */
  refreshKey: string
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [calendars, setCalendars] = useState<Calendar[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ text: string; bad: boolean } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await api<{ providers: ProviderInfo[]; accounts: Account[] }>('/oauth/status')
      setProviders(r.providers)
      setAccounts(r.accounts)
      setError(null)
      return r.accounts
    } catch (err) {
      setError(messageOf(err))
      return []
    }
  }, [])

  const openCalendars = useCallback(async (accountId: string) => {
    setOpenFor(accountId)
    setCalendars(null)
    setError(null)
    try {
      const r = await api<{ calendars: Calendar[] }>(`/oauth/accounts/${accountId}/calendars`)
      setCalendars(r.calendars)
    } catch (err) {
      setError(messageOf(err))
      setCalendars([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  // Read the result of a round trip exactly once, then take it out of the URL
  // so a refresh does not replay a message about something that happened
  // minutes ago.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('connected')
    if (!code) return

    setOutcome(OUTCOME[code] ?? { text: 'That did not work. Try connecting again.', bad: true })
    // The answer to "did it connect?" is the first thing to see, not
    // something to scroll down a sheet for.
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'start' }))
    params.delete('connected')
    const rest = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))

    // A fresh connection means a new account to show, and the calendar picker
    // should already be open on it — that is the next thing to do.
    if (code === 'connected') {
      void load().then((list) => {
        const newest = list[list.length - 1]
        if (newest) void openCalendars(newest.id)
      })
    }
  }, [load, openCalendars])

  async function connect(provider: string) {
    setBusy(true)
    setError(null)
    try {
      const { url } = await api<{ url: string }>(`/oauth/${provider}/connect`, { method: 'POST' })
      // A full navigation, not a popup: a popup here is the thing phone
      // browsers block most reliably.
      window.location.assign(url)
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  async function addCalendar(accountId: string, calendar: Calendar) {
    setBusy(true)
    setError(null)
    try {
      await api(`/oauth/accounts/${accountId}/calendars`, {
        method: 'POST',
        body: { calendarId: calendar.id, label: calendar.name },
      })
      await openCalendars(accountId)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      // The feed is kept server-side with its error showing either way, so the
      // list is worth refreshing — "Read now" can retry it.
      onChanged()
      setBusy(false)
    }
  }

  async function disconnect(account: Account) {
    const label = providers.find((p) => p.id === account.provider)?.label ?? account.provider
    const n = account.calendarCount
    if (
      !window.confirm(
        `Remove ${account.email} from Cue?\n\n` +
          (n > 0
            ? `The ${n} calendar${n === 1 ? '' : 's'} read from it, and everything brought in from them, will be removed from Cue. `
            : '') +
          `Your ${label} calendar itself is not touched.`,
      )
    ) {
      return
    }
    setBusy(true)
    setNote(null)
    try {
      const r = await api<{ alsoRemoveAt: string | null }>(`/oauth/accounts/${account.id}`, {
        method: 'DELETE',
      })
      // Microsoft publishes no revocation endpoint, so saying nothing here
      // would imply Cue had been removed at their end too.
      if (r.alsoRemoveAt) {
        setNote(`Removed here. ${label} keeps its own record — remove Cue at ${r.alsoRemoveAt}.`)
      }
      setOpenFor(null)
      await load()
      onChanged()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  // Still loading, or it failed. Rendering nothing for both made a failure
  // look like an empty account: no list, no Connect buttons, no reason.
  if (accounts === null) {
    return (
      <div className="stack tight" ref={root}>
        {outcome && <p className={outcome.bad ? 'error small' : 'muted small'}>{outcome.text}</p>}
        {error ? (
          <>
            <p className="error small">Could not load your connected accounts: {error}</p>
            <button className="ghost small-btn fit-btn" onClick={() => void load()}>
              Try again
            </button>
          </>
        ) : (
          <p className="muted small">Loading your connected accounts…</p>
        )}
      </div>
    )
  }

  const offerable = providers.filter((p) => p.configured)
  const unconfigured = providers.filter((p) => !p.configured)

  return (
    <div className="stack tight" ref={root}>
      {outcome && <p className={outcome.bad ? 'error small' : 'muted small'}>{outcome.text}</p>}
      {note && <p className="muted small">{note}</p>}

      {/* Every account this user has connected, counted, each removable. The
          list was there before but read like more calendar cards, with
          nothing saying how many accounts there were or which was which. */}
      <div className="accounts-head">
        <span className="label-text">Connected accounts</span>
        <span className="accounts-count">{accounts.length}</span>
      </div>

      {accounts.length === 0 && (
        <p className="muted small">None yet. Connect Google or Microsoft to bring your meetings in.</p>
      )}

      {accounts.length > 0 && (
        <ul className="account-list">
          {accounts.map((account) => {
            const label =
              providers.find((p) => p.id === account.provider)?.label ?? account.provider
            const open = openFor === account.id
            return (
              <li className="account-row" key={account.id}>
                <div className="account-line">
                  <span className={`provider-mark is-${account.provider}`} aria-hidden>
                    {label.charAt(0)}
                  </span>
                  <div className="account-info">
                    <p className="account-address">{account.email}</p>
                    <p className="muted small">
                      {account.status === 'revoked' ? (
                        <span className="error">
                          Access was withdrawn — connect again to keep reading it.
                        </span>
                      ) : account.lastError ? (
                        <span className="error">{account.lastError}</span>
                      ) : (
                        `${label} · ${calendarsLine(account.calendarCount)}`
                      )}
                    </p>
                  </div>
                  <div className="row account-actions">
                    <button
                      className="ghost small-btn"
                      onClick={() => (open ? setOpenFor(null) : void openCalendars(account.id))}
                      disabled={busy}
                    >
                      {open ? 'Hide' : 'Calendars'}
                    </button>
                    <button
                      className="ghost small-btn danger"
                      onClick={() => void disconnect(account)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="account-calendars">
                    {calendars === null && <p className="muted small">Reading your calendars…</p>}
                    {calendars?.length === 0 && (
                      <p className="muted small">No calendars this account can read.</p>
                    )}
                    {calendars?.map((calendar) => (
                      <div className="account-calendar" key={calendar.id}>
                        <div>
                          <p className="account-address">{calendar.name}</p>
                          <p className="muted small">
                            {calendar.primary ? 'Your main calendar' : calendar.accessRole}
                            {calendar.hidden ? ' · hidden at the source' : ''}
                          </p>
                        </div>
                        {calendar.added ? (
                          <span className="tag is-live">Reading</span>
                        ) : (
                          <button
                            className="ghost small-btn"
                            onClick={() => void addCalendar(account.id, calendar)}
                            disabled={busy}
                          >
                            Read this
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {offerable.length > 0 && (
        <div className="row">
          {offerable.map((provider) => (
            <button
              key={provider.id}
              className="ghost small-btn"
              onClick={() => void connect(provider.id)}
              disabled={busy}
            >
              + Connect {provider.label}
            </button>
          ))}
        </div>
      )}

      {unconfigured.length > 0 && (
        <p className="muted small">
          {unconfigured.map((p) => p.label).join(' and ')}{' '}
          {unconfigured.length > 1 ? 'sign-ins are' : 'sign-in is'} not set up on this server — it
          needs that provider&rsquo;s client id and secret, plus <code>ENCRYPTION_KEY</code>. All
          free to create, none of them billed.
        </p>
      )}

      {error && <p className="error small">{error}</p>}
    </div>
  )
}
