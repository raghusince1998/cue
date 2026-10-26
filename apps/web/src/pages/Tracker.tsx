import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BOARDS,
  formatRupees,
  isOpenStage,
  stageOf,
  type BoardKey,
  type ContactDTO,
  type TrackerItemDTO,
  type TrackerSuggestions,
  type TrackerUpdateDTO,
  type TrackerUpdateKind,
} from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange, useOnChange } from '../lib/changes.ts'
import { msg, rich, t } from '../lib/i18n.tsx'
import { dayLabel, formatDateTime, relativeDay } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { rupeesToPaise } from '../components/Owed.tsx'
import { waNumber } from '../components/PersonSheet.tsx'
import { PersonPicker, personBody, type PersonChoice, type PersonOption } from '../components/PersonPicker.tsx'
import { errorText } from '../lib/errors.ts'
import { openPerson, openPlan } from '../lib/open.ts'
import { toast } from '../lib/toast.ts'
import { saveToPhone } from '../lib/vcard.ts'
import {
  NEXT_WHEN,
  PlaceBlock,
  Suggest,
  UpdateForm,
  UpdateList,
  bookNext,
  dueIn,
  fresh,
  lastUpdateLine,
} from '../components/TrackerLog.tsx'

interface Detail extends TrackerItemDTO {
  events: { from: string | null; to: string; at: string }[]
  plans: { id: string; title: string; dueAt: string; status: string }[]
  updates: TrackerUpdateDTO[]
}

type Saved = TrackerItemDTO & { contactCreated?: boolean }
type View = 'open' | 'won' | 'lost'

/** What each board is for, said once at the top. */
const INTRO: Record<BoardKey, string> = {
  jobs: msg('Every job you have applied to, or mean to: where each one stands and what to do next.'),
  hiring: msg('Everyone in the running: where each candidate is and who needs a next step.'),
  deals: msg('Every deal in play, from first lead to signed, with the next step on each.'),
}

/** One item of each board, said whole so Hindi can say it its own way. Shown with t(). */
const WORDS: Record<
  BoardKey,
  { sheet: string; remove: string; ask: string; add: string; fresh: string; person: string; won: string; lost: string }
> = {
  jobs: {
    sheet: msg('Application'),
    remove: msg('Delete this application'),
    ask: msg('Delete this application? Its history goes with it; plans made for it stay.'),
    add: msg('+ Add an application'),
    fresh: msg('New application'),
    person: msg('Contact at the company (optional)'),
    won: msg('Got the job'),
    lost: msg('Closed'),
  },
  hiring: {
    sheet: msg('Candidate'),
    remove: msg('Delete this candidate'),
    ask: msg('Delete this candidate? Its history goes with it; plans made for it stay.'),
    add: msg('+ Add a candidate'),
    fresh: msg('New candidate'),
    person: msg('Their contact details (optional)'),
    won: msg('Hired'),
    lost: msg('Not hired'),
  },
  deals: {
    sheet: msg('Deal'),
    remove: msg('Delete this deal'),
    ask: msg('Delete this deal? Its history goes with it; plans made for it stay.'),
    add: msg('+ Add a deal'),
    fresh: msg('New deal'),
    person: msg('Contact person'),
    won: msg('Won'),
    lost: msg('Lost'),
  },
}

/** Why a deal was lost: one tap each, so the Lost view can say what keeps happening. Shown with t(). */
const LOST_REASONS: string[] = [
  msg('Price too high'),
  msg('Went with a competitor'),
  msg('No budget'),
  msg('Bad timing'),
  msg('Stopped replying'),
  msg('Did not need it'),
  msg('Already uses one'),
]

