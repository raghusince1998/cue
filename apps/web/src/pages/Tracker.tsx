import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BOARDS,
  formatRupees,
  isOpenStage,
  stageOf,
  type BoardKey,
  type TrackerItemDTO,
} from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange, useOnChange } from '../lib/changes.ts'
import { dayLabel, formatDateTime, relativeDay } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { rupeesToPaise } from '../components/Owed.tsx'

interface Detail extends TrackerItemDTO {
  events: { from: string | null; to: string; at: string }[]
  plans: { id: string; title: string; dueAt: string; status: string }[]
}

/** What each board is for, said once at the top. */
const INTRO: Record<BoardKey, string> = {
  jobs: 'Every job you have applied to, or mean to: where each one stands and what to do next.',
  hiring: 'Everyone in the running: where each candidate is and who needs a next step.',
  deals: 'Every deal in play, from first lead to signed, with the next step on each.',
}

/** "Applied 9 days ago", "Interviewing since yesterday". */
function sinceLine(board: BoardKey, item: TrackerItemDTO): string {
  const stage = stageOf(board, item.stage)?.label ?? item.stage
  const when = relativeDay(item.stageChangedAt)
  return when === 'today' ? `${stage} today` : `${stage} ${when}`
}

/** The next open stage, for one-tap moving along. */
function nextStage(board: BoardKey, stage: string) {
  const open = BOARDS[board].stages.filter((s) => !s.closed)
  const i = open.findIndex((s) => s.key === stage)
  return i >= 0 && i < open.length - 1 ? open[i + 1]! : null
}

/**
 * A tracker: job applications, candidates or deals, by stage. Each card says
 * how long it has been where it is and what is next; one gone quiet says so.
 */
