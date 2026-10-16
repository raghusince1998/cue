import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { RecurrenceDTO, ScheduleDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { rich, t } from '../lib/i18n.tsx'
import { dayLabel, formatDateTime, relativeDay } from '../lib/time.ts'
import { announceChange, useOnChange } from '../lib/changes.ts'
import { openAdd } from '../lib/addSheet.ts'
import { CommitmentSheet } from '../components/CommitmentSheet.tsx'
import { Modal } from '../components/Modal.tsx'

interface Occurrence {
  id: string
  title: string
  dueAt: string
  status: string
}

/**
 * One repeating plan, opened: how it repeats, the days coming up — each one
 * opens, to move or change just that day — and how many are behind it.
 */
function SeriesSheet({
  item,
  onOpenPlan,
  onStop,
  busy,
}: {
  item: RecurrenceDTO
  onOpenPlan: (id: string) => void
  onStop: () => void
  busy: boolean
}) {
  const [days, setDays] = useState<Occurrence[] | null>(null)
  useEffect(() => {
    api<{ occurrences: Occurrence[] }>(`/recurrences/${item.id}`)
      .then((r) => setDays(r.occurrences))
      .catch(() => setDays([]))
  }, [item.id])
  const now = Date.now()
  const ahead = (days ?? []).filter((d) => d.status === 'pending' && new Date(d.dueAt).getTime() >= now).slice(0, 8)
  const behind = (days ?? []).filter((d) => d.status === 'done').length
  return (
    <div className="stack tight">
      <p className="muted small">
        {item.summary}
        {item.placeName ?? item.placeLabel ? ` · ${item.placeName ?? item.placeLabel}` : ''} · {t('{n} min', { n: item.durationMinutes })}
      </p>
      <span className="label-text">{t('Coming up')}</span>
      {days === null ? (
        <p className="muted small">{t('Loading…')}</p>
      ) : ahead.length === 0 ? (
        <p className="muted small">{t('Nothing left ahead')}</p>
      ) : (
        <ul className="plain series-days">
          {ahead.map((d) => (
            <li key={d.id}>
              <button className="plan-link" onClick={() => onOpenPlan(d.id)}>
                {formatDateTime(d.dueAt)}
              </button>{' '}
              <span className="muted small">· {relativeDay(d.dueAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {behind > 0 && <p className="muted small">{behind === 1 ? t('1 done so far.') : t('{n} done so far.', { n: behind })}</p>}
      <div className="row">
        <button className="ghost small-btn" onClick={onStop} disabled={busy}>
          {t('Stop')}
        </button>
      </div>
    </div>
  )
}

/**
 * Everything that repeats.
 *
 * Kept off the Today screen on purpose: a rule is not a thing to do, and the
 * eleven Tuesdays it will produce would drown out the four things that are
 * actually due. This is where you come to check or stop one.
 */
export default function Repeating() {
  const [items, setItems] = useState<RecurrenceDTO[] | null>(null)
  const [schedules, setSchedules] = useState<ScheduleDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /** A series opened, and a single day of one (or a schedule's next step) open over it. */
  const [series, setSeries] = useState<RecurrenceDTO | null>(null)
  const [planOpen, setPlanOpen] = useState<string | null>(null)

  async function load() {
    try {
      const [r, s] = await Promise.all([
        api<{ recurrences: RecurrenceDTO[] }>('/recurrences'),
        api<{ schedules: ScheduleDTO[] }>('/schedules'),
      ])
      setItems(r.recurrences)
      setSchedules(s.schedules)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // "gym every mon wed fri at 7" typed from the header lands here.
  useOnChange(() => void load())

  // /repeating?series=<id>: a plan's "See the series", or a search result.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const id = params.get('series')
    if (!id || !items) return
    const found = items.find((i) => i.id === id)
    if (found) setSeries(found)
    params.delete('series')
    setParams(params, { replace: true })
  }, [params, setParams, items])

  async function stop(item: RecurrenceDTO) {
    // Worth a confirm: it removes every future occurrence in one go.
    const ok = window.confirm(
      t('Stop "{title}"?\n\n{n} upcoming will be removed. Anything already done stays in your history.', {
        title: item.title,
        n: item.upcomingCount,
      }),
    )
    if (!ok) return

    setBusy(item.id)
    try {
      const r = await api<{ keptOccurrences: number }>(`/recurrences/${item.id}`, {
        method: 'DELETE',
      })
      setSeries(null)
      setNote(
        r.keptOccurrences > 1
          ? t('Stopped. {n} past ones kept in your history.', { n: r.keptOccurrences })
          : r.keptOccurrences === 1
            ? t('Stopped. 1 past one kept in your history.')
            : t('Stopped.'),
      )
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function stopSchedule(item: ScheduleDTO) {
    const ok = window.confirm(
      item.done > 0
        ? t('Stop "{title}"?\n\nThe steps still ahead will be removed. The ones already done stay in your history.', {
            title: item.title,
          })
        : t('Stop "{title}"?\n\nThe steps still ahead will be removed.', { title: item.title }),
    )
    if (!ok) return
    setBusy(item.id)
    try {
      const r = await api<{ removed: number }>(`/schedules/${item.id}`, { method: 'DELETE' })
      setNote(
        r.removed === 1
          ? t('Stopped. 1 upcoming step removed.')
          : t('Stopped. {n} upcoming steps removed.', { n: r.removed }),
      )
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!items) return <p className="muted">{t('Loading…')}</p>

  const active = items.filter((i) => i.status === 'active')
  const ended = items.filter((i) => i.status !== 'active')
  const runningSchedules = schedules.filter((s) => s.status === 'active')

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">{t('Repeating')}</h1>
        <span className="page-count">
          {t('{n} running', { n: active.length })}
          {ended.length > 0 ? ` · ${t('{n} stopped', { n: ended.length })}` : ''}
          {runningSchedules.length > 0
            ? ` · ${runningSchedules.length === 1 ? t('1 schedule') : t('{n} schedules', { n: runningSchedules.length })}`
            : ''}
        </span>
      </div>

      {/* The two ways a plan comes back: on a rhythm, or on a set of dates. */}
      <div className="row repeat-starts">
        <button className="primary small-btn" onClick={() => openAdd({ repeat: true })}>
          + {t('Repeating plan')}
        </button>
        <button className="ghost small-btn" onClick={() => openAdd({ schedule: true })}>
          + {t('Schedule of dates')}
        </button>
      </div>

      {note && <p className="muted small">{note}</p>}

      {active.length === 0 && runningSchedules.length === 0 && (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#8635;
          </span>
          <h3>{t('Nothing repeats yet')}</h3>
          <p>
            {rich(
              '<b>Repeating plan</b> is for a rhythm — every day, every Monday, every 3 months, every year. <b>Schedule of dates</b> is for dates that follow a plan instead — a child’s vaccinations at 6 weeks, 10 weeks, 9 months. You can also just type “{example}” when you add something.',
              { b: (s) => <strong>{s}</strong>, example: 'standup every tuesday at 10am' },
            )}
          </p>
        </div>
      )}

      {active.length > 0 && (
        <div className="tiles two-up">
          {active.map((item) => (
            <article
              className="tile is-tappable"
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => setSeries(item)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
                e.preventDefault()
                setSeries(item)
              }}
            >
              <span className="tile-mark is-repeat" aria-hidden>
                &#8635;
              </span>

              <div className="tile-body">
                <p className="tile-title">{item.title}</p>
                <p className="tile-sub">{item.summary}</p>

                <div className="tile-tags">
                  {item.nextAt ? (
                    <span className="tag is-live">
                      {t('Next {day} · {when}', { day: dayLabel(item.nextAt), when: relativeDay(item.nextAt) })}
                    </span>
                  ) : (
                    <span className="tag is-warn">{t('Nothing left ahead')}</span>
                  )}
                  {item.upcomingCount > 0 && (
                    <span className="tag">{t('{n} booked', { n: item.upcomingCount })}</span>
                  )}
                  <span className="tag">{t('{n} min', { n: item.durationMinutes })}</span>
                  {(item.placeName ?? item.placeLabel) && (
                    <span className="tag">{item.placeName ?? item.placeLabel}</span>
                  )}
                </div>
              </div>

              <div className="tile-actions">
                <button
                  className="ghost small-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    void stop(item)
                  }}
                  disabled={busy === item.id}
                >
                  {t('Stop')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {runningSchedules.length > 0 && (
        <section className="stack tight">
          <h2 className="section-title">{t('Schedules · {n}', { n: runningSchedules.length })}</h2>
          <div className="tiles two-up">
            {runningSchedules.map((item) => (
              <article className="tile" key={item.id}>
                <span className="tile-mark is-schedule" aria-hidden>
                  &#9638;
                </span>
                <div className="tile-body">
                  <p className="tile-title">{item.title}</p>
                  <p className="tile-sub">
                    {t('{done} of {total} done · counting from {day}', {
                      done: item.done,
                      total: item.total,
                      day: dayLabel(item.startsOn),
                    })}
                  </p>
                  <div className="schedule-progress" aria-hidden>
                    <span style={{ width: `${item.total ? (item.done / item.total) * 100 : 0}%` }} />
                  </div>
                  <div className="tile-tags">
                    {item.next ? (
                      <button className="tag is-live tag-button" onClick={() => setPlanOpen(item.next!.id)}>
                        {t('Next: {step} · {day} · {when}', {
                          step: item.next.title.replace(`${item.title} — `, ''),
                          day: dayLabel(item.next.dueAt),
                          when: relativeDay(item.next.dueAt),
                        })}
                      </button>
                    ) : (
                      <span className="tag is-warn">{t('Nothing left ahead')}</span>
                    )}
                  </div>
                </div>
                <div className="tile-actions">
                  <button
                    className="ghost small-btn"
                    onClick={() => void stopSchedule(item)}
                    disabled={busy === item.id}
                  >
                    {t('Stop')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Stopped series are kept, quietly: the ones you attended are still
          part of the record even once the rule is switched off. */}
      {ended.length > 0 && (
        <section>
          <h2 className="section-title muted-title">{t('Stopped · {n}', { n: ended.length })}</h2>
          <div className="tiles two-up">
            {ended.map((item) => (
              <article className="tile dimmed" key={item.id}>
                <span className="tile-mark" aria-hidden>
                  &#8635;
                </span>
                <div className="tile-body">
                  <p className="tile-title">{item.title}</p>
                  <p className="tile-sub">{item.summary}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {series && (
        <Modal title={series.title} onClose={() => setSeries(null)}>
          <SeriesSheet
            key={series.id}
            item={series}
            busy={busy === series.id}
            onOpenPlan={setPlanOpen}
            onStop={() => void stop(series)}
          />
        </Modal>
      )}

      {planOpen && (
        <CommitmentSheet
          key={planOpen}
          commitmentId={planOpen}
          onClose={() => setPlanOpen(null)}
          onChanged={() => {
            announceChange()
            void load()
          }}
          onOpenOther={(id) => setPlanOpen(id)}
        />
      )}
    </div>
  )
}
