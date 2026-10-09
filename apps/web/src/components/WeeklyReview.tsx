import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ACCOUNT_STAGE_LABELS, type AccountStage, type TargetProgress } from '@cue/shared'
import { TargetBar, statusText } from './Targets.tsx'
import { api } from '../lib/api.ts'
import { dayLabel, relativeDay, spanLabel } from '../lib/time.ts'

interface WeekReview {
  week: { from: string; to: string }
  done: { total: number; meetings: number; tasks: number; titles: string[] }
  meetings: { count: number; minutes: number }
  focus?: { blocks: number; minutes: number }
  followUps: number
  slipped: number
  waiting: { count: number; names: string[]; oldest: { title: string; who: string; dueAt: string } | null }
  nextWeek: {
    days: { date: string; meetings: number; minutes: number; items: number }[]
    busiest: string | null
    meetingMinutes: number
    items: number
    freeMinutes: number
  }
  quiet?: { name: string; stage: AccountStage; lastContact: string | null }[]
  targets?: TargetProgress[]
  reviewedAt: string | null
}

function hours(minutes: number): string {
  if (minutes === 0) return '0h'
  const h = minutes / 60
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`
}

function weekdayOf(ymd: string, style: 'short' | 'long' = 'short'): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString([], { weekday: style })
}

/**
 * The week behind and the week ahead, on one screen.
 *
 * Each part ends in the one action it calls for — decide what slipped, chase
 * what is owed — rather than just reporting it. "Finish review" records that
 * the week was looked at.
 */
export function WeeklyReview({
  onDecideSlipped,
  onGoToWaiting,
  onDone,
}: {
  onDecideSlipped: () => void
  onGoToWaiting: () => void
  onDone: () => void
}) {
  const [r, setR] = useState<WeekReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api<WeekReview>('/review/week')
      .then(setR)
      .catch((err) => setError((err as Error).message))
  }, [])

  async function finish() {
    setBusy(true)
    try {
      await api('/review/week/done', { method: 'POST' })
      setFinished(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="error small">{error}</p>
  if (!r) return <p className="muted small">Looking back over the week…</p>

  if (finished) {
    return (
      <div className="stack tight">
        <strong>Week reviewed.</strong>
        <p className="muted small">
          {r.nextWeek.busiest
            ? `Next week's busiest day is ${weekdayOf(r.nextWeek.busiest, 'long')}. `
            : ''}
          Enjoy the weekend.
        </p>
        <div className="form-actions">
          <button className="primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    )
  }

  const maxMinutes = Math.max(...r.nextWeek.days.map((d) => d.minutes), 4 * 60)
  const reviewedThisWeek = r.reviewedAt && r.reviewedAt.slice(0, 10) >= r.week.from

  return (
    <div className="stack review">
      <div className="your-day-head">
        <strong>Week of {spanLabel(r.week.from, r.week.to)}</strong>
        {reviewedThisWeek && (
          <span className="muted small">Already reviewed {dayLabel(r.reviewedAt!)} — here it is again.</span>
        )}
      </div>

      <section className="review-part">
        <span className="label-text">This week</span>
        <div className="review-stats">
          <div>
            <strong>{r.done.total}</strong>
            <span>
              done
              {r.done.total > 0
                ? ` · ${r.done.meetings} meeting${r.done.meetings === 1 ? '' : 's'}, ${r.done.tasks} other`
                : ''}
            </span>
          </div>
          <div>
            <strong>{r.meetings.count}</strong>
            <span>
              meeting{r.meetings.count === 1 ? '' : 's'} · {hours(r.meetings.minutes)}
            </span>
          </div>
          <div>
            <strong>{r.followUps}</strong>
            <span>follow-ups captured</span>
          </div>
        </div>
        {(r.focus?.minutes ?? 0) > 0 && (
          <p className="muted small">
            Focus time: {hours(r.focus!.minutes)} in {r.focus!.blocks} block
            {r.focus!.blocks === 1 ? '' : 's'}.
          </p>
        )}
        {r.done.titles.length > 0 && (
          <details className="review-done">
            <summary>What got done</summary>
            <ul>
              {r.done.titles.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
              {r.done.total > r.done.titles.length && (
                <li className="muted">and {r.done.total - r.done.titles.length} more</li>
              )}
            </ul>
          </details>
        )}
      </section>

      <section className="review-part">
        <span className="label-text">What slipped</span>
        {r.slipped > 0 ? (
          <div className="review-action">
            <span>
              {r.slipped === 1
                ? '1 thing is past its time. Decide it now so it does not follow you into next week.'
                : `${r.slipped} things are past their time. Decide each one now so they do not follow you into next week.`}
            </span>
            <button className="primary small-btn" onClick={onDecideSlipped}>
              Decide each
            </button>
          </div>
        ) : (
          <p className="muted small">Nothing slipped.</p>
        )}
      </section>

      <section className="review-part">
        <span className="label-text">Waiting on others</span>
        {r.waiting.count > 0 ? (
          <div className="review-action">
            <span>
              {r.waiting.count} open
              {r.waiting.names.length > 0 ? ` with ${r.waiting.names.slice(0, 3).join(', ')}` : ''}
              {r.waiting.oldest
                ? `. Oldest: ${r.waiting.oldest.title} from ${r.waiting.oldest.who}, check-in ${dayLabel(r.waiting.oldest.dueAt)}.`
                : '.'}
            </span>
            <button className="ghost small-btn" onClick={onGoToWaiting}>
              Go through them
            </button>
          </div>
        ) : (
          <p className="muted small">Nobody owes you anything right now.</p>
        )}
      </section>

      {(r.quiet ?? []).length > 0 && (
        <section className="review-part">
          <span className="label-text">Gone quiet</span>
          <div className="review-action">
            <span>
              {r.quiet!
                .slice(0, 3)
                .map(
                  (q) =>
                    `${q.name} (${ACCOUNT_STAGE_LABELS[q.stage].toLowerCase()}, ${
                      q.lastContact ? `last contact ${relativeDay(q.lastContact)}` : 'no contact on record'
                    })`,
                )
                .join('; ')}
              {r.quiet!.length > 3 ? ` and ${r.quiet!.length - 3} more` : ''}.
            </span>
            <button
              className="ghost small-btn"
              onClick={() => {
                onDone()
                navigate('/people?view=accounts')
              }}
            >
              See accounts
            </button>
          </div>
        </section>
      )}

      {(r.targets ?? []).length > 0 && (
        <section className="review-part">
          <span className="label-text">
            Targets · hit {r.targets!.filter((t) => t.status === 'done').length} of {r.targets!.length}
          </span>
          {r.targets!.map((t) => (
            <div className="review-target" key={t.key}>
              <span className="small">
                {t.label}: {t.done} of {t.target}
                <span className={`target-status is-${t.status}`}> · {statusText(t)}</span>
              </span>
              <TargetBar m={t} small />
            </div>
          ))}
          <button
            className="link small fit-btn"
            onClick={() => {
              onDone()
              navigate('/?targets=1')
            }}
          >
            Change targets
          </button>
        </section>
      )}

      <section className="review-part">
        <span className="label-text">Next week</span>
        <div className="week-bars" role="img" aria-label="Booked time each day next week">
          {r.nextWeek.days.map((d) => (
            <div
              key={d.date}
              className={`week-bar${d.date === r.nextWeek.busiest ? ' is-busiest' : ''}`}
              title={`${weekdayOf(d.date, 'long')}: ${hours(d.minutes)} booked, ${d.meetings} meeting${d.meetings === 1 ? '' : 's'}`}
            >
              <span className="week-bar-value">{d.minutes > 0 ? hours(d.minutes) : ''}</span>
              <span
                className="week-bar-fill"
                style={{ height: `${Math.max(d.minutes > 0 ? 6 : 2, (d.minutes / maxMinutes) * 100)}%` }}
              />
              <span className="week-bar-day">{weekdayOf(d.date)}</span>
            </div>
          ))}
        </div>
        <p className="muted small">
          {hours(r.nextWeek.meetingMinutes)} in meetings · {r.nextWeek.items} thing
          {r.nextWeek.items === 1 ? '' : 's'} booked · {hours(r.nextWeek.freeMinutes)} free in
          working hours (8 am–9 pm, Mon–Fri)
          {r.nextWeek.busiest ? ` · busiest: ${weekdayOf(r.nextWeek.busiest, 'long')}` : ''}
        </p>
      </section>

      <div className="form-actions">
        <button className="primary" onClick={() => void finish()} disabled={busy}>
          {busy ? 'Saving…' : 'Finish review'}
        </button>
      </div>
    </div>
  )
}
