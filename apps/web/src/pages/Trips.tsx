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

function NewTrip({ onCreated }: { onCreated: () => void }) {
  const today = new Date()
  const [open, setOpen] = useState(false)
  const [placeLabel, setPlaceLabel] = useState('')
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
      <button className="primary" onClick={() => setOpen(true)}>
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
          placeholder="Mathura"
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
 * Where a wish gets written down, long before any trip exists.
 *
 * Kept deliberately dateless: "when I go to Mathura, buy peda" must not become
 * a reminder for tomorrow. It simply waits until a Mathura trip appears.
 */
function Wishlist({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<IntentionDTO[]>([])
  const [placeLabel, setPlaceLabel] = useState('')
  const [title, setTitle] = useState('')
  const [window, setWindow] = useState<TimeWindow | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setItems(await api<IntentionDTO[]>('/intentions', { query: { status: 'saved' } }))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function add() {
    setBusy(true)
    setNote(null)
    try {
      const r = await api<{ matchingTrips: { startsOn: string }[] }>('/intentions', {
        method: 'POST',
        body: {
          placeLabel: placeLabel.trim(),
          title: title.trim(),
          preferredWindow: window,
        },
      })
      setTitle('')
      setNote(
        r.matchingTrips.length > 0
          ? `Saved — and you already have a trip to ${placeLabel.trim()} on ${r.matchingTrips[0]!.startsOn}.`
          : `Saved. It will surface when you plan a trip to ${placeLabel.trim()}.`,
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

  const byPlace = new Map<string, IntentionDTO[]>()
  for (const item of items) {
    const key = item.placeLabel
    byPlace.set(key, [...(byPlace.get(key) ?? []), item])
  }

  return (
    <section className="card">
      <h2 className="section-title">Saved for when you go</h2>
      <p className="muted small">
        Things with no date — they wait until a trip to that place exists.
      </p>

      <div className="row">
        <input
          className="grow"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Try the famous peda"
        />
        <input
          className="grow"
          value={placeLabel}
          onChange={(e) => setPlaceLabel(e.target.value)}
          placeholder="Mathura"
        />
      </div>
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
      <button
        className="primary small-btn"
        disabled={busy || !title.trim() || !placeLabel.trim()}
        onClick={add}
      >
        Save it for there
      </button>
      {note && <p className="muted small">{note}</p>}

      {[...byPlace.entries()].map(([place, list]) => (
        <div key={place}>
          <span className="label-text">{place}</span>
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
      ))}
    </section>
  )
}

export default function Trips() {
  const [trips, setTrips] = useState<TripDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

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

      <NewTrip onCreated={load} />

      {trips.length === 0 && (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#9992;
          </span>
          <h3>No journeys planned</h3>
          <p>
            Plan one and everything you have saved for that place surfaces on its own — the peda
            you meant to buy, the uncle you meant to visit. Say &ldquo;going to Agra 2 to 4
            Oct&rdquo; when adding, or use the form above.
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

      <Wishlist onChanged={load} />

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
