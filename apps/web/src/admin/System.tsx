import { useCallback, useEffect, useState } from 'react'
import { adminApi as api } from './api.ts'
import { errorText } from '../lib/errors.ts'
import { LoadFailed } from '../components/LoadFailed.tsx'
import { ago, bytes, Empty, num, Section, span, Stat, uptime, when } from './shared.tsx'

interface Job {
  name: string
  everyMs: number | null
  runs: number
  failures: number
  running: boolean
  lastStartedAt: string | null
  lastOkAt: string | null
  lastDurationMs: number | null
  lastError: string | null
  lastErrorAt: string | null
}

interface SystemData {
  server: {
    sha: string | null
    builtAt: string | null
    startedAt: string
    uptimeSeconds: number
    node: string
    platform: string
    cpus: number
    load: number[]
    memory: { rss: number; heapUsed: number; heapTotal: number }
    systemMemory: { total: number; free: number }
    timezone: string
    aiReading: boolean
    google: boolean
    microsoft: boolean
  }
  database: Record<string, any>
  tables: { name: string; rows: number; bytes: number }[]
  queues: Record<string, number>
  jobs: Job[]
  push: { sent: number; failed: number; expired: number; configured: boolean }
  errors: { at: string; method: string; route: string; status: number; message: string }[]
}

const JOB_LABELS: Record<string, string> = {
  reminders: 'Reminders',
  'evening-nudge': 'Evening nudge',
  'morning-brief': 'Morning brief',
  'weekly-review': 'Weekly review',
  'daily-report': 'Daily report',
  'meeting-prep': 'Meeting prep',
  'follow-ups': 'Follow-up questions',
  focus: 'Focus blocks',
  bills: 'Bill reminders',
  deliveries: 'Parcel reminders',
  'mail-reader': 'Email reading',
  'calendar-sync': 'Calendar sync',
  'repeating-sweep': 'Repeating plans',
  'exam-week': 'Exam week report',
  'exam-notices': 'Exam notices',
  'demo-cleanup': 'Demo clean-up',
  'voice-note-purge': 'Voice note clean-up',
  'audit-purge': 'Activity log clean-up',
}

const REPO = 'https://github.com/raghusince1998/cue'

/** How a job stands: ran recently and fine, late, or failing. */
function jobTone(j: Job): 'good' | 'warn' | 'bad' {
  if (j.lastErrorAt && (!j.lastOkAt || j.lastErrorAt > j.lastOkAt)) return 'bad'
  if (j.everyMs && j.lastOkAt && Date.now() - new Date(j.lastOkAt).getTime() > j.everyMs * 2.5) return 'warn'
  return 'good'
}

