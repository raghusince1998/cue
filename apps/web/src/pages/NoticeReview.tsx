import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  EXAMS,
  EXAM_STEPS,
  NOTICE_KINDS,
  examStages,
  noticeSummary,
  type ExamStep,
  type NoticeDTO,
  type NoticeDate,
  type NoticeProposal,
} from '@cue/shared'
import { api } from '../lib/api.ts'
import { dayLabel, formatDateTime } from '../lib/time.ts'

type Status = 'pending' | 'unmatched' | 'approved' | 'dismissed'

interface Source {
  id: string
  name: string
  url: string
  checkedAt: string | null
  ok: boolean | null
  message: string | null
}

const TABS: { key: Status; label: string }[] = [
  { key: 'pending', label: 'To review' },
  { key: 'unmatched', label: 'No exam found' },
  { key: 'approved', label: 'Approved' },
  { key: 'dismissed', label: 'Dismissed' },
]

const BOARDS = ['RSSB', 'RPSC', 'SSC', 'UPSC', 'RRB', 'IBPS', 'SBI', 'RBI', 'NTA']

/**
 * Official notices, checked before anyone is told. Each one found on a
 * board's page, or added by hand, comes with what Cue read from it — which
 * exam, which dates. Open the notice, put right what is wrong, then approve:
 * everyone tracking that exam gets the dates as plans and one notification.
 */
export default function NoticeReview() {
  const [status, setStatus] = useState<Status>('pending')
  const [notices, setNotices] = useState<NoticeDTO[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [sources, setSources] = useState<Source[]>([])
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api<{ notices: NoticeDTO[]; counts: Record<string, number>; sources: Source[] }>('/admin/notices', { query: { status } })
      setNotices(res.notices)
      setCounts(res.counts)
      setSources(res.sources)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [status])
  useEffect(() => {
    void load()
  }, [load])

  async function checkNow() {
    setChecking(true)
    setMessage(null)
    try {
      const res = await api<{ runs: { source: string; ok: boolean; message: string; added: number }[] }>('/admin/notices/check', { method: 'POST' })
      const added = res.runs.reduce((s, r) => s + r.added, 0)
      setMessage(added > 0 ? `${added} new notice${added === 1 ? '' : 's'} to look at.` : 'Read every page: nothing new.')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="stack notice-review">
      <div className="page-head">
        <h1 className="page-title">Official notices</h1>
        <span className="page-count">{counts.pending ?? 0} to review</span>
      </div>
      <p className="muted small">
        Found on the boards&rsquo; own pages, or added by hand. Nobody hears of one until it is approved here: open
        the notice, check the exam and every date against it, then approve. Everyone tracking that exam gets the dates
        and one notification, with the notice&rsquo;s link.
      </p>

      <section className="card stack tight">
        <span className="label-text">Pages watched</span>
        <ul className="plain notice-sources">
          {sources.map((s) => (
            <li key={s.id}>
              <span className={`notice-dot${s.ok === false ? ' is-bad' : s.ok ? ' is-good' : ''}`} aria-hidden />
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.name}
              </a>
              <span className="muted small">
                {' '}
                · {s.checkedAt ? `${formatDateTime(s.checkedAt)}: ${s.message}` : 'not read yet'}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          UPSC and NTA&rsquo;s exam sites refuse robots, and SSC, IBPS and RRB build their pages in the browser: add
          their notices by hand below. Board emails reach people directly.
        </p>
        <div className="row">
          <button className="ghost small-btn" onClick={() => void checkNow()} disabled={checking}>
            {checking ? 'Reading the pages…' : 'Check the pages now'}
          </button>
        </div>
        {message && <p className="muted small">{message}</p>}
      </section>

      <AddNotice
        onAdded={() => {
          setStatus('pending')
          void load()
        }}
      />

      <div className="viewswitch" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} className={status === t.key ? 'selected' : ''} onClick={() => setStatus(t.key)} role="tab" aria-selected={status === t.key}>
            {t.label}
            {counts[t.key] ? ` · ${counts[t.key]}` : ''}
          </button>
        ))}
      </div>
      {error && <p className="error small">{error}</p>}

      {!notices ? (
        <div className="boot">
          <span className="spinner" />
        </div>
      ) : notices.length === 0 ? (
        <p className="muted">{status === 'pending' ? 'Nothing to review.' : 'None.'}</p>
      ) : (
        <div className="stack">
          {notices.map((n) => (
            <NoticeCard key={n.id} notice={n} onDone={() => void load()} />
          ))}
        </div>
      )}
    </div>
  )
}

