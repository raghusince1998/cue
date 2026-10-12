import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'

interface Status {
  providers: { id: string; label: string; configured: boolean }[]
  accounts: { mailEnabled: boolean }[]
}

const KEY = 'cue.mailAsked'
const NAME: Record<string, string> = { google: 'Gmail', microsoft: 'Outlook' }

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
      const { url } = await api<{ url: string }>(`/oauth/${provider}/connect`, { method: 'POST', body: { purpose: 'mail' } })
      dismiss()
      window.location.assign(url)
    } catch {
      setBusy(false)
    }
  }

  return (
    <section className="card uses-card connect-mail-card">
      <h2 className="section-title">Bookings, parcels and bills, by themselves</h2>
      <p className="muted small">
        Connect your email once. Train and flight tickets, hotel and movie bookings, parcels on their
        way, card dues and electricity bills then turn up here with reminders. Cue opens only emails
        from booking sites, shops, couriers, banks and utilities, and keeps none of them.
      </p>
      <div className="row">
        {usable.map((p) => (
          <button key={p.id} className="primary small-btn" onClick={() => void connect(p.id)} disabled={busy}>
            Connect {NAME[p.id] ?? p.label}
          </button>
        ))}
        <button className="ghost small-btn" onClick={dismiss}>
          Not now
        </button>
      </div>
    </section>
  )
}