export function System() {
  const [data, setData] = useState<SystemData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [at, setAt] = useState<Date | null>(null)

  const load = useCallback(() => {
    api<SystemData>('/admin/system')
      .then((d) => {
        setData(d)
        setError(null)
        setAt(new Date())
      })
      .catch((err) => setError(errorText(err)))
  }, [])

  // Live while it is open and looked at.
  useEffect(() => {
    load()
    const handle = setInterval(() => {
      if (!document.hidden) load()
    }, 30_000)
    return () => clearInterval(handle)
  }, [load])

  if (!data && error) return <LoadFailed what={error} onRetry={load} />
  if (!data) return <p className="muted small">Loading…</p>

  const { server, database, tables, queues, jobs, push, errors } = data
  const memUsed = server.systemMemory.total - server.systemMemory.free
  const memShare = memUsed / Math.max(1, server.systemMemory.total)
  const badJobs = jobs.filter((j) => jobTone(j) === 'bad').length

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <p className="muted small">
          Updated {at ? ago(at.toISOString()) : '—'} · refreshes every 30 seconds
          {error ? ` · last refresh failed: ${error}` : ''}
        </p>
        <button className="ghost small-btn" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="admin-stats">
        <Stat
          label="Running version"
          value={
            server.sha ? (
              <a href={`${REPO}/commit/${server.sha}`} target="_blank" rel="noopener noreferrer">
                {server.sha.slice(0, 7)}
              </a>
            ) : (
              'local'
            )
          }
          sub={server.builtAt ? `deployed ${ago(server.builtAt)}` : 'not a deployed build'}
        />
        <Stat label="Up for" value={uptime(server.uptimeSeconds)} sub={`since ${when(server.startedAt)}`} />
        <Stat
          label="Memory"
          value={bytes(server.memory.rss)}
          sub={`Cue's process · the machine has ${Math.round(memShare * 100)}% of ${bytes(server.systemMemory.total)} in use`}
          tone={memShare > 0.9 ? 'bad' : memShare > 0.8 ? 'warn' : undefined}
        />
        <Stat
          label="Load"
          value={server.load[0]?.toFixed(2) ?? '—'}
          sub={`${server.cpus} CPU · 5 min ${server.load[1]?.toFixed(2)} · 15 min ${server.load[2]?.toFixed(2)}`}
          tone={(server.load[0] ?? 0) > server.cpus ? 'warn' : undefined}
        />
        <Stat
          label="Background jobs"
          value={`${jobs.length - badJobs} / ${jobs.length}`}
          sub={badJobs ? `${badJobs} failing` : 'all fine'}
          tone={badJobs ? 'bad' : 'good'}
        />
        <Stat
          label="Late reminders"
          value={num(queues.reminders_late)}
          sub={`${num(queues.reminders_pending)} waiting · ${num(queues.reminders_sent_1d)} sent today`}
          tone={queues.reminders_late > 0 || queues.reminders_stuck > 0 ? 'bad' : 'good'}
        />
      </div>

      <Section title="Background jobs" aside={<span className="muted small">since the server started {ago(server.startedAt)}</span>}>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Every</th>
                <th>Last went fine</th>
                <th className="num">Took</th>
                <th className="num">Runs</th>
                <th className="num">Failed</th>
                <th>Last problem</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.name}>
                  <td>
                    <span className={`admin-dot is-${jobTone(j)}`} aria-hidden /> {JOB_LABELS[j.name] ?? j.name}
                    {j.running && <span className="muted small"> · running</span>}
                  </td>
                  <td>{j.everyMs ? span(j.everyMs) : '—'}</td>
                  <td title={when(j.lastOkAt)}>{j.lastOkAt ? ago(j.lastOkAt) : <span className="muted">not yet</span>}</td>
                  <td className="num">{j.lastDurationMs !== null ? `${(j.lastDurationMs / 1000).toFixed(1)} s` : '—'}</td>
                  <td className="num">{num(j.runs)}</td>
                  <td className="num">{num(j.failures)}</td>
                  <td className="small">
                    {j.lastError ? (
                      <span className={jobTone(j) === 'bad' ? 'error' : 'muted'} title={when(j.lastErrorAt)}>
                        {ago(j.lastErrorAt)}: {j.lastError}
                      </span>
                    ) : (
                      <span className="muted">none</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="admin-columns">
        <Section title="Queues and connections">
          <dl className="admin-facts">
            <dt>Reminders waiting</dt>
            <dd>{num(queues.reminders_pending)}</dd>
            <dt>Late (5+ min past their time)</dt>
            <dd className={queues.reminders_late ? 'error' : ''}>{num(queues.reminders_late)}</dd>
            <dt>Stuck mid-send</dt>
            <dd className={queues.reminders_stuck ? 'error' : ''}>{num(queues.reminders_stuck)}</dd>
            <dt>Sent in 24 h</dt>
            <dd>{num(queues.reminders_sent_1d)}</dd>
            <dt>Calendars read</dt>
            <dd>
              {num(queues.calendars)}
              {queues.calendars_failing ? <span className="error"> · {num(queues.calendars_failing)} failing</span> : null}
            </dd>
            <dt>Email being read</dt>
            <dd>
              {num(queues.mail_reading)}
              {queues.mail_failing ? <span className="error"> · {num(queues.mail_failing)} failing</span> : null}
            </dd>
            <dt>Devices</dt>
            <dd>{num(queues.devices)}</dd>
            <dt>Push since start</dt>
            <dd>
              {push.configured ? (
                <>
                  {num(push.sent)} delivered · {num(push.failed)} failed · {num(push.expired)} expired devices removed
                </>
              ) : (
                <span className="error">not set up (VAPID keys missing)</span>
              )}
            </dd>
          </dl>
        </Section>

        <Section title="Server">
          <dl className="admin-facts">
            <dt>Node</dt>
            <dd>{server.node}</dd>
            <dt>System</dt>
            <dd>{server.platform}</dd>
            <dt>Time zone</dt>
            <dd>{server.timezone}</dd>
            <dt>Server memory</dt>
            <dd>
              heap {bytes(server.memory.heapUsed)} of {bytes(server.memory.heapTotal)} · machine {bytes(memUsed)} of{' '}
              {bytes(server.systemMemory.total)}
            </dd>
            <dt>Reading unclear lines with AI</dt>
            <dd className={server.aiReading ? '' : 'muted'}>{server.aiReading ? 'on' : 'off — ANTHROPIC_API_KEY not set'}</dd>
            <dt>Google sign-in</dt>
            <dd className={server.google ? '' : 'muted'}>{server.google ? 'set up' : 'not set up'}</dd>
            <dt>Microsoft sign-in</dt>
            <dd className={server.microsoft ? '' : 'muted'}>{server.microsoft ? 'set up' : 'not set up'}</dd>
          </dl>
        </Section>
      </div>

      <div className="admin-columns">
        <Section title="Database">
          <dl className="admin-facts">
            <dt>PostgreSQL</dt>
            <dd>{database.version}</dd>
            <dt>Size</dt>
            <dd>{bytes(database.size_bytes)}</dd>
            <dt>Connections</dt>
            <dd>{num(database.connections)}</dd>
            <dt>Migrations</dt>
            <dd>
              {database.migrations !== null ? (
                <>
                  {num(database.migrations)} · latest {database.latestMigration} ({ago(database.migratedAt)})
                </>
              ) : (
                <span className="muted">not recorded here</span>
              )}
            </dd>
          </dl>
        </Section>

        <Section title="Largest tables">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Table</th>
                <th className="num">Rows</th>
                <th className="num">Size</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td className="num">{num(t.rows)}</td>
                  <td className="num">{bytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <Section title="Recent server errors" aside={<span className="muted small">the last 50, since start</span>}>
        {errors.length === 0 ? (
          <Empty>None since the server started.</Empty>
        ) : (
          <ul className="admin-events">
            {errors.map((e, i) => (
              <li key={i}>
                <span className="admin-event-when" title={when(e.at)}>
                  {ago(e.at)}
                </span>
                <span>
                  <code>
                    {e.status} {e.method} {e.route}
                  </code>{' '}
                  <span className="muted small">{e.message}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