function AddNotice({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [board, setBoard] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/admin/notices', { method: 'POST', body: { url: url.trim(), title: title.trim(), board: board || null, text: text.trim() || null } })
      setUrl('')
      setTitle('')
      setText('')
      setOpen(false)
      onAdded()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="row">
        <button className="ghost" onClick={() => setOpen(true)}>
          Add a notice by hand
        </button>
      </div>
    )
  }
  return (
    <form className="card stack tight" onSubmit={(e) => void add(e)}>
      <div className="tracker-fields">
        <label className="tracker-wide">
          The notice&rsquo;s link
          <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" placeholder="https://… the official notice" required />
        </label>
        <label className="tracker-wide">
          Its title, as the board gives it
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Admit card for CGL 2026 Tier-I" required minLength={5} />
        </label>
        <label>
          Board
          <select value={board} onChange={(e) => setBoard(e.target.value)}>
            <option value="">—</option>
            {BOARDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="tracker-wide">
          Its text, if you can copy it (optional: for the dates in it)
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
        </label>
      </div>
      <div className="row">
        <button className="primary small-btn" type="submit" disabled={busy || !url.trim() || title.trim().length < 5}>
          Add for review
        </button>
        <button className="ghost small-btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </form>
  )
}

const blankDate = (on = ''): NoticeDate => ({ step: 'exam', on, at: null, round: null, note: null })

