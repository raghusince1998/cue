import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { daysAway, type ExamGlance as Glance, type ExamGlanceItem, type ExamStep } from '@cue/shared'
import { api } from '../lib/api.ts'
import { useOnChange } from '../lib/changes.ts'
import { useExamWords } from '../lib/examWords.ts'

/**
 * For an aspirant, Today leads with the exams: the next one and how far off
 * it is, a last date to apply or pay in the next two weeks, and dates that
 * clash. Nothing at all for anyone with no exam still going.
 */
export function ExamGlance() {
  const w = useExamWords()
  const [glance, setGlance] = useState<Glance | null>(null)
  const load = useCallback(async () => {
    try {
      setGlance(await api<Glance>('/exams/glance'))
    } catch {
      // Not worth a message: the rest of Today still works.
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useOnChange(() => void load())

  if (!glance || (!glance.next && glance.soon.length === 0 && glance.clashes.length === 0)) return null
  const what = (i: ExamGlanceItem) => (i.round ? `${i.label} — ${w.stage(i.examKey, i.round)}` : i.label)
  const next = glance.next
  const away = next ? daysAway(next.on) : null
  return (
    <section className="card exam-glance" lang={w.lang}>
      <div className="row exam-glance-head">
        <h2 className="section-title">{w.title}</h2>
        <Link to="/exams" className="small">
          {w.allExams}
        </Link>
      </div>
      {next && away !== null && (
        <div className="exam-glance-next">
          <strong>{what(next)}</strong>
          <span className={`exam-countdown${away <= 7 ? ' is-near' : ''}`}>{w.daysToGo(away)}</span>
          <span className="muted small">{w.day(next.on)}</span>
        </div>
      )}
      {glance.soon.length > 0 && (
        <ul className="plain exam-glance-soon">
          {glance.soon.map((s) => {
            const n = daysAway(s.on)
            return (
              <li key={`${s.examId}-${s.step}-${s.on}`} className="small">
                <strong>{w.step(s.step as ExamStep)}</strong> · {s.label} ·{' '}
                <span className={n <= 3 ? 'exam-glance-near' : 'muted'}>
                  {w.day(s.on)}, {w.inDays(n)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {glance.clashes.map((k) => (
        <p key={`${k.on}-${k.a}-${k.b}`} className="small exam-glance-clash">
          {w.datesClash(k.a, k.b, w.day(k.on))}
        </p>
      ))}
    </section>
  )
}
