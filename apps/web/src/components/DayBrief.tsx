import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { openAdd } from '../lib/addSheet.ts'
import { TargetBar, type WeekTargets } from './Targets.tsx'
import { hasClients, hasWork } from '@cue/shared'
import { useAuth } from '../lib/auth.tsx'
import { locale, t } from '../lib/i18n.tsx'

/**
 * What the app noticed, above what the app was told.
 *
 * The screen used to open on "Nothing else at a set time today" — a true
 * sentence that makes a planner indistinguishable from a notes file. Everything
 * it actually knows (that a Pune meeting and a Mumbai one are 150km apart, that
 * things slip on Fridays, that three wishes are waiting for a trip five days
 * out) was computed somewhere and shown nowhere.
 *
 * This is that, first, before any list.
 */

type Tone = 'urgent' | 'warning' | 'opportunity' | 'positive' | 'neutral'

interface Insight {
  id: string
  tone: Tone
  headline: string
  detail: string
  action?: { label: string; href: string }
}

interface Summary {
  subject: 'today' | 'tomorrow'
  percentBooked: number
  freeMinutes: number
  todayCount: number
  nextGap: { from: string; to: string } | null
  overdue: number
  weekAhead: number
  waiting: number
  /** What other people owe you, and how many are due a check-in. */
  waitingOnOthers?: number
  checkInsDue?: number
}

const ICON: Record<Tone, string> = {
  urgent: '!',
  warning: '!',
  opportunity: '★',
  positive: '✓',
  neutral: '·',
}

function hoursLabel(minutes: number): string {
  if (minutes <= 0) return t('none')
  if (minutes < 60) return t('{n}m', { n: minutes })
  const h = minutes / 60
  return t('{n}h', { n: h % 1 === 0 ? h : h.toFixed(1) })
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
}

