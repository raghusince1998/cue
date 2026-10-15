import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { relativeDay } from '../lib/time.ts'
import { msg, t } from '../lib/i18n.tsx'

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
  calendarCount: number
  calendarAccess: boolean
  mailEnabled: boolean
  mailCheckedAt: string | null
  mailError: string | null
}

interface Find {
  found: string
  at: string
  email: string
}

interface Setup {
  calendar: { name: string; events: number } | null
  mail: { found: string[] } | null
  errors: string[]
}

/** What each provider brings, said the way people know them. Show the button with t(). */
const WHAT: Record<string, { name: string; button: string }> = {
  google: { name: 'Google', button: msg('Connect Google: Calendar + Gmail') },
  microsoft: { name: 'Microsoft', button: msg('Connect Microsoft: Outlook + Calendar') },
}

/** Codes the sign-in round trip can come back with; the wording lives here. Shown through outcomeOf. */
const OUTCOME: Record<string, { text: string; bad: boolean }> = {
  mail_connected: { text: msg('Email connected. Cue is looking through the last two weeks now.'), bad: false },
  mail_scope_missing: {
    text: msg('Email permission was not granted. Connect again and leave the box for reading email ticked.'),
    bad: true,
  },
  scope_missing: {
    text: msg('Neither calendar nor email access was granted. Connect again and leave the boxes ticked.'),
    bad: true,
  },
  cancelled: { text: msg('No change — you cancelled at the sign-in screen.'), bad: false },
  access_denied: { text: msg('No change — you cancelled at the sign-in screen.'), bad: false },
  no_refresh_token: {
    text: msg('That account did not grant lasting access. Remove Cue from your account permissions, then connect again.'),
    bad: true,
  },
}

/** The outcome for a code, in the reader's language. */
function outcomeOf(code: string): { text: string; bad: boolean } {
  const known = OUTCOME[code]
  return known
    ? { text: t(known.text), bad: known.bad }
    : { text: t('That did not work. Try connecting again.'), bad: true }
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return (err.data as { message?: string })?.message ?? err.message
  return (err as Error).message
}

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return t('just now')
  if (minutes < 60) return t('{n} min ago', { n: minutes })
  if (minutes < 24 * 60) return t('{n} h ago', { n: Math.round(minutes / 60) })
  return relativeDay(iso)
}

/**
 * Connected accounts, in one place and one step: a Google or Microsoft
 * account brings its calendar and — read-only, from the senders that send
 * them — bookings, parcels, bills, insurance, PUC and service reminders from
 * its email. The main calendar is mirrored and the email read straight away,
 * so there is nothing left to pick.
 */
