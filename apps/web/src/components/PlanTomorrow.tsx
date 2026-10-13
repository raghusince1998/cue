import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import { locale, t } from '../lib/i18n.tsx'

/**
 * Tomorrow, already worked out.
 *
 * The other half of the evening nudge. The notification says what it found;
 * this is where the whole thing is accepted in one press, with every placement
 * and its reason visible first — an assistant that rearranges your day without
 * showing its working is one you stop trusting after the first surprise.
 */

interface Proposal {
  commitmentId: string
  title: string
  at: string
  durationMinutes: number
  because: string
}

interface Plan {
  date: string
  loose: number
  proposals: Proposal[]
  unplaceable: { commitmentId: string; title: string; because: string }[]
  percentBooked: number
  fixedCount: number
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
}

export function PlanTomorrow({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Plan>('/plan/tomorrow')
      .then(setPlan)
      .catch((err) => setError((err as Error).message))
  }, [])

  async function apply() {
    if (!plan) return
    const taking = plan.proposals.filter((p) => !skipped.includes(p.commitmentId))
    if (taking.length === 0) return onClose()

    setBusy(true)
    try {
      const r = await api<{ applied: number }>('/plan/tomorrow', {
        method: 'POST',
        body: { proposals: taking.map((p) => ({ commitmentId: p.commitmentId, at: p.at })) },
      })
      setDone(r.applied)
      onApplied()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="error small">{error}</p>
  if (!plan) return <p className="muted small">{t('Working out tomorrow…')}</p>

  if (done !== null) {
    return (
      <div className="stack tight">
        <strong>
          {done === 1
            ? t('1 thing scheduled for tomorrow.')
            : t('{n} things scheduled for tomorrow.', { n: done })}
        </strong>
        <p className="muted small">
          {t('They are ordinary plans now — move or cancel any of them as usual.')}
        </p>
        <button className="primary" onClick={onClose}>
          {t('Good')}
        </button>
      </div>
    )
  }

  const taking = plan.proposals.filter((p) => !skipped.includes(p.commitmentId))

  return (
    <div className="stack tight">
      <p className="muted small">
        {plan.fixedCount === 1
          ? t('1 fixed thing tomorrow — {pct}% of the day. Here is where the rest could go.', {
              pct: plan.percentBooked,
            })
          : t('{n} fixed things tomorrow — {pct}% of the day. Here is where the rest could go.', {
              n: plan.fixedCount,
              pct: plan.percentBooked,
            })}
      </p>

      {plan.proposals.length === 0 && plan.unplaceable.length === 0 && (
        <p className="muted">{t('Nothing is waiting for a time. Tomorrow is already settled.')}</p>
      )}

      {plan.proposals.map((p) => {
        const off = skipped.includes(p.commitmentId)
        return (
          <div className={`plan-row${off ? ' is-off' : ''}`} key={p.commitmentId}>
            <div>
              <strong>{p.title}</strong>
              <p className="muted small">
                {clock(p.at)} · {t('{n} min', { n: p.durationMinutes })} — {p.because}
              </p>
            </div>
            <button
              className="ghost small-btn"
              onClick={() =>
                setSkipped((s) =>
                  off ? s.filter((id) => id !== p.commitmentId) : [...s, p.commitmentId],
                )
              }
            >
              {off ? t('Include') : t('Skip')}
            </button>
          </div>
        )
      })}

      {/* Said out loud rather than quietly dropped: "no room" is information. */}
      {plan.unplaceable.map((u) => (
        <div className="plan-row is-stuck" key={u.commitmentId}>
          <div>
            <strong>{u.title}</strong>
            <p className="muted small">{u.because}</p>
          </div>
        </div>
      ))}

      <div className="row">
        <button className="primary" onClick={() => void apply()} disabled={busy || taking.length === 0}>
          {busy
            ? t('Scheduling…')
            : taking.length === 0
              ? t('Nothing selected')
              : taking.length === plan.proposals.length
                ? t('Schedule all')
                : t('Schedule {n}', { n: taking.length })}
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          {t('Not now')}
        </button>
      </div>
    </div>
  )
}
