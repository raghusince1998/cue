import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ACCOUNT_STAGE_LABELS, type AccountStage, type TargetProgress } from '@cue/shared'
import { TargetBar, statusText } from './Targets.tsx'
import { api } from '../lib/api.ts'
import { locale, t } from '../lib/i18n.tsx'
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
  if (minutes === 0) return t('{n}h', { n: 0 })
  const h = minutes / 60
  return t('{n}h', { n: h % 1 === 0 ? h : h.toFixed(1) })
}

function weekdayOf(ymd: string, style: 'short' | 'long' = 'short'): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(locale(), { weekday: style })
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
  if (!r) return <p className="muted small">{t('Looking back over the week…')}</p>

  if (finished) {
    return (
      <div className="stack tight">
        <strong>{t('Week reviewed.')}</strong>
        <p className="muted small">
          {r.nextWeek.busiest
            ? `${t('Next week\'s busiest day is {day}.', { day: weekdayOf(r.nextWeek.busiest, 'long') })} `
            : ''}
          {t('Enjoy the weekend.')}
        </p>
        <div className="form-actions">
          <button className="primary" onClick={onDone}>
            {t('Done')}
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
        <strong>{t('Week of {span}', { span: spanLabel(r.week.from, r.week.to) })}</strong>
        {reviewedThisWeek && (
          <span className="muted small">
            {t('Already reviewed {day} — here it is again.', { day: dayLabel(r.reviewedAt!) })}
          </span>
        )}
      </div>

      <section className="review-part">
        <span className="label-text">{t('This week')}</span>
        <div className="review-stats">
          <div>
            <strong>{r.done.total}</strong>
            <span>
              {r.done.total === 0
                ? t('done')
                : r.done.meetings === 1
                  ? t('done · 1 meeting, {tasks} other', { tasks: r.done.tasks })
                  : t('done · {meetings} meetings, {tasks} other', { meetings: r.done.meetings, tasks: r.done.tasks })}
            </span>
          </div>
          <div>
            <strong>{r.meetings.count}</strong>
            <span>
              {r.meetings.count === 1
                ? t('meeting · {hours}', { hours: hours(r.meetings.minutes) })
                : t('meetings · {hours}', { hours: hours(r.meetings.minutes) })}
            </span>
          </div>
          <div>
            <strong>{r.followUps}</strong>
            <span>{t('follow-ups captured')}</span>
          </div>
        </div>
        {(r.focus?.minutes ?? 0) > 0 && (
          <p className="muted small">
            {r.focus!.blocks === 1
              ? t('Focus time: {hours} in 1 block.', { hours: hours(r.focus!.minutes) })
              : t('Focus time: {hours} in {n} blocks.', { hours: hours(r.focus!.minutes), n: r.focus!.blocks })}
          </p>
        )}
        {r.done.titles.length > 0 && (
          <details className="review-done">
            <summary>{t('What got done')}</summary>
            <ul>
              {r.done.titles.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
              {r.done.total > r.done.titles.length && (
                <li className="muted">{t('and {n} more', { n: r.done.total - r.done.titles.length })}</li>
              )}
            </ul>
          </details>
        )}
      </section>

      <section className="review-part">
        <span className="label-text">{t('What slipped')}</span>
        {r.slipped > 0 ? (
          <div className="review-action">
            <span>
              {r.slipped === 1
                ? t('1 thing is past its time. Decide it now so it does not follow you into next week.')
                : t('{n} things are past their time. Decide each one now so they do not follow you into next week.', {
                    n: r.slipped,
                  })}
            </span>
            <button className="primary small-btn" onClick={onDecideSlipped}>
              {t('Decide each')}
            </button>
          </div>
        ) : (
          <p className="muted small">{t('Nothing slipped.')}</p>
        )}
      </section>

      <section className="review-part">
        <span className="label-text">{t('Waiting on others')}</span>
        {r.waiting.count > 0 ? (
          <div className="review-action">
            <span>
              {r.waiting.names.length > 0
                ? t('{n} open with {names}', { n: r.waiting.count, names: r.waiting.names.slice(0, 3).join(', ') })
                : t('{n} open', { n: r.waiting.count })}
              {r.waiting.oldest
                ? `. ${t('Oldest: {title} from {who}, check-in {day}.', {
                    title: r.waiting.oldest.title,
                    who: r.waiting.oldest.who,
                    day: dayLabel(r.waiting.oldest.dueAt),
                  })}`
                : '.'}
            </span>
            <button className="ghost small-btn" onClick={onGoToWaiting}>
              {t('Go through them')}
            </button>
          </div>
        ) : (
          <p className="muted small">{t('Nobody owes you anything right now.')}</p>
        )}
      </section>

      {(r.quiet ?? []).length > 0 && (
        <section className="review-part">
          <span className="label-text">{t('Gone quiet')}</span>
          <div className="review-action">
            <span>
              {r.quiet!
                .slice(0, 3)
                .map(
                  (q) =>
                    `${q.name} (${t(ACCOUNT_STAGE_LABELS[q.stage]).toLowerCase()}, ${
                      q.lastContact
                        ? t('last contact {when}', { when: relativeDay(q.lastContact) })
                        : t('no contact on record')
                    })`,
                )
                .join('; ')}
              {r.quiet!.length > 3 ? ` ${t('and {n} more', { n: r.quiet!.length - 3 })}` : ''}.
            </span>
            <button
              className="ghost small-btn"
              onClick={() => {
                onDone()
                navigate('/people?view=accounts')
              }}
            >
              {t('See accounts')}
            </button>
          </div>
        </section>
      )}

      {(r.targets ?? []).length > 0 && (
        <section className="review-part">
          <span className="label-text">
            {t('Targets · hit {hit} of {n}', {
              hit: r.targets!.filter((m) => m.status === 'done').length,
              n: r.targets!.length,
            })}
          </span>
          {r.targets!.map((m) => (
            <div className="review-target" key={m.key}>
              <span className="small">
                {t('{label}: {done} of {target}', { label: t(m.label), done: m.done, target: m.target ?? '' })}
                <span className={`target-status is-${m.status}`}> · {statusText(m)}</span>
              </span>
              <TargetBar m={m} small />
            </div>
          ))}
          <button
            className="link small fit-btn"
            onClick={() => {
              onDone()
              navigate('/?targets=1')
            }}
          >
            {t('Change targets')}
          </button>
        </section>
      )}

      <section className="review-part">
        <span className="label-text">{t('Next week')}</span>
        <div className="week-bars" role="img" aria-label={t('Booked time each day next week')}>
          {r.nextWeek.days.map((d) => (
            <div
              key={d.date}
              className={`week-bar${d.date === r.nextWeek.busiest ? ' is-busiest' : ''}`}
              title={
                d.meetings === 1
                  ? t('{day}: {hours} booked, 1 meeting', { day: weekdayOf(d.date, 'long'), hours: hours(d.minutes) })
                  : t('{day}: {hours} booked, {n} meetings', {
                      day: weekdayOf(d.date, 'long'),
                      hours: hours(d.minutes),
                      n: d.meetings,
                    })
              }
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
          {r.nextWeek.items === 1
            ? t('{meetings} in meetings · 1 thing booked · {free} free in working hours (8 am–9 pm, Mon–Fri)', {
                meetings: hours(r.nextWeek.meetingMinutes),
                free: hours(r.nextWeek.freeMinutes),
              })
            : t('{meetings} in meetings · {n} things booked · {free} free in working hours (8 am–9 pm, Mon–Fri)', {
                meetings: hours(r.nextWeek.meetingMinutes),
                n: r.nextWeek.items,
                free: hours(r.nextWeek.freeMinutes),
              })}
          {r.nextWeek.busiest ? ` · ${t('busiest: {day}', { day: weekdayOf(r.nextWeek.busiest, 'long') })}` : ''}
        </p>
      </section>

      <div className="form-actions">
        <button className="primary" onClick={() => void finish()} disabled={busy}>
          {busy ? t('Saving…') : t('Finish review')}
        </button>
      </div>
    </div>
  )
}
