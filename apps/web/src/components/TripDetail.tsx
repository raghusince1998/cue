import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_WINDOW_HOURS,
  STRICTNESS_LABELS,
  TIME_WINDOWS,
  WINDOW_LABELS,
  type IntentionDTO,
  type TimeWindow,
  type TripDTO,
} from '@cue/shared'
import { ApiError, api } from '../lib/api.ts'
import { formatDateTime } from '../lib/time.ts'

interface PlannedItem {
  id: string
  title: string
  dueAt: string
  durationMinutes: number
  flexibility: string
  preferredWindow: TimeWindow | null
  allDay: boolean
  endsAt: string | null
  status: string
  priority: string
}

interface TripDetailResponse {
  trip: TripDTO
  planned: PlannedItem[]
  waiting: IntentionDTO[]
}

/** Midday on a trip day, in local time — a sane default before a window is applied. */
function dayOfTrip(trip: TripDTO, offset: number): Date {
  const d = new Date(`${trip.startsOn}T12:00:00`)
  d.setDate(d.getDate() + offset)
  return d
}

export function TripDetail({
  tripId,
  onClose,
  onChanged,
}: {
  tripId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [data, setData] = useState<TripDetailResponse | null>(null)
  const [scheduling, setScheduling] = useState<string | null>(null)
  const [dayOffset, setDayOffset] = useState(0)
  const [window, setWindow] = useState<TimeWindow>('evening')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    setData(await api<TripDetailResponse>(`/trips/${tripId}`))
  }, [tripId])

  useEffect(() => {
    void load()
  }, [load])

  /** Every wish for this place, together: one plan on one day, with a list. */
  async function planAll() {
    if (!data) return
    setBusy(true)
    setError(null)
    try {
      const day = dayOfTrip(data.trip, dayOffset)
      day.setHours(DEFAULT_WINDOW_HOURS[window].from, 0, 0, 0)
      await api(`/trips/${tripId}/plan-wishes`, {
        method: 'POST',
        body: { intentionIds: data.waiting.map((w) => w.id), dueAt: day.toISOString() },
      })
      await load()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function schedule(intention: IntentionDTO) {
    if (!data) return
    setBusy(true)
    setError(null)
    try {
      const day = dayOfTrip(data.trip, dayOffset)
      await api(`/intentions/${intention.id}/schedule`, {
        method: 'POST',
        body: {
          dueAt: day.toISOString(),
          tripId,
          // A wish stays flexible: it wants an evening, not 6:00 PM sharp.
          flexibility: 'flexible',
        },
      })
      setScheduling(null)
      await load()
      onChanged()
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'already_scheduled'
          ? 'That one is already on the plan.'
          : (err as Error).message,
      )
    } finally {
      setBusy(false)
    }
  }

  async function removeTrip() {
    setBusy(true)
    try {
      const r = await api<{ detached: number }>(`/trips/${tripId}`, { method: 'DELETE' })
      setError(null)
      onChanged()
      onClose()
      if (r.detached > 0) {
        // Worth saying out loud — people expect a delete to take everything.
        // eslint-disable-next-line no-alert
        alert(`Trip removed. ${r.detached} plan(s) were kept and detached from it.`)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  const { trip, planned, waiting } = data
  const dayCount = trip.nights + 1

  return (
    <div className="stack tight">
      <div>
        <h2 className="repeat-title">{trip.placeLabel}</h2>
        <p className="muted small">
          {trip.startsOn} → {trip.endsOn} · {dayCount} days
        </p>
        <p className="muted small">{STRICTNESS_LABELS[trip.strictness]}</p>
      </div>

      {waiting.length > 0 && (
        <section className="repeat-card">
          <strong>
            {waiting.length} saved for {trip.placeLabel}
          </strong>
          <p className="muted small">
            Wishes you noted down before this trip existed. They are not on your calendar until
            you put them there.
          </p>

          <ul className="plain">
            {waiting.map((w) => (
              <li key={w.id} className="voice-note">
                <div className="commitment-head">
                  <div>
                    <span className="commitment-title">{w.title}</span>
                    <br />
                    <span className="muted small">
                      {w.preferredWindow ? WINDOW_LABELS[w.preferredWindow] : 'Any time'} ·{' '}
                      {w.durationMinutes} min
                    </span>
                  </div>
                  <button
                    className="ghost small-btn"
                    onClick={() => {
                      setScheduling(scheduling === w.id ? null : w.id)
                      if (w.preferredWindow) setWindow(w.preferredWindow)
                    }}
                  >
                    {scheduling === w.id ? 'Cancel' : 'Schedule'}
                  </button>
                </div>

                {scheduling === w.id && (
                  <div className="stack tight">
                    <span className="label-text">Which day?</span>
                    <div className="chips">
                      {Array.from({ length: dayCount }, (_, i) => (
                        <button
                          key={i}
                          className={`chip${dayOffset === i ? ' selected' : ''}`}
                          onClick={() => setDayOffset(i)}
                        >
                          {dayOfTrip(trip, i).toLocaleDateString([], {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </button>
                      ))}
                    </div>

                    <span className="label-text">Roughly when?</span>
                    <div className="chips">
                      {TIME_WINDOWS.map((t) => (
                        <button
                          key={t}
                          className={`chip${window === t ? ' selected' : ''}`}
                          onClick={() => setWindow(t)}
                        >
                          {WINDOW_LABELS[t]}
                        </button>
                      ))}
                    </div>

                    <button
                      className="primary small-btn"
                      disabled={busy}
                      onClick={() => void schedule(w)}
                    >
                      {busy ? 'Adding…' : 'Add to the trip'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Visiting Hawa Mahal and buying lakh chudi are one afternoon in
              Jaipur, not two reminders. */}
          {waiting.length > 1 && scheduling === null && (
            <div className="stack tight together">
              <span className="label-text">Or all together, as one plan with a list</span>
              <div className="chips">
                {Array.from({ length: dayCount }, (_, i) => (
                  <button
                    key={i}
                    className={`chip${dayOffset === i ? ' selected' : ''}`}
                    onClick={() => setDayOffset(i)}
                  >
                    {dayOfTrip(trip, i).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
                  </button>
                ))}
              </div>
              <div className="chips">
                {TIME_WINDOWS.map((t) => (
                  <button key={t} className={`chip${window === t ? ' selected' : ''}`} onClick={() => setWindow(t)}>
                    {WINDOW_LABELS[t]}
                  </button>
                ))}
              </div>
              <button className="primary small-btn fit-btn" disabled={busy} onClick={() => void planAll()}>
                {busy ? 'Adding…' : `Add all ${waiting.length} as one plan`}
              </button>
            </div>
          )}
        </section>
      )}

      <span className="label-text">Planned on this trip</span>
      {planned.length === 0 ? (
        <p className="muted small">Nothing scheduled yet.</p>
      ) : (
        <ul className="plain">
          {planned.map((p) => (
            <li key={p.id} className="voice-note">
              <span className="commitment-title">{p.title}</span>
              <br />
              <span className="muted small">
                {p.flexibility === 'flexible' && p.preferredWindow
                  ? `${WINDOW_LABELS[p.preferredWindow]} — no set time`
                  : formatDateTime(p.dueAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error small">{error}</p>}

      <div className="row">
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="danger-zone">
        {confirmDelete ? (
          <div className="row">
            <button className="danger-btn" onClick={removeTrip} disabled={busy}>
              Yes, remove the trip
            </button>
            <button className="ghost small-btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button className="link danger-link" onClick={() => setConfirmDelete(true)}>
            Remove this trip
          </button>
        )}
        <p className="muted small">
          Anything planned on it is kept and simply detached — cancelling a journey does not
          cancel the appointment you filed under it.
        </p>
      </div>
    </div>
  )
}
