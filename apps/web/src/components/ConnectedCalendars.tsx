import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import { t } from '../lib/i18n.tsx'
import { connectionError } from '../lib/oauthOutcome.ts'

/**
 * Choosing which of a connected account's calendars Cue reads.
 *
 * Connecting and removing the account happen once, in Integrations above, and
 * so does reading the result of a sign-in. This lists what each account
 * offers — a work account usually has several — and adds the ones chosen.
 */

interface ProviderInfo {
  id: string
  label: string
}

interface Account {
  id: string
  provider: string
  email: string
  status: string
  lastError: string | null
  /** How many of its calendars Cue is reading. */
  calendarCount: number
  /** False when it was connected only to read email. */
  calendarAccess?: boolean
}

interface Calendar {
  id: string
  name: string
  primary: boolean
  accessRole: string
  hidden: boolean
  added: boolean
}

function calendarsLine(n: number): string {
  if (n === 0) return t('no calendars chosen yet')
  return n === 1 ? t('reading 1 calendar') : t('reading {n} calendars', { n })
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

  const load = useCallback(async () => {
    try {
      const r = await api<{ providers: ProviderInfo[]; accounts: Account[] }>('/oauth/status')
      // An account connected only to read email has no calendars to offer.
      setProviders(r.providers)
      setAccounts(r.accounts.filter((a) => a.calendarAccess !== false))
      setError(null)
    } catch (err) {
      setError(connectionError(err))
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
      setError(connectionError(err))
      setCalendars([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

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
      setError(connectionError(err))
    } finally {
      // The feed is kept server-side with its error showing either way, so the
      // list is worth refreshing — "Read now" can retry it.
      onChanged()
      setBusy(false)
    }
  }

  // Still loading, or it failed. Rendering nothing for both made a failure
  // look like an empty account: no list, no reason.
  if (accounts === null) {
    return (
      <div className="stack tight">
        {error ? (
          <>
            <p className="error small">{t('Could not load your connected accounts: {error}', { error })}</p>
            <button className="ghost small-btn fit-btn" onClick={() => void load()}>
              {t('Try again')}
            </button>
          </>
        ) : (
          <p className="muted small">{t('Loading your connected accounts…')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="stack tight">
      <div className="accounts-head">
        <span className="label-text">{t('Choose calendars to read')}</span>
        <span className="accounts-count">{accounts.length}</span>
      </div>

      {accounts.length === 0 && (
        <p className="muted small">{t('Connect Google or Microsoft above, then choose which of its calendars to read.')}</p>
      )}

      {accounts.length > 0 && (
        <ul className="account-list">
          {accounts.map((account) => {
            const label = providers.find((p) => p.id === account.provider)?.label ?? account.provider
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
                        <span className="error">{t('Access was withdrawn — connect again to keep reading it.')}</span>
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
                      {open ? t('Hide') : t('Calendars')}
                    </button>
                  </div>
                </div>

                {open && (
                  <div className="account-calendars">
                    {calendars === null && <p className="muted small">{t('Reading your calendars…')}</p>}
                    {calendars?.length === 0 && <p className="muted small">{t('No calendars this account can read.')}</p>}
                    {calendars?.map((calendar) => (
                      <div className="account-calendar" key={calendar.id}>
                        <div>
                          <p className="account-address">{calendar.name}</p>
                          <p className="muted small">
                            {calendar.primary ? t('Your main calendar') : calendar.accessRole}
                            {calendar.hidden ? ` · ${t('hidden at the source')}` : ''}
                          </p>
                        </div>
                        {calendar.added ? (
                          <span className="tag is-live">{t('Reading')}</span>
                        ) : (
                          <button
                            className="ghost small-btn"
                            onClick={() => void addCalendar(account.id, calendar)}
                            disabled={busy}
                          >
                            {t('Read this')}
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

      {error && <p className="error small">{error}</p>}
    </div>
  )
}
