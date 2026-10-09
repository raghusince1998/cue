import { useState } from 'react'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'

export interface PersonLink {
  id: string
  name: string
  detail: string | null
  phone: string | null
  certain: boolean
}

export interface Links {
  people: PersonLink[]
  places: { id: string; name: string; detail: string | null }[]
  accounts: { name: string; people: number }[]
}

export interface TripLink {
  placeLabel: string
  day: string
  existing: { id: string; startsOn: string; endsOn: string } | null
  waiting: { id: string; title: string }[]
}

export interface UpcomingTrip {
  id: string
  placeLabel: string
  startsOn: string
  endsOn: string
}

/** What the person decided about each offer. `undefined` keeps the preview's own choice. */
export interface LinkChoices {
  contactId?: string | null
  placeId: string | null
  accountName: string | null
  trip: 'add' | 'skip'
  onTrip: boolean
}

export const NO_CHOICES: LinkChoices = { placeId: null, accountName: null, trip: 'add', onTrip: true }

const day = (ymd: string, style: 'short' | 'long' = 'short') =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString([], {
    weekday: style,
    day: 'numeric',
    month: 'short',
  })

export function range(a: string, b: string): string {
  return a === b ? day(a) : `${day(a)} to ${day(b)}`
}

/**
 * What the sentence seems to mean that is already in Cue: the person, a
 * saved place, a clinic or company, and — in another city — a trip. A certain
 * person is attached with "not them"; the rest is a tap to attach.
 */
export function QuickLinks({
  contactId,
  links,
  trip,
  upcomingTrip,
  choices,
  onChange,
  onHome,
}: {
  /** Who the preview attached, before any choice. */
  contactId: string | null
  links: Links
  trip: TripLink | null
  upcomingTrip: UpcomingTrip | null
  choices: LinkChoices
  onChange: (next: LinkChoices) => void
  /** "Pune is where I live": never a trip again. */
  onHome: (city: string) => void
}) {
  const chosen = choices.contactId !== undefined ? choices.contactId : contactId
  const person = links.people.find((p) => p.id === chosen) ?? null
  const others = links.people.filter((p) => p.id !== chosen)
  const set = (patch: Partial<LinkChoices>) => onChange({ ...choices, ...patch })

  const nothing =
    links.people.length === 0 && links.places.length === 0 && links.accounts.length === 0 && !trip && !upcomingTrip
  if (nothing) return null

  return (
    <div className="quick-links">
      {person ? (
        <div className="quick-link is-on">
          <span>
            <span className="quick-link-mark" aria-hidden>
              &#128100;
            </span>
            With <strong>{person.name}</strong>
            {person.detail ? <span className="muted"> · {person.detail}</span> : null}
          </span>
          <button className="link small" onClick={() => set({ contactId: null })}>
            Not them
          </button>
        </div>
      ) : (
        links.people.length > 0 && (
          <div className="quick-link">
            <span className="muted small">
              {chosen === null && contactId ? 'Not linked to anyone. Someone else?' : 'Is this about…'}
            </span>
          </div>
        )
      )}
      {others.length > 0 && (
        <div className="chips quick-link-choices">
          {person && <span className="muted small">or</span>}
          {others.map((p) => (
            <button key={p.id} className="chip" onClick={() => set({ contactId: p.id })}>
              {p.name}
              {p.detail ? <span className="muted"> · {p.detail}</span> : null}
            </button>
          ))}
        </div>
      )}

      {links.places.map((p) => (
        <label className="quick-link checkbox" key={p.id}>
          <input
            type="checkbox"
            checked={choices.placeId === p.id}
            onChange={(e) => set({ placeId: e.target.checked ? p.id : null })}
          />
          <span>
            <span className="quick-link-mark" aria-hidden>
              &#128205;
            </span>
            At <strong>{p.name}</strong>
            {p.detail ? <span className="muted"> · {p.detail}</span> : null}
          </span>
        </label>
      ))}

      {links.accounts.map((a) => (
        <label className="quick-link checkbox" key={a.name}>
          <input
            type="checkbox"
            checked={choices.accountName === a.name}
            onChange={(e) => set({ accountName: e.target.checked ? a.name : null })}
          />
          <span>
            <span className="quick-link-mark" aria-hidden>
              &#127970;
            </span>
            For <strong>{a.name}</strong>
            {a.people ? (
              <span className="muted">
                {' '}
                · {a.people} {a.people === 1 ? 'person' : 'people'} there
              </span>
            ) : null}
          </span>
        </label>
      ))}

      {trip &&
        (trip.existing ? (
          <div className="quick-link is-on">
            <span>
              <span className="quick-link-mark" aria-hidden>
                &#9992;
              </span>
              Part of your <strong>{trip.placeLabel}</strong> trip
              <span className="muted"> · {range(trip.existing.startsOn, trip.existing.endsOn)}</span>
            </span>
          </div>
        ) : (
          <div className="quick-link">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={choices.trip === 'add'}
                onChange={(e) => set({ trip: e.target.checked ? 'add' : 'skip' })}
              />
              <span>
                <span className="quick-link-mark" aria-hidden>
                  &#9992;
                </span>
                Also a trip to <strong>{trip.placeLabel}</strong>
                <span className="muted"> · {day(trip.day, 'long')}</span>
              </span>
            </label>
            <button className="link small" onClick={() => onHome(trip.placeLabel)}>
              {trip.placeLabel} is where I live
            </button>
          </div>
        ))}
      {trip && trip.waiting.length > 0 && (choices.trip === 'add' || trip.existing) && (
        <p className="muted small quick-link-note">
          {trip.waiting.length} saved for {trip.placeLabel}: {trip.waiting.map((w) => w.title).slice(0, 3).join(', ')}
          {trip.waiting.length > 3 ? '…' : ''}. Add them to this day after saving.
        </p>
      )}

      {upcomingTrip && (
        <label className="quick-link checkbox">
          <input type="checkbox" checked={choices.onTrip} onChange={(e) => set({ onTrip: e.target.checked })} />
          <span>
            <span className="quick-link-mark" aria-hidden>
              &#9992;
            </span>
            Put it on your <strong>{upcomingTrip.placeLabel}</strong> trip
            <span className="muted"> · {range(upcomingTrip.startsOn, upcomingTrip.endsOn)}</span>
          </span>
        </label>
      )}
    </div>
  )
}

