import { stripWaitingOn } from '@cue/shared'
import { useEffect, useState } from 'react'
import type { CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { locale, t } from '../lib/i18n.tsx'
import { errorText } from '../lib/errors.ts'

/** The working day the free stretches are measured within — the same as the summary card's. */
const DAY_START_HOUR = 8
const DAY_END_HOUR = 21
/** Shorter than this, a gap is a breather, not time to get something done. */
const MIN_GAP_MINUTES = 30

function endOf(c: CommitmentDTO): Date {
  return c.endsAt
    ? new Date(c.endsAt)
    : new Date(new Date(c.dueAt).getTime() + c.durationMinutes * 60_000)
}

function clock(d: Date): string {
  return d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
}

function length(minutes: number): string {
  if (minutes < 60) return t('{n} min', { n: minutes })
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? t('{h}h {m}m', { h, m }) : t('{n}h', { n: h })
}

type Row =
  | { type: 'item'; c: CommitmentDTO; from: Date; to: Date }
  | { type: 'gap'; from: Date; to: Date }

/**
 * Today, hour by hour, with the free stretches between things marked.
 *
 * The list on Today says what is due; this says how the day fits together:
 * where the meetings are, what is already behind you, and where the gaps
 * long enough for real work are. It is what the morning brief opens.
 */
export function YourDay({
  waiting,
  justFinished,
  onOpen,
  onNudge,
  onWrapUp,
  onBlock,
}: {
  waiting: CommitmentDTO[]
  justFinished: CommitmentDTO[]
  onOpen: (id: string) => void
  onNudge: (c: CommitmentDTO) => void
  onWrapUp: (c: CommitmentDTO) => void
  /** Reserve (part of) a free stretch for focus time. */
  onBlock?: (startAt: string, maxMinutes: number) => void
}) {
  const [items, setItems] = useState<CommitmentDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayEnd = new Date(dayStart.getTime() + 86_400_000)

  useEffect(() => {
    api<{ commitments: CommitmentDTO[] }>('/commitments/range', {
      query: { from: dayStart.toISOString(), to: dayEnd.toISOString() },
    })
      .then((r) => setItems(r.commitments))
      .catch((err) => setError(errorText(err)))
    // Today's bounds, fixed for the life of the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <p className="error small">{error}</p>
  if (!items) return <p className="muted small">{t('Laying out your day…')}</p>

  // Check-ins are not time on the calendar, and a cancelled plan gave its time back.
  const real = items.filter((c) => !c.waitingOn && c.status !== 'cancelled')
  const allDay = real.filter((c) => c.allDay)
  const loose = real.filter((c) => !c.allDay && c.flexibility === 'flexible')
  const timed = real
    .filter((c) => !c.allDay && c.flexibility !== 'flexible')
    .filter((c) => new Date(c.dueAt) >= dayStart && new Date(c.dueAt) < dayEnd)
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))

  // Free stretches inside the working day, between whatever is booked.
  const windowStart = new Date(dayStart.getTime() + DAY_START_HOUR * 3_600_000)
  const windowEnd = new Date(dayStart.getTime() + DAY_END_HOUR * 3_600_000)
  const rows: Row[] = []
  let cursor = windowStart
  let freeMinutes = 0
  const addGap = (from: Date, to: Date) => {
    const minutes = Math.round((to.getTime() - from.getTime()) / 60_000)
    if (minutes >= MIN_GAP_MINUTES) {
      rows.push({ type: 'gap', from, to })
      freeMinutes += minutes
    }
  }
  for (const c of timed) {
    const from = new Date(c.dueAt)
    const to = endOf(c)
    if (from > cursor && cursor < windowEnd) addGap(cursor, from < windowEnd ? from : windowEnd)
    rows.push({ type: 'item', c, from, to })
    if (to > cursor) cursor = to
  }
  if (cursor < windowEnd) addGap(cursor, windowEnd)

  const meetings = timed.filter((c) => c.kind === 'meeting').length
  const toDo = timed.length - meetings + loose.length
  const checkIns = waiting.filter((c) => new Date(c.dueAt) < dayEnd)
  const toWrap = justFinished.filter((c) => endOf(c) <= now)

  return (
    <div className="stack tight your-day">
      <div className="your-day-head">
        <strong>{now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
        <span className="muted small">
          {[
            meetings ? (meetings === 1 ? t('1 meeting') : t('{n} meetings', { n: meetings })) : null,
            toDo ? t('{n} to do', { n: toDo }) : null,
            t('{free} free between {start} am and {end} pm', {
              free: length(freeMinutes),
              start: DAY_START_HOUR,
              end: DAY_END_HOUR - 12,
            }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      {allDay.length > 0 && (
        <p className="muted small">{t('All day: {titles}', { titles: allDay.map((c) => c.title).join(', ') })}</p>
      )}

      <ol className="timeline">
        {rows.map((row) =>
          row.type === 'gap' ? (
            <li
              key={`gap-${row.from.getTime()}`}
              className={`timeline-gap${row.to <= now ? ' is-past' : ''}`}
            >
              <span className="timeline-time">{clock(row.from)}</span>
              <span>
                {t('Free until {time} · {length}', {
                  time: clock(row.to),
                  length: length(Math.round((row.to.getTime() - row.from.getTime()) / 60_000)),
                })}
                {row.to > now && row.to.getTime() - row.from.getTime() >= 60 * 60_000 && (
                  <em> — {t('room for focused work')}</em>
                )}
                {onBlock && row.to.getTime() - Math.max(row.from.getTime(), now.getTime()) >= 25 * 60_000 && (
                  <button
                    className="link small gap-block"
                    onClick={() => {
                      const from = row.from > now ? row.from : now
                      onBlock(from.toISOString(), Math.round((row.to.getTime() - from.getTime()) / 60_000))
                    }}
                  >
                    {t('Block it')}
                  </button>
                )}
              </span>
            </li>
          ) : (
            <li
              key={row.c.id}
              className={[
                'timeline-item',
                row.c.kind === 'meeting' ? 'is-meeting' : '',
                row.c.kind === 'focus' ? 'is-focus' : '',
                row.c.status === 'done' ? 'is-done' : '',
                row.to <= now ? 'is-past' : '',
                row.from <= now && row.to > now ? 'is-now' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="timeline-time">{clock(row.from)}</span>
              <button className="timeline-body" onClick={() => onOpen(row.c.id)}>
                <span className="timeline-title">{row.c.title}</span>
                <span className="muted small">
                  {clock(row.from)}–{clock(row.to)}
                  {row.c.placeName ? ` · ${row.c.placeName}` : ''}
                  {row.from <= now && row.to > now ? ` · ${t('now')}` : ''}
                  {row.c.status === 'done' ? ` · ${t('done')}` : ''}
                  {(row.c.prepOpen ?? 0) > 0 && row.to > now ? (
                    <span className="prep-chip">{t('{n} open from last time', { n: row.c.prepOpen ?? 0 })}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ),
        )}
        {rows.length === 0 && <li className="muted small">{t('Nothing booked between 8 am and 9 pm.')}</li>}
      </ol>

      {loose.length > 0 && (
        <p className="muted small">
          {t('Sometime today:')}{' '}
          {loose.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? ', ' : ''}
              <button className="plan-link" onClick={() => onOpen(c.id)}>
                {c.title}
              </button>
            </span>
          ))}
        </p>
      )}

      {checkIns.length > 0 && (
        <section className="stack tight">
          <span className="label-text">{t('Check in today')}</span>
          {checkIns.map((c) => (
            <div className="your-day-line" key={c.id}>
              <span>
                <span className="waiting-who">{c.waitingOn}</span>
                <button className="plan-link" onClick={() => onOpen(c.id)}>
                  {stripWaitingOn(c.title)}
                </button>
              </span>
              <button className="ghost small-btn" onClick={() => onNudge(c)}>
                {t('Nudge')}
              </button>
            </div>
          ))}
        </section>
      )}

      {toWrap.length > 0 && (
        <section className="stack tight">
          <span className="label-text">{t('Still need follow-ups')}</span>
          {toWrap.map((c) => (
            <div className="your-day-line" key={c.id}>
              <button className="plan-link" onClick={() => onOpen(c.id)}>
                {c.title}
              </button>
              <button className="ghost small-btn" onClick={() => onWrapUp(c)}>
                {t('Add follow-ups')}
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
