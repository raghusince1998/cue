import { useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api.ts'
import { formatSpan } from '../lib/time.ts'

interface ExtractedEvent {
  title: string
  kind: 'meeting' | 'callback' | 'task' | 'followup'
  /** Local wall-clock, no zone — parsed in the browser's own timezone. */
  startsAt: string
  endsAt?: string | null
  allDay?: boolean
  durationMinutes?: number | null
  place?: string | null
  notes?: string | null
}

interface ExtractionResult {
  events: ExtractedEvent[]
  provider: string
  warnings: string[]
}

/**
 * Shows what the model made of a dictated sentence and lets the user approve
 * it. Nothing reaches the database until they press Add — a misread date should
 * cost a rejected suggestion, never a wrong entry in a real calendar.
 */
export function ExtractReview({
  text,
  onDone,
  onCancel,
}: {
  text: string
  onDone: (added: number) => void
  onCancel: () => void
}) {
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api<ExtractionResult>('/ai/extract', { method: 'POST', body: { text } })
      .then((r) => {
        if (cancelled) return
        setResult(r)
        setChosen(new Set(r.events.map((_, i) => i)))
      })
      .catch((err) => {
        if (cancelled) return
        const code = err instanceof ApiError ? err.code : ''
        setError(
          code === 'ai_not_configured'
            ? 'No AI provider is set up yet — add one in Settings.'
            : code === 'extraction_failed'
              ? 'The provider could not be reached, or rejected the request. Check the key in Settings.'
              : (err as Error).message,
        )
      })
    return () => {
      cancelled = true
    }
  }, [text])

  function toggle(index: number) {
    const next = new Set(chosen)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setChosen(next)
  }

  async function addSelected() {
    if (!result) return
    setSaving(true)
    setError(null)

    let added = 0
    try {
      for (const [index, event] of result.events.entries()) {
        if (!chosen.has(index)) continue

        // Wall-clock strings become instants in the browser's own timezone,
        // which is the only place that knows what the user meant.
        const startsAt = new Date(event.startsAt)
        const endsAt = event.endsAt ? new Date(event.endsAt) : null

        await api('/commitments', {
          method: 'POST',
          body: {
            title: event.title,
            kind: event.kind,
            dueAt: startsAt.toISOString(),
            endsAt: endsAt ? endsAt.toISOString() : null,
            allDay: Boolean(event.allDay),
            ...(event.durationMinutes ? { durationMinutes: event.durationMinutes } : {}),
            notes: event.notes ?? null,
            // Everything here was extracted at once and is meant to coexist —
            // sessions inside a trip would otherwise all report clashes.
            allowConflict: true,
          },
        })
        added += 1
      }
      onDone(added)
    } catch (err) {
      setError(`Added ${added} before failing: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return (
      <div className="stack tight">
        <p className="error">{error}</p>
        <button className="ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="stack tight">
        <div className="boot">
          <span className="spinner" />
        </div>
        <p className="muted small center">Reading what you said…</p>
      </div>
    )
  }

  if (result.events.length === 0) {
    return (
      <div className="stack tight">
        <p>Could not find anything schedulable in that.</p>
        <p className="muted small">
          Try naming the days explicitly — &ldquo;1 and 2 September&rdquo; rather than
          &ldquo;first and second&rdquo;.
        </p>
        <button className="ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="stack tight">
      <p className="muted small">
        Found {result.events.length} {result.events.length === 1 ? 'thing' : 'things'}. Untick
        anything you do not want.
      </p>

      <ul className="plain">
        {result.events.map((event, index) => (
          <li key={index} className={`voice-note${chosen.has(index) ? '' : ' dimmed'}`}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={chosen.has(index)}
                onChange={() => toggle(index)}
              />
              <span>
                <span className="commitment-title">{event.title}</span>
                <br />
                <span className="muted small">
                  {formatSpan(
                    new Date(event.startsAt).toISOString(),
                    event.endsAt ? new Date(event.endsAt).toISOString() : null,
                    Boolean(event.allDay),
                  )}
                  {event.durationMinutes ? ` · ${event.durationMinutes} min` : ''}
                  {event.place ? ` · ${event.place}` : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {result.warnings.length > 0 && (
        <div className="conflict">
          <strong>Worth checking</strong>
          <ul className="plain">
            {result.warnings.map((w) => (
              <li key={w} className="muted small">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row">
        <button
          className="primary"
          onClick={addSelected}
          disabled={saving || chosen.size === 0}
        >
          {saving ? 'Adding…' : `Add ${chosen.size} to my list`}
        </button>
        <button className="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}
