import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CATEGORIES,
  EXAMS,
  EXAM_LEVELS,
  EXAM_TRAINING,
  EXAM_GROUPS,
  EXAM_STEPS,
  examGroup,
  examByKey,
  examLabel,
  examStages,
  watchedBoard,
  isOpenExamStage,
  markingFor,
  subjectsFor,
  type AdmitCard,
  type ExamClash,
  type ExamDTO,
  type ExamLevel,
  type ExamStep,
  type ExamTraining,
  type OpenFormDTO,
} from '@cue/shared'
import { ApiError, api, apiSendFile } from '../lib/api.ts'
import { announceChange, useOnChange } from '../lib/changes.ts'
import { takeSharedFile } from '../lib/sharedFile.ts'
import { useExamWords, type ExamWords } from '../lib/examWords.ts'
import { Modal } from '../components/Modal.tsx'
import { PhotoFitter } from '../components/PhotoFitter.tsx'

/** The soonest date still to come, for a card's "Next:" line. */
function nextDate(exam: ExamDTO) {
  const now = Date.now() - 12 * 3_600_000
  return exam.dates.find((d) => d.status === 'pending' && new Date(d.dueAt).getTime() >= now) ?? null
}

/** Days until the exam itself, when its day is known. */
function daysToExam(exam: ExamDTO): number | null {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = start(new Date())
  const day = exam.dates.find((d) => d.status === 'pending' && d.step === 'exam' && start(new Date(d.dueAt)) >= today)
  return day ? Math.round((start(new Date(day.dueAt)) - today) / 86_400_000) : null
}

