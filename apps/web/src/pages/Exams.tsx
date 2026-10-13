import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CATEGORIES,
  EXAMS,
  EXAM_STEPS,
  examByKey,
  examLabel,
  examStage,
  examStages,
  isOpenExamStage,
  type AdmitCard,
  type ExamDTO,
  type ExamStep,
} from '@cue/shared'
import { ApiError, api, apiSendFile } from '../lib/api.ts'
import { announceChange, useOnChange } from '../lib/changes.ts'
import { dayLabel, formatDateTime, relativeDay } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'

/** The soonest date still to come, for a card's "Next:" line. */
function nextDate(exam: ExamDTO) {
  const now = Date.now() - 12 * 3_600_000
  return exam.dates.find((d) => d.status === 'pending' && new Date(d.dueAt).getTime() >= now) ?? null
}

/** "Applied 9 days ago", "CBT 1 since yesterday". */
function sinceLine(exam: ExamDTO): string {
  const stage = examStage(exam.examKey, exam.stage)?.label ?? exam.stage
  const when = relativeDay(exam.stageChangedAt)
  return when === 'today' ? `${stage} today` : `${stage} ${when}`
}

/** What the person read off a card, or typed, before it becomes the day. */
interface CardDraft {
  examId: string
  examKey: string
  examName: string
  round: string
  date: string
  reportingAt: string
  gateClosesAt: string
  startsAt: string
  endsAt: string
  rollNo: string
  registrationNo: string
  centreName: string
  centreAddress: string
  centreCity: string
}

const BLANK_CARD: CardDraft = {
  examId: '',
  examKey: '',
  examName: '',
  round: '',
  date: '',
  reportingAt: '',
  gateClosesAt: '',
  startsAt: '',
  endsAt: '',
  rollNo: '',
  registrationNo: '',
  centreName: '',
  centreAddress: '',
  centreCity: '',
}

/**
 * Exams: each form applied for, or to fill, with where it stands and its
 * dates as reminders. Nothing here signs in to a portal; the dates come from
 * the person and from the admit cards they hand over.
 */
