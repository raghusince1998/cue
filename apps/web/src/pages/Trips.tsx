import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  STRICTNESS_LABELS,
  TIME_WINDOWS,
  TRIP_STRICTNESS,
  WINDOW_LABELS,
  type TimeWindow,
  type IntentionDTO,
  type TripDTO,
  type TripStrictness,
} from '@cue/shared'
import { api } from '../lib/api.ts'
import { locale, t } from '../lib/i18n.tsx'
import { dayLabel, spanLabel, toDateInputValue } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { TripDetail } from '../components/TripDetail.tsx'
import { useOnChange } from '../lib/changes.ts'
import { LoadFailed } from '../components/LoadFailed.tsx'

function whenLabel(trip: TripDTO): string {
  const { daysUntil, nights } = trip
  const length = nights === 0 ? t('day trip') : t('{n} days', { n: nights + 1 })
  if (daysUntil > 1) return t('in {n} days · {length}', { n: daysUntil, length })
  if (daysUntil === 1) return t('tomorrow · {length}', { length })
  if (daysUntil === 0) return t('starts today · {length}', { length })
  const ended = new Date(`${trip.endsOn}T23:59:59`) < new Date()
  return ended ? t('finished · {length}', { length }) : t('you are there now · {length}', { length })
}

function NewTrip({
  onCreated,
  prefill,
}: {
  /** With the trip's id when it should open now: things were saved for there. */
  onCreated: (openId?: string) => void
  /** "Plan a trip" on a place in Want to visit: the form opens with it filled in. */
  prefill: { place: string; key: number } | null
}) {
  const today = new Date()
  const [open, setOpen] = useState(false)
  const [placeLabel, setPlaceLabel] = useState('')

  useEffect(() => {
    if (!prefill) return
    setPlaceLabel(prefill.place)
    setOpen(true)
  }, [prefill])
  const [startsOn, setStartsOn] = useState(toDateInputValue(today))
  const [endsOn, setEndsOn] = useState(toDateInputValue(today))
  const [strictness, setStrictness] = useState<TripStrictness>('flexible')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ trip: TripDTO; waiting: IntentionDTO[] } | null>(null)

  async function create() {
    setBusy(true)
    try {
      const result = await api<{ trip: TripDTO; waiting: IntentionDTO[] }>('/trips', {
        method: 'POST',
        body: { placeLabel: placeLabel.trim(), startsOn, endsOn, strictness },
      })
      // The whole reason intentions are stored without a date: this moment.
      if (result.waiting.length > 0) setFound(result)
      else {
        setOpen(false)
        onCreated()
      }
      setPlaceLabel('')
    } finally {
      setBusy(false)
    }
  }

  if (found) {
    return (
      <Modal
        title={
          found.waiting.length === 1
            ? t('1 thing saved for {place}', { place: found.trip.placeLabel })
            : t('{n} things saved for {place}', { n: found.waiting.length, place: found.trip.placeLabel })
        }
        onClose={() => {
          setFound(null)
          setOpen(false)
          onCreated()
        }}
      >
        <div className="stack tight">
          <p className="muted small">
            {t('You wanted these whenever you next went. Open the trip to schedule them.')}
          </p>
          <ul className="plain">
            {found.waiting.map((w) => (
              <li key={w.id} className="voice-note">
                <span className="commitment-title">{w.title}</span>
                <br />
                <span className="muted small">
                  {w.preferredWindow ? t(WINDOW_LABELS[w.preferredWindow]) : t('Any time')} ·{' '}
                  {t('{n} min', { n: w.durationMinutes })}
                </span>
              </li>
            ))}
          </ul>
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                const id = found.trip.id
                setFound(null)
                setOpen(false)
                onCreated(id)
              }}
            >
              {t('Open the trip')}
            </button>
            <button
              className="ghost"
              onClick={() => {
                setFound(null)
                setOpen(false)
                onCreated()
              }}
            >
              {t('Later')}
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (!open) {
    return (
      <button className="primary fit-btn" onClick={() => setOpen(true)}>
        {t('Plan a trip')}
      </button>
    )
  }

  return (
    <section className="card">
      <label>
        {t('Where are you going?')}
        <input
          value={placeLabel}
          onChange={(e) => setPlaceLabel(e.target.value)}
          placeholder="Pune"
          autoFocus
        />
      </label>
      <div className="row">
        <label className="grow">
          {t('From')}
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </label>
        <label className="grow">
          {t('To')}
          <input
            type="date"
            min={startsOn}
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </label>
      </div>

      <span className="label-text">{t('How fixed is being there?')}</span>
      <div className="chips">
        {TRIP_STRICTNESS.map((s) => (
          <button
            key={s}
            className={`chip${strictness === s ? ' selected' : ''}`}
            onClick={() => setStrictness(s)}
          >
            {t(STRICTNESS_LABELS[s])}
          </button>
        ))}
      </div>
      <p className="muted small">
        {t(
          'This decides how loudly the app objects when something elsewhere lands in the middle of the trip.',
        )}
      </p>

      <div className="row">
        <button
          className="primary"
          onClick={create}
          disabled={busy || !placeLabel.trim() || endsOn < startsOn}
        >
          {busy ? t('Saving…') : t('Save trip')}
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          {t('Cancel')}
        </button>
      </div>
    </section>
  )
}

