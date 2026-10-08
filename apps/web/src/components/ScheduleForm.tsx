import { useState } from 'react'
import {
  SCHEDULE_TEMPLATES,
  SCHEDULE_UNITS,
  offsetLabel,
  stepDate,
  type ScheduleDTO,
  type ScheduleTemplate,
  type ScheduleUnit,
} from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { dayLabel, relativeDay, toDateInputValue } from '../lib/time.ts'

interface StepDraft {
  key: number
  title: string
  mode: 'after' | 'on'
  amount: string
  unit: ScheduleUnit
  date: string
}

let nextKey = 0
function blankStep(unit: ScheduleUnit = 'weeks'): StepDraft {
  nextKey += 1
  return { key: nextKey, title: '', mode: 'after', amount: '', unit, date: '' }
}

/** What a draft row amounts to: a step to send, nothing at all, or a row missing its "when". */
function readStep(s: StepDraft) {
  const amount = s.amount.trim() === '' ? null : Number(s.amount)
  const offset =
    s.mode === 'after' && amount !== null && Number.isInteger(amount) && amount >= 0
      ? { amount, unit: s.unit }
      : null
  const date = s.mode === 'on' && s.date ? s.date : null
  const empty = !s.title.trim() && amount === null && !s.date
  return { offset, date, empty, complete: Boolean(offset || date) }
}

/**
 * Plans on a schedule, not a rhythm — vaccinations at birth, 6 weeks,
 * 10 weeks, 9 months; a course of treatment; anything whose dates are set
 * out in advance but are not "every N weeks".
 *
 * Each row is a step: what happens, and when — a gap after the start date, or
 * a date of its own. The real date shows beside every row as it is typed, so
 * nobody has to work out what "14 weeks after 1 August" is.
 */
