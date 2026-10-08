import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { WINDOW_LABELS, type CommitmentDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { dayBounds, formatSpan, overdueBy } from '../lib/time.ts'
import { enablePush, pushState, sendTestPush } from '../lib/push.ts'
import { Modal } from '../components/Modal.tsx'
import { InstallButton } from '../components/InstallButton.tsx'
import { CommitmentSheet, type SheetMode } from '../components/CommitmentSheet.tsx'
import { WrapUp } from '../components/WrapUp.tsx'
import { NearbyIntentions } from '../components/NearbyIntentions.tsx'
import { DayBrief } from '../components/DayBrief.tsx'
import { PlanTomorrow } from '../components/PlanTomorrow.tsx'
import { MoveIt } from '../components/MoveIt.tsx'
import { Checklist } from '../components/Checklist.tsx'
import { Triage } from '../components/Triage.tsx'
import { Search } from '../components/Search.tsx'
import { CalendarView, type CalendarMode } from '../components/CalendarView.tsx'
import { useOnChange } from '../lib/changes.ts'
import { readNotes } from '../lib/sample.ts'

interface Agenda {
  overdue: CommitmentDTO[]
  today: CommitmentDTO[]
  upcoming: CommitmentDTO[]
  doneToday: CommitmentDTO[]
  /** Meetings under way or ended this week, not yet wrapped up. */
  justFinished?: CommitmentDTO[]
}

const EMPTY: Agenda = { overdue: [], today: [], upcoming: [], doneToday: [], justFinished: [] }

/** When a meeting ends: its own end, or its start plus its length. */
function endOf(c: CommitmentDTO): Date {
  return c.endsAt
    ? new Date(c.endsAt)
    : new Date(new Date(c.dueAt).getTime() + c.durationMinutes * 60_000)
}

function endedAgo(end: Date, now = new Date()): string {
  const minutes = Math.round((now.getTime() - end.getTime()) / 60_000)
  if (minutes < 60) return `Ended ${Math.max(1, minutes)} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Ended ${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Ended yesterday' : `Ended ${days} days ago`
}

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
  onOpen,
  onMoved,
}: {
  commitment: CommitmentDTO
  overdue?: boolean
  onDone: (id: string) => void
  onSnooze: (id: string, minutes: number) => void
  /** Show this plan's details; 'edit' goes straight to the form. */
  onOpen: (id: string, mode?: SheetMode) => void
  onMoved: () => void
}) {
  const [moving, setMoving] = useState(false)
  const { notes, sample } = readNotes(commitment.notes)

  return (
    <li
      className={`card commitment tone-edge tone-${cardTone(commitment, overdue)}${overdue ? ' is-overdue' : ''}`}
    >
      {/* The card itself opens the plan. Its buttons do their own thing and
          sit outside this, so pressing Done never also opens the details. */}
      <div
        className="commitment-main is-openable"
        role="button"
        tabIndex={0}
        aria-label={`Open ${commitment.title}`}
        onClick={() => onOpen(commitment.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(commitment.id)
          }
        }}
      >
      <div className="commitment-head">
        <div>
          <p className="commitment-title">
            {commitment.title}
            {sample && <span className="sample-tag">Sample</span>}
          </p>
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

      {notes && <p className="notes">{notes}</p>}

      {commitment.escalationCount > 0 && (
        <p className="muted small">
          Chased {commitment.escalationCount}{' '}
          {commitment.escalationCount === 1 ? 'time' : 'times'}
        </p>
      )}
      </div>

      <div className="row commitment-actions">
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
            onOpen(commitment.id, 'edit')
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

/**
 * Whether the page is in its two-column layout. The same breakpoint as the
 * stylesheet, because it decides what the calendar beside the list shows: a
 * month has room in the side column, but above a phone's list only a week
 * does.
 */
const WIDE = '(min-width: 1000px)'

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const query = window.matchMedia(WIDE)
    const update = () => setWide(query.matches)
    query.addEventListener('change', update)
    // Both, as in CalendarView: change events do not always arrive when the
    // viewport is driven externally, and a resize does.
    window.addEventListener('resize', update)
    return () => {
      query.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return wide
}

export default function Today() {
  const [agenda, setAgenda] = useState<Agenda>(EMPTY)
  const [loading, setLoading] = useState(true)
  /** The meeting being wrapped up: "what came out of it?". */
  const [wrapping, setWrapping] = useState<CommitmentDTO | null>(null)
  /** The plan open in the details sheet, and whether it opened on the form. */
  const [opened, setOpened] = useState<{ id: string; mode: SheetMode } | null>(null)
  const openPlan = useCallback(
    (id: string, mode: SheetMode = 'view') => setOpened({ id, mode }),
    [],
  )
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
  const wide = useWide()
  /** A day a link asked to open on — "Open the day" on a clash. */
  const [focusDate, setFocusDate] = useState<string | null>(null)

  // ?wrapup=<id>: the "just ended — any follow-ups?" notification, tapped.
  useEffect(() => {
    const id = params.get('wrapup')
    if (!id) return
    params.delete('wrapup')
    setParams(params, { replace: true })
    void api<CommitmentDTO>(`/commitments/${id}`)
      .then((c) => {
        if (c.status === 'pending') setWrapping(c)
      })
      .catch(() => undefined)
  }, [params, setParams])

  // ?view=week&date=YYYY-MM-DD: switch to that view on that day, then take
  // the parameters out of the address so a refresh does not keep jumping back.
  useEffect(() => {
    const linked = params.get('view')
    if (linked !== 'week' && linked !== 'month') return
    setView(linked)
    setFocusDate(params.get('date'))
    params.delete('view')
    params.delete('date')
    setParams(params, { replace: true })
  }, [params, setParams])

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
  const nowMs = Date.now()
  const happeningNow = (agenda.justFinished ?? []).filter((c) => endOf(c).getTime() > nowMs)
  const justFinished = (agenda.justFinished ?? []).filter((c) => endOf(c).getTime() <= nowMs)

  /** "Nothing came out of it": close the meeting without opening anything. */
  async function nothingToAdd(id: string) {
    await api(`/commitments/${id}/wrap-up`, { method: 'POST', body: { items: [] } })
    await load()
  }
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
    /*
     * Three regions rather than one long column.
     *
     * On a phone they stack: search, then what the app noticed, then the
     * plans. On a wide screen the summary moves to its own column on the right
     * and the plans take the main one — a single 800px column on a 1440px
     * screen left two thirds of it empty and made the day 4,500px tall.
     */
    <div className="today">
      {/* Opened from the brief, which is the only thing that raises it. */}
      {(params.get('triage') === '1' || params.get('triage') === 'all') && (
        <Modal
          title={params.get('triage') === 'all' ? 'Clear what is overdue' : 'What stopped moving'}
          onClose={() => {
            params.delete('triage')
            setParams(params, { replace: true })
          }}
        >
          <Triage
            all={params.get('triage') === 'all'}
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
      <div className="today-search">
        <Search variant="inline" />
      </div>

      {/* What the app noticed, before what it was told. */}
      <aside className="today-aside stack">
        <NearbyIntentions />
        <DayBrief
          refreshKey={calendarKey}
          onNavigate={(href) => navigate(href)}
          preview={wide ? 2 : 1}
        />
        {/* The list and the calendar in one view. The list says what to do
            next; this says how the weeks around it are shaped, which a list
            cannot. Left out when the main column is a calendar already. */}
        {view === 'agenda' && (
          <section className="card today-cal">
            <CalendarView
              compact
              mode={wide ? 'month' : 'week'}
              onOpen={openPlan}
              refreshKey={calendarKey}
            />
          </section>
        )}
        <InstallButton />
        <PushBanner />
      </aside>

      <div className="today-main stack">
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
        <CalendarView
          key={focusDate ?? 'today'}
          mode={view}
          onOpen={openPlan}
          refreshKey={calendarKey}
          initialDate={focusDate ?? undefined}
        />
      )}

      {/* First, because it is the most perishable thing on the screen: what was
          agreed in a meeting is clearest in the hour after it. */}
      {view === 'agenda' && justFinished.length > 0 && (
        <section>
          <h2 className="section-title">
            Just finished — any follow-ups? <span className="count is-calm">{justFinished.length}</span>
          </h2>
          <ul className="list">
            {justFinished.map((c) => (
              <li key={c.id} className="card commitment wrapup-card">
                <div
                  className="commitment-main is-openable"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${c.title}`}
                  onClick={() => openPlan(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openPlan(c.id)
                    }
                  }}
                >
                  <p className="commitment-title">{c.title}</p>
                  <p className="muted small">
                    {endedAgo(endOf(c))}
                    {c.placeName ? ` · ${c.placeName}` : ''}
                    {c.feedId ? ' · from your calendar' : ''}
                  </p>
                </div>
                <div className="row commitment-actions">
                  <button className="primary small-btn" onClick={() => setWrapping(c)}>
                    Add follow-ups
                  </button>
                  <button className="ghost small-btn" onClick={() => void nothingToAdd(c.id)}>
                    Nothing to add
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === 'agenda' && happeningNow.length > 0 && (
        <section>
          <h2 className="section-title">Happening now</h2>
          <ul className="list">
            {happeningNow.map((c) => (
              <Card
                key={c.id}
                commitment={c}
                onDone={complete}
                onSnooze={snooze}
                onOpen={openPlan}
                onMoved={() => void load()}
              />
            ))}
          </ul>
        </section>
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
                onOpen={openPlan}
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
                onOpen={openPlan}
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
                onOpen={openPlan}
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
                onOpen={openPlan}
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
                  <button className="link" onClick={() => openPlan(c.id, 'edit')}>
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
      </div>

      {wrapping && (
        <Modal title="Wrap up" onClose={() => setWrapping(null)} closeOnBackdrop={false}>
          <WrapUp
            meeting={wrapping}
            onDone={() => {
              setWrapping(null)
              void load()
            }}
          />
        </Modal>
      )}

      {opened && (
        <CommitmentSheet
          key={opened.id}
          commitmentId={opened.id}
          initialMode={opened.mode}
          onClose={() => setOpened(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}