/** A visit or call that ended in no: the deal is offered as lost, for this reason. */
const LOST_FROM: Record<string, string> = {
  [msg('Not interested')]: msg('Did not need it'),
  [msg('Already uses one')]: msg('Already uses one'),
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** A reason said with t() when it is one of ours; what the person typed, as typed. */
const reasonText = (reason: string) => (LOST_REASONS.includes(reason) ? t(reason) : reason)

/** "Applied 9 days ago", "Interviewing since yesterday". */
function sinceLine(board: BoardKey, item: TrackerItemDTO): string {
  const stage = stageOf(board, item.stage)?.label ?? item.stage
  const when = relativeDay(item.stageChangedAt)
  return t('{stage} {when}', { stage: t(stage), when })
}

/** The next open stage, for one-tap moving along. */
function nextStage(board: BoardKey, stage: string) {
  const open = BOARDS[board].stages.filter((s) => !s.closed)
  const i = open.findIndex((s) => s.key === stage)
  return i >= 0 && i < open.length - 1 ? open[i + 1]! : null
}

const outcome = (board: BoardKey, item: TrackerItemDTO) => stageOf(board, item.stage)?.closed ?? null
const daysTaken = (item: TrackerItemDTO) =>
  item.closedAt ? Math.max(0, Math.round((Date.parse(item.closedAt) - Date.parse(item.createdAt)) / 86_400_000)) : null
const sumValue = (list: TrackerItemDTO[]) => list.reduce((n, i) => n + (i.valuePaise ?? 0), 0)
/** "the same day", "in 1 day", "in 12 days". */
const tookWords = (days: number) => (days === 0 ? t('the same day') : days === 1 ? t('in 1 day') : t('in {n} days', { n: days }))

/**
 * A tracker: job applications, candidates or deals. Open ones by stage; won
 * and lost each on their own, with what they add up to.
 */
export default function Tracker({ board: key }: { board: BoardKey }) {
  const board = BOARDS[key]
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<TrackerItemDTO[] | null>(null)
  const [people, setPeople] = useState<PersonOption[]>([])
  const [hints, setHints] = useState<TrackerSuggestions>({ details: [], nextSteps: [] })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openId = params.get('item')
  const view: View = params.get('view') === 'won' ? 'won' : params.get('view') === 'lost' ? 'lost' : 'open'

  const load = useCallback(async () => {
    try {
      const [list, suggested] = await Promise.all([
        api<TrackerItemDTO[]>(`/trackers/${key}`),
        api<TrackerSuggestions>(`/trackers/${key}/suggestions`).catch(() => null),
      ])
      setItems(list)
      if (suggested) setHints(suggested)
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }, [key])
  const loadPeople = useCallback(() => {
    void api<ContactDTO[]>('/contacts')
      .then((r) => setPeople(r.map((c) => ({ id: c.id, name: c.name, phone: c.phone, organization: c.organization }))))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    void load()
    loadPeople()
  }, [load, loadPeople])
  useOnChange(() => {
    void load()
    loadPeople()
  })

  const open = useMemo(() => (items ?? []).filter((i) => isOpenStage(key, i.stage)), [items, key])
  const won = useMemo(() => (items ?? []).filter((i) => outcome(key, i) === 'won'), [items, key])
  const lost = useMemo(() => (items ?? []).filter((i) => outcome(key, i) === 'lost'), [items, key])
  const quiet = open.filter((i) => i.quietDays !== null)
  const openStages = board.stages.filter((s) => !s.closed)
  // Clients typed before, and where People work: one tap in the first box.
  const workplaces = useMemo(
    () =>
      [
        ...new Set([
          ...(items ?? []).map((i) => i.title.trim()),
          ...people.map((p) => p.organization?.trim()).filter((o): o is string => Boolean(o)),
        ]),
      ].sort(),
    [items, people],
  )

  const show = (id: string | null) => {
    if (id) params.set('item', id)
    else params.delete('item')
    setParams(params, { replace: !id })
  }
  const setView = (next: View) => {
    if (next === 'open') params.delete('view')
    else params.set('view', next)
    setParams(params, { replace: true })
  }

  async function move(item: TrackerItemDTO, to: string) {
    try {
      await api(`/tracker-items/${item.id}`, { method: 'PATCH', body: { stage: to } })
      await load()
      announceChange()
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const decided = won.length + lost.length
  const winRate = decided > 0 ? Math.round((won.length / decided) * 100) : null

  return (
    <div className="stack tracker-page">
      <div className="page-head">
        <h1 className="page-title">{t(board.label)}</h1>
        <button className="primary small-btn" onClick={() => setAdding(true)}>
          {t(WORDS[key].add)}
        </button>
      </div>
      <p className="muted small">{t(INTRO[key])}</p>

      {/* What it adds up to: the deals still in play, what was won, how often. */}
      {key === 'deals' && items && items.length > 0 && (
        <div className="tracker-stats">
          <div>
            <span>{t('In the pipeline')}</span>
            <strong>{formatRupees(sumValue(open))}</strong>
            <small>{t('{n} open', { n: open.length })}</small>
          </div>
          <div className="is-won">
            <span>{t('Won')}</span>
            <strong>{formatRupees(sumValue(won))}</strong>
            <small>{won.length === 1 ? t('1 deal') : t('{n} deals', { n: won.length })}</small>
          </div>
          <div>
            <span>{t('Win rate')}</span>
            <strong>{winRate === null ? '—' : `${winRate}%`}</strong>
            <small>{t('{won} of {n} decided', { won: won.length, n: decided })}</small>
          </div>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="tracker-tabs" role="tablist" aria-label={t(board.label)}>
          {(
            [
              ['open', t('Open'), open.length],
              ['won', t(WORDS[key].won), won.length],
              ['lost', t(WORDS[key].lost), lost.length],
            ] as const
          ).map(([v, label, n]) => (
            <button key={v} role="tab" aria-selected={view === v} className={`is-${v}${view === v ? ' is-on' : ''}`} onClick={() => setView(v)}>
              {label} <span className="tracker-tab-count">{n}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="error small">{error}</p>}

      {!items ? (
        <div className="boot">
          <span className="spinner" />
        </div>
      ) : items.length === 0 ? (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#128203;
          </span>
          <h3>{t('Nothing tracked yet')}</h3>
          <p>
            {rich('Add one above, or type it in the box on Today: {example}.', {
              example: (
                <strong>
                  {key === 'jobs'
                    ? 'applied to Infosys for data analyst'
                    : key === 'hiring'
                      ? 'candidate Priya Nair for product designer'
                      : 'new lead: Tata Motors for 50 laptops'}
                </strong>
              ),
            })}
          </p>
        </div>
      ) : view === 'open' ? (
        <>
          {quiet.length > 0 && (
            <div className="tracker-quiet">
              <strong>
                {quiet.length === 1 ? t('One has gone quiet') : t('{n} have gone quiet', { n: quiet.length })}
              </strong>
              <span className="muted small"> {t('— nothing booked, and longer than usual at their stage.')}</span>
            </div>
          )}
          {open.length === 0 ? (
            <p className="muted small">{t('Nothing open right now.')}</p>
          ) : (
            <div className="tracker-columns" style={{ ['--cols' as string]: openStages.length }}>
              {openStages.map((s) => {
                const here = open.filter((i) => i.stage === s.key)
                return (
                  <section key={s.key} className={`tracker-column${here.length === 0 ? ' is-empty' : ''}`}>
                    <h2 className="tracker-column-head">
                      {t(s.label)} <span className="muted">{here.length}</span>
                      {key === 'deals' && sumValue(here) > 0 && <span className="tracker-column-value">{formatRupees(sumValue(here))}</span>}
                    </h2>
                    {here.map((i) => (
                      <TrackerCard key={i.id} board={key} item={i} onOpen={() => show(i.id)} onMove={(to) => void move(i, to)} />
                    ))}
                  </section>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <ClosedList board={key} kind={view} items={view === 'won' ? won : lost} onOpen={show} />
      )}

      {adding && (
        <Modal title={t(WORDS[key].fresh)} onClose={() => setAdding(false)} closeOnBackdrop={false}>
          <NewItem
            board={key}
            items={items ?? []}
            details={hints.details}
            people={people}
            workplaces={workplaces}
            onOpenExisting={(id) => {
              setAdding(false)
              setView('open')
              show(id)
            }}
            onCreated={(saved) => {
              setAdding(false)
              setView('open')
              void load()
              announceChange()
              if (saved.contactCreated && saved.contactName) toast(t('{name} saved to your People.', { name: saved.contactName }))
              show(saved.id)
            }}
          />
        </Modal>
      )}

      {openId && (
        <Modal title={t(WORDS[key].sheet)} onClose={() => show(null)} closeOnBackdrop={false}>
          <ItemSheet
            id={openId}
            board={key}
            people={people}
            nextSteps={hints.nextSteps}
            onChanged={() => {
              void load()
              loadPeople()
            }}
            onDeleted={() => {
              show(null)
              void load()
            }}
          />
        </Modal>
      )}
    </div>
  )
}

/** Adding one: who, what, with whom (picked or new), what it is worth and when. */
function NewItem({
  board: key,
  items,
  details,
  people,
  workplaces,
  onOpenExisting,
  onCreated,
}: {
  board: BoardKey
  items: TrackerItemDTO[]
  details: string[]
  people: PersonOption[]
  workplaces: string[]
  onOpenExisting: (id: string) => void
  onCreated: (saved: Saved) => void
}) {
  const board = BOARDS[key]
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [person, setPerson] = useState<PersonChoice | null>(null)
  const [value, setValue] = useState('')
  const [closeOn, setCloseOn] = useState('')
  const [stage, setStage] = useState(board.startStage)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openStages = board.stages.filter((s) => !s.closed)
  // A candidate is a person: their name is the title unless one was typed.
  const name = title.trim() || (person?.kind ? person.name.trim() : '')
  // What it is for: what was used with this client before, then what is used most.
  const forClient = title.trim()
    ? items.filter((i) => i.detail && same(i.title, title)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : []
  const usual = fresh([...forClient.map((i) => i.detail!), ...details], detail)
  // Already one open with this client: logging on it beats a second one.
  const already = title.trim() ? items.find((i) => isOpenStage(key, i.stage) && same(i.title, title)) : undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name) {
      setError(t('Who is it with? {label} is needed.', { label: t(board.titleLabel) }))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await api<Saved>(`/trackers/${key}`, {
        method: 'POST',
        body: {
          title: name,
          detail: detail.trim() || null,
          stage,
          valuePaise: value.trim() ? rupeesToPaise(value) : null,
          expectedCloseOn: closeOn || null,
          ...personBody(person),
        },
      })
      onCreated(saved)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack tight tracker-new" onSubmit={(e) => void submit(e)}>
      <label>
        {t(board.titleLabel)}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t(board.titlePlaceholder)}
          list={key === 'hiring' ? undefined : 'tracker-workplaces'}
          maxLength={160}
          autoFocus
        />
      </label>
      {already && (
        <p className="tracker-already small">
          {t('Already open: {what}.', { what: already.detail ? `${already.title} — ${already.detail}` : already.title })}{' '}
          <button type="button" className="link small" onClick={() => onOpenExisting(already.id)}>
            {t('Open it')}
          </button>
        </p>
      )}
      {key !== 'hiring' && (
        <datalist id="tracker-workplaces">
          {workplaces.map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>
      )}
      <label>
        {t(board.detailLabel)}
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder={t(board.detailPlaceholder)}
          list="tracker-details"
          maxLength={200}
        />
      </label>
      <datalist id="tracker-details">
        {details.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <Suggest label={t('Used before')} options={usual} onPick={setDetail} />

      <PersonPicker people={people} value={person} onChange={setPerson} label={t(WORDS[key].person)} />

      <div className="tracker-new-row">
        <label>
          {t('{label} (₹, optional)', { label: t(board.valueLabel) })}
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0" />
        </label>
        {key === 'deals' && (
          <label>
            {t('Expected to close (optional)')}
            <input type="date" value={closeOn} onChange={(e) => setCloseOn(e.target.value)} />
          </label>
        )}
      </div>

      <span className="label-text">{t('Stage')}</span>
      <div className="chips" role="group" aria-label={t('Stage')}>
        {openStages.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`chip${stage === s.key ? ' selected' : ''}`}
            aria-pressed={stage === s.key}
            onClick={() => setStage(s.key)}
          >
            {t(s.label)}
          </button>
        ))}
      </div>

      {error && <p className="error small">{error}</p>}
      <button className="primary" type="submit" disabled={busy || !name}>
        {busy ? t('Saving…') : t('Save')}
      </button>
    </form>
  )
}

/** Won, or lost: each on its own, with what they add up to and — for lost deals — why. */
function ClosedList({
  board: key,
  kind,
  items,
  onOpen,
}: {
  board: BoardKey
  kind: 'won' | 'lost'
  items: TrackerItemDTO[]
  onOpen: (id: string) => void
}) {
  const sorted = [...items].sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
  const total = sumValue(items)
  const taken = items.map(daysTaken).filter((d): d is number => d !== null)
  const avgDays = taken.length ? Math.round(taken.reduce((a, b) => a + b, 0) / taken.length) : null
  const reasons = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of items) {
      const r = i.closeReason?.trim() || ''
      counts.set(r, (counts.get(r) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [items])

  if (items.length === 0) {
    return (
      <p className="muted small">
        {kind === 'won' ? t('Nothing won yet — the first one will show here.') : t('Nothing lost. Long may it last.')}
      </p>
    )
  }

  return (
    <div className="stack tight">
      <div className={`closed-summary is-${kind}`}>
        <strong>
          {items.length === 1
            ? t('1 {noun}', { noun: t(WORDS[key].sheet).toLowerCase() })
            : t('{n} in all', { n: items.length })}
          {total > 0 && ` · ${formatRupees(total)}`}
        </strong>
        {avgDays !== null && kind === 'won' && (
          <span className="muted small">
            {avgDays === 0
              ? t('Usually closed within a day')
              : avgDays === 1
                ? t('Took 1 day on average')
                : t('Took {n} days on average', { n: avgDays })}
          </span>
        )}
      </div>

      {kind === 'lost' && reasons.some(([r]) => r) && (
        <div className="closed-reasons" aria-label={t('Why they were lost')}>
          {reasons.map(([r, n]) => (
            <span key={r || 'none'} className="closed-reason">
              {r ? reasonText(r) : t('No reason given')} <strong>{n}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="closed-list">
        {sorted.map((i) => {
          const days = daysTaken(i)
          const stage = stageOf(key, i.stage)
          return (
            <button key={i.id} className={`closed-card is-${kind}`} onClick={() => onOpen(i.id)}>
              <span className="closed-card-top">
                <strong>{i.title}</strong>
                {i.valuePaise ? <span className="closed-card-value">{formatRupees(i.valuePaise)}</span> : null}
              </span>
              {i.detail && <span className="muted small">{i.detail}</span>}
              <span className="closed-card-meta">
                {[
                  stage ? `${t(stage.label)} ${dayLabel(i.closedAt ?? i.stageChangedAt)}` : null,
                  days !== null ? tookWords(days) : null,
                  i.contactName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {i.closeReason && <span className="closed-card-reason">{reasonText(i.closeReason)}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TrackerCard({
  board,
  item,
  onOpen,
  onMove,
}: {
  board: BoardKey
  item: TrackerItemDTO
  onOpen: () => void
  onMove?: (to: string) => void
}) {
  const stage = stageOf(board, item.stage)
  const forward = onMove ? nextStage(board, item.stage) : null
  return (
    <article className={`tracker-card${item.quietDays !== null ? ' is-quiet' : ''}`}>
      <button className="tracker-card-main" onClick={onOpen}>
        <span className="tracker-card-title">{item.title}</span>
        {item.detail && <span className="tracker-card-detail">{item.detail}</span>}
        {item.contactName && <span className="tracker-card-person">{t('with {name}', { name: item.contactName })}</span>}
        <span className="tracker-card-meta">
          {stage?.closed ? `${t(stage.label)} · ${dayLabel(item.closedAt ?? item.stageChangedAt)}` : sinceLine(board, item)}
          {item.valuePaise ? ` · ${formatRupees(item.valuePaise)}` : ''}
          {item.expectedCloseOn ? ` · ${t('closes {day}', { day: dayLabel(item.expectedCloseOn) })}` : ''}
        </span>
        {item.lastUpdate && <span className="tracker-card-log">{lastUpdateLine(board, item.lastUpdate)}</span>}
        {item.next ? (
          <span className="tracker-card-next">
            {t('Next: {title} · {when}', { title: item.next.title, when: formatDateTime(item.next.dueAt) })}
          </span>
        ) : (
          item.quietDays !== null && (
            <span className="tracker-card-quiet">{t('Quiet for {n} days — what is next?', { n: item.quietDays })}</span>
          )
        )}
      </button>
      {forward && (
        <button className="link small tracker-forward" onClick={() => onMove!(forward.key)}>
          {t('Move to {stage} →', { stage: t(forward.label) })}
        </button>
      )}
    </article>
  )
}

/** Who it is with: call, message, save to the phone — or pick someone. */
function ContactBlock({
  board: key,
  item,
  people,
  busy,
  onLink,
}: {
  board: BoardKey
  item: Detail
  people: PersonOption[]
  busy: boolean
  onLink: (choice: PersonChoice) => Promise<void>
}) {
  const [changing, setChanging] = useState(false)
  const [choice, setChoice] = useState<PersonChoice | null>(null)
  const person = people.find((p) => p.id === item.contactId)

  if (item.contactId && item.contactName && !changing) {
    const phone = item.contactPhone
    return (
      <div className="contact-card">
        <span className="person-avatar" aria-hidden>
          {item.contactName.charAt(0).toUpperCase()}
        </span>
        <div className="contact-card-text">
          <button className="plan-link" onClick={() => openPerson(item.contactId!)}>
            <strong>{item.contactName}</strong>
          </button>
          <span className="muted small">{[phone, item.contactEmail].filter(Boolean).join(' · ') || t('No number saved')}</span>
        </div>
        <div className="contact-card-actions">
          {phone && (
            <a className="ghost small-btn" href={`tel:${phone}`}>
              {t('Call')}
            </a>
          )}
          {phone && (
            <a className="ghost small-btn" href={`https://wa.me/${waNumber(phone)}`} target="_blank" rel="noopener noreferrer">
              {t('WhatsApp')}
            </a>
          )}
          <button
            className="ghost small-btn"
            onClick={() =>
              saveToPhone({ name: item.contactName!, phone, email: item.contactEmail, organization: person?.organization ?? (key === 'hiring' ? null : item.title) })
            }
          >
            {t('Save to phone')}
          </button>
          <button className="link small" onClick={() => setChanging(true)}>
            {t('Change')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stack tight">
      <PersonPicker people={people} value={choice} onChange={setChoice} label={t(WORDS[key].person)} hideLabel />
      <div className="row">
        <button
          className="primary small-btn"
          disabled={busy || !choice || (choice.kind === 'new' && !choice.name.trim())}
          onClick={() => {
            if (!choice) return
            void onLink(choice).then(() => {
              setChoice(null)
              setChanging(false)
            })
          }}
        >
          {t('Save')}
        </button>
        {changing && (
          <button className="ghost small-btn" onClick={() => setChanging(false)}>
            {t('Cancel')}
          </button>
        )}
      </div>
    </div>
  )
}

/** One item: where it stands, who it is with, what is next, and how it got here. */
function ItemSheet({
  id,
  board: key,
  people,
  nextSteps,
  onChanged,
  onDeleted,
}: {
  id: string
  board: BoardKey
  people: PersonOption[]
  nextSteps: string[]
  onChanged: () => void
  onDeleted: () => void
}) {
  const board = BOARDS[key]
  const [item, setItem] = useState<Detail | null>(null)
  const [draft, setDraft] = useState({ title: '', detail: '', link: '', value: '', notes: '', closeOn: '' })
  const [dirty, setDirty] = useState(false)
  const [nextText, setNextText] = useState('')
  const [nextAt, setNextAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** A lost stage picked: asking why before it moves. */
  const [losing, setLosing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  /** A visit or a call being logged. */
  const [logging, setLogging] = useState<TrackerUpdateKind | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/tracker-items/${id}`)
      setItem(d)
      setDraft({
        title: d.title,
        detail: d.detail ?? '',
        link: d.link ?? '',
        value: d.valuePaise ? String(d.valuePaise / 100) : '',
        notes: d.notes ?? '',
        closeOn: d.expectedCloseOn ?? '',
      })
      setDirty(false)
    } catch (err) {
      setError(errorText(err))
    }
  }, [id])
  useEffect(() => {
    void load()
  }, [load])
  // A plan opened from here and changed: this follows.
  useOnChange(() => void load())

  const field = (k: keyof typeof draft) => ({
    value: draft[k],
    onChange: (e: { target: { value: string } }) => {
      setDraft((d) => ({ ...d, [k]: e.target.value }))
      setDirty(true)
    },
  })

  async function patch(body: Record<string, unknown>): Promise<Saved | null> {
    setBusy(true)
    setError(null)
    try {
      const saved = await api<Saved>(`/tracker-items/${id}`, { method: 'PATCH', body })
      await load()
      onChanged()
      announceChange()
      return saved
    } catch (err) {
      setError(errorText(err))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function saveDetails() {
    await patch({
      title: draft.title,
      detail: draft.detail || null,
      link: draft.link.trim() || null,
      valuePaise: draft.value.trim() ? rupeesToPaise(draft.value) : null,
      notes: draft.notes || null,
      ...(key === 'deals' ? { expectedCloseOn: draft.closeOn || null } : {}),
    })
  }

  async function link(choice: PersonChoice) {
    const saved = await patch(personBody(choice))
    if (saved?.contactCreated && saved.contactName) toast(t('{name} saved to your People.', { name: saved.contactName }))
  }

  function pickStage(to: string) {
    if (!item || item.stage === to) return
    // A deal lost: why, in one tap — it is what the Lost view learns from.
    if (key === 'deals' && stageOf(key, to)?.closed === 'lost') {
      setLosing(to)
      setReason('')
      return
    }
    void patch({ stage: to })
  }

  async function addNext(days: number | null) {
    if (!nextText.trim()) {
      setError(t('What is the next step? e.g. Send a thank-you note'))
      return
    }
    let due: Date
    if (days === null) {
      if (!nextAt) {
        setError(t('Pick a day and time.'))
        return
      }
      due = new Date(nextAt)
    } else {
      due = dueIn(days)
    }
    setBusy(true)
    setError(null)
    try {
      await bookNext(id, item?.contactId ?? null, nextText.trim(), due)
      setNextText('')
      setNextAt('')
      await load()
      onChanged()
      announceChange()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  /** Logged: and when it ended in no, why it was lost is asked straight away. */
  async function logged(saved: { outcome: string | null } | null) {
    setLogging(null)
    if (!saved) return
    await load()
    onChanged()
    announceChange()
    const why = saved.outcome ? LOST_FROM[saved.outcome] : undefined
    const lostStage = board.stages.find((s) => s.closed === 'lost')
    if (key === 'deals' && why && item && isOpenStage(key, item.stage) && lostStage) {
      setLosing(lostStage.key)
      setReason(why)
    }
  }

  async function removeUpdate(updateId: string) {
    try {
      await api(`/tracker-items/${id}/updates/${updateId}`, { method: 'DELETE' })
      await load()
      onChanged()
      announceChange()
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function remove() {
    if (!window.confirm(t(WORDS[key].ask))) return
    await api(`/tracker-items/${id}`, { method: 'DELETE' })
    onChanged()
    announceChange()
    onDeleted()
  }

  if (!item) return error ? <p className="error">{error}</p> : <div className="boot"><span className="spinner" /></div>

  const upcoming = item.plans.filter((p) => p.status === 'pending')
  const past = item.plans.filter((p) => p.status !== 'pending')
  const result = outcome(key, item)
  const days = daysTaken(item)
  return (
    <div className="stack tight tracker-sheet">
      <div>
        <strong className="tracker-sheet-title">{item.title}</strong>
        {item.detail && <p className="muted small">{item.detail}</p>}
        {(item.valuePaise || item.expectedCloseOn) && (
          <p className="tracker-sheet-facts">
            {item.valuePaise ? <strong>{formatRupees(item.valuePaise)}</strong> : null}
            {item.expectedCloseOn && !result && (
              <span className="muted small"> · {t('expected to close {day}', { day: dayLabel(item.expectedCloseOn) })}</span>
            )}
          </p>
        )}
      </div>

      {result && (
        <div className={`tracker-outcome is-${result}`}>
          <strong>
            {t(stageOf(key, item.stage)?.label ?? item.stage)} · {dayLabel(item.closedAt ?? item.stageChangedAt)}
            {days !== null && ` · ${tookWords(days)}`}
          </strong>
          {item.closeReason && <span>{reasonText(item.closeReason)}</span>}
        </div>
      )}

      <span className="label-text">{t(WORDS[key].person)}</span>
      <ContactBlock board={key} item={item} people={people} busy={busy} onLink={link} />

      {key !== 'hiring' && (
        <>
          <span className="label-text">{t('Location')}</span>
          <PlaceBlock place={item.place} busy={busy} onPatch={patch} />
        </>
      )}

      <span className="label-text">{t('What happened')}</span>
      {logging ? (
        <UpdateForm
          key={logging}
          board={key}
          item={item}
          kind={logging}
          people={people}
          nextSteps={nextSteps}
          onDone={(saved) => void logged(saved)}
        />
      ) : (
        <div className="row">
          <button className="ghost small-btn" onClick={() => setLogging('visit')}>
            {key === 'deals' ? t('+ Log a visit') : t('+ Log a meeting')}
          </button>
          <button className="ghost small-btn" onClick={() => setLogging('call')}>
            {t('+ Log a call')}
          </button>
        </div>
      )}
      {item.updates.length === 0 && !logging && (
        <p className="muted small">{t('Nothing logged yet. Each visit or call, with how it went, shows here.')}</p>
      )}
      <UpdateList board={key} updates={item.updates} onRemove={(u) => void removeUpdate(u)} />

      <span className="label-text">{t('Stage')}</span>
      <div className="chips tracker-stages" role="group" aria-label={t('Stage')}>
        {board.stages.map((s) => (
          <button
            key={s.key}
            className={`chip${item.stage === s.key ? ' selected' : ''}${s.closed ? ` is-${s.closed}` : ''}`}
            onClick={() => pickStage(s.key)}
            disabled={busy}
            aria-pressed={item.stage === s.key}
          >
            {t(s.label)}
          </button>
        ))}
      </div>
      {losing && (
        <div className="lost-ask">
          <strong>{t('Why was it lost?')}</strong>
          <div className="chips">
            {LOST_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className={`chip${reason === r ? ' selected' : ''}`}
                aria-pressed={reason === r}
                onClick={() => setReason(r)}
              >
                {t(r)}
              </button>
            ))}
          </div>
          <input
            value={LOST_REASONS.includes(reason) ? '' : reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('Or in your words')}
            maxLength={200}
          />
          <div className="row">
            <button
              className="primary small-btn"
              disabled={busy}
              onClick={() => {
                const to = losing
                setLosing(null)
                void patch({ stage: to, closeReason: reason.trim() || null })
              }}
            >
              {t('Mark as lost')}
            </button>
            <button className="ghost small-btn" onClick={() => setLosing(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
      <p className="muted small">{sinceLine(key, item)}.</p>

      <span className="label-text">{t('Next step')}</span>
      {upcoming.length > 0 ? (
        <ul className="plain tracker-plans">
          {upcoming.map((p) => (
            <li key={p.id}>
              <button className="plan-link" onClick={() => openPlan(p.id)}>
                {p.title}
              </button>{' '}
              <span className="muted">· {formatDateTime(p.dueAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        isOpenStage(key, item.stage) && <p className="muted small">{t('Nothing booked. What happens next, and when?')}</p>
      )}
      {isOpenStage(key, item.stage) && (
        <div className="stack tight tracker-next">
          <input
            value={nextText}
            onChange={(e) => setNextText(e.target.value)}
            placeholder={
              key === 'jobs'
                ? t('e.g. Follow up with the recruiter')
                : key === 'hiring'
                  ? t('e.g. Second interview with the team')
                  : t('e.g. Send the revised quote')
            }
            aria-label={t('Next step')}
          />
          <Suggest label={t('Used before')} options={fresh(nextSteps, nextText, 3)} onPick={setNextText} />
          <div className="row">
            {NEXT_WHEN.map((w) => (
              <button key={w.label} className="ghost small-btn" onClick={() => void addNext(w.days)} disabled={busy}>
                {t(w.label)}
              </button>
            ))}
            <input
              type="datetime-local"
              value={nextAt}
              onChange={(e) => setNextAt(e.target.value)}
              aria-label={t('Or pick a time')}
              className="tracker-next-at"
            />
            {nextAt && (
              <button className="primary small-btn" onClick={() => void addNext(null)} disabled={busy}>
                {t('Book it')}
              </button>
            )}
          </div>
        </div>
      )}

      <span className="label-text">{t('Details')}</span>
      <div className="tracker-fields">
        <label>
          {t(board.titleLabel)}
          <input {...field('title')} maxLength={160} />
        </label>
        <label>
          {t(board.detailLabel)}
          <input {...field('detail')} placeholder={t(board.detailPlaceholder)} maxLength={200} />
        </label>
        <label>
          {t('{label} (₹, optional)', { label: t(board.valueLabel) })}
          <input {...field('value')} inputMode="decimal" placeholder="0" />
        </label>
        {key === 'deals' && (
          <label>
            {t('Expected to close (optional)')}
            <input {...field('closeOn')} type="date" />
          </label>
        )}
        <label className="tracker-wide">
          {t('Link (optional)')}
          <input {...field('link')} type="url" placeholder={t('https://… the posting, the CV, the proposal')} />
        </label>
        <label className="tracker-wide">
          {t('Notes')}
          <textarea {...field('notes')} rows={3} />
        </label>
      </div>
      <div className="row">
        <button className="primary small-btn" onClick={() => void saveDetails()} disabled={busy || !dirty || !draft.title.trim()}>
          {t('Save details')}
        </button>
        {item.link && (
          <a className="ghost small-btn link-btn" href={item.link} target="_blank" rel="noopener noreferrer">
            {t('Open link')}
          </a>
        )}
      </div>

      <span className="label-text">{t('History')}</span>
      <ul className="plain tracker-history">
        {[
          ...item.events.map((e) => ({ at: e.at, text: t(stageOf(key, e.to)?.label ?? e.to), planId: null })),
          ...past.map((p) => ({
            at: p.dueAt,
            text: p.status === 'cancelled' ? t('{title} (cancelled)', { title: p.title }) : p.title,
            planId: p.id,
          })),
        ]
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((h, i) => (
            <li key={i}>
              <span className="muted">{dayLabel(h.at)}</span> ·{' '}
              {h.planId ? (
                <button className="plan-link" onClick={() => openPlan(h.planId)}>
                  {h.text}
                </button>
              ) : (
                h.text
              )}
            </li>
          ))}
      </ul>

      <div className="row">
        <button className="link small danger-text" onClick={() => void remove()}>
          {t(WORDS[key].remove)}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