export function ScheduleForm({
  initialTitle = '',
  onDone,
  onBack,
}: {
  initialTitle?: string
  onDone: () => void
  /** Back to the single-plan form. */
  onBack: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [startsOn, setStartsOn] = useState(() => toDateInputValue(new Date()))
  const [time, setTime] = useState('10:00')
  const [steps, setSteps] = useState<StepDraft[]>(() => [blankStep(), blankStep()])
  /** The template the steps came from, kept for its caution and its start label. */
  const [template, setTemplate] = useState<ScheduleTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ schedule: ScheduleDTO; booked: number; skippedPast: number } | null>(
    null,
  )

  const [hour, minute] = time.split(':').map(Number) as [number, number]
  const now = Date.now()

  /** Fills the steps from a template. Every step stays editable before booking. */
  function applyTemplate(id: string) {
    const t = SCHEDULE_TEMPLATES.find((x) => x.id === id)
    if (!t) return
    const typed = steps.some((s) => s.title.trim() || s.amount.trim() || s.date)
    if (typed && !window.confirm(`Replace the steps you have typed with "${t.label}"?`)) return
    setTemplate(t)
    if (!title.trim()) setTitle(t.title)
    setTime(`${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`)
    setSteps(
      t.steps.map((step) => {
        nextKey += 1
        return {
          key: nextKey,
          title: step.title ?? '',
          mode: step.date ? 'on' : 'after',
          amount: step.offset ? String(step.offset.amount) : '',
          unit: step.offset?.unit ?? 'weeks',
          date: step.date ?? '',
        }
      }),
    )
  }

  function update(key: number, patch: Partial<StepDraft>) {
    setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  const rows = steps.map((s) => {
    const read = readStep(s)
    const ymd = read.complete ? stepDate(startsOn, { offset: read.offset, date: read.date }) : null
    const at = ymd ? new Date(`${ymd}T${time || '10:00'}:00`) : null
    return { s, read, ymd, past: at ? at.getTime() < now : false }
  })
  const ready = rows.filter((r) => r.read.complete)
  const incomplete = rows.filter((r) => !r.read.complete && !r.read.empty)
  const toBook = ready.filter((r) => !r.past).length
  const canSave = title.trim() && startsOn && ready.length > 0 && incomplete.length === 0 && toBook > 0

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const r = await api<{ schedule: ScheduleDTO; booked: number; skippedPast: number }>(
        '/schedules',
        {
          method: 'POST',
          body: {
            title: title.trim(),
            startsOn,
            hour: Number.isFinite(hour) ? hour : 10,
            minute: Number.isFinite(minute) ? minute : 0,
            kind: 'meeting',
            steps: ready.map((r) => ({
              title: r.s.title.trim(),
              offset: r.read.offset,
              date: r.read.date,
            })),
          },
        },
      )
      announceChange()
      setSaved(r)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    const next = saved.schedule.next
    return (
      <div className="stack tight">
        <strong>
          {saved.booked} step{saved.booked === 1 ? '' : 's'} of {saved.schedule.title} booked.
        </strong>
        <p className="muted small">
          {next
            ? `Next: ${next.title.replace(`${saved.schedule.title} — `, '')}, ${dayLabel(next.dueAt)} (${relativeDay(next.dueAt)}). `
            : ''}
          {saved.skippedPast > 0
            ? `${saved.skippedPast} already past ${saved.skippedPast === 1 ? 'was' : 'were'} left out. `
            : ''}
          Each one reminds you on its day, and the whole schedule is on the Repeating page.
        </p>
        <div className="form-actions">
          <button className="primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stack tight schedule-form">
      <button className="quick-more" onClick={onBack}>
        Back to a single plan
      </button>

      {SCHEDULE_TEMPLATES.length > 0 && (
        <section className="card schedule-template">
          <label>
            Start from a template (optional)
            <select
              value={template?.id ?? ''}
              onChange={(e) => (e.target.value ? applyTemplate(e.target.value) : setTemplate(null))}
            >
              <option value="">— my own steps —</option>
              {SCHEDULE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {template && <p className="schedule-caution">{template.caution}</p>}
        </section>
      )}

      <section className="card">
        <label>
          What is the schedule?
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Aarav's vaccinations"
            autoFocus={!template}
          />
        </label>
        <div className="row schedule-start">
          <label className="grow">
            {template ? template.startLabel : 'Counting from'}
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </label>
          <label className="grow">
            At
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <p className="muted small">
          The date the steps are counted from — a date of birth, the first dose, the start of a
          course.
        </p>
      </section>

      <section className="card">
        <span className="label-text">Steps</span>
        <ol className="schedule-steps">
          {rows.map(({ s, read, ymd, past }, i) => (
            <li key={s.key} className="schedule-step">
              <div className="schedule-step-fields">
                <input
                  value={s.title}
                  onChange={(e) => update(s.key, { title: e.target.value })}
                  placeholder={i === 0 ? 'What happens, e.g. BCG, OPV-0' : 'What happens (optional)'}
                  aria-label={`Step ${i + 1}: what happens`}
                />
                <div className="schedule-when">
                  <select
                    value={s.mode}
                    onChange={(e) => update(s.key, { mode: e.target.value as StepDraft['mode'] })}
                    aria-label={`Step ${i + 1}: how its date is set`}
                  >
                    <option value="after">after</option>
                    <option value="on">on</option>
                  </select>
                  {s.mode === 'after' ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={s.amount}
                        onChange={(e) => update(s.key, { amount: e.target.value })}
                        placeholder="6"
                        aria-label={`Step ${i + 1}: how many`}
                      />
                      <select
                        value={s.unit}
                        onChange={(e) => update(s.key, { unit: e.target.value as ScheduleUnit })}
                        aria-label={`Step ${i + 1}: unit`}
                      >
                        {SCHEDULE_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <input
                      type="date"
                      value={s.date}
                      onChange={(e) => update(s.key, { date: e.target.value })}
                      aria-label={`Step ${i + 1}: date`}
                    />
                  )}
                  <button
                    className="link schedule-remove"
                    onClick={() => setSteps((list) => list.filter((x) => x.key !== s.key))}
                    aria-label={`Remove step ${i + 1}`}
                    disabled={steps.length === 1}
                  >
                    ×
                  </button>
                </div>
              </div>
              <p className={`schedule-date${past ? ' is-past' : ''}`}>
                {ymd
                  ? past
                    ? `${dayLabel(ymd)} — already past, will be left out`
                    : `${dayLabel(ymd)} · ${relativeDay(ymd)}${
                        read.offset
                          ? read.offset.amount === 0
                            ? ' · at the start'
                            : ` · ${offsetLabel(read.offset).toLowerCase()} after the start`
                          : ''
                      }`
                  : read.empty
                    ? ' '
                    : 'Needs a when'}
              </p>
            </li>
          ))}
        </ol>
        <button
          className="ghost small-btn fit-btn"
          onClick={() => setSteps((list) => [...list, blankStep(list.at(-1)?.unit)])}
        >
          + Add a step
        </button>
      </section>

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button className="primary" onClick={() => void save()} disabled={!canSave || saving}>
          {saving
            ? 'Booking…'
            : toBook > 0
              ? `Book ${toBook} step${toBook === 1 ? '' : 's'}`
              : 'Book the steps'}
        </button>
      </div>
      {incomplete.length > 0 && (
        <p className="muted small">
          {incomplete.length} step{incomplete.length === 1 ? ' needs' : 's need'} a when — a gap
          after the start or a date.
        </p>
      )}
    </div>
  )
}
