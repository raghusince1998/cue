import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import { t } from '../lib/i18n.tsx'

interface Status {
  providers: { id: string; label: string; configured: boolean }[]
  accounts: { mailEnabled: boolean }[]
}

const KEY = 'cue.mailAsked'
const NAME: Record<string, string> = { google: 'Google', microsoft: 'Microsoft' }

/**
 * Asked once, on Today: let bookings, parcels and bills come in from email
 * on their own. Gone for good after an answer either way.
 */
export function ConnectMailCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [asked, setAsked] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (asked) return
    void api<Status>('/oauth/status')
      .then(setStatus)
      .catch(() => undefined)
  }, [asked])

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // Private mode: it asks again next time, which is harmless.
    }
    setAsked(true)
  }

  const usable = status?.providers.filter((p) => p.configured) ?? []
  if (asked || !status || usable.length === 0 || status.accounts.some((a) => a.mailEnabled)) return null

  async function connect(provider: string) {
    setBusy(true)
    try {
      const { url } = await api<{ url: string }>(`/oauth/${provider}/connect`, { method: 'POST', body: { purpose: 'all' } })
      dismiss()
      window.location.assign(url)
    } catch {
      setBusy(false)
    }
  }

  return (
    <section className="card uses-card connect-mail-card">
      <h2 className="section-title">{t('Connect once, and things come in by themselves')}</h2>
      <p className="muted small">
        {t(
          'Your calendar, plus what your email already says: train and flight tickets, parcels, card and electricity bills, insurance, PUC, service dues, FASTag and challans, exam registrations and admit cards, each with a reminder. One step. Email is read-only and only from the senders that send these; none of it is kept.',
        )}
      </p>
      <div className="row">
        {usable.map((p) => (
          <button key={p.id} className="primary small-btn" onClick={() => void connect(p.id)} disabled={busy}>
            {t('Connect {name}', { name: NAME[p.id] ?? p.label })}
          </button>
        ))}
        <button className="ghost small-btn" onClick={dismiss}>
          {t('Not now')}
        </button>
      </div>
    </section>
  )
}