const WINDOWS = [
  { key: 'morning', label: 'Morning', hour: 10 },
  { key: 'afternoon', label: 'Afternoon', hour: 15 },
  { key: 'evening', label: 'Evening', hour: 18 },
] as const

/**
 * Things saved for "when I go to …", now that a trip there is planned: each
 * one tap from being on a day of it, as something for that part of the day
 * rather than a fixed slot.
 */
export function SavedForTrip({
  trip,
  waiting,
}: {
  trip: { id: string; placeLabel: string; startsOn: string; endsOn: string }
  waiting: { id: string; title: string }[]
}) {
  const days: string[] = []
  for (let d = new Date(`${trip.startsOn}T00:00:00`); days.length < 7; d.setDate(d.getDate() + 1)) {
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (ymd > trip.endsOn) break
    days.push(ymd)
  }
  const [onDay, setOnDay] = useState(days[0]!)
  const [done, setDone] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  async function add(id: string, hour: number, label: string) {
    setError(null)
    try {
      const [y, m, d] = onDay.split('-').map(Number)
      await api(`/intentions/${id}/schedule`, {
        method: 'POST',
        body: { dueAt: new Date(y!, m! - 1, d!, hour, 0).toISOString(), tripId: trip.id, flexibility: 'flexible' },
      })
      setDone((x) => ({ ...x, [id]: `${day(onDay)}, ${label.toLowerCase()}` }))
      announceChange()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="saved-for-trip">
      <span className="label-text">Saved for {trip.placeLabel}: add to this trip?</span>
      {days.length > 1 && (
        <div className="chips">
          {days.map((d) => (
            <button key={d} className={`chip${onDay === d ? ' selected' : ''}`} onClick={() => setOnDay(d)}>
              {day(d)}
            </button>
          ))}
        </div>
      )}
      {waiting.map((w) => (
        <div className="your-day-line" key={w.id}>
          <span>{w.title}</span>
          {done[w.id] ? (
            <span className="small target-status is-done">Added · {done[w.id]}</span>
          ) : (
            <span className="row">
              {WINDOWS.map((t) => (
                <button key={t.key} className="ghost tiny-btn" onClick={() => void add(w.id, t.hour, t.label)}>
                  {t.label}
                </button>
              ))}
            </span>
          )}
        </div>
      ))}
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