/** "Applied 9 days ago", "CBT 1 since yesterday". */
function sinceLine(w: ExamWords, exam: ExamDTO): string {
  return w.since(w.stage(exam.examKey, exam.stage), w.ago(exam.stageChangedAt))
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
 * dates as reminders; the study plan and mock tests on the way; and the
 * result. Nothing here signs in to a portal. In English or Hindi, as the
 * person chose.
 */
export default function Exams() {
  const w = useExamWords()
  const [params, setParams] = useSearchParams()
  const [exams, setExams] = useState<ExamDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<{ examId: string; file?: File } | null>(null)
  const [fitting, setFitting] = useState(false)
  const openId = params.get('exam')
  // The app icon's shortcuts: straight to reading an admit card, or adding an exam.
  const [adding, setAdding] = useState(() => params.get('add') === '1')
  useEffect(() => {
    if (params.get('card') === '1') setReading({ examId: '' })
    // Shared from another app: the reader opens with the file already in it.
    if (params.get('card') === 'shared') {
      void takeSharedFile().then((file) => setReading({ examId: '', ...(file ? { file } : {}) }))
    }
    if (params.has('card') || params.has('add')) {
      params.delete('card')
      params.delete('add')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const [clashes, setClashes] = useState<ExamClash[]>([])
  const load = useCallback(async () => {
    try {
      setExams(await api<ExamDTO[]>('/exams'))
      setClashes(await api<ExamClash[]>('/exams/clashes').catch(() => []))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useOnChange(() => void load())

  /** What adding just brought with it: the official dates already out, or that they will come. */
  const [addedNote, setAddedNote] = useState<string | null>(null)
  /** Bumped when what they studied changes, so the forms open now are marked again. */
  const [studied, setStudied] = useState(0)
  const open = useMemo(() => (exams ?? []).filter((x) => !x.closedAt), [exams])
  const closed = useMemo(() => (exams ?? []).filter((x) => x.closedAt), [exams])

  const show = (id: string | null) => {
    if (id) params.set('exam', id)
    else params.delete('exam')
    setParams(params, { replace: !id })
  }

  return (
    <div className="stack exams-page" lang={w.lang}>
      <div className="page-head">
        <h1 className="page-title">{w.title}</h1>
        {exams && (
          <span className="page-count">
            {w.open(open.length)}
            {closed.length ? ` · ${w.done(closed.length)}` : ''}
          </span>
        )}
      </div>
      <p className="muted small">{w.intro}</p>

      {exams && exams.length === 0 && !adding && (
        <ExamsPicker
          onAdded={(official) => {
            setAddedNote(w.officialAdded(official))
            void load()
          }}
          onOther={() => setAdding(true)}
        />
      )}

      {exams && (exams.length > 0 || adding) && (
        <AddExam
          key={adding ? 'adding' : 'folded'}
          startOpen={adding}
          onAdded={(official) => {
            setAddedNote(w.officialAdded(official))
            void load()
          }}
          onReadCard={() => setReading({ examId: '' })}
          onFitPhoto={() => setFitting(true)}
        />
      )}
      {addedNote && (
        <p className="card small exam-added" role="status">
          {addedNote}{' '}
          <button className="link small" onClick={() => setAddedNote(null)}>
            {w.doneButton}
          </button>
        </p>
      )}
      {error && <p className="error small">{error}</p>}

      {!exams ? (
        <div className="boot">
          <span className="spinner" />
        </div>
      ) : exams.length === 0 ? (
        <>
          <OpenForms
            key={studied}
            onAdded={(official) => {
              setAddedNote(w.officialAdded(official))
              void load()
            }}
          />
          <Studies onChanged={() => setStudied((n) => n + 1)} />
          <p className="muted small">
            {w.noExamsHow} <strong>applied for RRB NTPC 2026, RRB Ajmer, reg no …</strong> ·{' '}
            <strong>REET ka form bharna hai, last date 20 nov</strong>
          </p>
        </>
      ) : (
        <>
          <Clashes clashes={clashes} />
          <div className="exam-list">
            {open.map((x) => (
              <ExamCard
                key={x.id}
                exam={x}
                clash={clashes.some((k) => k.kind !== 'same-day-shifts' && (k.a.examId === x.id || k.b.examId === x.id))}
                onOpen={() => show(x.id)}
              />
            ))}
          </div>
          <OpenForms
            key={`${exams.length}-${studied}`}
            onAdded={(official) => {
              setAddedNote(w.officialAdded(official))
              void load()
            }}
          />
          <Studies onChanged={() => setStudied((n) => n + 1)} />
          {closed.length > 0 && (
            <details className="tracker-closed">
              <summary>
                {w.doneHeading} · {closed.length}
              </summary>
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
        <Modal title={w.exam} onClose={() => show(null)} closeOnBackdrop={false}>
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
        <Modal title={w.readCard} onClose={() => setReading(null)} closeOnBackdrop={false}>
          <AdmitCardReader
            examId={reading.examId}
            sharedFile={reading.file}
            exams={open}
            onDone={() => {
              setReading(null)
              void load()
            }}
          />
        </Modal>
      )}

      {fitting && (
        <Modal title={w.photoTool} onClose={() => setFitting(false)}>
          <PhotoFitter />
        </Modal>
      )}

      <p className="exam-disclaimer">{w.disclaimer}</p>
    </div>
  )
}

/**
 * The first time: which exams they are preparing for, chosen from the list
 * by group, each added with its stages and its board's site — the form
 * still to fill, or already applied.
 */
function ExamsPicker({ onAdded, onOther }: { onAdded: (officialDates: number) => void; onOther: () => void }) {
  const w = useExamWords()
  const [picked, setPicked] = useState<string[]>([])
  const [applied, setApplied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true)
    setError(null)
    try {
      let official = 0
      for (const key of picked) {
        const exam = EXAMS.find((x) => x.key === key)!
        const made = await api<{ officialDates?: number }>('/exams', {
          method: 'POST',
          body: { examKey: key, name: exam.name, stage: applied ? 'applied' : 'to_apply' },
        })
        official += made.officialDates ?? 0
      }
      announceChange()
      onAdded(official)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack tight exams-picker" lang={w.lang}>
      <h2 className="section-title">{w.pickTitle}</h2>
      <p className="muted small">{w.pickHow}</p>
      {EXAM_GROUPS.map((g) => (
        <div key={g.key} className="exams-pick-group">
          <span className="label-text">{w.lang === 'hi' ? g.hi : g.en}</span>
          <div className="chips">
            {EXAMS.filter((x) => examGroup(x) === g.key).map((x) => (
              <button
                key={x.key}
                className={`chip${picked.includes(x.key) ? ' selected' : ''}`}
                aria-pressed={picked.includes(x.key)}
                onClick={() => setPicked((list) => (list.includes(x.key) ? list.filter((k) => k !== x.key) : [...list, x.key]))}
              >
                {x.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="chips" role="group">
        <button className={`chip${!applied ? ' selected' : ''}`} onClick={() => setApplied(false)}>
          {w.pickToApply}
        </button>
        <button className={`chip${applied ? ' selected' : ''}`} onClick={() => setApplied(true)}>
          {w.pickApplied}
        </button>
      </div>
      <div className="row">
        <button className="primary" onClick={() => void add()} disabled={busy || picked.length === 0}>
          {w.pickAdd(Math.max(1, picked.length))}
        </button>
        <button className="link small" onClick={onOther}>
          {w.pickOther}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </section>
  )
}

/**
 * Forms open now, from the boards' approved notices, for exams not already
 * tracked: the last day to apply, and one tap to add the exam with every
 * date the notices give.
 */
function OpenForms({ onAdded }: { onAdded: (officialDates: number) => void }) {
  const w = useExamWords()
  const [forms, setForms] = useState<OpenFormDTO[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    api<OpenFormDTO[]>('/exams/open-forms')
      .then(setForms)
      .catch(() => setForms([]))
  }, [])
  if (!forms || forms.length === 0) return null

  async function add(f: OpenFormDTO) {
    const key = `${f.examKey}|${f.cycle ?? ''}`
    setBusy(key)
    try {
      const made = await api<{ officialDates?: number }>('/exams', {
        method: 'POST',
        body: { examKey: f.examKey, name: f.name, cycle: f.cycle, stage: 'to_apply' },
      })
      setForms((list) => (list ?? []).filter((x) => `${x.examKey}|${x.cycle ?? ''}` !== key))
      announceChange()
      onAdded(made.officialDates ?? 0)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card stack tight open-forms" lang={w.lang}>
      <h2 className="section-title">{w.openForms}</h2>
      <p className="muted small">{w.openFormsHow}</p>
      <ul className="plain open-forms-list">
        {forms.map((f) => {
          const key = `${f.examKey}|${f.cycle ?? ''}`
          const needs = examByKey(f.examKey)?.needs
          return (
            <li key={key} className={`open-form${f.fit === 'needs' ? ' is-unfit' : ''}`}>
              <span className="open-form-what">
                <strong>{examLabel({ name: f.name, cycle: f.cycle })}</strong>
                <span className="muted small">
                  {' '}
                  · {w.lastDateOn(w.day(f.applyBy))}
                  {f.tentative ? ` (${w.tentative})` : ''} ·{' '}
                  <a href={f.url} target="_blank" rel="noopener noreferrer">
                    {w.theNoticeLink}
                  </a>
                </span>
                {f.fit === 'fits' && <span className="small open-form-fit"> · ✓ {w.fitsYou}</span>}
                {f.fit === 'needs' && needs && <span className="muted small"> · {w.usuallyNeeds(needs.level, needs.training ?? [])}</span>}
              </span>
              <button className="primary small-btn" onClick={() => void add(f)} disabled={busy !== null}>
                {w.addThis}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

interface Studied {
  examLevel: ExamLevel | null
  examTraining: ExamTraining[]
  examFormAlerts: boolean
}

/**
 * What they have studied, said once — never a date of birth: which forms
 * fit them, and whether to hear when one opens for an exam like theirs.
 * Open until it is said; a line with "Change" after.
 */
function Studies({ onChanged }: { onChanged: () => void }) {
  const w = useExamWords()
  const [said, setSaid] = useState<Studied | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    api<Studied>('/me/preferences')
      .then(setSaid)
      .catch(() => undefined)
  }, [])
  if (!said) return null

  async function save(patch: Partial<Studied>) {
    setSaid((s) => (s ? { ...s, ...patch } : s))
    try {
      const saved = await api<Studied>('/me/preferences', { method: 'PATCH', body: patch })
      setSaid(saved)
      onChanged()
    } catch {
      // Kept on screen; it is saved again with the next tap.
    }
  }

  if (said.examLevel && !editing) {
    const summary = [w.level(said.examLevel), ...said.examTraining.map((t) => w.training(t))].join(' · ')
    return (
      <p className="muted small exam-studies-line" lang={w.lang}>
        {w.studiedAs(summary)}{' '}
        <button className="link small" onClick={() => setEditing(true)}>
          {w.change}
        </button>
      </p>
    )
  }

  return (
    <section className="card stack tight exam-studies" lang={w.lang}>
      <h2 className="section-title">{w.studiesTitle}</h2>
      <p className="muted small">{w.studiesHow}</p>
      <div className="chips" role="group" aria-label={w.studiesTitle}>
        {EXAM_LEVELS.map((level) => (
          <button
            key={level}
            className={`chip${said.examLevel === level ? ' selected' : ''}`}
            aria-pressed={said.examLevel === level}
            onClick={() => void save({ examLevel: level })}
          >
            {w.level(level)}
          </button>
        ))}
      </div>
      <span className="label-text">{w.alsoHave}</span>
      <div className="chips" role="group" aria-label={w.alsoHave}>
        {EXAM_TRAINING.map((t) => {
          const on = said.examTraining.includes(t)
          return (
            <button
              key={t}
              className={`chip${on ? ' selected' : ''}`}
              aria-pressed={on}
              onClick={() => void save({ examTraining: on ? said.examTraining.filter((x) => x !== t) : [...said.examTraining, t] })}
            >
              {w.training(t)}
            </button>
          )
        })}
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={said.examFormAlerts} onChange={(e) => void save({ examFormAlerts: e.target.checked })} />
        {w.formAlerts}
      </label>
      {said.examLevel && (
        <div className="row">
          <button className="ghost small-btn" onClick={() => setEditing(false)}>
            {w.doneButton}
          </button>
        </div>
      )}
    </section>
  )
}

/** Exam days that collide, found from the dates Cue holds — so nobody has to notice it themselves. */
function Clashes({ clashes }: { clashes: ExamClash[] }) {
  const w = useExamWords()
  if (clashes.length === 0) return null
  return (
    <section className="card stack tight exam-clashes" lang={w.lang} role="status">
      <h2 className="section-title">⚠ {w.clashTitle}</h2>
      <ul className="plain stack tight">
        {clashes.map((k) => {
          const day = w.day(k.on)
          return (
            <li key={`${k.kind}-${k.on}-${k.a.examId}-${k.b.examId}`} className="small">
              {k.kind === 'same-day'
                ? w.clashSameDay(k.a.label, k.b.label, day)
                : k.kind === 'same-day-shifts'
                  ? w.clashShifts(k.a.label, k.b.label, day)
                  : w.clashTravel(k.a.label, k.b.label, day, k.a.city ?? '', k.b.city ?? '')}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ExamCard({ exam, clash = false, onOpen }: { exam: ExamDTO; clash?: boolean; onOpen: () => void }) {
  const w = useExamWords()
  const next = nextDate(exam)
  const stage = examStages(exam.examKey).find((s) => s.key === exam.stage)
  const days = exam.closedAt ? null : daysToExam(exam)
  return (
    <article className="tracker-card exam-card">
      <button className="tracker-card-main" onClick={onOpen}>
        <span className="tracker-card-title">{examLabel(exam)}</span>
        {days !== null && <span className={`exam-countdown${days <= 7 ? ' is-near' : ''}`}>{w.daysToGo(days)}</span>}
        {clash && <span className="exam-clash-badge">⚠ {w.clashBadge}</span>}
        {(exam.region || exam.centreCity) && (
          <span className="tracker-card-detail">
            {[exam.region, exam.centreCity ? `${w.centre}: ${exam.centreName ?? exam.centreCity}` : null].filter(Boolean).join(' · ')}
          </span>
        )}
        <span className="tracker-card-meta">
          {stage?.closed ? `${w.stage(exam.examKey, exam.stage)} · ${w.day(exam.closedAt ?? exam.stageChangedAt)}` : sinceLine(w, exam)}
          {exam.rollNo ? ` · ${w.rollNo} ${exam.rollNo}` : ''}
        </span>
        {next && (
          <span className="tracker-card-next">
            {w.next}: {next.title} · {w.when(next.dueAt)}
          </span>
        )}
      </button>
    </article>
  )
}

/** One line in: which exam, and the one or two dates that matter first. */
function AddExam({
  startOpen,
  onAdded,
  onReadCard,
  onFitPhoto,
}: {
  startOpen: boolean
  onAdded: (officialDates: number) => void
  onReadCard: () => void
  onFitPhoto: () => void
}) {
  const w = useExamWords()
  // Folded once there are exams to see, so on a phone the list is not below a screenful of form.
  const [open, setOpen] = useState(startOpen)
  const [name, setName] = useState('')
  const [cycle, setCycle] = useState('')
  const [region, setRegion] = useState('')
  const [registrationNo, setRegistrationNo] = useState('')
  const [stage, setStage] = useState<'applied' | 'to_apply'>('applied')
  const [applyBy, setApplyBy] = useState('')
  const [examOn, setExamOn] = useState('')
  const [knowDate, setKnowDate] = useState(false)
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
      const made = await api<{ officialDates?: number }>('/exams', {
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
      setKnowDate(false)
      onAdded(made.officialDates ?? 0)
      announceChange()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const tools = (
    <>
      <button className="ghost" type="button" onClick={onReadCard}>
        {w.readCard}
      </button>
      <button className="ghost" type="button" onClick={onFitPhoto}>
        {w.photoTool}
      </button>
    </>
  )

  if (!open) {
    return (
      <div className="row exam-add">
        <button className="primary" onClick={() => setOpen(true)}>
          {w.addExam}
        </button>
        {tools}
      </div>
    )
  }

  return (
    <form className="card stack tight exam-add" onSubmit={(e) => void add(e)}>
      <div className="tracker-fields">
        <label className="tracker-wide">
          {w.exam}
          <input value={name} onChange={(e) => setName(e.target.value)} list="exam-catalog" placeholder={w.examPlaceholder} maxLength={120} />
        </label>
        <label>
          {w.yearOptional}
          <input value={cycle} onChange={(e) => setCycle(e.target.value)} placeholder="2026, CEN 05/2026" maxLength={40} />
        </label>
        <label>
          {catalog?.regions ? w.boardOptional : w.regionOptional}
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            list={catalog?.regions ? 'exam-regions' : undefined}
            placeholder={catalog?.regions ? 'RRB Ajmer' : ''}
            maxLength={80}
          />
        </label>
        <label>
          {w.standsHeading}
          <select value={stage} onChange={(e) => setStage(e.target.value as 'applied' | 'to_apply')}>
            <option value="applied">{w.stage(null, 'applied')}</option>
            <option value="to_apply">{w.stage(null, 'to_apply')}</option>
          </select>
        </label>
        {stage === 'applied' && (
          <label>
            {w.regNoOptional}
            <input value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} maxLength={40} />
          </label>
        )}
        {/* An exam Cue knows gets its dates from the official notices; asked only of one it does not, or on request. */}
        {(!catalog || knowDate) && (
          <>
            {stage === 'to_apply' && (
              <label>
                {w.lastDate}
                <input type="date" value={applyBy} onChange={(e) => setApplyBy(e.target.value)} />
              </label>
            )}
            <label>
              {w.examDateIfAnnounced}
              <input type="date" value={examOn} onChange={(e) => setExamOn(e.target.value)} />
            </label>
          </>
        )}
      </div>
      {catalog && !knowDate && (
        <p className="muted small">
          {w.datesFromNotices}{' '}
          <button className="link small" type="button" onClick={() => setKnowDate(true)}>
            {w.knowDate}
          </button>
        </p>
      )}
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
          {w.addExamButton}
        </button>
        {tools}
      </div>
      {catalog && (
        <p className="muted small">
          {catalog.body}
          {catalog.site && (
            <>
              {' · '}
              <a href={catalog.site} target="_blank" rel="noopener noreferrer">
                {w.officialSite}
              </a>
            </>
          )}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </form>
  )
}

/** One exam: where it stands, its dates, the preparing, its result, its day, its numbers. */
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
  const w = useExamWords()
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
      if (!window.confirm(w.confirmClose)) return
    }
    await patch({ stage })
  }

  async function addDate() {
    if (!on) {
      setError(w.pickDay)
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
    if (!window.confirm(w.confirmDelete)) return
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
  const isOpen = isOpenExamStage(exam.examKey, exam.stage)
  const days = isOpen ? daysToExam(exam) : null

  return (
    <div className="stack tight tracker-sheet" lang={w.lang}>
      <div>
        <strong className="tracker-sheet-title">{examLabel(exam)}</strong>
        {days !== null && <p className={`exam-countdown${days <= 7 ? ' is-near' : ''}`}>{w.daysToGo(days)}</p>}
        <p className="muted small">
          {[catalog?.body, exam.region].filter(Boolean).join(' · ')}
          {catalog?.site && (
            <>
              {' · '}
              <a href={catalog.site} target="_blank" rel="noopener noreferrer">
                {w.officialSite}
              </a>
            </>
          )}
          {catalog?.applyAt && (
            <>
              {' · '}
              <a href={catalog.applyAt} target="_blank" rel="noopener noreferrer">
                {w.applyLogin}
              </a>
            </>
          )}
        </p>
      </div>

      <span className="label-text">{w.standsHeading}</span>
      <div className="chips tracker-stages" role="group" aria-label={w.standsHeading}>
        {stages.map((s) => (
          <button
            key={s.key}
            className={`chip${exam.stage === s.key ? ' selected' : ''}${s.closed ? ` is-${s.closed}` : ''}`}
            onClick={() => void moveTo(s.key)}
            disabled={busy}
            aria-pressed={exam.stage === s.key}
          >
            {w.stage(exam.examKey, s.key)}
          </button>
        ))}
      </div>
      <p className="muted small">{sinceLine(w, exam)}.</p>

      <span className="label-text">{w.dates}</span>
      {upcoming.length > 0 ? (
        <ul className="plain tracker-plans">
          {upcoming.map((d) => (
            <li key={d.id}>
              {d.title} <span className="muted">· {w.when(d.dueAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        isOpen && <p className="muted small">{watchedBoard(exam.examKey) ? w.noDatesWatched(watchedBoard(exam.examKey)!) : w.noDates}</p>
      )}
      {isOpen && (
        <div className="exam-date-add">
          <select value={step} onChange={(e) => setStep(e.target.value as ExamStep)} aria-label={w.dates}>
            {EXAM_STEPS.map((s) => (
              <option key={s.key} value={s.key}>
                {w.step(s.key)}
              </option>
            ))}
          </select>
          {roundsMatter && rounds.length > 1 && (
            <select value={round} onChange={(e) => setRound(e.target.value)} aria-label={w.round}>
              <option value="">{w.whichRound}</option>
              {rounds.map((r) => (
                <option key={r.key} value={r.key}>
                  {w.stage(exam.examKey, r.key)}
                </option>
              ))}
            </select>
          )}
          {step === 'other' && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={w.whatIsIt} maxLength={120} />}
          <input type="date" value={on} onChange={(e) => setOn(e.target.value)} aria-label={w.on} />
          <input type="time" value={at} onChange={(e) => setAt(e.target.value)} aria-label={w.at} />
          <button className="primary small-btn" onClick={() => void addDate()} disabled={busy || !on}>
            {w.addDate}
          </button>
        </div>
      )}

      {isOpen && <StudyPlan exam={exam} onChanged={() => void run(async () => undefined)} />}
      <Mocks exam={exam} onChanged={() => void load()} />

      {(exam.notices ?? []).length > 0 && (
        <>
          <span className="label-text">{w.notices}</span>
          <ul className="plain tracker-plans">
            {exam.notices!.map((n) => (
              <li key={n.id}>
                {n.summary.split(': ').slice(1).join(': ')} <span className="muted">· {w.day(n.reviewedAt)} · </span>
                <a href={n.url} target="_blank" rel="noopener noreferrer">
                  {w.theNotice}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}

      <Expected exam={exam} onChanged={() => void load()} />

      <Results exam={exam} onChecked={() => void load()} />

      <span className="label-text">{w.examDay}</span>
      {exam.centreName || exam.centreAddress ? (
        <p className="small">
          {[exam.centreName, exam.centreAddress].filter(Boolean).join(', ')}
          {exam.rollNo ? (
            <span className="muted">
              {' '}
              · {w.rollNo} {exam.rollNo}
            </span>
          ) : null}
        </p>
      ) : (
        <p className="muted small">{w.examDayHow}</p>
      )}
      <div className="row">
        <button className="ghost small-btn" onClick={onReadCard}>
          {w.readTheCard}
        </button>
        {exam.examDay && <ShareExamDay exam={exam} />}
      </div>

      <span className="label-text">{w.details}</span>
      <div className="tracker-fields">
        <label>
          {w.year}
          <input {...field('cycle')} placeholder="2026, CEN 05/2026" maxLength={40} />
        </label>
        <label>
          {catalog?.regions ? w.board : w.region}
          <input {...field('region')} list={catalog?.regions ? 'exam-sheet-regions' : undefined} maxLength={80} />
        </label>
        <label>
          {w.regNo}
          <input {...field('registrationNo')} maxLength={40} />
        </label>
        <label>
          {w.rollNo}
          <input {...field('rollNo')} maxLength={40} />
        </label>
        <label>
          {w.category}
          <select {...field('category')}>
            <option value="">{w.notSaid}</option>
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="tracker-wide">
          {w.notes}
          <textarea {...field('notes')} rows={2} placeholder={w.notesPlaceholder} />
        </label>
      </div>
      {catalog?.regions && (
        <datalist id="exam-sheet-regions">
          {catalog.regions.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      )}
      <p className="muted small">{w.neverAsks}</p>
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
          {w.saveDetails}
        </button>
      </div>

      {past.length > 0 && (
        <>
          <span className="label-text">{w.doneHeading}</span>
          <ul className="plain tracker-history">
            {past.map((d) => (
              <li key={d.id}>
                <span className="muted">{w.day(d.dueAt)}</span> · {d.title}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="row">
        <button className="link small danger-text" onClick={() => void remove()}>
          {w.deleteExam}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]
const pad = (n: number) => String(n).padStart(2, '0')
const clockOf = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`

/**
 * The study plan: each subject on its days at one time, and a weekly mock
 * test, until the day before the exam. Running, it says so and can be made
 * again or stopped; otherwise, the form to make it.
 */
function StudyPlan({ exam, onChanged }: { exam: ExamDTO; onChanged: () => void }) {
  const w = useExamWords()
  const study = exam.study ?? []
  const [editing, setEditing] = useState(false)
  const [subjects, setSubjects] = useState(() => subjectsFor(exam.examKey, w.lang).join('\n'))
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [at, setAt] = useState('06:30')
  const [minutes, setMinutes] = useState(90)
  const [mockDay, setMockDay] = useState<number | null>(0)
  const [mockAt, setMockAt] = useState('10:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function make() {
    setBusy(true)
    setError(null)
    try {
      await api(`/exams/${exam.id}/study-plan`, {
        method: 'POST',
        body: {
          subjects: subjects.split('\n').map((s) => s.trim()).filter(Boolean),
          days,
          at,
          minutes,
          mock: mockDay === null ? null : { day: mockDay, at: mockAt, minutes: 120 },
        },
      })
      setEditing(false)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    try {
      await api(`/exams/${exam.id}/study-plan`, { method: 'DELETE' })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const running = study.length > 0 && !editing
  return (
    <>
      <span className="label-text">{w.study}</span>
      {running ? (
        <>
          <ul className="plain tracker-plans">
            {study.map((s) => (
              <li key={s.id}>
                {s.title}{' '}
                <span className="muted">
                  · {MONDAY_FIRST.filter((d) => s.weekdays.includes(d)).map((d) => w.weekdays[d]).join(', ')} · {clockOf(s.hour, s.minute)} ·{' '}
                  {s.durationMinutes}′
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {w.planRunning} {study[0]!.untilOn ? w.day(study[0]!.untilOn) : '—'}
          </p>
          <div className="row">
            <button className="ghost small-btn" onClick={() => setEditing(true)} disabled={busy}>
              {w.remakePlan}
            </button>
            <button className="link small" onClick={() => void stop()} disabled={busy}>
              {w.stopPlan}
            </button>
          </div>
        </>
      ) : !editing ? (
        <>
          <p className="muted small">{w.studyHow}</p>
          <div className="row">
            <button className="ghost small-btn" onClick={() => setEditing(true)}>
              {w.makePlan}
            </button>
          </div>
        </>
      ) : (
        <div className="stack tight exam-study-form">
          <label>
            {w.subjects}
            <textarea value={subjects} onChange={(e) => setSubjects(e.target.value)} rows={4} />
          </label>
          <span className="muted small">{w.days}</span>
          <div className="chips" role="group" aria-label={w.days}>
            {MONDAY_FIRST.map((d) => (
              <button
                key={d}
                className={`chip${days.includes(d) ? ' selected' : ''}`}
                aria-pressed={days.includes(d)}
                onClick={() => setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]))}
              >
                {w.weekdays[d]}
              </button>
            ))}
          </div>
          <div className="tracker-fields">
            <label>
              {w.at}
              <input type="time" value={at} onChange={(e) => setAt(e.target.value)} />
            </label>
            <label>
              {w.forMinutes}
              <input type="number" min={15} max={480} step={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            </label>
            <label>
              {w.mockOn}
              <select value={mockDay ?? ''} onChange={(e) => setMockDay(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">{w.noMock}</option>
                {MONDAY_FIRST.map((d) => (
                  <option key={d} value={d}>
                    {w.weekdays[d]}
                  </option>
                ))}
              </select>
            </label>
            {mockDay !== null && (
              <label>
                {w.at}
                <input type="time" value={mockAt} onChange={(e) => setMockAt(e.target.value)} />
              </label>
            )}
          </div>
          <div className="row">
            <button className="primary small-btn" onClick={() => void make()} disabled={busy || days.length === 0 || !subjects.trim()}>
              {study.length ? w.remakePlan : w.makePlan}
            </button>
            <button className="link small" onClick={() => setEditing(false)}>
              ✕
            </button>
          </div>
          {error && <p className="error small">{error}</p>}
        </div>
      )}
    </>
  )
}

/** Mock tests: each score kept, the trend at a glance, and a score added. */
const marks = (n: number) => String(Math.round(n * 100) / 100)

/**
 * A score worked out from the answer key: right and wrong answers by the
 * board's marking where Cue knows it, or one typed in; then held against
 * the newest cut-off Cue has for their category — a guide, said as one.
 */
function Expected({ exam, onChanged }: { exam: ExamDTO; onChanged: () => void }) {
  const w = useExamWords()
  // Written papers only: an answer key has nothing to say of a skill test, a medical or an interview.
  const NOT_MARKED = ['skill', 'dv', 'medical', 'pet', 'interview', 'counselling', 'ssb', 'rally', 'language']
  const rounds = (examByKey(exam.examKey)?.rounds ?? []).filter((r) => !NOT_MARKED.includes(r.key))
  const firstKnown = rounds.find((r) => markingFor(exam.examKey, r.key))?.key ?? rounds[0]?.key ?? null
  const [round, setRound] = useState<string | null>(firstKnown)
  const known = markingFor(exam.examKey, round)
  const [other, setOther] = useState(false)
  const [right, setRight] = useState('')
  const [wrong, setWrong] = useState('')
  const [questions, setQuestions] = useState(String(known?.questions ?? 100))
  const [perRight, setPerRight] = useState(String(known?.right ?? 1))
  const [perWrong, setPerWrong] = useState(String(known ? marks(known.wrong) : 0))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const custom = other || !known
  const saved = exam.expected?.[round ?? '']

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api(`/exams/${exam.id}/expected`, {
        method: 'PUT',
        body: {
          round,
          right: Number(right),
          wrong: Number(wrong || 0),
          ...(custom ? { questions: Number(questions), perRight: Number(perRight), perWrong: Number(perWrong) } : {}),
        },
      })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError && (err.data as { error?: string } | null)?.error === 'too_many' ? w.tooMany : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Against the newest cut-off Cue holds, in their category (or the open one).
  // Only one for the same round: a CBT 1 cut-off says nothing of a CBT 2 score.
  const cut = exam.lastCutoffs && (!exam.lastCutoffs.round || !round || exam.lastCutoffs.round === round) ? exam.lastCutoffs : null
  const category = exam.category ?? 'UR'
  const line = cut?.cutoffs.find((c) => c.category === category)
  return (
    <>
      <span className="label-text">{w.expectedTitle}</span>
      <p className="muted small">{w.expectedHow}</p>
      <div className="tracker-fields">
        {rounds.length > 1 && (
          <label>
            {w.round}
            <select value={round ?? ''} onChange={(e) => setRound(e.target.value || null)}>
              {rounds.map((r) => (
                <option key={r.key} value={r.key}>
                  {w.stage(exam.examKey, r.key)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {w.right}
          <input type="number" min={0} inputMode="numeric" value={right} onChange={(e) => setRight(e.target.value)} />
        </label>
        <label>
          {w.wrong}
          <input type="number" min={0} inputMode="numeric" value={wrong} onChange={(e) => setWrong(e.target.value)} />
        </label>
        {custom && (
          <>
            <label>
              {w.questions}
              <input type="number" min={1} inputMode="numeric" value={questions} onChange={(e) => setQuestions(e.target.value)} />
            </label>
            <label>
              {w.perRight}
              <input type="number" min={0} step="0.25" inputMode="decimal" value={perRight} onChange={(e) => setPerRight(e.target.value)} />
            </label>
            <label>
              {w.perWrong}
              <input type="number" min={0} step="0.01" inputMode="decimal" value={perWrong} onChange={(e) => setPerWrong(e.target.value)} />
            </label>
          </>
        )}
      </div>
      {known && !other && (
        <p className="muted small">
          {w.markingKnown(known.questions, marks(known.right), marks(known.wrong))}{' '}
          <button className="link small" onClick={() => setOther(true)}>
            {w.markingOther}
          </button>
        </p>
      )}
      <div className="row">
        <button className="primary small-btn" onClick={() => void save()} disabled={busy || right === ''}>
          {w.workItOut}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
      {saved && (
        <div className="small stack tight exam-expected">
          <strong>{w.expectedIs(marks(saved.score), marks(saved.outOf), saved.right, saved.wrong)}</strong>
          {cut && line && (
            <span>
              {w.cutoffAgainst(cut.title, category, marks(line.marks))}{' '}
              {saved.score >= line.marks ? w.aboveBy(marks(saved.score - line.marks)) : w.belowBy(marks(line.marks - saved.score))}
            </span>
          )}
          {cut && line && <span className="muted">{w.cutoffCaveat}</span>}
        </div>
      )}
    </>
  )
}

/**
 * The exam day, said to whoever takes them there: the day, when to report,
 * when the gate closes, the centre and a map — in one tap, in their
 * language. Never the roll number: it is not needed to get there.
 */
function ShareExamDay({ exam }: { exam: ExamDTO }) {
  const w = useExamWords()
  const day = exam.examDay!
  const clock = (t: string) => new Date(`2000-01-01T${t}:00`).toLocaleTimeString(w.lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' })
  const centre = [exam.centreName, exam.centreAddress, exam.centreCity].filter(Boolean).join(', ')
  const times = [
    day.reportingAt ? w.reportBy(clock(day.reportingAt)) : null,
    day.gateClosesAt ? w.gateAt(clock(day.gateClosesAt)) : null,
    day.startsAt ? w.examAt(clock(day.startsAt), day.endsAt ? clock(day.endsAt) : null) : null,
  ].filter(Boolean)
  const text = [
    `${examLabel(exam)} — ${w.day(day.date)}`,
    times.join(' · ') || null,
    centre ? w.centreIs(centre) : null,
    centre ? w.mapIs(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(centre)}`) : null,
  ]
    .filter(Boolean)
    .join('\n')

  async function send() {
    if (navigator.share) {
      try {
        await navigator.share({ text })
        return
      } catch {
        // Closed without sending, or not allowed here: WhatsApp is the way most families talk.
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

  return (
    <button className="ghost small-btn" onClick={() => void send()}>
      {w.shareDay}
    </button>
  )
}

function Mocks({ exam, onChanged }: { exam: ExamDTO; onChanged: () => void }) {
  const w = useExamWords()
  const mocks = exam.mocks ?? []
  const lastOutOf = mocks.at(-1)?.outOf ?? 100
  const today = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()
  const [score, setScore] = useState('')
  const [outOf, setOutOf] = useState(String(lastOutOf))
  const [on, setOn] = useState(today)
  const [busy, setBusy] = useState(false)
  const pct = (m: { score: number; outOf: number }) => Math.round((m.score / m.outOf) * 100)

  async function add() {
    if (!score) return
    setBusy(true)
    try {
      await api(`/exams/${exam.id}/mocks`, { method: 'POST', body: { takenOn: on, score: Number(score), outOf: Number(outOf) } })
      setScore('')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    await api(`/exams/${exam.id}/mocks/${id}`, { method: 'DELETE' })
    onChanged()
  }

  const recent = mocks.slice(-12)
  const best = mocks.length ? Math.max(...mocks.map(pct)) : null
  const average = mocks.length ? Math.round(mocks.reduce((s, m) => s + pct(m), 0) / mocks.length) : null
  return (
    <>
      <span className="label-text">{w.mocks}</span>
      {mocks.length === 0 ? (
        <p className="muted small">{w.mocksHow}</p>
      ) : (
        <>
          <div className="exam-mock-bars" role="img" aria-label={recent.map((m) => `${pct(m)}%`).join(', ')}>
            {recent.map((m) => (
              <span key={m.id} className="exam-mock-bar" style={{ height: `${Math.max(6, pct(m))}%` }} title={`${w.day(m.takenOn)}: ${m.score}/${m.outOf}`} />
            ))}
          </div>
          <p className="small">
            {w.last}: <strong>{pct(mocks.at(-1)!)}%</strong> · {w.best}: {best}% · {w.average}: {average}%
          </p>
          <ul className="plain tracker-history">
            {mocks
              .slice(-5)
              .reverse()
              .map((m) => (
                <li key={m.id}>
                  <span className="muted">{w.day(m.takenOn)}</span> · {m.score}/{m.outOf} ({pct(m)}%){' '}
                  <button className="link small" onClick={() => void remove(m.id)} aria-label={w.remove}>
                    ✕
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
      <div className="exam-date-add">
        <input type="number" min={0} step="0.25" value={score} onChange={(e) => setScore(e.target.value)} placeholder={w.score} aria-label={w.score} />
        <input type="number" min={1} value={outOf} onChange={(e) => setOutOf(e.target.value)} placeholder={w.outOf} aria-label={w.outOf} />
        <input type="date" value={on} onChange={(e) => setOn(e.target.value)} aria-label={w.on} />
        <button className="ghost small-btn" onClick={() => void add()} disabled={busy || !score || Number(score) > Number(outOf)}>
          {w.addScore}
        </button>
      </div>
    </>
  )
}

/**
 * An admit card, read and checked: a PDF chosen or text pasted, every field
 * shown to be put right, and only then made into the day. A card read wrong
 * should cost a correction here, not a missed gate.
 */
function AdmitCardReader({
  examId,
  sharedFile,
  exams,
  onDone,
}: {
  examId: string
  /** A file shared in from another app, read as soon as the reader opens. */
  sharedFile?: File
  exams: ExamDTO[]
  onDone: () => void
}) {
  const w = useExamWords()
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

  useEffect(() => {
    if (!sharedFile) return
    // A photo of an admit card cannot be read: only its PDF, or its text.
    if (sharedFile.type !== 'application/pdf' && !/\.pdf$/i.test(sharedFile.name)) setError(w.sharedNotPdf)
    else void read({ file: sharedFile })
    // Once, for the file it opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedFile])

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
      setError(w.dateNeeded)
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
      setDone(res.travel === 'trip' ? w.plannedTrip(res.trip?.placeLabel ?? '') : res.travel === 'no-home-city' ? w.plannedNoHome : w.planned)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="stack tight" lang={w.lang}>
        <p>{done}</p>
        <div className="row">
          <button className="primary small-btn" onClick={onDone}>
            {w.doneButton}
          </button>
        </div>
      </div>
    )
  }

  if (!draft) {
    return (
      <div className="stack tight" lang={w.lang}>
        <p className="muted small">{w.cardHow}</p>
        <label className="ghost exam-file">
          {w.choosePdf}
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
        <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} placeholder={w.pasteHere} />
        <div className="row">
          <button className="ghost small-btn" onClick={() => void read({ text: pasted })} disabled={busy || !pasted.trim()}>
            {w.readText}
          </button>
          <button className="link small" onClick={() => setDraft({ ...BLANK_CARD, examId })}>
            {w.typeInstead}
          </button>
        </div>
        {busy && <p className="muted small">{w.reading}</p>}
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
    <div className="stack tight" lang={w.lang}>
      <p className="muted small">{w.checkEach}</p>
      <div className="tracker-fields">
        <label className="tracker-wide">
          {w.exam}
          <select {...set('examId')}>
            <option value="">
              {draft.examName || examByKey(draft.examKey)?.name || w.newExam} {w.newSuffix}
            </option>
            {exams.map((x) => (
              <option key={x.id} value={x.id}>
                {examLabel(x)}
              </option>
            ))}
          </select>
        </label>
        {!draft.examId && !draft.examKey && (
          <label className="tracker-wide">
            {w.itsName}
            <input {...set('examName')} list="exam-catalog-card" placeholder="RRB NTPC" maxLength={120} />
            <datalist id="exam-catalog-card">
              {EXAMS.map((x) => (
                <option key={x.key} value={x.name} />
              ))}
            </datalist>
          </label>
        )}
        {rounds.length > 1 && (
          <label>
            {w.round}
            <select {...set('round')}>
              <option value="">—</option>
              {rounds.map((r) => (
                <option key={r.key} value={r.key}>
                  {w.stage(key, r.key)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {w.examDate}
          <input type="date" {...set('date')} />
        </label>
        <label>
          {w.reportingTime}
          <input type="time" {...set('reportingAt')} />
        </label>
        <label>
          {w.gateCloses}
          <input type="time" {...set('gateClosesAt')} />
        </label>
        <label>
          {w.examStarts}
          <input type="time" {...set('startsAt')} />
        </label>
        <label>
          {w.examEnds}
          <input type="time" {...set('endsAt')} />
        </label>
        <label>
          {w.rollNo}
          <input {...set('rollNo')} maxLength={40} />
        </label>
        <label>
          {w.centreCity}
          <input {...set('centreCity')} maxLength={80} />
        </label>
        <label className="tracker-wide">
          {w.centre}
          <input {...set('centreName')} maxLength={200} />
        </label>
        <label className="tracker-wide">
          {w.centreAddress}
          <textarea {...set('centreAddress')} rows={2} maxLength={400} />
        </label>
      </div>
      <div className="row">
        <button className="primary small-btn" onClick={() => void save()} disabled={busy || !draft.date}>
          {w.planDay}
        </button>
        <button className="ghost small-btn" onClick={() => setDraft(null)} disabled={busy}>
          {w.startAgain}
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
  const w = useExamWords()
  const [busy, setBusy] = useState(false)
  const [own, setOwn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const checks = exam.checks ?? []
  const cutoffs = (exam.notices ?? []).filter((n) => n.cutoffs.length > 0)
  const roundLabel = (round: string | null) => (round ? w.stage(exam.examKey, round) : null)

  async function lookThrough(file: File) {
    setBusy(true)
    setError(null)
    setOwn(null)
    try {
      const res = await apiSendFile<{ page: number | null; pages: number }>(`/exams/${exam.id}/check-list`, file)
      setOwn(res.page ? w.foundOnPage(res.page, res.pages) : w.notInList(res.pages))
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
        <span className="label-text">{w.results}</span>
        <p className="muted small">{w.resultsHow}</p>
      </>
    )
  }

  return (
    <>
      <span className="label-text">{w.results}</span>
      {checks.length > 0 && (
        <ul className="plain tracker-plans exam-checks">
          {checks.map((c) => (
            <li key={c.noticeId} className={c.found ? 'is-found' : 'is-missing'}>
              {c.found ? (c.means === 'selected' ? w.selectedOnList : c.means === 'shortlist' ? w.inListFor(roundLabel(c.round)) : w.inResultList) : w.notFound}
              {c.page ? ` (${w.page(c.page)})` : ''}
              <span className="muted"> · </span>
              <a href={c.url} target="_blank" rel="noopener noreferrer">
                {w.theNotice}
              </a>
            </li>
          ))}
        </ul>
      )}
      {cutoffs.map((n) => (
        <div key={n.id} className="exam-cutoffs">
          <span className="muted small">
            {w.cutoffs} · {n.summary.split(': ').slice(1).join(': ')}
          </span>
          <div className="chips">
            {n.cutoffs.map((c) => (
              <span key={c.category} className={`chip${c.category === exam.category ? ' selected' : ''}`}>
                {c.category} {c.marks}
              </span>
            ))}
          </div>
          {!exam.category && <span className="muted small">{w.setCategory}</span>}
        </div>
      ))}
      {(exam.rollNo || exam.registrationNo) && (
        <label className="ghost exam-file">
          {busy ? w.looking : w.lookThrough}
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
