import { useState } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONGEST = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * A day and a month, with no year: a birthday as people know it. Value is
 * "MM-DD", or null until both halves are chosen. Each half is kept while the
 * other is still being picked.
 */
export function MonthDayInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | null
  onChange: (next: string | null) => void
}) {
  const [initialMonth, initialDay] = value ? value.split('-').map(Number) : [0, 0]
  const [month, setMonth] = useState(initialMonth ?? 0)
  const [day, setDay] = useState(initialDay ?? 0)
  const pad = (n: number) => String(n).padStart(2, '0')

  function set(m: number, d: number) {
    // 31 April becomes 30 April rather than refusing the month that was picked.
    const fitted = m && d ? Math.min(d, LONGEST[m - 1]!) : d
    setMonth(m)
    setDay(fitted)
    onChange(m && fitted ? `${pad(m)}-${pad(fitted)}` : null)
  }

  return (
    <div className="month-day">
      <span className="label-text">{label}</span>
      <div className="row">
        <select value={day || ''} onChange={(e) => set(month, Number(e.target.value))} aria-label={`${label} day`}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        <select value={month || ''} onChange={(e) => set(Number(e.target.value), day)} aria-label={`${label} month`}>
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        {(month > 0 || day > 0) && (
          <button className="link small" onClick={() => set(0, 0)}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
