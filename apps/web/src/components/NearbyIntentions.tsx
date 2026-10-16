import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { WINDOW_LABELS, type IntentionDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { getFix } from '../lib/geo.ts'
import { t } from '../lib/i18n.tsx'

interface Near {
  intention: IntentionDTO
  distanceKm: number
}

/**
 * "You are near Mathura — here is what you saved for it."
 *
 * The moment a place-bound wish is actually worth something. Creating a trip
 * surfaces these ahead of time; this catches the case where you simply turn up.
 *
 * Two deliberate limits, both honest:
 *  - It only runs when location permission has *already* been granted. Opening
 *    a planner should not trigger a permission prompt out of nowhere.
 *  - It only runs while the app is open. A browser cannot watch your location
 *    in the background; a real arrival notification needs a native build.
 */
export function NearbyIntentions() {
  const [near, setNear] = useState<Near[]>([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false

    void navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then(async (status) => {
        if (status.state !== 'granted' || cancelled) return
        const fix = await getFix()
        if (cancelled) return
        const r = await api<{ near: Near[] }>('/intentions/nearby', {
          method: 'POST',
          body: { lat: fix.lat, lng: fix.lng },
        })
        if (!cancelled) setNear(r.near)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  const navigate = useNavigate()
  if (dismissed || near.length === 0) return null

  // They are all within the same radius, so the closest names the place.
  const place = near[0]!.intention.placeLabel ?? ''

  return (
    <div className="banner">
      <div>
        <strong>
          {near.length === 1
            ? t('You are near {place} — 1 thing saved for here', { place })
            : t('You are near {place} — {n} things saved for here', { place, n: near.length })}
        </strong>
        <ul className="plain">
          {near.map(({ intention }) => (
            <li key={intention.id} className="muted small">
              {intention.title}
              {intention.preferredWindow
                ? ` · ${t(WINDOW_LABELS[intention.preferredWindow])}`
                : ''}
            </li>
          ))}
        </ul>
      </div>
      <div className="row">
        <button className="ghost small-btn" onClick={() => navigate('/trips')}>
          {t('See them')}
        </button>
        <button className="ghost small-btn" onClick={() => setDismissed(true)}>
          {t('Not now')}
        </button>
      </div>
    </div>
  )
}
