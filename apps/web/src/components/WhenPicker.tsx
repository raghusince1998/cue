import { DEFAULT_WINDOW_HOURS, TIME_WINDOWS, WINDOW_LABELS, type TimeWindow } from '@cue/shared'
import { msg, t } from '../lib/i18n.tsx'
import { toDateInputValue } from '../lib/time.ts'

/**
 * When a plan is: at a set time, or any time in a part of the day. One picker
 * for the Add box's preview and for editing a plan already saved, so "the
 * evening" can become "7:30" (and back) wherever it is changed.
 */

export interface When {
  at: Date
  flexibility: 'fixed' | 'flexible'
  window: TimeWindow | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** The day kept, the hour put at the start of that part of the day. */
export function atWindow(day: Date, window: TimeWindow): Date {
  const d = new Date(day)
  d.setHours(DEFAULT_WINDOW_HOURS[window].from, 0, 0, 0)
  return d
}

/** Shown with t(). */
const SHORTCUTS = [
  { label: msg('Today'), days: 0 },
  { label: msg('Tomorrow'), days: 1 },
] as const

export function WhenPicker({ value, onChange }: { value: When; onChange: (next: When) => void }) {
  const fixed = value.flexibility === 'fixed'

  /** A new day, keeping the time (or the part of the day). */
  function setDay(day: Date) {
    const at = new Date(day)
    at.setHours(value.at.getHours(), value.at.getMinutes(), 0, 0)
    onChange({ ...value, at: fixed || !value.window ? at : atWindow(at, value.window) })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const sameDay = (days: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() + days)
    return toDateInputValue(d) === toDateInputValue(value.at)
  }

  return (
    <div className="when-picker">
      <div className="chips" role="group" aria-label={t('When?')}>
        <button
          type="button"
          className={`chip${fixed ? ' selected' : ''}`}
          aria-pressed={fixed}
          onClick={() => onChange({ ...value, flexibility: 'fixed', window: null })}
        >
          {t('At a set time')}
        </button>
        <button
          type="button"
          className={`chip${!fixed ? ' selected' : ''}`}
          aria-pressed={!fixed}
          onClick={() => {
            const window = value.window ?? 'evening'
            onChange({ at: atWindow(value.at, window), flexibility: 'flexible', window })
          }}
        >
          {t('Morning, evening…')}
        </button>
      </div>

      <div className="when-row">
        <label>
          {t('Date')}
          <input
            type="date"
            value={toDateInputValue(value.at)}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split('-').map(Number)
              if (y && m && d) setDay(new Date(y, m - 1, d))
            }}
          />
        </label>
        {fixed && (
          <label>
            {t('Time')}
            <input
              type="time"
              value={timeValue(value.at)}
              onChange={(e) => {
                const [h, min] = e.target.value.split(':').map(Number)
                if (h === undefined || min === undefined || Number.isNaN(h) || Number.isNaN(min)) return
                const at = new Date(value.at)
                at.setHours(h, min, 0, 0)
                onChange({ ...value, at })
              }}
            />
          </label>
        )}
      </div>

      <div className="chips">
        {SHORTCUTS.map((s) => (
          <button
            key={s.label}
            type="button"
            className={`chip${sameDay(s.days) ? ' selected' : ''}`}
            onClick={() => {
              const d = new Date(today)
              d.setDate(d.getDate() + s.days)
              setDay(d)
            }}
          >
            {t(s.label)}
          </button>
        ))}
      </div>

      {!fixed && (
        <div className="chips" role="group" aria-label={t('Morning, evening…')}>
          {TIME_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className={`chip${value.window === w ? ' selected' : ''}`}
              aria-pressed={value.window === w}
              onClick={() => onChange({ at: atWindow(value.at, w), flexibility: 'flexible', window: w })}
            >
              {t(WINDOW_LABELS[w])}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
