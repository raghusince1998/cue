import { locale, msg, t } from './i18n.tsx'

/** Local-day boundaries, since the API deliberately knows nothing about the device timezone. */
export function dayBounds(date = new Date()): { from: string; to: string } {
  const from = new Date(date)
  from.setHours(0, 0, 0, 0)
  const to = new Date(date)
  to.setHours(23, 59, 59, 999)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(date, today)) return t('Today {time}', { time: formatTime(iso) })
  if (sameDay(date, tomorrow)) return t('Tomorrow {time}', { time: formatTime(iso) })

  return date.toLocaleString(locale(), {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function overdueBy(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return t('just now')
  if (minutes < 60) return t('{n} min', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('{n}h', { n: hours })
  const days = Math.floor(hours / 24)
  return t('{n}d', { n: days })
}

/** Value for an <input type="datetime-local">, which wants local time with no zone. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export interface DuePreset {
  label: string
  at: () => Date
}

/** The realistic answers to "when did they say to come back?" — one tap each. Show the label with t(). */
export const duePresets: DuePreset[] = [
  { label: msg('In 1 hour'), at: () => new Date(Date.now() + 60 * 60_000) },
  { label: msg('In 3 hours'), at: () => new Date(Date.now() + 3 * 60 * 60_000) },
  {
    label: msg('Tomorrow 10am'),
    at: () => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(10, 0, 0, 0)
      return d
    },
  },
  {
    label: msg('In 3 days'),
    at: () => {
      const d = new Date()
      d.setDate(d.getDate() + 3)
      d.setHours(10, 0, 0, 0)
      return d
    },
  },
  {
    label: msg('Next week'),
    at: () => {
      const d = new Date()
      d.setDate(d.getDate() + 7)
      d.setHours(10, 0, 0, 0)
      return d
    },
  },
]

/** Value for an <input type="date">. */
export function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * How an item reads on a list. A three-day trip has a shape, not a start time,
 * so an all-day item shows dates and a timed one shows the clock.
 */
export function formatSpan(
  dueAt: string,
  endsAt: string | null,
  allDay: boolean,
): string {
  const start = new Date(dueAt)
  const end = endsAt ? new Date(endsAt) : null

  if (!allDay) {
    return end && end.toDateString() !== start.toDateString()
      ? `${formatDateTime(dueAt)} → ${formatDateTime(endsAt!)}`
      : formatDateTime(dueAt)
  }

  const dayOnly = (d: Date) =>
    d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })

  if (!end || end.toDateString() === start.toDateString()) {
    return t('{day} · all day', { day: dayOnly(start) })
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  return t('{from} → {to} · {n} days', { from: dayOnly(start), to: dayOnly(end), n: days })
}

/**
 * Dates as people write them.
 *
 * Four screens were showing raw ISO — "2026-10-02 → 2026-10-04" — which is the
 * database's format, not anybody's. These are the shapes those pages need.
 */

/** "Fri 2 Oct", and the year only when it is not this one. */
export function dayLabel(value: string | Date): string {
  const d = typeof value === 'string' ? parseDay(value) : value
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(locale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** "2 – 4 Oct", collapsing whatever the two ends share. */
export function spanLabel(from: string | Date, to: string | Date): string {
  const a = typeof from === 'string' ? parseDay(from) : from
  const b = typeof to === 'string' ? parseDay(to) : to

  if (a.toDateString() === b.toDateString()) return dayLabel(a)

  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
  const month = (d: Date) => d.toLocaleDateString(locale(), { month: 'short' })
  const year = b.getFullYear() === new Date().getFullYear() ? '' : ` ${b.getFullYear()}`

  return sameMonth
    ? `${a.getDate()} – ${b.getDate()} ${month(b)}${year}`
    : `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}${year}`
}

/** "in 5 days", "tomorrow", "3 days ago" — relative, for things with a date. */
export function relativeDay(value: string | Date): string {
  const d = typeof value === 'string' ? parseDay(value) : value
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)

  if (days === 0) return t('today')
  if (days === 1) return t('tomorrow')
  if (days === -1) return t('yesterday')
  // Pluralised properly: "1 weeks ago" is the kind of detail that makes a
  // screen feel unfinished even when nobody can say why.
  const UNITS = {
    day: [msg('1 day'), msg('{n} days')],
    week: [msg('1 week'), msg('{n} weeks')],
    month: [msg('1 month'), msg('{n} months')],
    year: [msg('1 year'), msg('{n} years')],
  } as const
  const unit = (n: number, word: keyof typeof UNITS) => (n === 1 ? t(UNITS[word][0]) : t(UNITS[word][1], { n }))
  // Weeks stop meaning anything past a couple of months: a vaccination
  // schedule runs to sixteen years, and "in 825 weeks" is not a date anyone
  // can picture.
  const span = (d: number) =>
    d < 7
      ? unit(d, 'day')
      : d < 60
        ? unit(Math.round(d / 7), 'week')
        : d < 730
          ? unit(Math.round(d / 30.44), 'month')
          : unit(Math.round(d / 365.25), 'year')
  if (days > 0) return t('in {span}', { span: span(days) })
  return t('{span} ago', { span: span(Math.abs(days)) })
}

/**
 * A YYYY-MM-DD string as a local date.
 *
 * `new Date('2026-10-02')` is midnight UTC, which is the previous evening in
 * Kolkata — the same off-by-one that has bitten this codebase three times.
 */
function parseDay(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
}

/** "RY" from "Ramesh Yadav" — the anchor a contact list needs to be scannable. */
export function initials(name: string): string {
  const parts = name.trim().replace(/^the\s+/i, '').split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts.at(-1)![0]!).toUpperCase()
}
