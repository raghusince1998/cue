import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { WINDOW_LABELS, hasWork, type CommitmentDTO, type Sphere } from '@cue/shared'
import { useAuth } from '../lib/auth.tsx'
import { UsesPicker } from '../components/UsesPicker.tsx'
import { Deliveries } from '../components/Deliveries.tsx'
import { ExamGlance } from '../components/ExamGlance.tsx'
import { ConnectMailCard } from '../components/ConnectMailCard.tsx'
import { api } from '../lib/api.ts'
import { dayBounds, dayLabel, formatSpan, overdueBy } from '../lib/time.ts'
import { enablePush, pushState, sendTestPush } from '../lib/push.ts'
import { Modal } from '../components/Modal.tsx'
import { InstallButton } from '../components/InstallButton.tsx'
import { CommitmentSheet, type SheetMode } from '../components/CommitmentSheet.tsx'
import { WrapUp } from '../components/WrapUp.tsx'
import { Nudge, waitingWhat } from '../components/Nudge.tsx'
import { WaitingForm } from '../components/WaitingForm.tsx'
import { YourDay } from '../components/YourDay.tsx'
import { WeeklyReview } from '../components/WeeklyReview.tsx'
import { DailyReport } from '../components/DailyReport.tsx'
import { Targets } from '../components/Targets.tsx'
import { startCall } from '../lib/calls.ts'
import { clearShared, readShared, type Shared } from '../lib/share.ts'
import { openAdd } from '../lib/addSheet.ts'
import { reopenPlan } from '../lib/reopen.ts'
import { QuickAdd } from '../components/QuickAdd.tsx'
import { CallLog } from '../components/CallLog.tsx'
import { FocusStart } from '../components/FocusStart.tsx'
import { NearbyIntentions } from '../components/NearbyIntentions.tsx'
import { DayBrief } from '../components/DayBrief.tsx'
import { PlanTomorrow } from '../components/PlanTomorrow.tsx'
import { MoveIt } from '../components/MoveIt.tsx'
import { Checklist } from '../components/Checklist.tsx'
import { Triage } from '../components/Triage.tsx'
import { Search } from '../components/Search.tsx'
import { CalendarView, type CalendarMode } from '../components/CalendarView.tsx'
import { useOnChange } from '../lib/changes.ts'
import { toast } from '../lib/toast.ts'
import { ApiError } from '../lib/api.ts'
import { readNotes } from '../lib/sample.ts'
import { locale, t } from '../lib/i18n.tsx'

interface Agenda {
  overdue: CommitmentDTO[]
  today: CommitmentDTO[]
  upcoming: CommitmentDTO[]
  doneToday: CommitmentDTO[]
  /** Meetings under way or ended this week, not yet wrapped up. */
  justFinished?: CommitmentDTO[]
  /** What other people owe you, soonest check-in first. */
  waiting?: CommitmentDTO[]
  /** Focus time under way, and how many reminders it is holding. */
  focus?: { active: CommitmentDTO | null; held: number }
}

const EMPTY: Agenda = {
  overdue: [],
  today: [],
  upcoming: [],
  doneToday: [],
  justFinished: [],
  waiting: [],
}

/** When a meeting ends: its own end, or its start plus its length. */
function endOf(c: CommitmentDTO): Date {
  return c.endsAt
    ? new Date(c.endsAt)
    : new Date(new Date(c.dueAt).getTime() + c.durationMinutes * 60_000)
}

function endedAgo(end: Date, now = new Date()): string {
  const minutes = Math.round((now.getTime() - end.getTime()) / 60_000)
  if (minutes < 60) return t('Ended {n} min ago', { n: Math.max(1, minutes) })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('Ended {n}h ago', { n: hours })
  const days = Math.round(hours / 24)
  return days === 1 ? t('Ended yesterday') : t('Ended {n} days ago', { n: days })
}

/** Mirrors toneOf in CalendarView, so a card and its chip agree on colour. */
/** Whether cards say "Work" or "Personal": only for someone with a working life. */
const ShowSphere = createContext(false)

