import type { PlaceSuggestionDTO } from '@cue/shared'
import { formatDateTime } from '../lib/time.ts'

/**
 * Turns the stored pattern into the actual time to propose: the usual gap from
 * now, keeping the time of day you normally pick. Done on the client because
 * only the device knows its timezone.
 */
export function suggestedDueAt(suggestion: PlaceSuggestionDTO): Date | null {
  if (suggestion.typicalIntervalDays === null || !suggestion.lastCommitment) return null

  const target = new Date(Date.now() + suggestion.typicalIntervalDays * 86_400_000)
  const previous = new Date(suggestion.lastCommitment.dueAt)
  target.setHours(previous.getHours(), previous.getMinutes(), 0, 0)

  // Rounding the time of day down can land the suggestion in the past.
  if (target.getTime() < Date.now()) target.setDate(target.getDate() + 1)
  return target
}

function describeGap(days: number): string {
  if (days <= 0) return 'the same day'
  if (days === 1) return 'the next day'
  if (days < 14) return `after ${days} days`
  if (days < 60) return `after about ${Math.round(days / 7)} weeks`
  return `after about ${Math.round(days / 30)} months`
}

export function RepeatVisitCard({
  suggestion,
  dueAt,
  busy,
  onAccept,
  onDismiss,
}: {
  suggestion: PlaceSuggestionDTO
  dueAt: Date | null
  busy: boolean
  onAccept: () => void
  onDismiss: () => void
}) {
  const { contact, outcome, visitCount, daysSinceLast, lastCommitment } = suggestion

  const lastTime = [
    contact ? `met ${contact.name}` : null,
    outcome ? `marked it ${outcome}` : null,
    lastCommitment && suggestion.typicalIntervalDays !== null
      ? `followed up ${describeGap(Math.round(suggestion.typicalIntervalDays))}`
      : null,
  ].filter(Boolean)

  return (
    <section className="card repeat-card">
      <div>
        <h2 className="repeat-title">You&rsquo;re at {suggestion.placeName}</h2>
        <p className="muted small">
          Visit {visitCount + 1}
          {daysSinceLast !== null &&
            ` · last one ${daysSinceLast === 0 ? 'today' : `${daysSinceLast} days ago`}`}
        </p>
      </div>

      {lastTime.length > 0 && (
        <p className="repeat-summary">
          Last time you {lastTime.join(', ')}.
        </p>
      )}

      {dueAt && lastCommitment && (
        <p className="muted small">
          Repeating that books &ldquo;{lastCommitment.title}&rdquo; for{' '}
          <strong>{formatDateTime(dueAt.toISOString())}</strong>.
        </p>
      )}

      <div className="row">
        <button className="primary" onClick={onAccept} disabled={busy}>
          {busy ? 'Saving…' : 'Same again'}
        </button>
        <button className="ghost" onClick={onDismiss} disabled={busy}>
          Something else
        </button>
      </div>
    </section>
  )
}