/**
 * The wishlist: what you want to do, somewhere or any time, written down long
 * before there is a trip or a plan to do it on.
 *
 * Kept deliberately dateless: "when I'm in Pune, visit Apollo Clinic" must not
 * become a reminder for tomorrow. It waits until a Pune trip appears — and
 * each place says whether one is coming, or offers to plan it.
 */
function Wishlist({
  onChanged,
  upcoming,
  onPlan,
}: {
  onChanged: () => void
  /** Trips still to come, to say which places already have one. */
  upcoming: TripDTO[]
  onPlan: (place: string) => void
}) {
  const [items, setItems] = useState<IntentionDTO[]>([])
  const [placeLabel, setPlaceLabel] = useState('')
  const [what, setWhat] = useState('')
  const [window, setWindow] = useState<TimeWindow | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setItems(await api<IntentionDTO[]>('/intentions', { query: { status: 'saved' } }))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Several at once: one per line, or separated by commas.
  const titles = what
    .split(/\n|,|;/)
    .map((line) => line.trim())
    .filter(Boolean)
  const place = placeLabel.trim()

  async function add() {
    if (titles.length === 0) return
    setBusy(true)
    setNote(null)
    try {
      const r = await api<{ matchingTrips: { startsOn: string }[] }>('/intentions/batch', {
        method: 'POST',
        body: { placeLabel: place || null, titles, preferredWindow: window },
      })
      const n = titles.length
      const one = n === 1
      setWhat('')
      setNote(
        !place
          ? one
            ? t('Saved for any time. Add them to a plan from its details when it suits.')
            : t('{n} saved for any time. Add them to a plan from its details when it suits.', { n })
          : r.matchingTrips.length > 0
            ? one
              ? t('Saved, and you already have a trip to {place} on {date}.', {
                  place,
                  date: dayLabel(r.matchingTrips[0]!.startsOn),
                })
              : t('{n} saved, and you already have a trip to {place} on {date}.', {
                  n,
                  place,
                  date: dayLabel(r.matchingTrips[0]!.startsOn),
                })
            : one
              ? t('Saved. They will show up when you plan a trip to {place}.', { place })
              : t('{n} saved. They will show up when you plan a trip to {place}.', { n, place }),
      )
      await load()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function drop(id: string) {
    await api(`/intentions/${id}`, { method: 'DELETE' })
    await load()
    onChanged()
  }

  // By place, with the ones for any time last.
  const byPlace = new Map<string, IntentionDTO[]>()
  for (const item of items) {
    const key = item.placeLabel ?? ''
    byPlace.set(key, [...(byPlace.get(key) ?? []), item])
  }
  const groups = [...byPlace.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  const places = groups.filter(([p]) => p !== '').length

  const tripTo = (p: string) =>
    upcoming.find((trip) => trip.placeLabel.trim().toLowerCase() === p.trim().toLowerCase()) ?? null

  return (
    <section className="card saved-for-trip">
      <div className="saved-intro">
        <div className="wish-head">
          <h2 className="section-title">{t('Wishlist')}</h2>
          {items.length > 0 && (
            <span className="page-count">
              {items.length === 1 ? t('1 wish') : t('{n} wishes', { n: items.length })}
              {places > 0 ? ` · ${places === 1 ? t('1 place') : t('{n} places', { n: places })}` : ''}
            </span>
          )}
        </div>
        <p className="muted small">
          {t(
            'What you want to do, somewhere or any time. Wishes for a place wait for a trip there and go on it together; the rest wait for a plan to add them to.',
          )}
        </p>
      </div>

      <div className="saved-form">
        <textarea
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          rows={3}
          placeholder={'Visit Hawa Mahal\nBuy lakh chudi'}
          aria-label={t('What do you want to do?')}
        />
        <input
          value={placeLabel}
          onChange={(e) => setPlaceLabel(e.target.value)}
          placeholder={t('Where? (optional) e.g. {example}', { example: 'Jaipur' })}
          aria-label={t('Where')}
          list="wish-places"
        />
        <datalist id="wish-places">
          {groups
            .filter(([p]) => p !== '')
            .map(([p]) => (
              <option key={p} value={p} />
            ))}
        </datalist>
        <p className="muted small">{t('One per line, or separate them with commas.')}</p>
        <div className="chips">
          {TIME_WINDOWS.map((w) => (
            <button
              key={w}
              className={`chip${window === w ? ' selected' : ''}`}
              onClick={() => setWindow(window === w ? null : w)}
            >
              {t(WINDOW_LABELS[w])}
            </button>
          ))}
        </div>
        <button className="primary small-btn fit-btn" disabled={busy || titles.length === 0} onClick={add}>
          {titles.length > 1
            ? place
              ? t('Save {n} for {place}', { n: titles.length, place })
              : t('Save {n} for any time', { n: titles.length })
            : place
              ? t('Save it for {place}', { place })
              : t('Save it')}
        </button>
        {note && <p className="muted small">{note}</p>}
      </div>

      <div className="saved-list">
        {groups.length === 0 && (
          <p className="muted small">
            {t('Nothing yet. Add a few above, or type “{example}” in the box on Today.', {
              example: 'Jaipur: visit Hawa Mahal, buy lakh chudi',
            })}
          </p>
        )}
        {groups.map(([p, list]) => {
          const trip = p ? tripTo(p) : null
          return (
            <div key={p || 'any time'} className="wish-place">
              <div className="wish-place-head">
                <span className="label-text">
                  {p || t('Any time')} · {list.length}
                </span>
                {!p ? (
                  <span className="muted small">{t('Add to any plan from its details')}</span>
                ) : trip ? (
                  <span className="tag is-live">{t('Trip {span}', { span: spanLabel(trip.startsOn, trip.endsOn) })}</span>
                ) : (
                  <button className="link small" onClick={() => onPlan(p)}>
                    {t('Plan a trip')} &rarr;
                  </button>
                )}
              </div>
              <ul className="plain">
                {list.map((item) => (
                  <li key={item.id} className="commitment-head">
                    <span className="muted small">
                      {item.title}
                      {item.preferredWindow ? ` · ${t(WINDOW_LABELS[item.preferredWindow])}` : ''}
                    </span>
                    <button className="link danger-link" onClick={() => void drop(item.id)}>
                      {t('Remove')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default function Trips() {
  const [trips, setTrips] = useState<TripDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  /** "Plan a trip" from Want to visit: the form, opened for that place. */
  const [prefill, setPrefill] = useState<{ place: string; key: number } | null>(null)

  const [failed, setFailed] = useState(false)
  const load = useCallback(async () => {
    try {
      setTrips(await api<TripDTO[]>('/trips'))
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // "going to Agra 2 to 4 Oct" typed from the header lands here.
  useOnChange(() => void load())

  // /trips?trip=<id>: a notification, an insight or a search result naming one.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const id = params.get('trip')
    if (!id) return
    setOpenId(id)
    params.delete('trip')
    setParams(params, { replace: true })
  }, [params, setParams])

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  if (failed && trips.length === 0) {
    return (
      <LoadFailed
        what={t('Could not load your trips just now.')}
        onRetry={() => {
          setLoading(true)
          void load()
        }}
      />
    )
  }

  const now = new Date()
  const upcoming = trips.filter((trip) => new Date(`${trip.endsOn}T23:59:59`) >= now)
  const past = trips.filter((trip) => new Date(`${trip.endsOn}T23:59:59`) < now)

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">{t('Trips')}</h1>
        <span className="page-count">
          {t('{n} coming up', { n: upcoming.length })}
          {past.length > 0 ? ` · ${t('{n} been and gone', { n: past.length })}` : ''}
        </span>
      </div>

      {/* Trips on the left; what you want to do in places, beside them. */}
      <div className="trips-layout">
      <div className="trips-main stack">
      <NewTrip
        onCreated={(id) => {
          void load()
          if (id) setOpenId(id)
        }}
        prefill={prefill}
      />

      {trips.length === 0 && (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#9992;
          </span>
          <h3>{t('No journeys planned')}</h3>
          <p>
            {t(
              'Plan one and everything you want to do there surfaces on its own: the place you meant to see, the friend or client you meant to meet. Say “{example}” in the box on Today, or use Plan a trip.',
              { example: 'going to Pune 12 to 14 Oct' },
            )}
          </p>
        </div>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="section-title">{t('Coming up')}</h2>
          <div className="tiles two-up">
            {upcoming.map((trip) => {
              const start = new Date(`${trip.startsOn}T00:00:00`)
              return (
                <article
                  key={trip.id}
                  className="tile is-tappable"
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId(trip.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setOpenId(trip.id)
                    }
                  }}
                >
                  <span className="tile-mark is-trip" aria-hidden>
                    <span className="mark-top">
                      {start.toLocaleDateString(locale(), { month: 'short' })}
                    </span>
                    <span className="mark-main">{start.getDate()}</span>
                  </span>

                  <div className="tile-body">
                    <p className="tile-title">{trip.placeLabel}</p>
                    {/* Written the way a person writes it, not the way the
                        column is stored. */}
                    <p className="tile-sub">
                      {spanLabel(trip.startsOn, trip.endsOn)} · {whenLabel(trip)}
                    </p>

                    <div className="tile-tags">
                      {Boolean(trip.plannedCount) && (
                        <span className="tag">{t('{n} planned', { n: trip.plannedCount! })}</span>
                      )}
                      {Boolean(trip.waitingCount) && (
                        <span className="tag is-live">
                          {t('{n} waiting for you there', { n: trip.waitingCount! })}
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="tile-chevron" aria-hidden>
                    ›
                  </span>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="section-title muted-title">{t('Been and gone')}</h2>
          <div className="tiles two-up">
            {past.map((trip) => (
              <article
                  key={trip.id}
                  className="tile dimmed is-tappable"
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId(trip.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setOpenId(trip.id)
                    }
                  }}
                >
                <span className="tile-mark" aria-hidden>
                  <span className="mark-top">
                    {new Date(`${trip.startsOn}T00:00:00`).toLocaleDateString(locale(), { month: 'short' })}
                  </span>
                  <span className="mark-main">
                    {new Date(`${trip.startsOn}T00:00:00`).getDate()}
                  </span>
                </span>
                <div className="tile-body">
                  <p className="tile-title">{trip.placeLabel}</p>
                  <p className="tile-sub">{spanLabel(trip.startsOn, trip.endsOn)}</p>
                </div>
                <span className="tile-chevron" aria-hidden>
                  ›
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      </div>

      <aside className="trips-aside">
        <Wishlist
          onChanged={load}
          upcoming={upcoming}
          onPlan={(place) => {
            setPrefill({ place, key: Date.now() })
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      </aside>
      </div>

      {openId && (
        <Modal title={t('Trip')} onClose={() => setOpenId(null)}>
          <TripDetail
            tripId={openId}
            onClose={() => setOpenId(null)}
            onChanged={() => void load()}
          />
        </Modal>
      )}
    </div>
  )
}
