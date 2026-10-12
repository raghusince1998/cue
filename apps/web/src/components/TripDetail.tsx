import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_WINDOW_HOURS,
  STRICTNESS_LABELS,
  TIME_WINDOWS,
  WINDOW_LABELS,
  type IntentionDTO,
  type TimeWindow,
  type TripDTO,
  type TripItemDTO,
} from '@cue/shared'
import { ApiError, api } from '../lib/api.ts'
import { Checklist } from './Checklist.tsx'

interface TripDetailResponse {
  trip: TripDTO
  planned: TripItemDTO[]
  waiting: IntentionDTO[]
}

const KIND_OF_BOOKING: Record<string, string> = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  hotel: 'Stay',
  show: 'Show',
  appointment: 'Booking',
  other: 'Booking',
}

const dayKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayName = (ymd: string) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

type DayRow = { key: string; at: string; item?: TripItemDTO; checkOut?: string }

/**
 * The trip as it will be lived: before it, then each day in order — the
 * journeys with when to leave for them, the stays with their check-out, and
 * whatever else was planned there.
 */
function daysOf(trip: TripDTO, planned: TripItemDTO[]): { before: TripItemDTO[]; days: { day: string; rows: DayRow[] }[] } {
  const before = planned.filter((p) => dayKey(p.dueAt) < trip.startsOn)
  const rows: DayRow[] = planned
    .filter((p) => dayKey(p.dueAt) >= trip.startsOn)
    .map((p) => ({ key: p.id, at: p.dueAt, item: p }))
  // A stay's check-out is a moment of the trip too, though nothing is booked for it.
  for (const p of planned) {
    if (p.booking?.type === 'hotel' && p.booking.endsOn) {
      rows.push({ key: `${p.id}-out`, at: `${p.booking.endsOn}T11:00:00`, checkOut: p.title.replace(/^Check in:\s*/i, '') })
    }
  }
  rows.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  const days: { day: string; rows: DayRow[] }[] = []
  for (const row of rows) {
    const day = dayKey(row.at)
    const last = days[days.length - 1]
    if (last && last.day === day) last.rows.push(row)
    else days.push({ day, rows: [row] })
  }
  return { before, days }
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
  const plan = daysOf(trip, planned.filter((p) => p.id !== trip.packingId))
  const packing = planned.find((p) => p.id === trip.packingId) ?? null

  async function makePacking(purpose: 'work' | 'leisure') {
    setBusy(true)
    setError(null)
    try {
      await api(`/trips/${tripId}/packing`, { method: 'POST', body: { purpose } })
      await load()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // What to pack: made for this trip, ticked off the evening before. Below the
  // day-by-day plan, which is what the trip is; a list of 17 things above it
  // pushed the flights out of sight.
  const packingSection = (
    <section className="repeat-card trip-packing">
      {packing ? (
        <>
          <strong>Packing list</strong>
          <p className="muted small">
            A reminder {new Date(packing.dueAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            {packing.checklistCount > 0 ? ` · ${packing.checklistDone} of ${packing.checklistCount} packed` : ''}
          </p>
          <Checklist commitmentId={packing.id} />
        </>
      ) : (
        <>
          <strong>What to pack</strong>
          <p className="muted small">
            A list for {trip.nights > 0 ? `${trip.nights} ${trip.nights === 1 ? 'night' : 'nights'}` : 'the day'}
            {planned.some((p) => p.booking?.type === 'flight') ? ' and a flight' : ''}, with a reminder the evening before you go.
          </p>
          <div className="row">
            <button className="ghost small-btn" disabled={busy} onClick={() => void makePacking('work')}>
              For work
            </button>
            <button className="ghost small-btn" disabled={busy} onClick={() => void makePacking('leisure')}>
              For a holiday
            </button>
          </div>
        </>
      )}
    </section>
  )

  return (
    <div className="stack tight">
      <div>
        <h2 className="repeat-title">{trip.placeLabel}</h2>
        <p className="muted small">
          {trip.startsOn === trip.endsOn
            ? dayName(trip.startsOn)
            : `${dayName(trip.startsOn)} – ${dayName(trip.endsOn)} · ${trip.nights} ${trip.nights === 1 ? 'night' : 'nights'}`}
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

      <span className="label-text">Day by day</span>
      {plan.before.length === 0 && plan.days.length === 0 ? (
        <p className="muted small">Nothing planned yet. Bookings found in your email, and plans you add here, show up day by day.</p>
      ) : (
        <div className="trip-days">
          {plan.before.length > 0 && (
            <div className="trip-day">
              <p className="trip-day-name">Before you go</p>
              <ul className="plain">
                {plan.before.map((p) => (
                  <TripRow key={p.id} item={p} withDay />
                ))}
              </ul>
            </div>
          )}
          {plan.days.map(({ day, rows }) => (
            <div key={day} className="trip-day">
              <p className="trip-day-name">{dayName(day)}</p>
              <ul className="plain">
                {rows.map((r) =>
                  r.item ? (
                    <TripRow key={r.key} item={r.item} />
                  ) : (
                    <li key={r.key} className="trip-row">
                      <span className="trip-time">{clock(r.at)}</span>
                      <span>
                        <span className="trip-kind">Stay</span> Check out: {r.checkOut}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      {packingSection}

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

/** One line of a trip's day: when, what, and for a journey when to leave. */
function TripRow({ item, withDay }: { item: TripItemDTO; withDay?: boolean }) {
  const done = item.status === 'done' || item.status === 'cancelled'
  const flexible = item.flexibility === 'flexible' && item.preferredWindow
  const facts = [
    item.booking?.leaveAt ? `leave by ${clock(item.booking.leaveAt)}` : null,
    item.booking?.type === 'hotel' && item.booking.endsOn ? `check out ${dayName(item.booking.endsOn)}` : null,
    item.booking?.ref ? `Ref ${item.booking.ref}` : null,
    item.booking?.provider ?? null,
  ].filter(Boolean)
  // "Flight 6E 512 …" says what it is already; the tag is for "Check in: Taj".
  const kind = item.booking ? (KIND_OF_BOOKING[item.booking.type] ?? 'Booking') : null
  const tag = kind && !item.title.toLowerCase().startsWith(kind.toLowerCase()) ? kind : null
  return (
    <li className={`trip-row${done ? ' is-done' : ''}`}>
      <span className="trip-time">
        {withDay ? `${dayName(dayKey(item.dueAt))}, ` : ''}
        {flexible ? WINDOW_LABELS[item.preferredWindow!] : clock(item.dueAt)}
      </span>
      <span>
        {tag && <span className="trip-kind">{tag}</span>} {item.title}
        {facts.length > 0 && <span className="muted small trip-facts">{facts.join(' · ')}</span>}
      </span>
    </li>
  )
}
