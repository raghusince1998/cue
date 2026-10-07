import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { WINDOW_LABELS, type CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { dayBounds, formatSpan, overdueBy } from '../lib/time.ts'
import { enablePush, pushState, sendTestPush } from '../lib/push.ts'
import { Modal } from '../components/Modal.tsx'
import { InstallButton } from '../components/InstallButton.tsx'
import { CommitmentEditor } from '../components/CommitmentEditor.tsx'
import { NearbyIntentions } from '../components/NearbyIntentions.tsx'
import { DayBrief } from '../components/DayBrief.tsx'
import { PlanTomorrow } from '../components/PlanTomorrow.tsx'
import { MoveIt } from '../components/MoveIt.tsx'
import { Checklist } from '../components/Checklist.tsx'
import { Triage } from '../components/Triage.tsx'
import { Search } from '../components/Search.tsx'
import { CalendarView, type CalendarMode } from '../components/CalendarView.tsx'
import { useOnChange } from '../lib/changes.ts'

interface Agenda {
  overdue: CommitmentDTO[]
  today: CommitmentDTO[]
  upcoming: CommitmentDTO[]
  doneToday: CommitmentDTO[]
}

const EMPTY: Agenda = { overdue: [], today: [], upcoming: [], doneToday: [] }

/** Mirrors toneOf in CalendarView, so a card and its chip agree on colour. */
function cardTone(c: CommitmentDTO, overdue?: boolean): string {
  if (overdue) return 'overdue'
  if (c.priority === 'critical') return 'critical'
  if (c.feedId) return 'feed'
  if (c.recurrenceId) return 'repeat'
  return 'normal'
}

function Card({
  commitment,
  overdue,
  onDone,
  onSnooze,
  onEdit,
  onMoved,
}: {
  commitment: CommitmentDTO
  overdue?: boolean
  onDone: (id: string) => void
  onSnooze: (id: string, minutes: number) => void
  onEdit: (id: string) => void
  onMoved: () => void
}) {
  const [moving, setMoving] = useState(false)

  return (
    <li
      className={`card commitment tone-edge tone-${cardTone(commitment, overdue)}${overdue ? ' is-overdue' : ''}`}
    >
      <div className="commitment-head">
        <div>
          <p className="commitment-title">{commitment.title}</p>
          <p className="muted small">
            {commitment.flexibility === 'flexible' && commitment.preferredWindow
              ? `${WINDOW_LABELS[commitment.preferredWindow]} — no set time`
              : formatSpan(commitment.dueAt, commitment.endsAt, commitment.allDay)}
            {commitment.placeName ? ` · ${commitment.placeName}` : ''}
            {commitment.contactName ? ` · ${commitment.contactName}` : ''}
            {/* Says why only one of a series is showing, and where the rest went. */}
            {commitment.recurrenceId ? ' · repeats' : ''}
            {commitment.feedId ? ' · from your calendar' : ''}
          </p>
        </div>
        {overdue && commitment.flexibility === 'fixed' && (
          <span className="badge">{overdueBy(commitment.dueAt)} late</span>
        )}
        {commitment.priority === 'critical' && <span className="badge">Critical</span>}
      </div>

      {commitment.notes && <p className="notes">{commitment.notes}</p>}

      {commitment.escalationCount > 0 && (
        <p className="muted small">
          Chased {commitment.escalationCount}{' '}
          {commitment.escalationCount === 1 ? 'time' : 'times'}
        </p>
      )}

      <div className="row">
        <button className="primary small-btn" onClick={() => onDone(commitment.id)}>
          Done
        </button>
        {/* The word "Snooze" is what makes the bare durations mean anything;
            with it they can stay short and the whole row fits on one line. */}
        {/* Pushing something an hour is what already failed, so an overdue
            card offers a real time instead of three sizes of "later". */}
        {overdue ? (
          <button className="ghost small-btn" onClick={() => setMoving((v) => !v)}>
            {moving ? 'Never mind' : 'Move it'}
          </button>
        ) : (
          <span className="snooze-group">
            <span className="snooze-label">Snooze</span>
            <button className="ghost tiny-btn" onClick={() => onSnooze(commitment.id, 15)}>
              15m
            </button>
            <button className="ghost tiny-btn" onClick={() => onSnooze(commitment.id, 60)}>
              1h
            </button>
            <button className="ghost tiny-btn" onClick={() => onSnooze(commitment.id, 60 * 24)}>
              1d
            </button>
          </span>
        )}
        {commitment.contactPhone && (
          <a className="ghost small-btn call-btn" href={`tel:${commitment.contactPhone}`}>
            Call {commitment.contactName ?? ''}
          </a>
        )}
        <button className="link push-right" onClick={() => onEdit(commitment.id)}>
          Edit
        </button>
      </div>

      {commitment.checklistCount ? <Checklist commitmentId={commitment.id} /> : null}

      {moving && (
        <MoveIt
          commitmentId={commitment.id}
          onMoved={() => {
            setMoving(false)
            onMoved()
          }}
          onCancel={() => setMoving(false)}
          onEdit={() => {
            setMoving(false)
            onEdit(commitment.id)
          }}
        />
      )}
    </li>
  )
}

function PushBanner() {
  const [state, setState] = useState(pushState())
  const [message, setMessage] = useState<string | null>(null)

  if (state === 'granted') {
    return (
      <div className="banner subtle">
        <span>Notifications are on.</span>
        <button
          className="link"
          onClick={async () => {
            const delivered = await sendTestPush()
            setMessage(
              delivered > 0
                ? 'Test sent — check your notification tray.'
                : 'No device registered yet. Reload and enable again.',
            )
          }}
        >
          Send test
        </button>
        {message && <span className="muted small">{message}</span>}
      </div>
    )
  }

  return (
    <div className="banner">
      <div>
        <strong>Turn on reminders</strong>
        <p className="muted small">Nothing can reach you once the app is closed without them.</p>
        {message && <p className="error small">{message}</p>}
      </div>
      <button
        className="primary small-btn"
        onClick={async () => {
          const result = await enablePush()
          setState(pushState())
          setMessage(result.ok ? null : (result.reason ?? 'Could not enable notifications.'))
        }}
      >
        Enable
      </button>
    </div>
  )
}

export default function Today() {
  const [agenda, setAgenda] = useState<Agenda>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Five is enough to see the shape of the month without scrolling past it.
  const [showAllContext, setShowAllContext] = useState(false)
  // Bumped after any save, so the calendar refetches instead of going stale.
  const [calendarKey, setCalendarKey] = useState(0)
  // Remembered across visits: someone who thinks in months should not have to
  // re-pick the month view every time they open the app.
  const [view, setView] = useState<'agenda' | CalendarMode>(
    () => (localStorage.getItem('cue.view') as 'agenda' | CalendarMode | null) ?? 'agenda',
  )
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const handledDeepLink = useRef(false)

  const load = useCallback(async () => {
    const { from, to } = dayBounds()
    setAgenda(await api<Agenda>('/commitments/agenda', { query: { from, to } }))
    setLoading(false)
    setCalendarKey((k) => k + 1)
  }, [])

  // Something added from the header, over this page: show it now rather than
  // at the next minute's poll.
  useOnChange(() => void load())

  useEffect(() => {
    void load()
    // Keeps the overdue list honest while the tab sits open on a desk.
    const handle = setInterval(() => void load(), 60_000)
    return () => clearInterval(handle)
  }, [load])

  const complete = useCallback(
    async (id: string) => {
      await api(`/commitments/${id}/done`, { method: 'POST' })
      await load()
    },
    [load],
  )

  const snooze = useCallback(
    async (id: string, minutes: number) => {
      await api(`/commitments/${id}/snooze`, { method: 'POST', body: { minutes } })
      await load()
    },
    [load],
  )

  // Notification action buttons deep-link back here rather than calling the API
  // from the service worker, which has no access to the auth token.
  useEffect(() => {
    if (handledDeepLink.current) return
    const action = params.get('action')
    const id = params.get('id')
    if (!action || !id) return

    handledDeepLink.current = true

    // "Call" from a notification: look the number up, then dial.
    if (action === 'call') {
      void api<CommitmentDTO>(`/commitments/${id}`)
        .then((c) => {
          if (c.contactPhone) window.location.href = `tel:${c.contactPhone}`
        })
        .finally(() => setParams({}, { replace: true }))
      return
    }

    const run = action === 'done' ? complete(id) : snooze(id, 15)
    void run.finally(() => setParams({}, { replace: true }))
  }, [params, setParams, complete, snooze])

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  const fixedToday = agenda.today.filter((c) => c.flexibility !== 'flexible')
  const flexibleToday = agenda.today.filter((c) => c.flexibility === 'flexible')

  /**
   * One card per repeating plan, not seventeen.
   *
   * A weekly standup generates months of identical occurrences, and showing
   * them all buries the handful of things that genuinely need attention. Only
   * the next one appears here; the whole series lives on the Repeating screen.
   */
  const upcomingCollapsed = (() => {
    const seen = new Set<string>()
    return agenda.upcoming.filter((c) => {
      if (!c.recurrenceId) return true
      if (seen.has(c.recurrenceId)) return false
      seen.add(c.recurrenceId)
      return true
    })
  })()

  /**
   * An all-day event mirrored from a calendar is context, not a task.
   *
   * A public holiday is not something you tick off, and giving seventy of them
   * a Done button and a snooze menu buries the handful of things that really
   * are yours to do. They still matter — they are why a Thursday is a bad day
   * to book something — so they are listed, just not as work.
   */
  const isContext = (c: CommitmentDTO) => Boolean(c.feedId) && c.allDay
  const upcomingTasks = upcomingCollapsed.filter((c) => !isContext(c))
  const upcomingContext = upcomingCollapsed.filter(isContext)

  const nothingPending =
    agenda.overdue.length === 0 && agenda.today.length === 0 && agenda.upcoming.length === 0

  function chooseView(next: 'agenda' | CalendarMode) {
    setView(next)
    try {
      localStorage.setItem('cue.view', next)
    } catch {
      // Private browsing refuses to store. Losing the preference is fine.
    }
  }

  return (
    <div className="stack">
      {/* Opened from the brief, which is the only thing that raises it. */}
      {params.get('triage') === '1' && (
        <Modal
          title="What stopped moving"
          onClose={() => {
            params.delete('triage')
            setParams(params, { replace: true })
          }}
        >
          <Triage
            onClose={() => {
              params.delete('triage')
              setParams(params, { replace: true })
            }}
            onApplied={() => void load()}
          />
        </Modal>
      )}

      {/* Opened by the evening nudge, which deep-links here with ?plan=tomorrow. */}
      {params.get('plan') === 'tomorrow' && (
        <Modal
          title="Tomorrow"
          onClose={() => {
            params.delete('plan')
            setParams(params, { replace: true })
          }}
        >
          <PlanTomorrow
            onClose={() => {
              params.delete('plan')
              setParams(params, { replace: true })
            }}
            onApplied={() => void load()}
          />
        </Modal>
      )}

      {/* Above the brief, where people look for it. Quiet until used: no
          helper text and no results, so it costs one line and nothing else. */}
      <Search variant="inline" />

      <NearbyIntentions />
      {/* What the app noticed, before what it was told. */}
      <DayBrief refreshKey={calendarKey} onNavigate={(href) => navigate(href)} />
      <InstallButton />
      <PushBanner />

      <div className="row spread">
        <div className="viewswitch">
          {(['agenda', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              className={view === v ? 'selected' : ''}
              onClick={() => chooseView(v)}
            >
              {v === 'agenda' ? 'List' : v === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
        {agenda.overdue.length > 0 && view !== 'agenda' && (
          <button className="ghost small-btn danger" onClick={() => chooseView('agenda')}>
            {agenda.overdue.length} overdue
          </button>
        )}
      </div>

      {view !== 'agenda' && (
        <CalendarView mode={view} onOpen={setEditingId} refreshKey={calendarKey} />
      )}

      {view === 'agenda' && agenda.overdue.length > 0 && (
        <section>
          <h2 className="section-title danger">
            You dropped these <span className="count">{agenda.overdue.length}</span>
          </h2>
          <ul className="list">
            {agenda.overdue.map((c) => (
              <Card
                key={c.id}
                commitment={c}
                overdue
                onDone={complete}
                onSnooze={snooze}
                onEdit={setEditingId}
                onMoved={() => void load()}
              />
            ))}
          </ul>
        </section>
      )}

      {view === 'agenda' && (
      <section>
        <h2 className="section-title">Rest of today</h2>
        {fixedToday.length === 0 ? (
          <p className="muted">Nothing else at a set time today.</p>
        ) : (
          <ul className="list">
            {fixedToday.map((c) => (
              <Card
                key={c.id}
                commitment={c}
                onDone={complete}
                onSnooze={snooze}
                onEdit={setEditingId}
                onMoved={() => void load()}
              />
            ))}
          </ul>
        )}
      </section>
      )}

      {/* Intentions, not appointments. Kept apart so the day reads as a day. */}
      {view === 'agenda' && flexibleToday.length > 0 && (
        <section>
          <h2 className="section-title">Whenever you get a chance</h2>
          <ul className="list">
            {flexibleToday.map((c) => (
              <Card
                key={c.id}
                commitment={c}
                onDone={complete}
                onSnooze={snooze}
                onEdit={setEditingId}
                onMoved={() => void load()}
              />
            ))}
          </ul>
        </section>
      )}

      {view === 'agenda' && upcomingTasks.length > 0 && (
        <section>
          <h2 className="section-title">Coming up</h2>
          <ul className="list">
            {upcomingTasks.map((c) => (
              <Card
                key={c.id}
                commitment={c}
                onDone={complete}
                onSnooze={snooze}
                onEdit={setEditingId}
                onMoved={() => void load()}
              />
            ))}
          </ul>
        </section>
      )}

      {view === 'agenda' && upcomingContext.length > 0 && (
        <section>
          <h2 className="section-title muted-title">
            From your calendar · {upcomingContext.length}
          </h2>
          <ul className="plain">
            {upcomingContext.slice(0, showAllContext ? undefined : 5).map((c) => (
              <li key={c.id} className="muted small">
                {formatSpan(c.dueAt, c.endsAt, c.allDay)} — {c.title}
              </li>
            ))}
          </ul>
          {upcomingContext.length > 5 && (
            <button className="ghost small-btn" onClick={() => setShowAllContext((v) => !v)}>
              {showAllContext ? 'Show fewer' : `Show all ${upcomingContext.length}`}
            </button>
          )}
        </section>
      )}

      {view === 'agenda' && agenda.doneToday.length > 0 && (
        <section>
          <h2 className="section-title muted-title">Closed today · {agenda.doneToday.length}</h2>
          <ul className="list">
            {agenda.doneToday.map((c) => (
              <li key={c.id} className="card done">
                <div className="commitment-head">
                  <div>
                    <p className="commitment-title struck">{c.title}</p>
                    {/* Two ways to close something, and they mean different
                        things, so the card says which one happened. */}
                    <p className="muted small">
                      {c.status === 'cancelled' ? 'Cancelled' : 'Done'}
                      {c.placeName ? ` · ${c.placeName}` : ''}
                    </p>
                  </div>
                  <button className="link" onClick={() => setEditingId(c.id)}>
                    Reopen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === 'agenda' && nothingPending && agenda.doneToday.length === 0 && (
        <div className="empty">
          <p>Nothing is waiting on you.</p>
          <p className="muted small">
            Log a visit and any callback they gave you becomes a reminder automatically.
          </p>
        </div>
      )}

      {editingId && (
        <Modal title="Edit follow-up" onClose={() => setEditingId(null)}>
          <CommitmentEditor
            commitmentId={editingId}
            onClose={() => setEditingId(null)}
            onSaved={() => {
              setEditingId(null)
              void load()
            }}
          />
        </Modal>
      )}
    </div>
  )
}