export function DayBrief({
  refreshKey,
  onNavigate,
  preview = 2,
}: {
  refreshKey: number
  onNavigate: (href: string) => void
  /** How many insights show before "N more". A phone has room for one. */
  preview?: number
}) {
  const { me } = useAuth()
  /** Reports are for a job; a household has no standup. */
  const work = hasWork(me?.uses ?? [])
  /** Targets of calls and visits are for sales and clients, not every job. */
  const clients = hasClients(me?.uses ?? [])
  const [data, setData] = useState<{
    insights: Insight[]
    summary: Summary
    sample: boolean
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [reloads, setReloads] = useState(0)
  /** People it has been too long with — keep in touch. */
  const [reachOut, setReachOut] = useState(0)
  /** This week against the weekly targets, once any is set. */
  const [targets, setTargets] = useState<WeekTargets | null>(null)

  useEffect(() => {
    let cancelled = false
    api<{ insights: Insight[]; summary: Summary; sample: boolean }>('/insights')
      .then((r) => !cancelled && setData(r))
      // A brief that fails is not worth an error on the main screen; the lists
      // below it are the actual work and still render.
      .catch(() => undefined)
    api<{ due: number }>('/people/keep-in-touch')
      .then((r) => !cancelled && setReachOut(r.due))
      .catch(() => undefined)
    api<WeekTargets>('/targets/week')
      .then((r) => !cancelled && setTargets(r))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [refreshKey, reloads])

  async function sample(load: boolean) {
    setBusy(true)
    try {
      await api('/sample-day', { method: load ? 'POST' : 'DELETE' })
      setReloads((n) => n + 1)
      // The brief is not the only thing showing it. Without this, "Clear it"
      // emptied the brief and left every sample plan sitting in the list
      // below until the next minute's poll — and the calendar beside it, and
      // Trips and Repeating, until they were reopened.
      announceChange()
      onNavigate('/')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <div className="brief brief-skeleton" aria-hidden />

  const { summary } = data
  const visible = data.insights.filter((i) => !dismissed.includes(i.id))
  const shown = expanded ? visible : visible.slice(0, preview)

  const now = new Date()
  const ahead = summary.subject === 'tomorrow'
  const shown_day = ahead ? new Date(now.getTime() + 86_400_000) : now
  const greeting = ahead
    ? t('Tomorrow')
    : now.getHours() < 12
      ? t('This morning')
      : now.getHours() < 17
        ? t('This afternoon')
        : t('This evening')

  return (
    <section className="brief">
      <div className="brief-top">
        <div>
          <p className="brief-date">
            {shown_day.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="brief-headline">
            {summary.todayCount === 0
              ? t('{when} is yours', { when: greeting })
              : t('{when}: {pct}% booked', { when: greeting, pct: summary.percentBooked })}
          </h1>
          <p className="brief-sub">
            {summary.todayCount === 0
              ? summary.weekAhead > 0
                ? ahead
                  ? t('Nothing fixed tomorrow. {n} coming this week.', { n: summary.weekAhead })
                  : t('Nothing fixed today. {n} coming this week.', { n: summary.weekAhead })
                : t('Nothing fixed, and nothing this week.')
              : summary.nextGap
                ? t('{free} free — longest clear run {from} to {to}', {
                    free: hoursLabel(summary.freeMinutes),
                    from: clock(summary.nextGap.from),
                    to: clock(summary.nextGap.to),
                  })
                : t('{free} free, in short gaps', { free: hoursLabel(summary.freeMinutes) })}
          </p>
        </div>

        {/* The bar is the point: a number people skim, a shape they feel. */}
        <div
          className="brief-dial"
          style={{ ['--pct' as string]: `${summary.percentBooked}` }}
          role="img"
          aria-label={t('{pct} percent booked', { pct: summary.percentBooked })}
        >
          <span>{summary.percentBooked}%</span>
        </div>
      </div>

      {/* The shape of the day, not just its numbers. */}
      <div className="brief-links">
        <button className="brief-day-link" onClick={() => onNavigate('/?day=1')}>
          {t('Your day, hour by hour →')}
        </button>
        <button className="brief-day-link" onClick={() => onNavigate('/?review=1')}>
          {t('Review your week →')}
        </button>
        {/* Mornings are for the standup; the rest of the day, for the report. */}
        {!work ? null : new Date().getHours() < 12 ? (
          <button className="brief-day-link" onClick={() => onNavigate('/?report=standup')}>
            {t('Write your standup →')}
          </button>
        ) : (
          <button className="brief-day-link" onClick={() => onNavigate('/?report=1')}>
            {t('Send today’s report →')}
          </button>
        )}
        <button className="brief-day-link" onClick={() => onNavigate('/?focusnow=1')}>
          {t('Start focus time →')}
        </button>
        <button className="brief-day-link" onClick={() => openAdd({ share: true })}>
          {t('Share when you’re free →')}
        </button>
        {clients && targets && !targets.tracking && (
          <button className="brief-day-link" onClick={() => onNavigate('/?targets=1')}>
            {t('Set weekly targets →')}
          </button>
        )}
      </div>

      {/* The week's targets at a glance; the whole sheet is a tap away. */}
      {targets?.tracking && (
        <button className="brief-targets" onClick={() => onNavigate('/?targets=1')}>
          {targets.metrics
            .filter((m) => m.target)
            .slice(0, 4)
            .map((m) => (
              <span className="brief-target" key={m.key}>
                <span className="brief-target-label">
                  {t(m.label)}
                  <span className={`target-status is-${m.status}`}>
                    {m.done}/{m.target}
                  </span>
                </span>
                <TargetBar m={m} small />
              </span>
            ))}
        </button>
      )}

      <div className="brief-stats">
        <button className="stat" onClick={() => onNavigate('/')}>
          <strong>{summary.todayCount}</strong>
          <span>{ahead ? t('tomorrow') : t('today')}</span>
        </button>
        <button
          className={`stat${summary.overdue > 0 ? ' is-alert' : ''}`}
          onClick={() => onNavigate('/')}
        >
          <strong>{summary.overdue}</strong>
          <span>{t('overdue')}</span>
        </button>
        <button className="stat" onClick={() => onNavigate('/')}>
          <strong>{summary.weekAhead}</strong>
          <span>{t('this week')}</span>
        </button>
        {(summary.waitingOnOthers ?? 0) > 0 && (
          <button
            className={`stat${(summary.checkInsDue ?? 0) > 0 ? ' is-alert' : ''}`}
            onClick={() => onNavigate('/?focus=waiting')}
          >
            <strong>{summary.waitingOnOthers}</strong>
            <span>
              {t('waiting on others')}
              {(summary.checkInsDue ?? 0) > 0 ? ` · ${t('{n} to chase', { n: summary.checkInsDue ?? 0 })}` : ''}
            </span>
          </button>
        )}
        {reachOut > 0 && (
          <button className="stat is-alert" onClick={() => onNavigate('/people')}>
            <strong>{reachOut}</strong>
            <span>{t('to reach out')}</span>
          </button>
        )}
        <button className="stat" onClick={() => onNavigate('/trips')}>
          <strong>{summary.waiting}</strong>
          <span>{t('waiting on a trip')}</span>
        </button>
      </div>

      {summary.todayCount === 0 &&
        summary.weekAhead === 0 &&
        summary.overdue === 0 &&
        !data.sample && (
          <div className="brief-empty">
            <p>
              {t(
                'Nothing in here yet, so there is nothing for me to notice. Load a realistic week and you will see what this does that a list cannot.',
              )}
            </p>
            <button className="primary small-btn" disabled={busy} onClick={() => void sample(true)}>
              {busy ? t('Filling…') : t('Show me with sample data')}
            </button>
          </div>
        )}

      {data.sample && (
        <div className="brief-sample">
          <span>{t('Showing sample data')}</span>
          <button disabled={busy} onClick={() => void sample(false)}>
            {t('Clear it')}
          </button>
        </div>
      )}

      {shown.length > 0 && (
        <div className="insights">
          {shown.map((insight) => (
            <article key={insight.id} className={`insight tone-${insight.tone}`}>
              <span className="insight-mark" aria-hidden>
                {ICON[insight.tone]}
              </span>
              <div className="insight-body">
                <strong>{insight.headline}</strong>
                <p>{insight.detail}</p>
                {insight.action && (
                  <button
                    className="insight-action"
                    onClick={() => onNavigate(insight.action!.href)}
                  >
                    {insight.action.label} →
                  </button>
                )}
              </div>
              <button
                className="insight-close"
                aria-label={t('Dismiss')}
                onClick={() => setDismissed((d) => [...d, insight.id])}
              >
                ×
              </button>
            </article>
          ))}

          {visible.length > preview && (
            <button className="insight-more" onClick={() => setExpanded((v) => !v)}>
              {expanded
                ? t('Show less')
                : visible.length - preview === 1
                  ? t('1 more thing I noticed')
                  : t('{n} more things I noticed', { n: visible.length - preview })}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
