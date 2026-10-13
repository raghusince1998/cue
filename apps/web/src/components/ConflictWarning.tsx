import type { ConflictReport, LocationConflictDTO } from '@cue/shared'
import { formatDateTime, formatTime } from '../lib/time.ts'
import { t } from '../lib/i18n.tsx'

/**
 * Shown wherever a time is chosen — the capture screen and the commitment
 * editor both need it, and both offer the same three ways out: move mine,
 * move theirs, or knowingly double-book.
 */
export function ConflictWarning({
  report,
  allowConflict,
  onAllowConflictChange,
  onUseSuggestion,
  onShiftExisting,
  /**
   * True when the clashing time is the form's opening guess rather than a time
   * the user picked. The same facts, told as information instead of a problem —
   * nobody should be told to fix a decision they have not made yet.
   */
  suggestedTimeOnly,
}: {
  report: ConflictReport
  allowConflict: boolean
  onAllowConflictChange: (value: boolean) => void
  onUseSuggestion: (iso: string) => void
  onShiftExisting?: (id: string, to: string) => void
  suggestedTimeOnly?: boolean
}) {
  const { conflicts, suggestions } = report
  const locations = report.locationConflicts ?? []
  if (conflicts.length === 0 && locations.length === 0) return null

  const firstSuggestion = suggestions[0]

  // Where-based problems read differently from clock ones and deserve their own
  // block: the answer is rarely "pick another slot", it is "decide which of
  // these two you actually want".
  const locationBlock = locations.length > 0 && (
    <div className={`conflict${locations.some((l) => l.severity === 'impossible') ? '' : ' warn'}`}>
      <strong>
        {locations.some((l) => l.severity === 'impossible')
          ? t('This looks impractical')
          : t('Worth a look')}
      </strong>
      {locations.map((l: LocationConflictDTO, i) => (
        <div key={i} className="stack tight">
          <p className="notes">{l.reason}</p>
          {l.travel && (
            <p className="muted small">
              {t('About {km} km · roughly {hours} hours · estimated, not a routed journey', {
                km: l.travel.distanceKm,
                hours: Math.round(l.travel.minutes / 6) / 10,
              })}
            </p>
          )}
          <p className="muted small">{l.suggestedActions.join(' · ')}</p>
        </div>
      ))}
      <p className="muted small">
        {t(
          'Nothing is blocked — you can save this anyway. It is only flagged so the decision is yours rather than a surprise later.',
        )}
      </p>
    </div>
  )

  if (conflicts.length === 0) return <>{locationBlock}</>

  return (
    <>
    {locationBlock}
    <div className={`conflict${suggestedTimeOnly ? ' warn' : ''}`}>
      <strong>
        {suggestedTimeOnly
          ? conflicts.length === 1
            ? t('That default time is taken — you already have something then')
            : t('That default time is taken — you already have {n} things then', { n: conflicts.length })
          : conflicts.length === 1
            ? t('You already have something booked then')
            : t('You already have {n} things booked then', { n: conflicts.length })}
      </strong>
      {suggestedTimeOnly && (
        <p className="muted small">
          {t('Nothing is blocked — this is just the time the form opened on. Pick another below, or save anyway.')}
        </p>
      )}

      <ul className="plain">
        {conflicts.map((c) => (
          <li key={c.id}>
            <span className="commitment-title">{c.title}</span>
            <br />
            <span className="muted small">
              {formatDateTime(c.dueAt)} · {t('blocks {n} min', { n: c.durationMinutes })}
              {c.placeName ? ` · ${c.placeName}` : ''}
            </span>
          </li>
        ))}
      </ul>

      {suggestions.length > 0 && (
        <>
          <span className="label-text">{t('Move this one to a free slot')}</span>
          <div className="chips">
            {suggestions.map((s) => (
              <button key={s} className="chip" onClick={() => onUseSuggestion(s)}>
                {formatTime(s)}
              </button>
            ))}
          </div>

          {onShiftExisting && conflicts.length === 1 && firstSuggestion && (
            <button
              className="ghost small-btn"
              onClick={() => onShiftExisting(conflicts[0]!.id, firstSuggestion)}
            >
              {t('Or shift “{title}” to {time} instead', {
                title: conflicts[0]!.title,
                time: formatTime(firstSuggestion),
              })}
            </button>
          )}
        </>
      )}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={allowConflict}
          onChange={(e) => onAllowConflictChange(e.target.checked)}
        />
        <span>{t('Book both anyway — I know they overlap')}</span>
      </label>
    </div>
    </>
  )
}
