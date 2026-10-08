import { useEffect, useState } from 'react'
import type { RecurrenceDTO, ScheduleDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { dayLabel, relativeDay } from '../lib/time.ts'
import { useOnChange } from '../lib/changes.ts'
import { openAdd } from '../lib/addSheet.ts'

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

  async function stop(item: RecurrenceDTO) {
    // Worth a confirm: it removes every future occurrence in one go.
    const ok = window.confirm(
      `Stop "${item.title}"?\n\n${item.upcomingCount} upcoming will be removed. Anything already done stays in your history.`,
    )
    if (!ok) return

    setBusy(item.id)
    try {
      const r = await api<{ keptOccurrences: number }>(`/recurrences/${item.id}`, {
        method: 'DELETE',
      })
      setNote(
        r.keptOccurrences > 0
          ? `Stopped. ${r.keptOccurrences} past one${r.keptOccurrences === 1 ? '' : 's'} kept in your history.`
          : 'Stopped.',
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
      `Stop "${item.title}"?\n\nThe steps still ahead will be removed. ${item.done > 0 ? 'The ones already done stay in your history.' : ''}`,
    )
    if (!ok) return
    setBusy(item.id)
    try {
      const r = await api<{ removed: number }>(`/schedules/${item.id}`, { method: 'DELETE' })
      setNote(`Stopped. ${r.removed} upcoming step${r.removed === 1 ? '' : 's'} removed.`)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!items) return <p className="muted">Loading…</p>

  const active = items.filter((i) => i.status === 'active')
  const ended = items.filter((i) => i.status !== 'active')
  const runningSchedules = schedules.filter((s) => s.status === 'active')

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Repeating</h1>
        <span className="page-count">
          {active.length} running{ended.length > 0 ? ` · ${ended.length} stopped` : ''}
          {runningSchedules.length > 0
            ? ` · ${runningSchedules.length} schedule${runningSchedules.length === 1 ? '' : 's'}`
            : ''}
        </span>
      </div>

      {/* The two ways a plan comes back: on a rhythm, or on a set of dates. */}
      <div className="row repeat-starts">
        <button className="primary small-btn" onClick={() => openAdd({ repeat: true })}>
          + Repeating plan
        </button>
        <button className="ghost small-btn" onClick={() => openAdd({ schedule: true })}>
          + Schedule of dates
        </button>
      </div>

      {note && <p className="muted small">{note}</p>}

      {active.length === 0 && runningSchedules.length === 0 && (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#8635;
          </span>
          <h3>Nothing repeats yet</h3>
          <p>
            <strong>Repeating plan</strong> is for a rhythm — every day, every Monday, every
            3 months, every year. <strong>Schedule of dates</strong> is for dates that follow a
            plan instead — a child&rsquo;s vaccinations at 6 weeks, 10 weeks, 9 months. You can
            also just type &ldquo;standup every tuesday at 10am&rdquo; when you add something.
          </p>
        </div>
      )}

      {active.length > 0 && (
        <div className="tiles two-up">
          {active.map((item) => (
            <article className="tile" key={item.id}>
              <span className="tile-mark is-repeat" aria-hidden>
                &#8635;
              </span>

              <div className="tile-body">
                <p className="tile-title">{item.title}</p>
                <p className="tile-sub">{item.summary}</p>

                <div className="tile-tags">
                  {item.nextAt ? (
                    <span className="tag is-live">
                      Next {dayLabel(item.nextAt)} · {relativeDay(item.nextAt)}
                    </span>
                  ) : (
                    <span className="tag is-warn">Nothing left ahead</span>
                  )}
                  {item.upcomingCount > 0 && (
                    <span className="tag">{item.upcomingCount} booked</span>
                  )}
                  <span className="tag">{item.durationMinutes} min</span>
                  {(item.placeName ?? item.placeLabel) && (
                    <span className="tag">{item.placeName ?? item.placeLabel}</span>
                  )}
                </div>
              </div>

              <div className="tile-actions">
                <button
                  className="ghost small-btn"
                  onClick={() => void stop(item)}
                  disabled={busy === item.id}
                >
                  Stop
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {runningSchedules.length > 0 && (
        <section className="stack tight">
          <h2 className="section-title">Schedules · {runningSchedules.length}</h2>
          <div className="tiles two-up">
            {runningSchedules.map((item) => (
              <article className="tile" key={item.id}>
                <span className="tile-mark is-schedule" aria-hidden>
                  &#9638;
                </span>
                <div className="tile-body">
                  <p className="tile-title">{item.title}</p>
                  <p className="tile-sub">
                    {item.done} of {item.total} done · counting from {dayLabel(item.startsOn)}
                  </p>
                  <div className="schedule-progress" aria-hidden>
                    <span style={{ width: `${item.total ? (item.done / item.total) * 100 : 0}%` }} />
                  </div>
                  <div className="tile-tags">
                    {item.next ? (
                      <span className="tag is-live">
                        Next: {item.next.title.replace(`${item.title} — `, '')} ·{' '}
                        {dayLabel(item.next.dueAt)} · {relativeDay(item.next.dueAt)}
                      </span>
                    ) : (
                      <span className="tag is-warn">Nothing left ahead</span>
                    )}
                  </div>
                </div>
                <div className="tile-actions">
                  <button
                    className="ghost small-btn"
                    onClick={() => void stopSchedule(item)}
                    disabled={busy === item.id}
                  >
                    Stop
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
          <h2 className="section-title muted-title">Stopped · {ended.length}</h2>
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
    </div>
  )
}
