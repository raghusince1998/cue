import { useEffect, useState } from 'react'
import type { RecurrenceDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { dayLabel, relativeDay } from '../lib/time.ts'
import { useOnChange } from '../lib/changes.ts'

/**
 * Everything that repeats.
 *
 * Kept off the Today screen on purpose: a rule is not a thing to do, and the
 * eleven Tuesdays it will produce would drown out the four things that are
 * actually due. This is where you come to check or stop one.
 */
export default function Repeating() {
  const [items, setItems] = useState<RecurrenceDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function load() {
    try {
      const r = await api<{ recurrences: RecurrenceDTO[] }>('/recurrences')
      setItems(r.recurrences)
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

  if (error) return <p className="error">{error}</p>
  if (!items) return <p className="muted">Loading…</p>

  const active = items.filter((i) => i.status === 'active')
  const ended = items.filter((i) => i.status !== 'active')

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Repeating</h1>
        <span className="page-count">
          {active.length} running{ended.length > 0 ? ` · ${ended.length} stopped` : ''}
        </span>
      </div>

      {note && <p className="muted small">{note}</p>}

      {active.length === 0 && (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#8635;
          </span>
          <h3>Nothing repeats yet</h3>
          <p>
            Say it once and it keeps going. Type &ldquo;standup every tuesday at 10am&rdquo; or
            &ldquo;pay rent on the 1st of every month&rdquo; when you add a plan, and it lands
            here.
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