export function Integrations({ onChanged }: { onChanged?: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [finds, setFinds] = useState<Find[]>([])
  const [busy, setBusy] = useState<string | null>(null)
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

  const finish = useCallback(
    async (accountId: string) => {
      setBusy('setup')
      setNote({ text: t('Connected. Bringing in your calendar and looking through your email…'), bad: false })
      try {
        const r = await api<Setup>(`/oauth/accounts/${accountId}/setup`, { method: 'POST', body: {} })
        const parts = [
          r.calendar
            ? !r.calendar.events
              ? t('Your calendar “{name}” is in.', { name: r.calendar.name })
              : r.calendar.events === 1
                ? t('Your calendar “{name}” is in (1 event).', { name: r.calendar.name })
                : t('Your calendar “{name}” is in ({n} events).', { name: r.calendar.name, n: r.calendar.events })
            : null,
          r.mail
            ? r.mail.found.length
              ? t('Found in your email: {list}.', { list: r.mail.found.join(' · ') })
              : t('Nothing to add from your email yet; Cue checks again every 15 minutes.')
            : null,
          ...r.errors,
        ].filter(Boolean)
        setNote({ text: parts.join(' '), bad: r.errors.length > 0 && !r.calendar && !r.mail })
        announceChange()
        onChanged?.()
      } catch (err) {
        setNote({ text: messageOf(err), bad: true })
      } finally {
        setBusy(null)
        await load()
      }
    },
    [load, onChanged],
  )

  // Back from the provider, or sent here from Today.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('connected')
    const asked = params.get('settings') === 'connect' || params.get('settings') === 'mail'
    const mine = code && (code.startsWith('all_connected') || code.startsWith('mail') || (code !== 'connected' && OUTCOME[code]))
    if (!asked && !mine) return
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'start' }))
    params.delete('settings')
    if (mine) params.delete('connected')
    const rest = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
    if (code?.startsWith('all_connected:')) void finish(code.split(':')[1]!)
    else if (code === 'mail_connected') {
      setNote(outcomeOf('mail_connected'))
      void checkNow()
    } else if (code && mine) setNote(outcomeOf(code))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect(provider: string) {
    setBusy(provider)
    setNote(null)
    try {
      const { url } = await api<{ url: string }>(`/oauth/${provider}/connect`, { method: 'POST', body: { purpose: 'all' } })
      window.location.assign(url)
    } catch (err) {
      setNote({ text: messageOf(err), bad: true })
      setBusy(null)
    }
  }

  async function checkNow() {
    setBusy('check')
    try {
      const r = await api<{ found: string[]; errors: string[] }>('/mail/check', { method: 'POST', body: {} })
      setNote(
        r.errors.length
          ? { text: r.errors.join(' '), bad: true }
          : {
              text: r.found.length
                ? t('Found {n}: {list}', { n: r.found.length, list: r.found.join(' · ') })
                : t('Nothing new in your email.'),
              bad: false,
            },
      )
      if (r.found.length) announceChange()
    } catch (err) {
      setNote({ text: messageOf(err), bad: true })
    } finally {
      setBusy(null)
      await load()
    }
  }

  async function stopMail(account: Account) {
    if (!window.confirm(t('Stop reading email from {email}? What was already found stays.', { email: account.email }))) return
    await api(`/oauth/accounts/${account.id}/mail-off`, { method: 'POST', body: {} })
    await load()
  }

  async function disconnect(account: Account) {
    if (
      !window.confirm(
        t('Disconnect {email}? Its calendar stops mirroring and its email is no longer read.', { email: account.email }),
      )
    )
      return
    const r = await api<{ alsoRemoveAt: string | null }>(`/oauth/accounts/${account.id}`, { method: 'DELETE' })
    setNote(
      r.alsoRemoveAt
        ? { text: t('Disconnected. To finish, remove Cue at {url}.', { url: r.alsoRemoveAt }), bad: false }
        : { text: t('Disconnected.'), bad: false },
    )
    await load()
    onChanged?.()
  }

  const usable = providers.filter((p) => p.configured)

  return (
    <div className="stack tight integrations" ref={root}>
      <p className="muted small">
        {t(
          'One step: your calendar comes in, and Cue finds train and flight tickets, parcels, card and electricity bills, insurance, PUC, service dues, FASTag top-ups and traffic challans in your email, with reminders. Email is read-only, only from the senders that send these, and no email is kept.',
        )}
      </p>

      {accounts.map((a) => {
        const needsMore = !a.calendarAccess || !a.mailEnabled
        return (
          <div key={a.id} className="integration">
            <div className="integration-head">
              <strong>{a.email}</strong>
              <span className="muted small">{WHAT[a.provider]?.name ?? a.provider}</span>
            </div>
            <div className="chips">
              <span className={`tag${a.calendarAccess && a.calendarCount ? ' is-live' : ''}`}>
                {a.calendarAccess
                  ? a.calendarCount
                    ? t('Calendar · {n} mirrored', { n: a.calendarCount })
                    : t('Calendar · none chosen')
                  : t('Calendar off')}
              </span>
              <span className={`tag${a.mailEnabled && !a.mailError ? ' is-live' : a.mailError ? ' is-warn' : ''}`}>
                {a.mailEnabled
                  ? a.mailError
                    ? t('Email · last look failed')
                    : a.mailCheckedAt
                      ? t('Email · checked {when}', { when: ago(a.mailCheckedAt) })
                      : t('Email · first look under way')
                  : t('Email off')}
              </span>
              {a.status !== 'active' && <span className="tag is-warn">{t('Needs connecting again')}</span>}
            </div>
            {a.mailError && <p className="error small">{a.mailError}</p>}
            <div className="row">
              {a.mailEnabled && (
                <button className="ghost small-btn" onClick={() => void checkNow()} disabled={busy !== null}>
                  {busy === 'check' ? t('Looking…') : t('Check email now')}
                </button>
              )}
              {(needsMore || a.status !== 'active') && (
                <button className="primary small-btn" onClick={() => void connect(a.provider)} disabled={busy !== null}>
                  {a.status !== 'active' ? t('Connect again') : !a.mailEnabled ? t('Turn on email too') : t('Turn on calendar too')}
                </button>
              )}
              {a.calendarAccess && !a.calendarCount && (
                <button className="ghost small-btn" onClick={() => void finish(a.id)} disabled={busy !== null}>
                  {t('Add my main calendar')}
                </button>
              )}
              {a.mailEnabled && (
                <button className="link small" onClick={() => void stopMail(a)}>
                  {t('Stop reading email')}
                </button>
              )}
              <button className="link small danger-text" onClick={() => void disconnect(a)}>
                {t('Disconnect')}
              </button>
            </div>
          </div>
        )
      })}

      {usable.length === 0 ? (
        <p className="muted small">{t('This server has no Google or Microsoft sign-in set up yet.')}</p>
      ) : (
        <div className="row">
          {usable.map((p) => (
            <button
              key={p.id}
              className={accounts.length ? 'ghost small-btn' : 'primary small-btn'}
              onClick={() => void connect(p.id)}
              disabled={busy !== null}
            >
              {busy === p.id
                ? t('Opening…')
                : accounts.some((a) => a.provider === p.id)
                  ? t('Add another {name} account', { name: WHAT[p.id]?.name ?? p.label })
                  : WHAT[p.id]
                    ? t(WHAT[p.id]!.button)
                    : t('Connect {name}', { name: p.label })}
            </button>
          ))}
        </div>
      )}

      {note && <p className={`small ${note.bad ? 'error' : 'muted'}`}>{note.text}</p>}

      {finds.length > 0 && (
        <details className="mail-found">
          <summary className="small">{t('Found in your email · {n}', { n: finds.length })}</summary>
          <ul className="plain mail-finds">
            {finds.map((f, i) => (
              <li key={i}>
                {f.found} <span className="muted">· {ago(f.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
