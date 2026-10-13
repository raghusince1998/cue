import { useEffect, useState } from 'react'
import { findCity, type IntentionDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { t } from '../lib/i18n.tsx'

/**
 * Wishes onto a plan: tick the ones that belong to it, and they become its
 * things to do. Those for the plan's own place come first, then the ones for
 * any time, then everywhere else.
 */
export function WishPicker({
  plan,
  onAdded,
}: {
  plan: { id: string; title: string; placeLabel?: string | null; placeName?: string | null }
  onAdded: (count: number) => void
}) {
  const [wishes, setWishes] = useState<IntentionDTO[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<IntentionDTO[]>('/intentions', { query: { status: 'saved' } })
      .then(setWishes)
      .catch(() => setWishes([]))
  }, [])

  // Where the plan is: its place, or a city its title names.
  const here = [plan.placeLabel, plan.placeName, findCity(plan.title)]
    .filter((p): p is string => Boolean(p))
    .map((p) => p.trim().toLowerCase())
  const rank = (w: IntentionDTO) =>
    w.placeLabel && here.some((h) => h.includes(w.placeLabel!.toLowerCase())) ? 0 : w.placeLabel ? 2 : 1
  const sorted = [...(wishes ?? [])].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))

  // The ones for this place are the obvious ones: ticked to start with.
  useEffect(() => {
    if (wishes) setPicked(wishes.filter((w) => rank(w) === 0).map((w) => w.id))
    // Once, when the wishes arrive.
  }, [wishes])

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ added: number }>(`/commitments/${plan.id}/attach-wishes`, {
        method: 'POST',
        body: { intentionIds: picked },
      })
      announceChange()
      onAdded(r.added)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (wishes === null) return <p className="muted small">{t('Loading your wishlist…')}</p>
  if (wishes.length === 0) {
    return (
      <p className="muted small wish-picker">
        {t('Your wishlist is empty. Add to it on Trips, or type “wishlist: learn swimming, read Deep Work” in the box on Today.')}
      </p>
    )
  }

  return (
    <div className="wish-picker">
      <ul className="plain">
        {sorted.map((w) => (
          <li key={w.id}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={picked.includes(w.id)}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, w.id] : p.filter((x) => x !== w.id)))
                }
              />
              <span>
                {w.title}
                <span className="muted small"> · {w.placeLabel ?? t('any time')}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="error small">{error}</p>}
      <button className="primary small-btn fit-btn" disabled={busy || picked.length === 0} onClick={() => void add()}>
        {busy ? t('Adding…') : picked.length ? t('Add {n} to this plan', { n: picked.length }) : t('Add to this plan')}
      </button>
    </div>
  )
}
