import { useCallback, useEffect, useState } from 'react'
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
import { spanLabel, toDateInputValue } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { TripDetail } from '../components/TripDetail.tsx'
import { useOnChange } from '../lib/changes.ts'

function whenLabel(trip: TripDTO): string {
  const { daysUntil, nights } = trip
  const length = nights === 0 ? 'day trip' : `${nights + 1} days`
  if (daysUntil > 1) return `in ${daysUntil} days · ${length}`
  if (daysUntil === 1) return `tomorrow · ${length}`
  if (daysUntil === 0) return `starts today · ${length}`
  const ended = new Date(`${trip.endsOn}T23:59:59`) < new Date()
  return ended ? `finished · ${length}` : `you are there now · ${length}`
}

function NewTrip({
  onCreated,
  prefill,
}: {
  onCreated: () => void
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
        title={`${found.waiting.length} things saved for ${found.trip.placeLabel}`}
        onClose={() => {
          setFound(null)
          setOpen(false)
          onCreated()
        }}
      >
        <div className="stack tight">
          <p className="muted small">
            You wanted these whenever you next went. Open the trip to schedule them.
          </p>
          <ul className="plain">
            {found.waiting.map((w) => (
              <li key={w.id} className="voice-note">
                <span className="commitment-title">{w.title}</span>
                <br />
                <span className="muted small">
                  {w.preferredWindow ? WINDOW_LABELS[w.preferredWindow] : 'Any time'} ·{' '}
                  {w.durationMinutes} min
                </span>
              </li>
            ))}
          </ul>
          <button
            className="primary"
            onClick={() => {
              setFound(null)
              setOpen(false)
              onCreated()
            }}
          >
            Got it
          </button>
        </div>
      </Modal>
    )
  }

  if (!open) {
    return (
      <button className="primary fit-btn" onClick={() => setOpen(true)}>
        Plan a trip
      </button>
    )
  }

  return (
    <section className="card">
      <label>
        Where are you going?
        <input
          value={placeLabel}
          onChange={(e) => setPlaceLabel(e.target.value)}
          placeholder="Pune"
          autoFocus
        />
      </label>
      <div className="row">
        <label className="grow">
          From
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </label>
        <label className="grow">
          To
          <input
            type="date"
            min={startsOn}
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </label>
      </div>

      <span className="label-text">How fixed is being there?</span>
      <div className="chips">
        {TRIP_STRICTNESS.map((s) => (
          <button
            key={s}
            className={`chip${strictness === s ? ' selected' : ''}`}
            onClick={() => setStrictness(s)}
          >
            {STRICTNESS_LABELS[s]}
          </button>
        ))}
      </div>
      <p className="muted small">
        This decides how loudly the app objects when something elsewhere lands in the middle of
        the trip.
      </p>

      <div className="row">
        <button
          className="primary"
          onClick={create}
          disabled={busy || !placeLabel.trim() || endsOn < startsOn}
        >
          {busy ? 'Saving…' : 'Save trip'}
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
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
    .map((t) => t.trim())
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
      const n = titles.length === 1 ? 'Saved' : `${titles.length} saved`
      setWhat('')
      setNote(
        !place
          ? `${n} for any time. Add them to a plan from its details when it suits.`
          : r.matchingTrips.length > 0
            ? `${n}, and you already have a trip to ${place} on ${r.matchingTrips[0]!.startsOn}.`
            : `${n}. They will show up when you plan a trip to ${place}.`,
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
    upcoming.find((t) => t.placeLabel.trim().toLowerCase() === p.trim().toLowerCase()) ?? null

  return (
    <section className="card saved-for-trip">
      <div className="saved-intro">
        <div className="wish-head">
          <h2 className="section-title">Wishlist</h2>
          {items.length > 0 && (
            <span className="page-count">
              {items.length} {items.length === 1 ? 'wish' : 'wishes'}
              {places > 0 ? ` · ${places} ${places === 1 ? 'place' : 'places'}` : ''}
            </span>
          )}
        </div>
        <p className="muted small">
          What you want to do, somewhere or any time. Wishes for a place wait for a trip there and
          go on it together; the rest wait for a plan to add them to.
        </p>
      </div>

      <div className="saved-form">
        <textarea
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          rows={3}
          placeholder={'Visit Hawa Mahal\nBuy lakh chudi'}
          aria-label="What do you want to do?"
        />
        <input
          value={placeLabel}
          onChange={(e) => setPlaceLabel(e.target.value)}
          placeholder="Where? (optional) e.g. Jaipur"
          aria-label="Where"
          list="wish-places"
        />
        <datalist id="wish-places">
          {groups
            .filter(([p]) => p !== '')
            .map(([p]) => (
              <option key={p} value={p} />
            ))}
        </datalist>
        <p className="muted small">One per line, or separate them with commas.</p>
        <div className="chips">
          {TIME_WINDOWS.map((w) => (
            <button
              key={w}
              className={`chip${window === w ? ' selected' : ''}`}
              onClick={() => setWindow(window === w ? null : w)}
            >
              {WINDOW_LABELS[w]}
            </button>
          ))}
        </div>
        <button className="primary small-btn fit-btn" disabled={busy || titles.length === 0} onClick={add}>
          {titles.length > 1
            ? `Save ${titles.length} ${place ? `for ${place}` : 'for any time'}`
            : place
              ? `Save it for ${place}`
              : 'Save it'}
        </button>
        {note && <p className="muted small">{note}</p>}
      </div>

      <div className="saved-list">
        {groups.length === 0 && (
          <p className="muted small">
            Nothing yet. Add a few above, or type &ldquo;Jaipur: visit Hawa Mahal, buy lakh
            chudi&rdquo; in the box on Today.
          </p>
        )}
        {groups.map(([p, list]) => {
          const trip = p ? tripTo(p) : null
          return (
            <div key={p || 'any time'} className="wish-place">
              <div className="wish-place-head">
                <span className="label-text">
                  {p || 'Any time'} · {list.length}
                </span>
                {!p ? (
                  <span className="muted small">Add to any plan from its details</span>
                ) : trip ? (
                  <span className="tag is-live">Trip {spanLabel(trip.startsOn, trip.endsOn)}</span>
                ) : (
                  <button className="link small" onClick={() => onPlan(p)}>
                    Plan a trip &rarr;
                  </button>
                )}
              </div>
              <ul className="plain">
                {list.map((item) => (
                  <li key={item.id} className="commitment-head">
                    <span className="muted small">
                      {item.title}
                      {item.preferredWindow ? ` · ${WINDOW_LABELS[item.preferredWindow]}` : ''}
                    </span>
                    <button className="link danger-link" onClick={() => void drop(item.id)}>
                      Remove
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

  const load = useCallback(async () => {
    setTrips(await api<TripDTO[]>('/trips'))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // "going to Agra 2 to 4 Oct" typed from the header lands here.
  useOnChange(() => void load())

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  const now = new Date()
  const upcoming = trips.filter((t) => new Date(`${t.endsOn}T23:59:59`) >= now)
  const past = trips.filter((t) => new Date(`${t.endsOn}T23:59:59`) < now)

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Trips</h1>
        <span className="page-count">
          {upcoming.length} coming up{past.length > 0 ? ` · ${past.length} been and gone` : ''}
        </span>
      </div>

      {/* Trips on the left; what you want to do in places, beside them. */}
      <div className="trips-layout">
      <div className="trips-main stack">
      <NewTrip onCreated={load} prefill={prefill} />

      {trips.length === 0 && (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#9992;
          </span>
          <h3>No journeys planned</h3>
          <p>
            Plan one and everything you want to do there surfaces on its own: the clinic you
            meant to visit, the client you meant to meet. Say &ldquo;going to Pune 12 to 14
            Oct&rdquo; in the box on Today, or use Plan a trip.
          </p>
        </div>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="section-title">Coming up</h2>
          <div className="tiles two-up">
            {upcoming.map((t) => {
              const start = new Date(`${t.startsOn}T00:00:00`)
              return (
                <article key={t.id} className="tile is-tappable" onClick={() => setOpenId(t.id)}>
                  <span className="tile-mark is-trip" aria-hidden>
                    <span className="mark-top">
                      {start.toLocaleDateString([], { month: 'short' })}
                    </span>
                    <span className="mark-main">{start.getDate()}</span>
                  </span>

                  <div className="tile-body">
                    <p className="tile-title">{t.placeLabel}</p>
                    {/* Written the way a person writes it, not the way the
                        column is stored. */}
                    <p className="tile-sub">
                      {spanLabel(t.startsOn, t.endsOn)} · {whenLabel(t)}
                    </p>

                    <div className="tile-tags">
                      {Boolean(t.plannedCount) && (
                        <span className="tag">{t.plannedCount} planned</span>
                      )}
                      {Boolean(t.waitingCount) && (
                        <span className="tag is-live">
                          {t.waitingCount} waiting for you there
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
          <h2 className="section-title muted-title">Been and gone</h2>
          <div className="tiles two-up">
            {past.map((t) => (
              <article key={t.id} className="tile dimmed is-tappable" onClick={() => setOpenId(t.id)}>
                <span className="tile-mark" aria-hidden>
                  <span className="mark-top">
                    {new Date(`${t.startsOn}T00:00:00`).toLocaleDateString([], { month: 'short' })}
                  </span>
                  <span className="mark-main">
                    {new Date(`${t.startsOn}T00:00:00`).getDate()}
                  </span>
                </span>
                <div className="tile-body">
                  <p className="tile-title">{t.placeLabel}</p>
                  <p className="tile-sub">{spanLabel(t.startsOn, t.endsOn)}</p>
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
        <Modal title="Trip" onClose={() => setOpenId(null)}>
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
