import type { PlaceSuggestionDTO } from '@cue/shared'
import { formatDateTime } from '../lib/time.ts'
import { rich, t } from '../lib/i18n.tsx'

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
  if (days <= 0) return t('the same day')
  if (days === 1) return t('the next day')
  if (days < 14) return t('after {n} days', { n: days })
  if (days < 60) return t('after about {n} weeks', { n: Math.round(days / 7) })
  return t('after about {n} months', { n: Math.round(days / 30) })
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
    contact ? t('met {name}', { name: contact.name }) : null,
    outcome ? t('marked it {outcome}', { outcome }) : null,
    lastCommitment && suggestion.typicalIntervalDays !== null
      ? t('followed up {gap}', { gap: describeGap(Math.round(suggestion.typicalIntervalDays)) })
      : null,
  ].filter(Boolean)

  return (
    <section className="card repeat-card">
      <div>
        <h2 className="repeat-title">{t('You’re at {place}', { place: suggestion.placeName })}</h2>
        <p className="muted small">
          {t('Visit {n}', { n: visitCount + 1 })}
          {daysSinceLast !== null &&
            ` · ${daysSinceLast === 0 ? t('last one today') : t('last one {n} days ago', { n: daysSinceLast })}`}
        </p>
      </div>

      {lastTime.length > 0 && (
        <p className="repeat-summary">
          {t('Last time you {list}.', { list: lastTime.join(', ') })}
        </p>
      )}

      {dueAt && lastCommitment && (
        <p className="muted small">
          {rich('Repeating that books “{title}” for {time}.', {
            title: lastCommitment.title,
            time: <strong>{formatDateTime(dueAt.toISOString())}</strong>,
          })}
        </p>
      )}

      <div className="row">
        <button className="primary" onClick={onAccept} disabled={busy}>
          {busy ? t('Saving…') : t('Same again')}
        </button>
        <button className="ghost" onClick={onDismiss} disabled={busy}>
          {t('Something else')}
        </button>
      </div>
    </section>
  )
}
