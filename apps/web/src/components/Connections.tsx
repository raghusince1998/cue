import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import { t } from '../lib/i18n.tsx'
import { CalendarFeeds } from './CalendarFeeds.tsx'
import { Fold } from './Fold.tsx'
import { Integrations } from './Integrations.tsx'

interface Status {
  accounts: { email: string; mailEnabled: boolean; calendarCount: number; status: string }[]
}

/** Back from Google or Microsoft, or sent here from Today: open, so the result is the first thing seen. */
function arrivedToConnect(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.has('connected') || params.get('settings') === 'connect' || params.get('settings') === 'mail'
}

/**
 * Email and calendars, in one place: the Google or Microsoft accounts
 * connected — what each one's email and calendar is doing — then which
 * calendars Cue reads and how. Closed, one line says where it stands.
 */
export function Connections() {
  const [status, setStatus] = useState<Status | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await api<Status>('/oauth/status'))
    } catch {
      // The summary line just stays as it was; the section itself says what went wrong.
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const accounts = status?.accounts ?? []
  const calendars = accounts.reduce((n, a) => n + a.calendarCount, 0)
  const summary =
    status === null
      ? null
      : accounts.length === 0
        ? t('Not connected yet: Gmail or Outlook, and your calendar')
        : [
            accounts.map((a) => a.email).join(', '),
            accounts.some((a) => a.mailEnabled) ? t('email on') : t('email off'),
            calendars === 1 ? t('1 calendar') : t('{n} calendars', { n: calendars }),
            accounts.some((a) => a.status !== 'active') ? t('needs connecting again') : null,
          ]
            .filter(Boolean)
            .join(' · ')

  return (
    <Fold title={t('Email & calendars')} summary={summary} defaultOpen={arrivedToConnect()} onToggle={() => void load()}>
      <Integrations onChanged={() => void load()} />
      <div className="fold-divider" />
      <CalendarFeeds pickerOnly />
    </Fold>
  )
}