export default function Tracker({ board: key }: { board: BoardKey }) {
  const board = BOARDS[key]
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<TrackerItemDTO[] | null>(null)
  const [people, setPeople] = useState<{ id: string; name: string }[]>([])
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [stage, setStage] = useState(board.startStage)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openId = params.get('item')

  const load = useCallback(async () => {
    try {
      setItems(await api<TrackerItemDTO[]>(`/trackers/${key}`))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [key])
  useEffect(() => {
    void load()
  }, [load])
  useOnChange(() => void load())
  useEffect(() => {
    void api<{ id: string; name: string }[]>('/contacts')
      .then((r) => setPeople(r.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => undefined)
  }, [])

  const open = useMemo(() => (items ?? []).filter((i) => isOpenStage(key, i.stage)), [items, key])
  const closed = useMemo(() => (items ?? []).filter((i) => !isOpenStage(key, i.stage)), [items, key])
  const quiet = open.filter((i) => i.quietDays !== null)
  const openStages = board.stages.filter((s) => !s.closed)

  const show = (id: string | null) => {
    if (id) params.set('item', id)
    else params.delete('item')
    setParams(params, { replace: !id })
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api(`/trackers/${key}`, { method: 'POST', body: { title, detail: detail || null, stage } })
      setTitle('')
      setDetail('')
      await load()
      announceChange()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function move(item: TrackerItemDTO, to: string) {
    await api(`/tracker-items/${item.id}`, { method: 'PATCH', body: { stage: to } })
    await load()
    announceChange()
  }

  return (
    <div className="stack tracker-page">
      <div className="page-head">
        <h1 className="page-title">{board.label}</h1>
        {items && (
          <span className="page-count">
            {open.length} open{closed.length ? ` · ${closed.length} closed` : ''}
          </span>
        )}
      </div>
      <p className="muted small">{INTRO[key]}</p>

      <form className="card tracker-add" onSubmit={(e) => void add(e)}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`${board.titleLabel}, ${board.titlePlaceholder}`}
          aria-label={board.titleLabel}
          maxLength={160}
        />
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder={`${board.detailLabel} (optional), ${board.detailPlaceholder}`}
          aria-label={board.detailLabel}
          maxLength={200}
        />
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
          {openStages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="primary" type="submit" disabled={busy || !title.trim()}>
          Add
        </button>
      </form>
      {error && <p className="error small">{error}</p>}

      {quiet.length > 0 && (
        <div className="tracker-quiet">
          <strong>
            {quiet.length === 1 ? 'One has gone quiet' : `${quiet.length} have gone quiet`}
          </strong>
          <span className="muted small"> — nothing booked, and longer than usual at their stage.</span>
        </div>
      )}

      {!items ? (
        <div className="boot">
          <span className="spinner" />
        </div>
      ) : items.length === 0 ? (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#128203;
          </span>
          <h3>Nothing tracked yet</h3>
          <p>
            Add one above, or type it in the box on Today:{' '}
            <strong>
              {key === 'jobs'
                ? 'applied to Infosys for data analyst'
                : key === 'hiring'
                  ? 'candidate Priya Nair for product designer'
                  : 'new lead: Tata Motors for 50 laptops'}
            </strong>
            .
          </p>
        </div>
      ) : (
        <>
          <div className="tracker-columns" style={{ ['--cols' as string]: openStages.length }}>
            {openStages.map((s) => {
              const here = open.filter((i) => i.stage === s.key)
              return (
                <section key={s.key} className={`tracker-column${here.length === 0 ? ' is-empty' : ''}`}>
                  <h2 className="tracker-column-head">
                    {s.label} <span className="muted">{here.length}</span>
                  </h2>
                  {here.map((i) => (
                    <TrackerCard key={i.id} board={key} item={i} onOpen={() => show(i.id)} onMove={(to) => void move(i, to)} />
                  ))}
                </section>
              )
            })}
          </div>

          {closed.length > 0 && (
            <details className="tracker-closed">
              <summary>Closed · {closed.length}</summary>
              <div className="stack tight">
                {closed.map((i) => (
                  <TrackerCard key={i.id} board={key} item={i} onOpen={() => show(i.id)} />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {openId && (
        <Modal title={board.noun[0]!.toUpperCase() + board.noun.slice(1)} onClose={() => show(null)} closeOnBackdrop={false}>
          <ItemSheet
            id={openId}
            board={key}
            people={people}
            onChanged={() => void load()}
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
        <span className="tracker-card-meta">
          {stage?.closed ? `${stage.label} · ${dayLabel(item.closedAt ?? item.stageChangedAt)}` : sinceLine(board, item)}
          {item.valuePaise ? ` · ${formatRupees(item.valuePaise)}` : ''}
        </span>
        {item.next ? (
          <span className="tracker-card-next">Next: {item.next.title} · {formatDateTime(item.next.dueAt)}</span>
        ) : (
          item.quietDays !== null && <span className="tracker-card-quiet">Quiet for {item.quietDays} days — what is next?</span>
        )}
      </button>
      {forward && (
        <button className="link small tracker-forward" onClick={() => onMove!(forward.key)}>
          Move to {forward.label} →
        </button>
      )}
    </article>
  )
}

const NEXT_WHEN = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
]

/** One item: where it stands, what is next, and how it got here. */
function ItemSheet({
  id,
  board: key,
  people,
  onChanged,
  onDeleted,
}: {
  id: string
  board: BoardKey
  people: { id: string; name: string }[]
  onChanged: () => void
  onDeleted: () => void
}) {
  const board = BOARDS[key]
  const [item, setItem] = useState<Detail | null>(null)
  const [draft, setDraft] = useState({ title: '', detail: '', person: '', link: '', value: '', notes: '' })
  const [dirty, setDirty] = useState(false)
  const [nextText, setNextText] = useState('')
  const [nextAt, setNextAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api<Detail>(`/tracker-items/${id}`)
      setItem(d)
      setDraft({
        title: d.title,
        detail: d.detail ?? '',
        person: d.contactName ?? '',
        link: d.link ?? '',
        value: d.valuePaise ? String(d.valuePaise / 100) : '',
        notes: d.notes ?? '',
      })
      setDirty(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [id])
  useEffect(() => {
    void load()
  }, [load])

  const field = (k: keyof typeof draft) => ({
    value: draft[k],
    onChange: (e: { target: { value: string } }) => {
      setDraft((d) => ({ ...d, [k]: e.target.value }))
      setDirty(true)
    },
  })

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await api(`/tracker-items/${id}`, { method: 'PATCH', body })
      await load()
      onChanged()
      announceChange()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveDetails() {
    const person = people.find((p) => p.name.toLowerCase() === draft.person.trim().toLowerCase())
    if (draft.person.trim() && !person) {
      setError(`${draft.person.trim()} is not in your People yet. Add them there first, then link them here.`)
      return
    }
    await patch({
      title: draft.title,
      detail: draft.detail || null,
      contactId: person?.id ?? null,
      link: draft.link.trim() || null,
      valuePaise: draft.value.trim() ? rupeesToPaise(draft.value) : null,
      notes: draft.notes || null,
    })
  }

  async function addNext(days: number | null) {
    if (!nextText.trim()) {
      setError('What is the next step? e.g. Send a thank-you note')
      return
    }
    let due: Date
    if (days === null) {
      if (!nextAt) {
        setError('Pick a day and time.')
        return
      }
      due = new Date(nextAt)
    } else {
      due = new Date()
      due.setDate(due.getDate() + days)
      due.setHours(10, 0, 0, 0)
    }
    setBusy(true)
    setError(null)
    try {
      await api('/commitments', {
        method: 'POST',
        body: {
          title: nextText.trim(),
          kind: /interview|meeting|call|meet/i.test(nextText) ? 'meeting' : 'task',
          dueAt: due.toISOString(),
          trackerItemId: id,
          contactId: item?.contactId ?? null,
          allowConflict: true,
        },
      })
      setNextText('')
      setNextAt('')
      await load()
      onChanged()
      announceChange()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Delete this ${board.noun}? Its history goes with it; plans made for it stay.`)) return
    await api(`/tracker-items/${id}`, { method: 'DELETE' })
    onChanged()
    announceChange()
    onDeleted()
  }

  if (!item) return error ? <p className="error">{error}</p> : <div className="boot"><span className="spinner" /></div>

  const upcoming = item.plans.filter((p) => p.status === 'pending')
  const past = item.plans.filter((p) => p.status !== 'pending')
  return (
    <div className="stack tight tracker-sheet">
      <div>
        <strong className="tracker-sheet-title">{item.title}</strong>
        {item.detail && <p className="muted small">{item.detail}</p>}
      </div>

      <span className="label-text">Stage</span>
      <div className="chips tracker-stages" role="group" aria-label="Stage">
        {board.stages.map((s) => (
          <button
            key={s.key}
            className={`chip${item.stage === s.key ? ' selected' : ''}${s.closed ? ` is-${s.closed}` : ''}`}
            onClick={() => item.stage !== s.key && void patch({ stage: s.key })}
            disabled={busy}
            aria-pressed={item.stage === s.key}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="muted small">{sinceLine(key, item)}.</p>

      <span className="label-text">Next step</span>
      {upcoming.length > 0 ? (
        <ul className="plain tracker-plans">
          {upcoming.map((p) => (
            <li key={p.id}>
              {p.title} <span className="muted">· {formatDateTime(p.dueAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        isOpenStage(key, item.stage) && <p className="muted small">Nothing booked. What happens next, and when?</p>
      )}
      {isOpenStage(key, item.stage) && (
        <div className="stack tight tracker-next">
          <input
            value={nextText}
            onChange={(e) => setNextText(e.target.value)}
            placeholder={
              key === 'jobs'
                ? 'e.g. Follow up with the recruiter'
                : key === 'hiring'
                  ? 'e.g. Second interview with the team'
                  : 'e.g. Send the revised quote'
            }
            aria-label="Next step"
          />
          <div className="row">
            {NEXT_WHEN.map((w) => (
              <button key={w.label} className="ghost small-btn" onClick={() => void addNext(w.days)} disabled={busy}>
                {w.label}
              </button>
            ))}
            <input
              type="datetime-local"
              value={nextAt}
              onChange={(e) => setNextAt(e.target.value)}
              aria-label="Or pick a time"
              className="tracker-next-at"
            />
            {nextAt && (
              <button className="primary small-btn" onClick={() => void addNext(null)} disabled={busy}>
                Book it
              </button>
            )}
          </div>
        </div>
      )}

      <span className="label-text">Details</span>
      <div className="tracker-fields">
        <label>
          {board.titleLabel}
          <input {...field('title')} maxLength={160} />
        </label>
        <label>
          {board.detailLabel}
          <input {...field('detail')} placeholder={board.detailPlaceholder} maxLength={200} />
        </label>
        <label>
          {key === 'hiring' ? 'Saved as a person' : 'Who you deal with'}
          <input {...field('person')} list="tracker-people" placeholder="A name from People" />
        </label>
        <label>
          {board.valueLabel} (₹, optional)
          <input {...field('value')} inputMode="decimal" placeholder="0" />
        </label>
        <label className="tracker-wide">
          Link (optional)
          <input {...field('link')} type="url" placeholder="https://… the posting, the CV, the proposal" />
        </label>
        <label className="tracker-wide">
          Notes
          <textarea {...field('notes')} rows={3} />
        </label>
      </div>
      <datalist id="tracker-people">
        {people.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      <div className="row">
        <button className="primary small-btn" onClick={() => void saveDetails()} disabled={busy || !dirty || !draft.title.trim()}>
          Save details
        </button>
        {item.link && (
          <a className="ghost small-btn link-btn" href={item.link} target="_blank" rel="noopener noreferrer">
            Open link
          </a>
        )}
      </div>

      <span className="label-text">History</span>
      <ul className="plain tracker-history">
        {[
          ...item.events.map((e) => ({ at: e.at, text: stageOf(key, e.to)?.label ?? e.to })),
          ...past.map((p) => ({ at: p.dueAt, text: `${p.title}${p.status === 'cancelled' ? ' (cancelled)' : ''}` })),
        ]
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((h, i) => (
            <li key={i}>
              <span className="muted">{dayLabel(h.at)}</span> · {h.text}
            </li>
          ))}
      </ul>

      <div className="row">
        <button className="link small danger-text" onClick={() => void remove()}>
          Delete this {board.noun}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
