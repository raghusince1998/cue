import { useEffect, useMemo, useState } from 'react'
import type { CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'

export type CalendarMode = 'month' | 'week'

/**
 * A trip, drawn across every day it covers.
 *
 * Not a commitment: it claims no slot and nothing clashes with it. It is the
 * context those days happen in, which is exactly why the grid has to show it.
 */
interface TripSpan {
  id: string
  placeLabel: string
  startsOn: string
  endsOn: string
  strictness: string
}

/** A trip rendered as a chip, so one map can hold both kinds. */
interface DayEntry {
  id: string
  title: string
  isTrip: boolean
  tone: string
  timeLabel: string
  commitment: CommitmentDTO | null
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

function keyOf(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** 'YYYY-MM-DD' as a local date, or null if it is not one. */
function parseDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** The Sunday on or before `d`, which is where every drawn week starts. */
function weekStart(d: Date): Date {
  return addDays(startOfDay(d), -d.getDay())
}

/**
 * The window a view needs, rounded out to whole weeks.
 *
 * A month grid always shows six weeks' worth of cells, including the tail of
 * the previous month and the head of the next, so the fetch has to cover them
 * or those cells silently render empty.
 */
function windowFor(mode: CalendarMode, anchor: Date): { from: Date; to: Date } {
  if (mode === 'week') {
    const from = weekStart(anchor)
    return { from, to: addDays(from, 7) }
  }
  const from = weekStart(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  return { from, to: addDays(from, 42) }
}

/** Every day an item covers, so a three-day trip appears on all three. */
function daysCovered(c: CommitmentDTO): string[] {
  const start = startOfDay(new Date(c.dueAt))
  const end = c.endsAt ? startOfDay(new Date(c.endsAt)) : start
  const out: string[] = []
  for (let d = start; d <= end && out.length < 60; d = addDays(d, 1)) out.push(keyOf(d))
  return out
}

function timeLabel(c: CommitmentDTO): string {
  if (c.allDay) return 'All day'
  if (c.flexibility === 'flexible' && c.preferredWindow) return c.preferredWindow
  return new Date(c.dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** What colours a chip: why it matters, in priority order. */
function toneOf(c: CommitmentDTO, now: Date): string {
  // Before 'done' and before the overdue test: a cancelled thing is not
  // late, and the slot being free is the point of still showing it.
  if (c.status === 'cancelled') return 'cancelled'
  if (c.status === 'done') return 'done'
  // Before the overdue test: a calendar event that is over is just over.
  if (c.feedId) return 'feed'
  if (!c.allDay && new Date(c.dueAt) < now) return 'overdue'
  if (c.priority === 'critical') return 'critical'
  if (c.recurrenceId) return 'repeat'
  return 'normal'
}

/** Below this, a month cell cannot hold a readable word. */
const NARROW_PX = 560

/**
 * Whether there is room for words, measured on the element itself.
 *
 * At 375px a month cell is 46px wide: every title clips to nothing and seven
 * columns of a week view are unreadable, so both views change shape rather
 * than shrink. A ResizeObserver rather than matchMedia, for two reasons: the
 * real question is how much room *this* element has, not how wide the window
 * is, and matchMedia change events do not always arrive when the viewport is
 * driven externally — which left the grid stuck in its phone layout on a
 * tablet.
 */
function useNarrow(): [(el: HTMLDivElement | null) => void, boolean] {
  const [narrow, setNarrow] = useState(false)
  const [node, setNode] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!node) return
    const measure = () => setNarrow(node.getBoundingClientRect().width < NARROW_PX)
    measure()

    // Both sources, because neither is reliable alone: ResizeObserver misses
    // nothing on a real rotate or window drag but is not always driven by an
    // emulated viewport, and a window resize does not fire when only the
    // element's own container changes. Setting the same value twice is a no-op.
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(node)

    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [node])

  return [setNode, narrow]
}

export function CalendarView({
  mode,
  onOpen,
  refreshKey,
  compact = false,
  initialDate,
}: {
  mode: CalendarMode
  onOpen: (id: string) => void
  /** Changes when something is saved elsewhere, so the grid refetches. */
  refreshKey: number
  /**
   * The at-a-glance version that sits beside the list: dots instead of titles,
   * short cells, no legend. A week stays one row of seven days instead of
   * turning into a list of them, which would only repeat the list it sits by.
   */
  compact?: boolean
  /** YYYY-MM-DD to open on, with that day picked out — for links into a day. */
  initialDate?: string
}) {
  const opening = initialDate ? parseDay(initialDate) : null
  const [anchor, setAnchor] = useState(() => opening ?? startOfDay(new Date()))
  const [items, setItems] = useState<CommitmentDTO[]>([])
  const [trips, setTrips] = useState<TripSpan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(() => (opening ? keyOf(opening) : null))

  const [calRef, measuredNarrow] = useNarrow()
  const narrow = measuredNarrow || compact
  const now = new Date()
  const { from, to } = useMemo(() => windowFor(mode, anchor), [mode, anchor])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<{ commitments: CommitmentDTO[]; trips: TripSpan[] }>('/commitments/range', {
      query: { from: from.toISOString(), to: to.toISOString() },
    })
      .then((r) => {
        if (!cancelled) {
          setItems(r.commitments)
          setTrips(r.trips ?? [])
          setError(null)
        }
      })
      .catch((err) => !cancelled && setError((err as Error).message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [from.getTime(), to.getTime(), refreshKey])

  /** One pass, so a 42-cell grid is not 42 scans of the same array. */
  const byDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>()
    const push = (day: string, entry: DayEntry) => {
      const list = map.get(day)
      if (list) list.push(entry)
      else map.set(day, [entry])
    }

    for (const c of items) {
      for (const day of daysCovered(c)) {
        push(day, {
          id: c.id,
          title: c.title,
          isTrip: false,
          tone: toneOf(c, now),
          timeLabel: timeLabel(c),
          commitment: c,
        })
      }
    }

    // A trip covers whole days, so it is drawn on each of them.
    for (const trip of trips) {
      const start = new Date(`${trip.startsOn}T00:00:00`)
      const end = new Date(`${trip.endsOn}T00:00:00`)
      for (let d = start; d <= end; d = addDays(d, 1)) {
        push(keyOf(d), {
          id: `trip-${trip.id}`,
          title: trip.placeLabel,
          isTrip: true,
          tone: 'trip',
          timeLabel: 'Trip',
          commitment: null,
        })
      }
    }

    for (const list of map.values()) {
      list.sort((a, b) => {
        // Trips head the day, then all-day items: both are context for what
        // happens, rather than a slot inside it.
        if (a.isTrip !== b.isTrip) return a.isTrip ? -1 : 1
        const aAll = a.commitment?.allDay ?? false
        const bAll = b.commitment?.allDay ?? false
        if (aAll !== bAll) return aAll ? -1 : 1
        return (a.commitment?.dueAt ?? '').localeCompare(b.commitment?.dueAt ?? '')
      })
    }
    return map
  }, [items, trips])

  const days = useMemo(() => {
    const count = mode === 'week' ? 7 : 42
    return Array.from({ length: count }, (_, i) => addDays(from, i))
  }, [from.getTime(), mode])

  function step(direction: number) {
    setSelected(null)
    setAnchor((a) =>
      mode === 'week'
        ? addDays(a, direction * 7)
        : new Date(a.getFullYear(), a.getMonth() + direction, 1),
    )
  }

  const heading =
    mode === 'week'
      ? `${from.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${addDays(from, 6).toLocaleDateString([], { day: 'numeric', month: 'short' })}`
      : anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })

  const selectedItems = selected ? (byDay.get(selected) ?? []) : []

  return (
    <div className={`cal${compact ? ' is-compact' : ''}`} ref={calRef}>
      <div className="cal-head">
        <strong className="cal-title">{heading}</strong>
        <button
          className="ghost small-btn"
          onClick={() => {
            setAnchor(startOfDay(new Date()))
            setSelected(null)
          }}
        >
          Today
        </button>
        {/* Paired, because they are one control: step through time. */}
        <span className="cal-steps">
          <button className="cal-nav" onClick={() => step(-1)} aria-label="Previous">
            ‹
          </button>
          <button className="cal-nav" onClick={() => step(1)} aria-label="Next">
            ›
          </button>
        </span>
      </div>

      {error && <p className="error small">{error}</p>}

      {mode === 'week' && narrow && !compact ? (
        <ul className="cal-daylist">
          {days.map((day) => {
            const list = byDay.get(keyOf(day)) ?? []
            return (
              <li
                key={keyOf(day)}
                className={`cal-dayrow${sameDay(day, now) ? ' is-today' : ''}`}
              >
                <div className="cal-dayrow-head">
                  <span className="cal-dayrow-dow">{WEEKDAY_SHORT[day.getDay()]}</span>
                  <span className="cal-dayrow-num">{day.getDate()}</span>
                </div>
                {list.length === 0 ? (
                  <span className="muted small">—</span>
                ) : (
                  <div className="cal-dayrow-items">
                    {list.map((e) => (
                      <button
                        className={`cal-chip tone-${e.tone}`}
                        key={e.id}
                        disabled={e.isTrip}
                        onClick={() => !e.isTrip && onOpen(e.id)}
                      >
                        <em>{e.timeLabel}</em>
                        {e.title}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
      <div
        className={`cal-grid${mode === 'week' ? ' is-week' : ''}${narrow ? ' is-dots' : ''}${loading ? ' is-loading' : ''}`}
      >
        {(mode === 'week' && !compact ? WEEKDAY_SHORT : WEEKDAY_LETTER).map((label, i) => (
          <div className="cal-dow" key={i}>
            {label}
          </div>
        ))}

        {days.map((day) => {
          const key = keyOf(day)
          const list = byDay.get(key) ?? []
          const outside = mode === 'month' && day.getMonth() !== anchor.getMonth()
          // A week column shows everything; a month cell would overflow, so it
          // shows a few and says how many more there are.
          const visible = mode === 'week' && !narrow ? list : list.slice(0, narrow ? 4 : 3)

          return (
            <button
              type="button"
              key={key}
              className={[
                'cal-cell',
                outside ? 'is-outside' : '',
                sameDay(day, now) ? 'is-today' : '',
                selected === key ? 'is-selected' : '',
                list.length === 0 ? 'is-empty' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelected(selected === key ? null : key)}
            >
              <span className="cal-date">{day.getDate()}</span>
              {narrow ? (
                <span className="cal-dots">
                  {visible.map((e) => (
                    <span className={`cal-dot tone-${e.tone}`} key={e.id + key} />
                  ))}
                </span>
              ) : (
                visible.map((e) => (
                  <span className={`cal-chip tone-${e.tone}`} key={e.id + key}>
                    {mode === 'week' && <em>{e.timeLabel}</em>}
                    {e.title}
                  </span>
                ))
              )}
              {!narrow && list.length > visible.length && (
                <span className="cal-more">+{list.length - visible.length} more</span>
              )}
            </button>
          )
        })}
      </div>
      )}

      {narrow && !selected && (mode === 'month' || compact) && (
        <p className="muted small cal-hint">Tap a day to see what is on it.</p>
      )}

      {selected && (
        <div className="cal-day-detail">
          <strong>
            {new Date(
              Number(selected.split('-')[0]),
              Number(selected.split('-')[1]),
              Number(selected.split('-')[2]),
            ).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
          </strong>
          {selectedItems.length === 0 ? (
            <p className="muted small">Nothing planned.</p>
          ) : (
            <ul className="plain">
              {selectedItems.map((e) => (
                <li key={e.id}>
                  <button
                    className="cal-detail-row"
                    disabled={e.isTrip}
                    onClick={() => !e.isTrip && onOpen(e.id)}
                  >
                    <span className={`cal-dot tone-${e.tone}`} />
                    <span className="cal-detail-time">{e.timeLabel}</span>
                    <span className="cal-detail-title">{e.title}</span>
                    {e.commitment?.placeName && (
                      <span className="muted small">{e.commitment.placeName}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!compact && (
      <p className="muted small cal-legend">
        <span className="cal-dot tone-overdue" /> overdue
        <span className="cal-dot tone-critical" /> critical
        <span className="cal-dot tone-repeat" /> repeats
        <span className="cal-dot tone-trip" /> away
        <span className="cal-dot tone-feed" /> from a calendar
        <span className="cal-dot tone-done" /> done
        <span className="cal-dot tone-cancelled" /> cancelled
      </p>
      )}
    </div>
  )
}
