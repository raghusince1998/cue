import { useEffect, useMemo, useState } from 'react'
import { GREETING_OCCASIONS, fillTemplate, shortName, type ContactDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { announceChange } from '../lib/changes.ts'
import { waNumber } from './PersonSheet.tsx'

interface RunPerson {
  id: string
  name: string
  organization: string | null
  phone: string | null
  email: string | null
  sentAt: string | null
}

interface Run {
  id: string
  occasion: string
  message: string
  people: RunPerson[]
}

interface RunSummary {
  id: string
  occasion: string
  total: number
  sent: number
}

type Audience = 'all' | 'orgs' | 'pick'

/**
 * Festival greetings across a contact list: Diwali, New Year.
 *
 * WhatsApp cannot be sent to forty people from a web page, and a broadcast is
 * not how anyone wants to be greeted anyway. So each person gets their own
 * message, with their name in it, one tap apiece; Cue keeps track of who has
 * had it, so it can be put down and picked up and nobody gets it twice.
 */
export function Greetings({ contacts, onClose }: { contacts: ContactDTO[]; onClose: () => void }) {
  const { me } = useAuth()
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [occasion, setOccasion] = useState(GREETING_OCCASIONS[0]!.key)
  const [customName, setCustomName] = useState('')
  const [message, setMessage] = useState(GREETING_OCCASIONS[0]!.message)
  const [audience, setAudience] = useState<Audience>('all')
  const [orgs, setOrgs] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api<RunSummary[]>('/greetings').then(setRuns).catch(() => undefined)
  }, [])

  const reachable = contacts.filter((c) => c.phone || c.email)
  const orgCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of reachable) if (c.organization) m.set(c.organization, (m.get(c.organization) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [reachable])

  const recipients =
    audience === 'all'
      ? reachable
      : audience === 'orgs'
        ? reachable.filter((c) => c.organization && orgs.includes(c.organization))
        : reachable.filter((c) => picked.includes(c.id))

  const chosen = GREETING_OCCASIONS.find((o) => o.key === occasion)!
  const label = occasion === 'custom' ? customName.trim() : chosen.label

  async function start() {
    setBusy(true)
    setError(null)
    try {
      setRun(
        await api<Run>('/greetings', {
          method: 'POST',
          body: { occasion: label, message, contactIds: recipients.map((c) => c.id) },
        }),
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function resume(id: string) {
    setRun(await api<Run>(`/greetings/${id}`))
  }

  const textFor = (p: RunPerson) =>
    fillTemplate(run!.message, { name: p.name, company: p.organization, me: me?.name })

  async function markSent(p: RunPerson) {
    setRun((r) => r && { ...r, people: r.people.map((x) => (x.id === p.id ? { ...x, sentAt: new Date().toISOString() } : x)) })
    await api(`/greetings/${run!.id}/sent`, { method: 'POST', body: { contactId: p.id } }).catch(() => undefined)
    announceChange()
  }

  function whatsapp(p: RunPerson) {
    window.open(`https://wa.me/${waNumber(p.phone!)}?text=${encodeURIComponent(textFor(p))}`, '_blank', 'noopener')
    void markSent(p)
  }

  function email(p: RunPerson) {
    window.open(
      `mailto:${p.email}?subject=${encodeURIComponent(run!.occasion)}&body=${encodeURIComponent(textFor(p))}`,
      '_blank',
      'noopener',
    )
    void markSent(p)
  }

  async function copy(p: RunPerson) {
    try {
      await navigator.clipboard.writeText(textFor(p))
      void markSent(p)
    } catch {
      setError('Could not copy — select the message and copy it yourself.')
    }
  }

  // ------------------------------------------------------------ sending
  if (run) {
    const sent = run.people.filter((p) => p.sentAt).length
    const next = run.people.find((p) => !p.sentAt && (p.phone || p.email))
    return (
      <div className="stack tight greetings">
        <div className="greet-progress">
          <strong>
            {run.occasion} · {sent} of {run.people.length} sent
          </strong>
          <span className="target-bar">
            <span
              className={`target-fill${sent === run.people.length ? ' is-done' : ''}`}
              style={{ width: `${(sent / Math.max(run.people.length, 1)) * 100}%` }}
            />
          </span>
        </div>

        {next ? (
          <button
            className="primary"
            onClick={() => (next.phone ? whatsapp(next) : email(next))}
          >
            Send to {shortName(next.name)}
            {next.organization ? ` (${next.organization})` : ''} by {next.phone ? 'WhatsApp' : 'email'}
          </button>
        ) : (
          <p className="small target-status is-done">Everyone has had it. Well done.</p>
        )}
        <p className="muted small">
          Each opens with their own message, name and all. Send it there, come back, and tap for the
          next.
        </p>

        <ul className="plain greet-list">
          {run.people.map((p) => (
            <li key={p.id} className="your-day-line">
              <span>
                {p.name}
                {p.organization ? <span className="muted small"> · {p.organization}</span> : null}
              </span>
              {p.sentAt ? (
                <span className="small target-status is-done">Sent</span>
              ) : (
                <span className="row">
                  {p.phone && (
                    <button className="ghost tiny-btn" onClick={() => whatsapp(p)}>
                      WhatsApp
                    </button>
                  )}
                  {p.email && (
                    <button className="ghost tiny-btn" onClick={() => email(p)}>
                      Email
                    </button>
                  )}
                  <button className="ghost tiny-btn" onClick={() => void copy(p)}>
                    Copy
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="error small">{error}</p>}
        <button className="ghost fit-btn" onClick={onClose}>
          Done for now
        </button>
      </div>
    )
  }

  // -------------------------------------------------------------- setup
  const unfinished = runs.filter((r) => r.sent < r.total)
  const q = query.trim().toLowerCase()
  return (
    <div className="stack tight greetings">
      {unfinished.length > 0 && (
        <div className="greet-resume">
          {unfinished.map((r) => (
            <button key={r.id} className="ghost small-btn" onClick={() => void resume(r.id)}>
              Continue {r.occasion}: {r.sent} of {r.total} sent
            </button>
          ))}
        </div>
      )}

      <span className="label-text">What for?</span>
      <div className="chips">
        {GREETING_OCCASIONS.map((o) => (
          <button
            key={o.key}
            className={`chip${occasion === o.key ? ' selected' : ''}`}
            onClick={() => {
              setOccasion(o.key)
              setMessage(o.message)
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {occasion === 'custom' && (
        <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Ganesh Chaturthi" />
      )}

      <label>
        Message
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} />
      </label>
      <p className="muted small">
        {'{first}'} becomes each person&rsquo;s name (Dr. Mehta, Ravi), and {'{me}'} yours.
      </p>

      <span className="label-text">Who to?</span>
      <div className="chips">
        <button className={`chip${audience === 'all' ? ' selected' : ''}`} onClick={() => setAudience('all')}>
          Everyone · {reachable.length}
        </button>
        {orgCounts.length > 0 && (
          <button className={`chip${audience === 'orgs' ? ' selected' : ''}`} onClick={() => setAudience('orgs')}>
            By clinic or company
          </button>
        )}
        <button className={`chip${audience === 'pick' ? ' selected' : ''}`} onClick={() => setAudience('pick')}>
          Choose people
        </button>
      </div>

      {audience === 'orgs' && (
        <div className="chips">
          {orgCounts.map(([org, n]) => (
            <button
              key={org}
              className={`chip${orgs.includes(org) ? ' selected' : ''}`}
              onClick={() => setOrgs((o) => (o.includes(org) ? o.filter((x) => x !== org) : [...o, org]))}
            >
              {org} · {n}
            </button>
          ))}
        </div>
      )}

      {audience === 'pick' && (
        <div className="greet-pick">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" />
          <ul className="plain">
            {reachable
              .filter((c) => !q || [c.name, c.organization, c.role].some((f) => f?.toLowerCase().includes(q)))
              .map((c) => (
                <li key={c.id}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={picked.includes(c.id)}
                      onChange={(e) =>
                        setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))
                      }
                    />
                    <span>
                      {c.name}
                      {c.organization ? <span className="muted small"> · {c.organization}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
          </ul>
        </div>
      )}

      {reachable.length < contacts.length && (
        <p className="muted small">
          {contacts.length - reachable.length} people have no number or email, so they are left out.
        </p>
      )}
      {error && <p className="error small">{error}</p>}
      <button
        className="primary"
        disabled={busy || recipients.length === 0 || !label || !message.trim()}
        onClick={() => void start()}
      >
        {busy ? 'Getting ready…' : `Start: ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}`}
      </button>
    </div>
  )
}