/**
 * One half of the day: work, or personal. A plan whose words say neither stays
 * in both, since hiding something that might be either is how it gets missed.
 */
function onlyHalf(agenda: Agenda, half: Sphere): Agenda {
  const keep = (list: CommitmentDTO[] | undefined) => list?.filter((c) => !c.sphere || c.sphere === half)
  return {
    ...agenda,
    overdue: keep(agenda.overdue)!,
    today: keep(agenda.today)!,
    upcoming: keep(agenda.upcoming)!,
    doneToday: keep(agenda.doneToday)!,
    justFinished: keep(agenda.justFinished),
    waiting: keep(agenda.waiting),
  }
}

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
  const showSphere = useContext(ShowSphere)

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
        aria-label={t('Open {title}', { title: commitment.title })}
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
            {sample && <span className="sample-tag">{t('Sample')}</span>}
            {showSphere && commitment.sphere && (
              <span className={`sphere-tag is-${commitment.sphere}`}>
                {commitment.sphere === 'work' ? t('Work') : t('Personal')}
              </span>
            )}
          </p>
          <p className="muted small">
            {commitment.flexibility === 'flexible' && commitment.preferredWindow
              ? t('{window} — no set time', { window: t(WINDOW_LABELS[commitment.preferredWindow]) })
              : formatSpan(commitment.dueAt, commitment.endsAt, commitment.allDay)}
            {commitment.placeName ? ` · ${commitment.placeName}` : ''}
            {commitment.contactName ? ` · ${commitment.contactName}` : ''}
            {/* Says why only one of a series is showing, and where the rest went. */}
            {commitment.recurrenceId ? ` · ${t('repeats')}` : ''}
            {commitment.feedId ? ` · ${t('from your calendar')}` : ''}
          </p>
          {/* Prep at a glance: open the card for what they are. */}
          {(commitment.prepOpen ?? 0) > 0 && (
            <span className="prep-chip">
              {t('{n} open from last time', { n: commitment.prepOpen ?? 0 })}
            </span>
          )}
        </div>
        {overdue && commitment.flexibility === 'fixed' && (
          <span className="badge">{t('{time} late', { time: overdueBy(commitment.dueAt) })}</span>
        )}
        {commitment.priority === 'critical' && <span className="badge">{t('Critical')}</span>}
      </div>

      {notes && <p className="notes">{notes}</p>}

      {commitment.escalationCount > 0 && (
        <p className="muted small">
          {commitment.escalationCount === 1
            ? t('Chased 1 time')
            : t('Chased {n} times', { n: commitment.escalationCount })}
        </p>
      )}
      </div>

      {commitment.kind === 'focus' ? (
        <div className="row commitment-actions">
          <button
            className="ghost small-btn"
            onClick={async () => {
              await api(`/focus/${commitment.id}/end`, { method: 'POST' })
              onMoved()
            }}
          >
            {t('Call it off')}
          </button>
        </div>
      ) : (
      <div className="row commitment-actions">
        <button className="primary small-btn" onClick={() => onDone(commitment.id)}>
          {t('Done')}
        </button>
        {/* The word "Snooze" is what makes the bare durations mean anything;
            with it they can stay short and the whole row fits on one line. */}
        {/* Pushing something an hour is what already failed, so an overdue
            card offers a real time instead of three sizes of "later". */}
        {overdue ? (
          <button className="ghost small-btn" onClick={() => setMoving((v) => !v)}>
            {moving ? t('Never mind') : t('Move it')}
          </button>
        ) : (
          <span className="snooze-group">
            <span className="snooze-label">{t('Snooze')}</span>
            <button className="ghost tiny-btn" onClick={() => onSnooze(commitment.id, 15)}>
              {t('15m')}
            </button>
            <button className="ghost tiny-btn" onClick={() => onSnooze(commitment.id, 60)}>
              {t('1h')}
            </button>
            <button className="ghost tiny-btn" onClick={() => onSnooze(commitment.id, 60 * 24)}>
              {t('1d')}
            </button>
          </span>
        )}
        {commitment.contactPhone && (
          <a
            className="ghost small-btn call-btn"
            href={`tel:${commitment.contactPhone}`}
            data-contact-id={commitment.contactId ?? undefined}
            data-name={commitment.contactName ?? undefined}
            data-commitment-id={commitment.id}
            data-commitment-title={commitment.title}
          >
            {commitment.contactName ? t('Call {name}', { name: commitment.contactName }) : t('Call')}
          </a>
        )}
      </div>

      )}

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
        <span>{t('Notifications are on.')}</span>
        <button
          className="link"
          onClick={async () => {
            const delivered = await sendTestPush()
            setMessage(
              delivered > 0
                ? t('Test sent — check your notification tray.')
                : t('No device registered yet. Reload and enable again.'),
            )
          }}
        >
          {t('Send test')}
        </button>
        {message && <span className="muted small">{message}</span>}
      </div>
    )
  }

  return (
    <div className="banner">
      <div>
        <strong>{t('Turn on reminders')}</strong>
        <p className="muted small">{t('Nothing can reach you once the app is closed without them.')}</p>
        {message && <p className="error small">{message}</p>}
      </div>
      <button
        className="primary small-btn"
        onClick={async () => {
          const result = await enablePush()
          setState(pushState())
          setMessage(result.ok ? null : (result.reason ?? t('Could not enable notifications.')))
        }}
      >
        {t('Enable')}
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
  const { me } = useAuth()
  // Asked once: "Not now" is an answer too.
  const [usesAsked, setUsesAsked] = useState(() => {
    try {
      return localStorage.getItem('cue.usesAsked') === '1'
    } catch {
      return false
    }
  })
  const [allAgenda, setAgenda] = useState<Agenda>(EMPTY)
  // Work and personal on one day: both by default, or one half of it.
  const working = hasWork(me?.uses ?? [])
  const [half, setHalf] = useState<'all' | Sphere>(() => {
    try {
      const saved = localStorage.getItem('cue.half')
      return saved === 'work' || saved === 'personal' ? saved : 'all'
    } catch {
      return 'all'
    }
  })
  function chooseHalf(next: 'all' | Sphere) {
    setHalf(next)
    try {
      localStorage.setItem('cue.half', next)
    } catch {
      // Remembering is a convenience; the choice still applies now.
    }
  }
  const agenda = useMemo(
    () => (working && half !== 'all' ? onlyHalf(allAgenda, half) : allAgenda),
    [allAgenda, half, working],
  )
  const [loading, setLoading] = useState(true)
  /** The meeting being wrapped up: "what came out of it?". */
  const [wrapping, setWrapping] = useState<CommitmentDTO | null>(null)
  /** The check-in being chased: a ready message, then "check again when?". */
  const [nudging, setNudging] = useState<CommitmentDTO | null>(null)
  const [addingWaiting, setAddingWaiting] = useState(false)
  /** "Your day": today hour by hour, with the free stretches marked. */
  const [dayOpen, setDayOpen] = useState(false)
  /** The weekly review: the week behind and the one ahead. */
  const [reviewOpen, setReviewOpen] = useState(false)
  /** The daily report, or the morning standup. */
  const [reportOpen, setReportOpen] = useState<'report' | 'standup' | null>(null)
  const [targetsOpen, setTargetsOpen] = useState(false)
  /** Something shared in from another app, waiting in the box. */
  const [shared, setShared] = useState<Shared | null>(() => readShared())
  /** The box, remounted to focus it or start listening: a home-screen shortcut. */
  const [capture, setCapture] = useState({ key: 0, focus: false, listen: false })
  /** "Log a call" from the home screen, and when it was opened. */
  const [loggingCallAt, setLoggingCallAt] = useState<number | null>(null)
  /** Starting focus time: now, or for a free stretch picked in "Your day". */
  const [focusStart, setFocusStart] = useState<{ startAt?: string; maxMinutes?: number } | null>(null)
  const [showAllWaiting, setShowAllWaiting] = useState(false)
  /** The plan open in the details sheet, and whether it opened on the form. */
  const [opened, setOpened] = useState<{ id: string; mode: SheetMode; notice?: string } | null>(null)
  const openPlan = useCallback(
    (id: string, mode: SheetMode = 'view', notice?: string) => setOpened({ id, mode, notice }),
    [],
  )

  /** Reopen from "Closed today": open again at once, then the editor for the time. */
  async function reopen(c: CommitmentDTO) {
    try {
      const notice = await reopenPlan(c)
      await load()
      openPlan(c.id, 'edit', notice)
    } catch {
      // Could not reopen it here: the editor still can, by hand.
      openPlan(c.id, 'edit')
    }
  }
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

  // ?edit=<id>: a plan's own link, from anywhere, opens that plan.
  useEffect(() => {
    const id = params.get('edit')
    if (!id || params.has('action')) return
    params.delete('edit')
    setParams(params, { replace: true })
    openPlan(id)
  }, [params, setParams, openPlan])

  // ?prep=<id>: "your meeting starts soon — still open from last time", tapped.
  useEffect(() => {
    const id = params.get('prep')
    if (!id) return
    params.delete('prep')
    setParams(params, { replace: true })
    openPlan(id)
  }, [params, setParams, openPlan])

  // ?focusnow=1: the summary card's "Start focus time".
  useEffect(() => {
    if (params.get('focusnow') !== '1') return
    params.delete('focusnow')
    setParams(params, { replace: true })
    setFocusStart({})
  }, [params, setParams])

  // ?review=1: the Friday notification, or the summary card's link, tapped.
  useEffect(() => {
    if (params.get('review') !== '1') return
    params.delete('review')
    setParams(params, { replace: true })
    setReviewOpen(true)
  }, [params, setParams])

  // ?capture=1|voice|shared and ?logcall=1: the home-screen shortcuts and the
  // share sheet. Capture happens from outside the app; this is where it lands.
  useEffect(() => {
    const how = params.get('capture')
    const call = params.get('logcall')
    if (!how && !call) return
    params.delete('capture')
    params.delete('logcall')
    setParams(params, { replace: true })
    if (how) {
      setShared(readShared())
      setCapture((c) => ({ key: c.key + 1, focus: true, listen: how === 'voice' }))
      window.scrollTo({ top: 0 })
    }
    if (call) setLoggingCallAt(Date.now())
  }, [params, setParams])

  // ?targets=1: the summary card's targets, or the review's link, tapped.
  useEffect(() => {
    if (params.get('targets') !== '1') return
    params.delete('targets')
    setParams(params, { replace: true })
    setTargetsOpen(true)
  }, [params, setParams])

  // ?report=1: the evening reminder, or the summary card's link, tapped.
  useEffect(() => {
    const which = params.get('report')
    if (!which) return
    params.delete('report')
    setParams(params, { replace: true })
    setReportOpen(which === 'standup' ? 'standup' : 'report')
  }, [params, setParams])

  // ?day=1: the morning brief, or the summary card's "your day", tapped.
  useEffect(() => {
    if (params.get('day') !== '1') return
    params.delete('day')
    setParams(params, { replace: true })
    setDayOpen(true)
  }, [params, setParams])

  // ?nudge=<id>: a check-in reminder, tapped — straight to the message; if it
  // was settled meanwhile, the plan itself, which says so.
  useEffect(() => {
    const id = params.get('nudge')
    if (!id || params.has('action')) return
    params.delete('nudge')
    setParams(params, { replace: true })
    void api<CommitmentDTO>(`/commitments/${id}`)
      .then((c) => (c.status === 'pending' ? setNudging(c) : openPlan(c.id)))
      .catch(() => toast(t('That one is no longer here.'), 'error'))
  }, [params, setParams, openPlan])

  // ?focus=waiting: the summary's "waiting on others" count, tapped.
  useEffect(() => {
    if (params.get('focus') !== 'waiting' || loading) return
    params.delete('focus')
    setParams(params, { replace: true })
    setView('agenda')
    requestAnimationFrame(() =>
      document.getElementById('waiting')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }, [params, setParams, loading])

  // ?wrapup=<id>: the "just ended — any follow-ups?" notification, tapped.
  // Already wrapped up from Today: the meeting itself, with what came of it.
  useEffect(() => {
    const id = params.get('wrapup')
    if (!id) return
    params.delete('wrapup')
    setParams(params, { replace: true })
    void api<CommitmentDTO>(`/commitments/${id}`)
      .then((c) => (c.status === 'pending' ? setWrapping(c) : openPlan(c.id)))
      .catch(() => toast(t('That one is no longer here.'), 'error'))
  }, [params, setParams, openPlan])

  // ?view=week&date=YYYY-MM-DD: switch to that view on that day, then take
  // the parameters out of the address so a refresh does not keep jumping back.
  useEffect(() => {
    const linked = params.get('view')
    if (linked !== 'week' && linked !== 'month' && linked !== 'agenda') return
    setView(linked)
    setFocusDate(params.get('date'))
    params.delete('view')
    params.delete('date')
    setParams(params, { replace: true })
    // The summary's "today": the list, from its top.
    if (linked === 'agenda') {
      requestAnimationFrame(() => document.querySelector('.today-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
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
    const action = params.get('action')
    const id = params.get('id')
    // Ready for the next one: with Cue left open, each button tapped arrives here.
    if (!action || !id) {
      handledDeepLink.current = false
      return
    }
    if (handledDeepLink.current) return
    handledDeepLink.current = true
    const settled = () => setParams({}, { replace: true })
    const failed = (err: unknown) =>
      toast(
        err instanceof ApiError && (err.status === 404 || err.status === 409)
          ? t('That one is already closed.')
          : t('Could not reach Cue. Try again in a moment.'),
        'error',
      )

    // "Call" from a notification: look the number up, then dial. No number:
    // the plan, so the call can still be made from there.
    if (action === 'call') {
      void api<CommitmentDTO>(`/commitments/${id}`)
        .then((c) => {
          if (!c.contactPhone) {
            openPlan(c.id)
            return
          }
          startCall({
            phone: c.contactPhone,
            contactId: c.contactId,
            name: c.contactName,
            commitmentId: c.id,
            commitmentTitle: c.title,
          })
          window.location.href = `tel:${c.contactPhone}`
        })
        .catch(failed)
        .finally(settled)
      return
    }
    if (action !== 'done' && action !== 'snooze') {
      settled()
      return
    }
    const run = action === 'done' ? complete(id) : snooze(id, 15)
    void run
      .then(() => toast(action === 'done' ? t('Marked done.') : t('Snoozed for 15 minutes.')))
      .catch(failed)
      .finally(settled)
  }, [params, setParams, complete, snooze, openPlan])

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

  const waiting = agenda.waiting ?? []
  const dueWaiting = waiting.filter((c) => new Date(c.dueAt).getTime() <= nowMs)
  const laterWaiting = waiting.filter((c) => new Date(c.dueAt).getTime() > nowMs)
  // Everything due a check-in, and the next few; the rest behind "show all".
  const shownWaiting = showAllWaiting ? waiting : [...dueWaiting, ...laterWaiting.slice(0, 3)]

  async function gotIt(id: string) {
    await api(`/commitments/${id}/done`, { method: 'POST' })
    await load()
  }

  /** "Later": check in two days from now, at ten. */
  async function pushBack(id: string) {
    const at = new Date()
    at.setDate(at.getDate() + 2)
    at.setHours(10, 0, 0, 0)
    await api(`/commitments/${id}/reschedule`, {
      method: 'POST',
      body: { dueAt: at.toISOString(), allowConflict: true },
    })
    await load()
  }

  const focusNow = agenda.focus?.active ?? null
  const focusEnds = focusNow ? endOf(focusNow) : null
  // Today's own tasks, offered as what a focus block is for.
  const focusIdeas = [...agenda.overdue, ...agenda.today]
    .filter((c) => c.kind === 'task')
    .map((c) => c.title)

  async function endFocusNow() {
    if (!focusNow) return
    await api(`/focus/${focusNow.id}/end`, { method: 'POST' })
    await load()
  }

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
    <ShowSphere.Provider value={working}>
    <div className="today">
      {/* Opened from the brief, which is the only thing that raises it. */}
      {(params.get('triage') === '1' || params.get('triage') === 'all') && (
        <Modal
          title={params.get('triage') === 'all' ? t('Clear what is overdue') : t('What stopped moving')}
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
          title={t('Tomorrow')}
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
      {/* The first thing on the screen: say what you need to remember, here. */}
      <div className="today-capture">
        {shared && (
          <div className="shared-note">
            <span className="muted small">
              {t('Shared from another app. Make it a plan, with a time if it needs one, and press Enter.')}
            </span>
            <button
              className="link small"
              onClick={() => {
                clearShared()
                setShared(null)
                setCapture((c) => ({ key: c.key + 1, focus: false, listen: false }))
              }}
            >
              {t('Discard')}
            </button>
          </div>
        )}
        <QuickAdd
          key={capture.key}
          inline
          autoFocus={capture.focus}
          listen={capture.listen}
          initialText={shared?.text ?? ''}
          onSaved={() => {
            clearShared()
            setShared(null)
          }}
          onDone={() => undefined}
          onFillIn={(text) => openAdd({ full: true, text })}
        />
        {me && me.uses.length === 0 && !usesAsked && (
          <section className="card uses-card">
            <h2 className="section-title">{t('What will you use Cue for?')}</h2>
            <UsesPicker
              onDone={() => {
                try {
                  localStorage.setItem('cue.usesAsked', '1')
                } catch {
                  // Private mode: it asks again next time, which is harmless.
                }
                setUsesAsked(true)
              }}
            />
          </section>
        )}
        {me && !me.isDemo && (me.uses.length > 0 || usesAsked) && <ConnectMailCard />}
        {shared?.original && (
          <details className="shared-original">
            <summary className="muted small">{t('The whole message')}</summary>
            <p className="small">{shared.original}</p>
          </details>
        )}
      </div>

      <div className="today-search">
        <Search variant="inline" />
      </div>

      {/* What the app noticed, before what it was told. */}
      <aside className="today-aside stack">
        {/* For an aspirant — who chose Competitive exams — the exams lead: a last date missed costs a year. */}
        {me?.uses.includes('exams') && <ExamGlance />}
        <NearbyIntentions />
        {/* Above the brief: a parcel at the door today cannot wait for a scroll. */}
        <Deliveries />
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
              {v === 'agenda' ? t('List') : v === 'week' ? t('Week') : t('Month')}
            </button>
          ))}
        </div>
        {/* Work and personal on one day: both, or one half of it. */}
        {working && view === 'agenda' && (
          <div className="viewswitch" role="group" aria-label={t('Show')}>
            {(['all', 'work', 'personal'] as const).map((h) => (
              <button key={h} className={half === h ? 'selected' : ''} aria-pressed={half === h} onClick={() => chooseHalf(h)}>
                {h === 'all' ? t('All') : h === 'work' ? t('Work') : t('Personal')}
              </button>
            ))}
          </div>
        )}
        {view === 'agenda' && (agenda.waiting ?? []).length === 0 && !addingWaiting && (
          <button className="link small" onClick={() => setAddingWaiting(true)}>
            {t('+ Waiting on someone')}
          </button>
        )}
        {agenda.overdue.length > 0 && view !== 'agenda' && (
          <button className="ghost small-btn danger" onClick={() => chooseView('agenda')}>
            {t('{n} overdue', { n: agenda.overdue.length })}
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

      {/* Focus under way: what for, until when, and what is being held. */}
      {view === 'agenda' && focusNow && focusEnds && (
        <div className="focus-banner">
          <div>
            <strong>
              {focusNow.title.startsWith('Focus: ')
                ? t('Focusing on {what}', { what: focusNow.title.slice(7) })
                : t('Focusing')}
            </strong>
            <span className="muted small">
              {t('until {time}', {
                time: focusEnds.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }),
              })}
              {(agenda.focus?.held ?? 0) > 0
                ? ` · ${
                    agenda.focus!.held === 1
                      ? t('1 reminder waiting')
                      : t('{n} reminders waiting', { n: agenda.focus!.held })
                  }`
                : ` · ${t('reminders will wait')}`}
            </span>
          </div>
          <button className="ghost small-btn" onClick={() => void endFocusNow()}>
            {t('End now')}
          </button>
        </div>
      )}

      {/* First, because it is the most perishable thing on the screen: what was
          agreed in a meeting is clearest in the hour after it. */}
      {view === 'agenda' && justFinished.length > 0 && (
        <section>
          <h2 className="section-title">
            {t('Just finished — any follow-ups?')} <span className="count is-calm">{justFinished.length}</span>
          </h2>
          <ul className="list">
            {justFinished.map((c) => (
              <li key={c.id} className="card commitment wrapup-card">
                <div
                  className="commitment-main is-openable"
                  role="button"
                  tabIndex={0}
                  aria-label={t('Open {title}', { title: c.title })}
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
                    {c.feedId ? ` · ${t('from your calendar')}` : ''}
                  </p>
                </div>
                <div className="row commitment-actions">
                  <button className="primary small-btn" onClick={() => setWrapping(c)}>
                    {t('Add follow-ups')}
                  </button>
                  <button className="ghost small-btn" onClick={() => void nothingToAdd(c.id)}>
                    {t('Nothing to add')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* What other people owe you. Its own list, because it is a different
          kind of thing: nothing here is yours to do except to ask. */}
      {view === 'agenda' && (waiting.length > 0 || addingWaiting) && (
        <section id="waiting">
          <div className="row spread section-head">
            <h2 className="section-title">
              {t('Waiting on others')} <span className="count is-calm">{waiting.length}</span>
            </h2>
            {!addingWaiting && (
              <button className="link small" onClick={() => setAddingWaiting(true)}>
                {t('+ Waiting on someone')}
              </button>
            )}
          </div>
          {addingWaiting && (
            <WaitingForm
              onDone={() => {
                setAddingWaiting(false)
                void load()
              }}
            />
          )}
          <ul className="list">
            {shownWaiting.map((c) => {
              const due = new Date(c.dueAt).getTime() <= nowMs
              return (
                <li key={c.id} className={`card commitment waiting-row${due ? ' is-due' : ''}`}>
                  <div
                    className="commitment-main is-openable"
                    role="button"
                    tabIndex={0}
                    aria-label={t('Open {title}', { title: c.title })}
                    onClick={() => openPlan(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openPlan(c.id)
                      }
                    }}
                  >
                    <p className="commitment-title">
                      <span className="waiting-who">{c.waitingOn}</span>
                      {waitingWhat(c)}
                    </p>
                    <p className="muted small">
                      {due ? (
                        <span className="due-now">{t('Check in now')}</span>
                      ) : (
                        t('Check in {day}', { day: dayLabel(c.dueAt) })
                      )}
                      {c.fromTitle ? ` · ${t('from {title}', { title: c.fromTitle })}` : ''}
                    </p>
                  </div>
                  <div className="row commitment-actions">
                    <button className={`${due ? 'primary' : 'ghost'} small-btn`} onClick={() => setNudging(c)}>
                      {t('Nudge')}
                    </button>
                    <button className="ghost small-btn" onClick={() => void gotIt(c.id)}>
                      {t('Got it')}
                    </button>
                    {due && (
                      <button className="link small" onClick={() => void pushBack(c.id)}>
                        {t('Later')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {waiting.length > shownWaiting.length && (
            <button className="ghost small-btn" onClick={() => setShowAllWaiting(true)}>
              {t('Show all {n}', { n: waiting.length })}
            </button>
          )}
        </section>
      )}

      {view === 'agenda' && happeningNow.length > 0 && (
        <section>
          <h2 className="section-title">{t('Happening now')}</h2>
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
            {t('You dropped these')} <span className="count">{agenda.overdue.length}</span>
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
        <h2 className="section-title">{t('Rest of today')}</h2>
        {fixedToday.length === 0 ? (
          <p className="muted">{t('Nothing else at a set time today.')}</p>
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
          <h2 className="section-title">{t('Whenever you get a chance')}</h2>
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
          <h2 className="section-title">{t('Coming up')}</h2>
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
            {t('From your calendar · {n}', { n: upcomingContext.length })}
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
              {showAllContext ? t('Show fewer') : t('Show all {n}', { n: upcomingContext.length })}
            </button>
          )}
        </section>
      )}

      {view === 'agenda' && agenda.doneToday.length > 0 && (
        <section>
          <h2 className="section-title muted-title">
            {t('Closed today · {n}', { n: agenda.doneToday.length })}
          </h2>
          <ul className="list">
            {agenda.doneToday.map((c) => (
              <li key={c.id} className="card done">
                <div className="commitment-head">
                  <div>
                    <p className="commitment-title struck">{c.title}</p>
                    {/* Two ways to close something, and they mean different
                        things, so the card says which one happened. */}
                    <p className="muted small">
                      {c.status === 'cancelled' ? t('Cancelled') : t('Done')}
                      {c.placeName ? ` · ${c.placeName}` : ''}
                    </p>
                  </div>
                  <button className="link" onClick={() => void reopen(c)}>
                    {t('Reopen')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === 'agenda' && nothingPending && agenda.doneToday.length === 0 && (
        <div className="empty">
          <p>{t('Nothing is waiting on you.')}</p>
          <p className="muted small">
            {t('Log a visit and any callback they gave you becomes a reminder automatically.')}
          </p>
        </div>
      )}
      </div>

      {focusStart && (
        <Modal title={t('Focus time')} onClose={() => setFocusStart(null)}>
          <FocusStart
            startAt={focusStart.startAt}
            maxMinutes={focusStart.maxMinutes}
            suggestions={focusIdeas}
            onDone={() => {
              setFocusStart(null)
              void load()
            }}
          />
        </Modal>
      )}

      {loggingCallAt !== null && (
        <Modal title={t('Log a call')} onClose={() => setLoggingCallAt(null)}>
          <CallLog
            call={{ phone: '', contactId: null, name: null, commitmentId: null, commitmentTitle: null, startedAt: loggingCallAt }}
            onDone={() => setLoggingCallAt(null)}
          />
        </Modal>
      )}

      {targetsOpen && (
        <Modal title={t('Weekly targets')} onClose={() => setTargetsOpen(false)}>
          <Targets onSaved={() => setCalendarKey((k) => k + 1)} />
        </Modal>
      )}

      {reportOpen && (
        <Modal title={t('Daily report')} onClose={() => setReportOpen(null)}>
          <DailyReport initialFormat={reportOpen} />
        </Modal>
      )}

      {reviewOpen && (
        <Modal title={t('Weekly review')} onClose={() => setReviewOpen(false)}>
          <WeeklyReview
            onDecideSlipped={() => {
              setReviewOpen(false)
              navigate('/?triage=all')
            }}
            onGoToWaiting={() => {
              setReviewOpen(false)
              navigate('/?focus=waiting')
            }}
            onDone={() => setReviewOpen(false)}
          />
        </Modal>
      )}

      {dayOpen && (
        <Modal title={t('Your day')} onClose={() => setDayOpen(false)}>
          <YourDay
            waiting={agenda.waiting ?? []}
            justFinished={agenda.justFinished ?? []}
            onOpen={(id) => {
              setDayOpen(false)
              openPlan(id)
            }}
            onNudge={(c) => {
              setDayOpen(false)
              setNudging(c)
            }}
            onWrapUp={(c) => {
              setDayOpen(false)
              setWrapping(c)
            }}
            onBlock={(startAt, maxMinutes) => {
              setDayOpen(false)
              setFocusStart({ startAt, maxMinutes })
            }}
          />
        </Modal>
      )}

      {nudging && (
        <Modal title={t('Nudge')} onClose={() => setNudging(null)}>
          <Nudge
            item={nudging}
            onDone={() => {
              setNudging(null)
              void load()
            }}
          />
        </Modal>
      )}

      {wrapping && (
        <Modal title={t('Wrap up')} onClose={() => setWrapping(null)} closeOnBackdrop={false}>
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
          initialNotice={opened.notice}
          onClose={() => setOpened(null)}
          onChanged={() => void load()}
          onOpenOther={(id) => openPlan(id)}
        />
      )}
    </div>
    </ShowSphere.Provider>
  )
}
