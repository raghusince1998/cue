import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ContactDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { dayLabel, initials, relativeDay } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { ContactEditor } from '../components/ContactEditor.tsx'
import { PersonSheet, personLine } from '../components/PersonSheet.tsx'
import { AccountSheet } from '../components/AccountSheet.tsx'
import { AccountsView } from './Accounts.tsx'
import { QuickMessage } from '../components/QuickMessage.tsx'
import { Greetings } from '../components/Greetings.tsx'
import { OCCASION_MESSAGES, hasClients, type OccasionKind } from '@cue/shared'
import { useAuth } from '../lib/auth.tsx'
import { useOnChange } from '../lib/changes.ts'
import {
  deviceContactsAvailable,
  deviceContactsReason,
  pickDeviceContacts,
} from '../lib/deviceContacts.ts'

/** `undefined` = closed, `null` = creating a new person, string = editing one. */
type Editing = string | null | undefined

interface Summary {
  people: Record<
    string,
    { waiting: number; waitingDue: number; owe: number; next: string | null; lastMet: string | null }
  >
  unsaved: string[]
}

interface Occasion {
  contactId: string
  name: string
  organization: string | null
  phone: string | null
  kind: OccasionKind
  date: string
  daysAway: number
}

interface Touch {
  id: string
  name: string
  role: string | null
  organization: string | null
  phone: string | null
  cadenceDays: number
  lastTouch: string | null
  dueAt: string
  due: boolean
}