function NoticeCard({ notice, onDone }: { notice: NoticeDTO; onDone: () => void }) {
  const reviewing = notice.status === 'pending' || notice.status === 'unmatched'
  const [proposals, setProposals] = useState<NoticeProposal[]>(notice.proposals)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const change = (i: number, p: Partial<NoticeProposal>) => setProposals((list) => list.map((x, k) => (k === i ? { ...x, ...p } : x)))
  const changeDate = (i: number, j: number, d: Partial<NoticeDate>) =>
    change(i, { dates: proposals[i]!.dates.map((x, k) => (k === j ? { ...x, ...d } : x)) })

  const ready = proposals.length > 0 && proposals.every((p) => p.examKey && p.dates.every((d) => d.on))

  async function approve() {
    const lines = proposals.map((p) => `• ${noticeSummary(p)}`).join('\n')
    if (!window.confirm(`Tell everyone tracking it?\n\n${lines}`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ told: number }>(`/admin/notices/${notice.id}/approve`, { method: 'POST', body: { proposals } })
      setResult(res.told === 0 ? 'Approved. Nobody tracks that exam yet; it is on its page for those who will.' : `Approved: ${res.told} ${res.told === 1 ? 'person' : 'people'} told.`)
      setTimeout(onDone, 1500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function dismiss() {
    setBusy(true)
    try {
      await api(`/admin/notices/${notice.id}/dismiss`, { method: 'POST' })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <article className="card stack tight notice-card">
      <div>
        <strong>{notice.title}</strong>
        <p className="muted small">
          {notice.sourceName} · found {dayLabel(notice.foundAt)} ·{' '}
          <a href={notice.url} target="_blank" rel="noopener noreferrer">
            Open the notice
          </a>
          {notice.status === 'approved' && ` · told ${notice.told}`}
        </p>
      </div>

      {notice.hints.length > 0 && reviewing && (
        <div className="stack tight">
          <span className="muted small">Dates in its PDF — tap one to add it to the first exam below:</span>
          <div className="chips">
            {notice.hints.map((h) => (
              <button
                key={h}
                className="chip"
                onClick={() =>
                  proposals[0]
                    ? change(0, { dates: [...proposals[0].dates, blankDate(h)] })
                    : setProposals([{ examKey: '', cycle: null, kind: 'schedule', dates: [blankDate(h)] }])
                }
              >
                {dayLabel(h)}
              </button>
            ))}
          </div>
        </div>
      )}

      {reviewing ? (
        <>
          {proposals.map((p, i) => {
            const rounds = examStages(p.examKey || null).filter((s) => !s.closed && s.key !== 'to_apply' && s.key !== 'applied')
            return (
              <div key={i} className="notice-proposal stack tight">
                <div className="tracker-fields">
                  <label>
                    Exam
                    <select value={p.examKey} onChange={(e) => change(i, { examKey: e.target.value })}>
                      <option value="">Which exam?</option>
                      {EXAMS.map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Year or notice
                    <input value={p.cycle ?? ''} onChange={(e) => change(i, { cycle: e.target.value.trim() || null })} placeholder="2026 — empty for any" />
                  </label>
                  <label>
                    Kind
                    <select value={p.kind} onChange={(e) => change(i, { kind: e.target.value as NoticeProposal['kind'] })}>
                      {NOTICE_KINDS.map((k) => (
                        <option key={k.key} value={k.key}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {p.dates.map((d, j) => (
                  <div key={j} className="exam-date-add">
                    <select value={d.step} onChange={(e) => changeDate(i, j, { step: e.target.value as ExamStep })} aria-label="Which date">
                      {EXAM_STEPS.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    {rounds.length > 1 && (
                      <select value={d.round ?? ''} onChange={(e) => changeDate(i, j, { round: e.target.value || null })} aria-label="Round">
                        <option value="">Any round</option>
                        {rounds.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    )}
                    <input type="date" value={d.on} onChange={(e) => changeDate(i, j, { on: e.target.value })} aria-label="Day" />
                    <input type="time" value={d.at ?? ''} onChange={(e) => changeDate(i, j, { at: e.target.value || null })} aria-label="Time (optional)" />
                    {d.step === 'other' && (
                      <input value={d.note ?? ''} onChange={(e) => changeDate(i, j, { note: e.target.value || null })} placeholder="What it is" />
                    )}
                    <button className="link small" onClick={() => change(i, { dates: p.dates.filter((_, k) => k !== j) })}>
                      Remove
                    </button>
                  </div>
                ))}
                <div className="row">
                  <button className="link small" onClick={() => change(i, { dates: [...p.dates, blankDate()] })}>
                    + A date
                  </button>
                  <button className="link small" onClick={() => setProposals((list) => list.filter((_, k) => k !== i))}>
                    Not about this exam
                  </button>
                </div>
                {p.examKey && <p className="small notice-preview">They will be told: {noticeSummary(p)}</p>}
              </div>
            )
          })}
          <div className="row">
            <button
              className="link small"
              onClick={() => setProposals((list) => [...list, { examKey: '', cycle: null, kind: 'other', dates: [] }])}
            >
              + {proposals.length ? 'Another exam' : 'Which exam is it about?'}
            </button>
          </div>
          <div className="row">
            <button className="primary small-btn" onClick={() => void approve()} disabled={busy || !ready}>
              Approve and tell
            </button>
            <button className="ghost small-btn" onClick={() => void dismiss()} disabled={busy}>
              Dismiss
            </button>
          </div>
        </>
      ) : (
        notice.proposals.length > 0 && (
          <ul className="plain small">
            {notice.proposals.map((p, i) => (
              <li key={i}>{noticeSummary(p)}</li>
            ))}
          </ul>
        )
      )}
      {result && <p className="small notice-preview">{result}</p>}
      {error && <p className="error small">{error}</p>}
    </article>
  )
}
