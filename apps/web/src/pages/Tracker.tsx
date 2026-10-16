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
import { msg, rich, t } from '../lib/i18n.tsx'
import { dayLabel, formatDateTime, relativeDay } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { CommitmentSheet } from '../components/CommitmentSheet.tsx'
import { rupeesToPaise } from '../components/Owed.tsx'
import { errorText } from '../lib/errors.ts'

interface Detail extends TrackerItemDTO {
  events: { from: string | null; to: string; at: string }[]
  plans: { id: string; title: string; dueAt: string; status: string }[]
}

/** What each board is for, said once at the top. */
const INTRO: Record<BoardKey, string> = {
  jobs: msg('Every job you have applied to, or mean to: where each one stands and what to do next.'),
  hiring: msg('Everyone in the running: where each candidate is and who needs a next step.'),
  deals: msg('Every deal in play, from first lead to signed, with the next step on each.'),
}

/** One item of each board, said whole so Hindi can say it its own way. Shown with t(). */
const WORDS: Record<BoardKey, { sheet: string; remove: string; ask: string }> = {
  jobs: {
    sheet: msg('Application'),
    remove: msg('Delete this application'),
    ask: msg('Delete this application? Its history goes with it; plans made for it stay.'),
  },
  hiring: {
    sheet: msg('Candidate'),
    remove: msg('Delete this candidate'),
    ask: msg('Delete this candidate? Its history goes with it; plans made for it stay.'),
  },
  deals: {
    sheet: msg('Deal'),
    remove: msg('Delete this deal'),
    ask: msg('Delete this deal? Its history goes with it; plans made for it stay.'),
  },
}

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
      setError(errorText(err))
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
      setError(errorText(err))
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
        <h1 className="page-title">{t(board.label)}</h1>
        {items && (
          <span className="page-count">
            {closed.length
              ? t('{open} open · {closed} closed', { open: open.length, closed: closed.length })
              : t('{n} open', { n: open.length })}
          </span>
        )}
      </div>
      <p className="muted small">{t(INTRO[key])}</p>

      <form className="card tracker-add" onSubmit={(e) => void add(e)}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`${t(board.titleLabel)}, ${t(board.titlePlaceholder)}`}
          aria-label={t(board.titleLabel)}
          maxLength={160}
        />
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder={t('{label} (optional), {example}', {
            label: t(board.detailLabel),
            example: t(board.detailPlaceholder),
          })}
          aria-label={t(board.detailLabel)}
          maxLength={200}
        />
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label={t('Stage')}>
          {openStages.map((s) => (
            <option key={s.key} value={s.key}>
              {t(s.label)}
            </option>
          ))}
        </select>
        <button className="primary" type="submit" disabled={busy || !title.trim()}>
          {t('Add')}
        </button>
      </form>
      {error && <p className="error small">{error}</p>}

      {quiet.length > 0 && (
        <div className="tracker-quiet">
          <strong>
            {quiet.length === 1 ? t('One has gone quiet') : t('{n} have gone quiet', { n: quiet.length })}
          </strong>
          <span className="muted small"> {t('— nothing booked, and longer than usual at their stage.')}</span>
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
      ) : (
        <>
          <div className="tracker-columns" style={{ ['--cols' as string]: openStages.length }}>
            {openStages.map((s) => {
              const here = open.filter((i) => i.stage === s.key)
              return (
                <section key={s.key} className={`tracker-column${here.length === 0 ? ' is-empty' : ''}`}>
                  <h2 className="tracker-column-head">
                    {t(s.label)} <span className="muted">{here.length}</span>
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
              <summary>{t('Closed · {n}', { n: closed.length })}</summary>
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
        <Modal title={t(WORDS[key].sheet)} onClose={() => show(null)} closeOnBackdrop={false}>
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
          {stage?.closed ? `${t(stage.label)} · ${dayLabel(item.closedAt ?? item.stageChangedAt)}` : sinceLine(board, item)}
          {item.valuePaise ? ` · ${formatRupees(item.valuePaise)}` : ''}
        </span>
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

const NEXT_WHEN = [
  { label: msg('Tomorrow'), days: 1 },
  { label: msg('In 3 days'), days: 3 },
  { label: msg('Next week'), days: 7 },
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
  /** A plan for this item, open over it: the interview, the follow-up. */
  const [planOpen, setPlanOpen] = useState<string | null>(null)

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
      setError(errorText(err))
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
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function saveDetails() {
    const person = people.find((p) => p.name.toLowerCase() === draft.person.trim().toLowerCase())
    if (draft.person.trim() && !person) {
      setError(t('{name} is not in your People yet. Add them there first, then link them here.', { name: draft.person.trim() }))
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
      setError(errorText(err))
    } finally {
      setBusy(false)
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
  return (
    <div className="stack tight tracker-sheet">
      <div>
        <strong className="tracker-sheet-title">{item.title}</strong>
        {item.detail && <p className="muted small">{item.detail}</p>}
      </div>

      <span className="label-text">{t('Stage')}</span>
      <div className="chips tracker-stages" role="group" aria-label={t('Stage')}>
        {board.stages.map((s) => (
          <button
            key={s.key}
            className={`chip${item.stage === s.key ? ' selected' : ''}${s.closed ? ` is-${s.closed}` : ''}`}
            onClick={() => item.stage !== s.key && void patch({ stage: s.key })}
            disabled={busy}
            aria-pressed={item.stage === s.key}
          >
            {t(s.label)}
          </button>
        ))}
      </div>
      <p className="muted small">{sinceLine(key, item)}.</p>

      <span className="label-text">{t('Next step')}</span>
      {upcoming.length > 0 ? (
        <ul className="plain tracker-plans">
          {upcoming.map((p) => (
            <li key={p.id}>
              <button className="plan-link" onClick={() => setPlanOpen(p.id)}>
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
          {key === 'hiring' ? t('Saved as a person') : t('Who you deal with')}
          <input {...field('person')} list="tracker-people" placeholder={t('A name from People')} />
        </label>
        <label>
          {t('{label} (₹, optional)', { label: t(board.valueLabel) })}
          <input {...field('value')} inputMode="decimal" placeholder="0" />
        </label>
        <label className="tracker-wide">
          {t('Link (optional)')}
          <input {...field('link')} type="url" placeholder={t('https://… the posting, the CV, the proposal')} />
        </label>
        <label className="tracker-wide">
          {t('Notes')}
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
                <button className="plan-link" onClick={() => setPlanOpen(h.planId)}>
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
      {planOpen && (
        <CommitmentSheet
          key={planOpen}
          commitmentId={planOpen}
          onClose={() => setPlanOpen(null)}
          onChanged={() => {
            void load()
            onChanged()
          }}
          onOpenOther={(pid) => setPlanOpen(pid)}
        />
      )}
    </div>
  )
}