export default function People() {
  // People, or the companies they work at. In the URL, so the weekly review
  // can link straight to accounts.
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'accounts' ? 'accounts' : 'people'
  const { me } = useAuth()
  /** Prospects and customers: a pipeline for sales and clients only. */
  const clients = hasClients(me?.uses ?? [])

  // ?wish=<id>&for=birthday: "Send wishes" on Today's card.
  useEffect(() => {
    const id = params.get('wish')
    if (!id) return
    const kind = params.get('for') === 'anniversary' ? 'anniversary' : 'birthday'
    setWishing({ contactId: id, kind })
    params.delete('wish')
    params.delete('for')
    setParams(params, { replace: true })
  }, [params, setParams])
  const [viewingAccount, setViewingAccount] = useState<string | null>(null)
  const [accountsReload, setAccountsReload] = useState(0)
  /** Where a person being added works, when added from an account. */
  const [newOrg, setNewOrg] = useState('')

  const [canPick] = useState(() => deviceContactsAvailable())
  const [pickReason] = useState(() => deviceContactsReason())
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState<string | null>(null)

  const [contacts, setContacts] = useState<ContactDTO[]>([])
  const withNumbers = contacts.filter((c) => c.phone).length

  /**
   * Called straight from the tap: the picker refuses to open otherwise, and
   * awaiting anything first is enough to lose the gesture.
   */
  async function importFromPhone() {
    setImporting(true)
    setImportNote(null)
    try {
      const picked = await pickDeviceContacts()
      if (picked.length === 0) {
        setImportNote('Nobody picked.')
        return
      }
      const r = await api<{ added: number; updated: number; unchanged: number }>(
        '/contacts/import',
        { method: 'POST', body: { contacts: picked } },
      )
      const parts = [
        r.added ? `${r.added} added` : null,
        r.updated ? `${r.updated} filled in` : null,
        r.unchanged ? `${r.unchanged} already complete` : null,
      ].filter(Boolean)
      setImportNote(parts.length ? `${parts.join(', ')}.` : 'Nothing changed.')
      await load()
    } catch (err) {
      setImportNote((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing>(undefined)

  const [summary, setSummary] = useState<Summary>({ people: {}, unsaved: [] })
  const [touches, setTouches] = useState<Touch[]>([])
  /** Someone due a word, being sent a quick message. */
  const [messaging, setMessaging] = useState<Touch | null>(null)
  /** Birthdays and anniversaries in the next few weeks. */
  const [occasions, setOccasions] = useState<Occasion[]>([])
  /** Wishing someone on their day: from Today's card, or the list below. */
  const [wishing, setWishing] = useState<{ contactId: string; kind: OccasionKind } | null>(null)
  const [greeting, setGreeting] = useState(false)
  const dueToReach = touches.filter((t) => t.due)
  const reachIds = new Set(dueToReach.map((t) => t.id))
  /** The person open in their page, and a name to start a new person with. */
  const [viewing, setViewing] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    const [list, s, t, occ] = await Promise.all([
      api<ContactDTO[]>('/contacts'),
      api<Summary>('/people/summary').catch(() => ({ people: {}, unsaved: [] })),
      api<{ people: Touch[] }>('/people/keep-in-touch').catch(() => ({ people: [] as Touch[] })),
      api<Occasion[]>('/occasions/upcoming', { query: { days: '30' } }).catch(() => [] as Occasion[]),
    ])
    setContacts(list)
    setSummary(s)
    setTouches(t.people)
    setOccasions(occ)
    setLoading(false)
  }, [])
  useOnChange(() => void load())

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matching = !q
      ? contacts
      : contacts.filter((c) =>
          [c.name, c.role, c.organization, c.phone, c.placeName].some((f) =>
            f?.toLowerCase().includes(q),
          ),
        )
    // People with something open between you first: they are the ones you
    // came here about. Alphabetical within each group, as before.
    const due = new Set(touches.filter((t) => t.due).map((t) => t.id))
    const open = (id: string) => {
      const s = summary.people[id]
      if (s?.waitingDue || due.has(id)) return 3
      return s ? (s.waiting + s.owe > 0 ? 2 : s.next ? 1 : 0) : 0
    }
    return [...matching].sort((a, b) => open(b.id) - open(a.id) || a.name.localeCompare(b.name))
  }, [contacts, query, summary, touches])

  async function touch(id: string, action: 'touched' | 'touch-later') {
    await api(`/contacts/${id}/${action}`, {
      method: 'POST',
      body: action === 'touch-later' ? { days: 7 } : {},
    })
    await load()
  }

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">People</h1>
        <span className="page-count">
          {contacts.length} saved
          {withNumbers > 0 ? ` · ${withNumbers} with a number` : ''}
        </span>
      </div>

      <div className="viewswitch">
        <button
          className={view === 'people' ? 'selected' : ''}
          onClick={() => setParams({}, { replace: true })}
        >
          People
        </button>
        <button
          className={view === 'accounts' ? 'selected' : ''}
          onClick={() => setParams({ view: 'accounts' }, { replace: true })}
        >
          {clients ? 'Accounts' : 'Companies'}
        </button>
      </div>

      {view === 'accounts' && (
        <AccountsView
          showStages={clients}
          onOpen={setViewingAccount}
          onAddPerson={() => setEditing(null)}
          reloadKey={accountsReload}
        />
      )}

      {view === 'people' && (
        <>
      <div className="row">
        <input
          className="grow"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, role, workplace or phone"
        />
        <button className="primary" onClick={() => setEditing(null)}>
          Add
        </button>
        {/* The native picker, where there is one. Not a sync, and the note
            below says so rather than implying one that cannot exist. */}
        <button className="ghost" onClick={() => setGreeting(true)} disabled={contacts.length === 0}>
          Send greetings
        </button>
        <button
          className="ghost"
          disabled={!canPick || importing}
          title={canPick ? undefined : pickReason}
          onClick={() => void importFromPhone()}
        >
          {importing ? 'Importing…' : 'From my phone'}
        </button>
      </div>

      {importNote && <p className="muted small">{importNote}</p>}

      {/* Names checked-in on that nobody saved: one tap to make them people. */}
      {summary.unsaved.length > 0 && (
        <div className="unsaved-people">
          <span className="muted small">Mentioned but not saved:</span>
          {summary.unsaved.map((n) => (
            <button
              key={n}
              className="chip"
              onClick={() => {
                setNewName(n)
                setEditing(null)
              }}
            >
              + {n}
            </button>
          ))}
        </div>
      )}

      {/* Birthdays and anniversaries coming up: the day itself is the one to act on. */}
      {occasions.length > 0 && !query.trim() && (
        <section className="card occasions">
          <div className="reach-out-head">
            <strong>Coming up</strong>
            <span className="muted small">next 30 days</span>
          </div>
          {occasions.slice(0, 6).map((o) => (
            <div className="your-day-line" key={`${o.contactId}-${o.kind}`}>
              <span>
                <span aria-hidden>{o.kind === 'birthday' ? '\u{1F382} ' : '\u{1F389} '}</span>
                <button className="link" onClick={() => setViewing(o.contactId)}>
                  {o.name}
                </button>
                <span className="muted small">
                  {' '}
                  · {o.kind} ·{' '}
                  {o.daysAway === 0
                    ? 'today'
                    : o.daysAway === 1
                      ? 'tomorrow'
                      : new Date(`${o.date}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
              </span>
              {o.daysAway <= 1 && (
                <button className="ghost tiny-btn" onClick={() => setWishing({ contactId: o.contactId, kind: o.kind })}>
                  Send wishes
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Keep in touch: who it has been too long with, longest first. */}
      {dueToReach.length > 0 && !query.trim() && (
        <section className="card reach-out">
          <div className="reach-out-head">
            <strong>Time to reach out</strong>
            <span className="muted small">
              {dueToReach.length} {dueToReach.length === 1 ? 'person' : 'people'}
            </span>
          </div>
          {dueToReach.map((t) => (
            <div className="your-day-line" key={t.id}>
              <span>
                <button className="link" onClick={() => setViewing(t.id)}>
                  {t.name}
                </button>
                <span className="muted small">
                  {t.organization ? ` · ${t.organization}` : ''} ·{' '}
                  {t.lastTouch ? `last contact ${relativeDay(t.lastTouch)}` : 'no contact on record'}
                </span>
              </span>
              <span className="row">
                {t.phone && (
                  <a className="ghost tiny-btn" href={`tel:${t.phone}`} data-contact-id={t.id} data-name={t.name}>
                    Call
                  </a>
                )}
                <button className="ghost tiny-btn" onClick={() => setMessaging(t)}>
                  Message
                </button>
                <button className="ghost tiny-btn" onClick={() => void touch(t.id, 'touched')}>
                  Talked
                </button>
                <button className="ghost tiny-btn" onClick={() => void touch(t.id, 'touch-later')}>
                  Next week
                </button>
              </span>
            </div>
          ))}
        </section>
      )}

      {contacts.length === 0 ? (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#128100;
          </span>
          <h3>Nobody here yet</h3>
          <p>
            Anyone you name while planning something is saved here on their own — say
            &ldquo;call the plumber&rdquo; and they appear. Add one by hand, or bring them over
            from your phone.
          </p>
          <div className="row">
            <button className="primary small-btn" onClick={() => setEditing(null)}>
              Add someone
            </button>
            {canPick && (
              <button className="ghost small-btn" onClick={() => void importFromPhone()}>
                From my phone
              </button>
            )}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="blank">
          <h3>Nobody matches &ldquo;{query}&rdquo;</h3>
          <p>Try part of a name, a job like &ldquo;plumber&rdquo;, or a phone number.</p>
        </div>
      ) : (
        <div className="tiles two-up">
          {filtered.map((c) => (
            <article key={c.id} className="tile">
              <span className={`tile-mark${c.phone ? ' is-accent' : ''}`} aria-hidden>
                {initials(c.name)}
              </span>

              <div className="tile-body">
                <p className="tile-title">{c.name}</p>
                {/* Only facts that exist. "No role recorded" and "Not met yet"
                    were two lines per card saying nothing. */}
                {personLine(c) && <p className="tile-sub">{personLine(c)}</p>}

                <div className="tile-tags">
                  {reachIds.has(c.id) && <span className="tag is-warn">Reach out</span>}
                  {summary.people[c.id]?.waiting ? (
                    <span className={`tag${summary.people[c.id]!.waitingDue ? ' is-warn' : ''}`}>
                      Waiting · {summary.people[c.id]!.waiting}
                    </span>
                  ) : null}
                  {summary.people[c.id]?.owe ? (
                    <span className="tag">You owe · {summary.people[c.id]!.owe}</span>
                  ) : null}
                  {summary.people[c.id]?.next ? (
                    <span className="tag is-live">Next: {dayLabel(summary.people[c.id]!.next!)}</span>
                  ) : summary.people[c.id]?.lastMet ? (
                    <span className="tag">Last met {relativeDay(summary.people[c.id]!.lastMet!)}</span>
                  ) : null}
                  {c.phone && <span className="tag is-live">{c.phone}</span>}
                  {c.visitCount ? (
                    <span className="tag">
                      {c.visitCount} meeting{c.visitCount === 1 ? '' : 's'}
                      {c.lastSeenAt ? ` · ${relativeDay(c.lastSeenAt)}` : ''}
                    </span>
                  ) : null}
                  {!c.phone && <span className="tag is-warn">No number</span>}
                </div>
              </div>

              <div className="tile-actions">
                {c.phone && (
                  <a
                    className="primary small-btn call-btn"
                    href={`tel:${c.phone}`}
                    data-contact-id={c.id}
                    data-name={c.name}
                  >
                    Call
                  </a>
                )}
                <button className="ghost small-btn" onClick={() => setViewing(c.id)}>
                  Open
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

        </>
      )}

      {greeting && (
        <Modal title="Send greetings" onClose={() => setGreeting(false)}>
          <Greetings contacts={contacts} onClose={() => setGreeting(false)} />
        </Modal>
      )}

      {wishing && (() => {
        const c = contacts.find((x) => x.id === wishing.contactId)
        if (!c) return null
        return (
          <Modal title={`Wish ${c.name}`} onClose={() => setWishing(null)}>
            <QuickMessage
              to={{ name: c.name, company: c.organization, phone: c.phone, email: c.email }}
              preset={{
                title: wishing.kind === 'birthday' ? 'Birthday wishes' : 'Anniversary wishes',
                body: OCCASION_MESSAGES[wishing.kind],
              }}
              onDone={() => setWishing(null)}
            />
          </Modal>
        )
      })()}

      {messaging && (
        <Modal title={`Message ${messaging.name}`} onClose={() => setMessaging(null)}>
          <QuickMessage
            to={{ name: messaging.name, company: messaging.organization, phone: messaging.phone }}
            suggest={/remind|touch|catch/i}
            onDone={() => setMessaging(null)}
          />
        </Modal>
      )}

      {viewingAccount && (
        <Modal title="Account" onClose={() => setViewingAccount(null)}>
          <AccountSheet
            key={viewingAccount}
            name={viewingAccount}
            onOpenPerson={(id) => {
              setViewingAccount(null)
              setViewing(id)
            }}
            onAddPerson={(org) => {
              setViewingAccount(null)
              setNewOrg(org)
              setEditing(null)
            }}
            onRenamed={(to) => {
              setViewingAccount(to)
              setAccountsReload((n) => n + 1)
              void load()
            }}
            onChanged={() => {
              setAccountsReload((n) => n + 1)
              void load()
            }}
          />
        </Modal>
      )}

      {viewing && (
        <Modal title="Person" onClose={() => setViewing(null)}>
          <PersonSheet
            key={viewing}
            contactId={viewing}
            onEdit={() => {
              setEditing(viewing)
              setViewing(null)
            }}
            onChanged={() => void load()}
            onOpenPerson={(id) => setViewing(id)}
            onOpenAccount={(org) => {
              setViewing(null)
              setViewingAccount(org)
            }}
          />
        </Modal>
      )}

      {editing !== undefined && (
        <Modal
          title={editing ? 'Edit person' : 'Add person'}
          onClose={() => {
            setEditing(undefined)
            setNewName('')
            setNewOrg('')
          }}
        >
          <ContactEditor
            contactId={editing}
            initialName={editing ? '' : newName}
            initialOrganization={editing ? '' : newOrg}
            onClose={() => {
              setEditing(undefined)
              setNewName('')
              setNewOrg('')
            }}
            onSaved={() => {
              setEditing(undefined)
              setNewName('')
              setNewOrg('')
              setAccountsReload((n) => n + 1)
              void load()
            }}
          />
        </Modal>
      )}
    </div>
  )
}