export default function Exams() {
  const [params, setParams] = useSearchParams()
  const [exams, setExams] = useState<ExamDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<{ examId: string } | null>(null)
  const openId = params.get('exam')

  const load = useCallback(async () => {
    try {
      setExams(await api<ExamDTO[]>('/exams'))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useOnChange(() => void load())

  const open = useMemo(() => (exams ?? []).filter((x) => !x.closedAt), [exams])
  const closed = useMemo(() => (exams ?? []).filter((x) => x.closedAt), [exams])

  const show = (id: string | null) => {
    if (id) params.set('exam', id)
    else params.delete('exam')
    setParams(params, { replace: !id })
  }

  return (
    <div className="stack exams-page">
      <div className="page-head">
        <h1 className="page-title">Exams</h1>
        {exams && (
          <span className="page-count">
            {open.length} open{closed.length ? ` · ${closed.length} done` : ''}
          </span>
        )}
      </div>
      <p className="muted small">
        Every exam you have applied for, or mean to: where it stands, and each date — the last day to apply, the
        fee, the exam, the result — as a reminder. Cue never signs in to an exam portal; dates come from you, from
        your admit cards, and, with your email connected, from the boards' own emails.
      </p>

      {exams && (
        <AddExam key={exams.length === 0 ? 'first' : 'more'} startOpen={exams.length === 0} onAdded={() => void load()} onReadCard={() => setReading({ examId: '' })} />
      )}
      {error && <p className="error small">{error}</p>}

      {!exams ? (
        <div className="boot">
          <span className="spinner" />
        </div>
      ) : exams.length === 0 ? (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#128221;
          </span>
          <h3>No exams yet</h3>
          <p>
            Add one above, or type it in the box on Today: <strong>applied for RRB NTPC 2026, RRB Ajmer, reg no …</strong>{' '}
            or <strong>REET form last date 20 nov</strong>.
          </p>
        </div>
      ) : (
        <>
          <div className="exam-list">
            {open.map((x) => (
              <ExamCard key={x.id} exam={x} onOpen={() => show(x.id)} />
            ))}
          </div>
          {closed.length > 0 && (
            <details className="tracker-closed">
              <summary>Done · {closed.length}</summary>
              <div className="exam-list">
                {closed.map((x) => (
                  <ExamCard key={x.id} exam={x} onOpen={() => show(x.id)} />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {openId && (
        <Modal title="Exam" onClose={() => show(null)} closeOnBackdrop={false}>
          <ExamSheet
            id={openId}
            onChanged={() => void load()}
            onReadCard={() => setReading({ examId: openId })}
            onDeleted={() => {
              show(null)
              void load()
            }}
          />
        </Modal>
      )}

      {reading && (
        <Modal title="Read an admit card" onClose={() => setReading(null)} closeOnBackdrop={false}>
          <AdmitCardReader
            examId={reading.examId}
            exams={open}
            onDone={() => {
              setReading(null)
              void load()
            }}
          />
        </Modal>
      )}
    </div>
  )
}

function ExamCard({ exam, onOpen }: { exam: ExamDTO; onOpen: () => void }) {
  const next = nextDate(exam)
  const stage = examStage(exam.examKey, exam.stage)
  return (
    <article className="tracker-card exam-card">
      <button className="tracker-card-main" onClick={onOpen}>
        <span className="tracker-card-title">{examLabel(exam)}</span>
        {(exam.region || exam.centreCity) && (
          <span className="tracker-card-detail">
            {[exam.region, exam.centreCity ? `Centre: ${exam.centreName ?? exam.centreCity}` : null].filter(Boolean).join(' · ')}
          </span>
        )}
        <span className="tracker-card-meta">
          {stage?.closed ? `${stage.label} · ${dayLabel(exam.closedAt ?? exam.stageChangedAt)}` : sinceLine(exam)}
          {exam.rollNo ? ` · Roll no ${exam.rollNo}` : ''}
        </span>
        {next && (
          <span className="tracker-card-next">
            Next: {next.title} · {formatDateTime(next.dueAt)}
          </span>
        )}
      </button>
    </article>
  )
}

/** One line in: which exam, and the one or two dates that matter first. */
function AddExam({ startOpen, onAdded, onReadCard }: { startOpen: boolean; onAdded: () => void; onReadCard: () => void }) {
  // Folded once there are exams to see, so on a phone the list is not below a screenful of form.
  const [open, setOpen] = useState(startOpen)
  const [name, setName] = useState('')
  const [cycle, setCycle] = useState('')
  const [region, setRegion] = useState('')
  const [registrationNo, setRegistrationNo] = useState('')
  const [stage, setStage] = useState<'applied' | 'to_apply'>('applied')
  const [applyBy, setApplyBy] = useState('')
  const [examOn, setExamOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const catalog = EXAMS.find((x) => x.name.toLowerCase() === name.trim().toLowerCase()) ?? null

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const dates = [
        stage === 'to_apply' && applyBy ? { step: 'apply_by', on: applyBy } : null,
        examOn ? { step: 'exam', on: examOn } : null,
      ].filter(Boolean)
      await api('/exams', {
        method: 'POST',
        body: {
          examKey: catalog?.key ?? null,
          name: catalog?.name ?? name.trim(),
          cycle: cycle.trim() || null,
          region: region.trim() || null,
          registrationNo: registrationNo.trim() || null,
          stage,
          dates,
        },
      })
      setName('')
      setCycle('')
      setRegion('')
      setRegistrationNo('')
      setApplyBy('')
      setExamOn('')
      onAdded()
      announceChange()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="row exam-add">
        <button className="primary" onClick={() => setOpen(true)}>
          Add an exam
        </button>
        <button className="ghost" onClick={onReadCard}>
          Read an admit card
        </button>
      </div>
    )
  }

  return (
    <form className="card stack tight exam-add" onSubmit={(e) => void add(e)}>
      <div className="tracker-fields">
        <label className="tracker-wide">
          Exam
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            list="exam-catalog"
            placeholder="Start typing: RRB NTPC, SSC CGL, REET, Patwari…"
            maxLength={120}
          />
        </label>
        <label>
          Year or notice (optional)
          <input value={cycle} onChange={(e) => setCycle(e.target.value)} placeholder="2026, or CEN 05/2026" maxLength={40} />
        </label>
        <label>
          {catalog?.regions ? 'Board (optional)' : 'Region or post (optional)'}
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            list={catalog?.regions ? 'exam-regions' : undefined}
            placeholder={catalog?.regions ? 'RRB Ajmer' : 'e.g. Northern region'}
            maxLength={80}
          />
        </label>
        <label>
          Where it stands
          <select value={stage} onChange={(e) => setStage(e.target.value as 'applied' | 'to_apply')}>
            <option value="applied">Applied</option>
            <option value="to_apply">Form to fill</option>
          </select>
        </label>
        {stage === 'applied' ? (
          <label>
            Registration number (optional)
            <input value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} maxLength={40} />
          </label>
        ) : (
          <label>
            Last date to apply
            <input type="date" value={applyBy} onChange={(e) => setApplyBy(e.target.value)} />
          </label>
        )}
        <label>
          Exam date, if announced
          <input type="date" value={examOn} onChange={(e) => setExamOn(e.target.value)} />
        </label>
      </div>
      <datalist id="exam-catalog">
        {EXAMS.map((x) => (
          <option key={x.key} value={x.name} />
        ))}
      </datalist>
      {catalog?.regions && (
        <datalist id="exam-regions">
          {catalog.regions.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      )}
      <div className="row">
        <button className="primary" type="submit" disabled={busy || !name.trim()}>
          Add exam
        </button>
        <button className="ghost" type="button" onClick={onReadCard}>
          Read an admit card
        </button>
      </div>
      {catalog && (
        <p className="muted small">
          {catalog.body}
          {catalog.site && (
            <>
              {' · '}
              <a href={catalog.site} target="_blank" rel="noopener noreferrer">
                official site
              </a>
            </>
          )}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </form>
  )
}

/** One exam: where it stands, its dates, its numbers, and its centre. */
function ExamSheet({
  id,
  onChanged,
  onReadCard,
  onDeleted,
}: {
  id: string
  onChanged: () => void
  onReadCard: () => void
  onDeleted: () => void
}) {
  const [exam, setExam] = useState<ExamDTO | null>(null)
  const [draft, setDraft] = useState({ cycle: '', region: '', registrationNo: '', rollNo: '', category: '', notes: '' })
  const [dirty, setDirty] = useState(false)
  const [step, setStep] = useState<ExamStep>('exam')
  const [round, setRound] = useState('')
  const [on, setOn] = useState('')
  const [at, setAt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const x = await api<ExamDTO>(`/exams/${id}`)
      setExam(x)
      setDraft({
        cycle: x.cycle ?? '',
        region: x.region ?? '',
        registrationNo: x.registrationNo ?? '',
        rollNo: x.rollNo ?? '',
        category: x.category ?? '',
        notes: x.notes ?? '',
      })
      setDirty(false)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [id])
  useEffect(() => {
    void load()
  }, [load])
  useOnChange(() => void load())

  const field = (k: keyof typeof draft) => ({
    value: draft[k],
    onChange: (e: { target: { value: string } }) => {
      setDraft((d) => ({ ...d, [k]: e.target.value }))
      setDirty(true)
    },
  })

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
      announceChange()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const patch = (body: Record<string, unknown>) => run(() => api(`/exams/${id}`, { method: 'PATCH', body }))

  async function moveTo(stage: string) {
    if (!exam || exam.stage === stage) return
    if (!isOpenExamStage(exam.examKey, stage) && exam.dates.some((d) => d.status === 'pending' && new Date(d.dueAt) > new Date())) {
      if (!window.confirm('Its dates still to come go too. Carry on?')) return
    }
    await patch({ stage })
  }

  async function addDate() {
    if (!on) {
      setError('Pick the day.')
      return
    }
    await run(() =>
      api(`/exams/${id}/dates`, {
        method: 'POST',
        body: { step, on, at: at || null, round: round || null, note: step === 'other' ? note || null : null },
      }),
    )
    setOn('')
    setAt('')
    setNote('')
  }

  async function remove() {
    if (!window.confirm('Delete this exam? Its dates still to come go with it.')) return
    await api(`/exams/${id}`, { method: 'DELETE' })
    onChanged()
    announceChange()
    onDeleted()
  }

  if (!exam) return error ? <p className="error">{error}</p> : <div className="boot"><span className="spinner" /></div>

  const catalog = examByKey(exam.examKey)
  const stages = examStages(exam.examKey)
  const rounds = stages.filter((s) => !s.closed && s.key !== 'to_apply' && s.key !== 'applied')
  const upcoming = exam.dates.filter((d) => d.status === 'pending')
  const past = exam.dates.filter((d) => d.status !== 'pending')
  const roundsMatter = step === 'exam' || step === 'admit_card' || step === 'result'

  return (
    <div className="stack tight tracker-sheet">
      <div>
        <strong className="tracker-sheet-title">{examLabel(exam)}</strong>
        <p className="muted small">
          {[catalog?.body, exam.region].filter(Boolean).join(' · ')}
          {catalog?.site && (
            <>
              {' · '}
              <a href={catalog.site} target="_blank" rel="noopener noreferrer">
                Official site
              </a>
            </>
          )}
          {catalog?.applyAt && (
            <>
              {' · '}
              <a href={catalog.applyAt} target="_blank" rel="noopener noreferrer">
                Apply / log in
              </a>
            </>
          )}
        </p>
      </div>

      <span className="label-text">Where it stands</span>
      <div className="chips tracker-stages" role="group" aria-label="Stage">
        {stages.map((s) => (
          <button
            key={s.key}
            className={`chip${exam.stage === s.key ? ' selected' : ''}${s.closed ? ` is-${s.closed}` : ''}`}
            onClick={() => void moveTo(s.key)}
            disabled={busy}
            aria-pressed={exam.stage === s.key}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="muted small">{sinceLine(exam)}.</p>

      <span className="label-text">Dates</span>
      {upcoming.length > 0 ? (
        <ul className="plain tracker-plans">
          {upcoming.map((d) => (
            <li key={d.id}>
              {d.title} <span className="muted">· {formatDateTime(d.dueAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        isOpenExamStage(exam.examKey, exam.stage) && <p className="muted small">No dates yet. Add one as soon as it is announced.</p>
      )}
      {isOpenExamStage(exam.examKey, exam.stage) && (
        <div className="exam-date-add">
          <select value={step} onChange={(e) => setStep(e.target.value as ExamStep)} aria-label="Which date">
            {EXAM_STEPS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {roundsMatter && rounds.length > 1 && (
            <select value={round} onChange={(e) => setRound(e.target.value)} aria-label="Round">
              <option value="">Which round?</option>
              {rounds.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          {step === 'other' && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is it?" maxLength={120} />}
          <input type="date" value={on} onChange={(e) => setOn(e.target.value)} aria-label="Day" />
          <input type="time" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Time (optional)" />
          <button className="primary small-btn" onClick={() => void addDate()} disabled={busy || !on}>
            Add date
          </button>
        </div>
      )}

      {(exam.notices ?? []).length > 0 && (
        <>
          <span className="label-text">Official notices</span>
          <ul className="plain tracker-plans">
            {exam.notices!.map((n) => (
              <li key={n.id}>
                {n.summary.split(': ').slice(1).join(': ')}{' '}
                <span className="muted">· {dayLabel(n.reviewedAt)} · </span>
                <a href={n.url} target="_blank" rel="noopener noreferrer">
                  the notice
                </a>
              </li>
            ))}
          </ul>
        </>
      )}

      <Results exam={exam} onChecked={() => void load()} />

      <span className="label-text">Exam day</span>
      {exam.centreName || exam.centreAddress ? (
        <p className="small">
          {[exam.centreName, exam.centreAddress].filter(Boolean).join(', ')}
          {exam.rollNo ? <span className="muted"> · Roll no {exam.rollNo}</span> : null}
        </p>
      ) : (
        <p className="muted small">When the admit card is out, read it here: the day is planned from it — when to report, what to carry, and the journey if the centre is in another city.</p>
      )}
      <div className="row">
        <button className="ghost small-btn" onClick={onReadCard}>
          Read the admit card
        </button>
      </div>

      <span className="label-text">Details</span>
      <div className="tracker-fields">
        <label>
          Year or notice
          <input {...field('cycle')} placeholder="2026, or CEN 05/2026" maxLength={40} />
        </label>
        <label>
          {catalog?.regions ? 'Board' : 'Region or post'}
          <input {...field('region')} list={catalog?.regions ? 'exam-sheet-regions' : undefined} maxLength={80} />
        </label>
        <label>
          Registration number
          <input {...field('registrationNo')} maxLength={40} />
        </label>
        <label>
          Roll number
          <input {...field('rollNo')} maxLength={40} />
        </label>
        <label>
          Category (for cut-offs)
          <select {...field('category')}>
            <option value="">Not said</option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="tracker-wide">
          Notes
          <textarea {...field('notes')} rows={2} placeholder="Post preferences, anything to remember" />
        </label>
      </div>
      {catalog?.regions && (
        <datalist id="exam-sheet-regions">
          {catalog.regions.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      )}
      <p className="muted small">Cue never asks for a portal password, OTP or date of birth. Keep those to yourself.</p>
      <div className="row">
        <button
          className="primary small-btn"
          disabled={busy || !dirty}
          onClick={() =>
            void patch({
              cycle: draft.cycle.trim() || null,
              region: draft.region.trim() || null,
              registrationNo: draft.registrationNo.trim() || null,
              rollNo: draft.rollNo.trim() || null,
              notes: draft.notes.trim() || null,
              category: draft.category || null,
            })
          }
        >
          Save details
        </button>
      </div>

      {past.length > 0 && (
        <>
          <span className="label-text">Done</span>
          <ul className="plain tracker-history">
            {past.map((d) => (
              <li key={d.id}>
                <span className="muted">{dayLabel(d.dueAt)}</span> · {d.title}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="row">
        <button className="link small danger-text" onClick={() => void remove()}>
          Delete this exam
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

/**
 * An admit card, read and checked: a PDF chosen or text pasted, every field
 * shown to be put right, and only then made into the day. A card read wrong
 * should cost a correction here, not a missed gate.
 */
function AdmitCardReader({ examId, exams, onDone }: { examId: string; exams: ExamDTO[]; onDone: () => void }) {
  const [draft, setDraft] = useState<CardDraft | null>(null)
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  function adopt(card: AdmitCard) {
    // The exam it is for: the one it was opened from, else one tracked for this exam.
    const tracked = examId || exams.find((x) => x.examKey && x.examKey === card.examKey)?.id || ''
    setDraft({
      ...BLANK_CARD,
      examId: tracked,
      examKey: card.examKey ?? '',
      examName: card.examName ?? '',
      round: card.round ?? '',
      date: card.date ?? '',
      reportingAt: card.reportingAt ?? '',
      gateClosesAt: card.gateClosesAt ?? '',
      startsAt: card.startsAt ?? '',
      endsAt: card.endsAt ?? '',
      rollNo: card.rollNo ?? '',
      registrationNo: card.registrationNo ?? '',
      centreName: card.centreName ?? '',
      centreAddress: card.centreAddress ?? '',
      centreCity: card.centreCity ?? '',
    })
  }

  async function read(source: { file: File } | { text: string }) {
    setBusy(true)
    setError(null)
    try {
      const res =
        'file' in source
          ? await apiSendFile<{ card: AdmitCard }>('/exams/admit-card', source.file)
          : await api<{ card: AdmitCard }>('/exams/admit-card', { method: 'POST', body: { text: source.text } })
      adopt(res.card)
    } catch (err) {
      const problem = err instanceof ApiError ? (err.data as { problem?: string } | null)?.problem : null
      setError(problem ?? (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!draft?.date) {
      setError('The exam date is needed.')
      return
    }
    setBusy(true)
    setError(null)
    const orNull = (s: string) => s.trim() || null
    try {
      const res = await api<{ travel: string; trip: { placeLabel: string } | null }>('/exams/day', {
        method: 'POST',
        body: {
          examId: orNull(draft.examId),
          // A name typed that is one in the list is that one.
          examKey: orNull(draft.examKey) ?? EXAMS.find((x) => x.name.toLowerCase() === draft.examName.trim().toLowerCase())?.key ?? null,
          examName: orNull(draft.examName),
          round: orNull(draft.round),
          date: draft.date,
          reportingAt: orNull(draft.reportingAt),
          gateClosesAt: orNull(draft.gateClosesAt),
          startsAt: orNull(draft.startsAt),
          endsAt: orNull(draft.endsAt),
          rollNo: orNull(draft.rollNo),
          registrationNo: orNull(draft.registrationNo),
          centreName: orNull(draft.centreName),
          centreAddress: orNull(draft.centreAddress),
          centreCity: orNull(draft.centreCity),
        },
      })
      announceChange()
      setDone(
        res.travel === 'trip'
          ? `Planned, with what to carry. The centre is in ${res.trip?.placeLabel}: a trip there from the day before, and a reminder to book the journey.`
          : res.travel === 'no-home-city'
            ? 'Planned, with what to carry. Add your home city in Settings, and a centre in another city becomes a trip with a reminder to book the journey.'
            : 'Planned, with what to carry and reminders the evening before and that morning.',
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="stack tight">
        <p>{done}</p>
        <div className="row">
          <button className="primary small-btn" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="stack tight">
        <p className="muted small">
          Choose the admit card's PDF, or paste its text. It is read and not kept: only what you save below is.
          A scanned or password-locked PDF cannot be read; type the details instead.
        </p>
        <label className="ghost exam-file">
          Choose the PDF
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void read({ file })
            }}
            disabled={busy}
          />
        </label>
        <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} placeholder="Or paste the admit card's text here" />
        <div className="row">
          <button className="ghost small-btn" onClick={() => void read({ text: pasted })} disabled={busy || !pasted.trim()}>
            Read the text
          </button>
          <button className="link small" onClick={() => setDraft({ ...BLANK_CARD, examId })}>
            Type it in instead
          </button>
        </div>
        {busy && <p className="muted small">Reading…</p>}
        {error && <p className="error small">{error}</p>}
      </div>
    )
  }

  const set = (k: keyof CardDraft) => ({
    value: draft[k],
    onChange: (e: { target: { value: string } }) => setDraft((d) => (d ? { ...d, [k]: e.target.value } : d)),
  })
  const key = draft.examId ? (exams.find((x) => x.id === draft.examId)?.examKey ?? null) : draft.examKey || null
  const rounds = examStages(key).filter((s) => !s.closed && s.key !== 'to_apply' && s.key !== 'applied')

  return (
    <div className="stack tight">
      <p className="muted small">Check each line against the card, and put right anything read wrong.</p>
      <div className="tracker-fields">
        <label className="tracker-wide">
          Exam
          <select {...set('examId')}>
            <option value="">{draft.examName || examByKey(draft.examKey)?.name || 'A new exam'} (new)</option>
            {exams.map((x) => (
              <option key={x.id} value={x.id}>
                {examLabel(x)}
              </option>
            ))}
          </select>
        </label>
        {!draft.examId && !draft.examKey && (
          <label className="tracker-wide">
            Its name
            <input {...set('examName')} list="exam-catalog-card" placeholder="e.g. RRB NTPC" maxLength={120} />
            <datalist id="exam-catalog-card">
              {EXAMS.map((x) => (
                <option key={x.key} value={x.name} />
              ))}
            </datalist>
          </label>
        )}
        {rounds.length > 1 && (
          <label>
            Round
            <select {...set('round')}>
              <option value="">—</option>
              {rounds.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Exam date
          <input type="date" {...set('date')} />
        </label>
        <label>
          Reporting time
          <input type="time" {...set('reportingAt')} />
        </label>
        <label>
          Gate closes
          <input type="time" {...set('gateClosesAt')} />
        </label>
        <label>
          Exam starts
          <input type="time" {...set('startsAt')} />
        </label>
        <label>
          Exam ends
          <input type="time" {...set('endsAt')} />
        </label>
        <label>
          Roll number
          <input {...set('rollNo')} maxLength={40} />
        </label>
        <label>
          Centre city
          <input {...set('centreCity')} maxLength={80} />
        </label>
        <label className="tracker-wide">
          Centre
          <input {...set('centreName')} maxLength={200} />
        </label>
        <label className="tracker-wide">
          Centre address
          <textarea {...set('centreAddress')} rows={2} maxLength={400} />
        </label>
      </div>
      <div className="row">
        <button className="primary small-btn" onClick={() => void save()} disabled={busy || !draft.date}>
          Plan the exam day
        </button>
        <button className="ghost small-btn" onClick={() => setDraft(null)} disabled={busy}>
          Start again
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

/**
 * Results: the lists their roll number was looked for in, the cut-offs the
 * board published (theirs picked out), and a list they have themselves,
 * looked through here.
 */
function Results({ exam, onChecked }: { exam: ExamDTO; onChecked: () => void }) {
  const [busy, setBusy] = useState(false)
  const [own, setOwn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const checks = exam.checks ?? []
  const cutoffs = (exam.notices ?? []).filter((n) => n.cutoffs.length > 0)
  const roundLabel = (round: string | null) => (round ? examStage(exam.examKey, round)?.label ?? round : null)

  async function lookThrough(file: File) {
    setBusy(true)
    setError(null)
    setOwn(null)
    try {
      const res = await apiSendFile<{ page: number | null; pages: number }>(`/exams/${exam.id}/check-list`, file)
      setOwn(
        res.page
          ? `Found: your number is on page ${res.page} of ${res.pages}.`
          : `Not in this list (${res.pages} page${res.pages === 1 ? '' : 's'} read). If it is split by region or category, check the right part.`,
      )
      onChecked()
    } catch (err) {
      const problem = err instanceof ApiError ? (err.data as { problem?: string } | null)?.problem : null
      setError(problem ?? (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (checks.length === 0 && cutoffs.length === 0 && !exam.rollNo && !exam.registrationNo) {
    return (
      <>
        <span className="label-text">Results</span>
        <p className="muted small">Add your roll number below, and when a result list comes out Cue looks for it in the list.</p>
      </>
    )
  }

  return (
    <>
      <span className="label-text">Results</span>
      {checks.length > 0 && (
        <ul className="plain tracker-plans exam-checks">
          {checks.map((c) => (
            <li key={c.noticeId} className={c.found ? 'is-found' : 'is-missing'}>
              {c.found
                ? c.means === 'selected'
                  ? 'Selected — your number is on the list'
                  : c.means === 'shortlist'
                    ? `In the list${roundLabel(c.round) ? ` for ${roundLabel(c.round)}` : ''}`
                    : 'Your number is in the result list'
                : 'Not found in this list — lists are often split by region, category or post'}
              {c.page ? ` (page ${c.page})` : ''}
              <span className="muted"> · </span>
              <a href={c.url} target="_blank" rel="noopener noreferrer">
                the notice
              </a>
            </li>
          ))}
        </ul>
      )}
      {cutoffs.map((n) => (
        <div key={n.id} className="exam-cutoffs">
          <span className="muted small">Cut-offs · {n.summary.split(': ').slice(1).join(': ')}</span>
          <div className="chips">
            {n.cutoffs.map((c) => (
              <span key={c.category} className={`chip${c.category === exam.category ? ' selected' : ''}`}>
                {c.category} {c.marks}
              </span>
            ))}
          </div>
          {!exam.category && <span className="muted small">Set your category in Details to see yours picked out.</span>}
        </div>
      ))}
      {(exam.rollNo || exam.registrationNo) && (
        <label className="ghost exam-file">
          {busy ? 'Looking…' : 'Look through a result list (PDF)'}
          <input
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void lookThrough(file)
              e.target.value = ''
            }}
          />
        </label>
      )}
      {own && <p className="small">{own}</p>}
      {error && <p className="error small">{error}</p>}
    </>
  )
}
