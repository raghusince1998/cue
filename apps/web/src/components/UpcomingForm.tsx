import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  SELECTABLE_KINDS,
  DEFAULT_DURATION_MINUTES,
  DURATION_CHOICES,
  KIND_LABELS,
  type CommitmentKind,
  type ConflictReport,
  type ContactDTO,
  type PlaceDTO,
  type Flexibility,
  type Priority,
  type SlotSuggestion,
  type TimeWindow,
  PRIORITIES,
  PRIORITY_LABELS,
  TIME_WINDOWS,
  WINDOW_LABELS,
  parseWhen,
  parseIntention,
  parseTrip,
  parseRecurrence,
  stripRecurrence,
  describeRecurrence,
  expandRecurrence,
  diagnose,
  findMalformedTime,
  originalIfInformative,
  placeFrom,
  titleFrom,
  type Frequency,
  type RecurrenceRule,
} from '@cue/shared'
import { ApiError, api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { loadContacts, loadPlaces } from '../lib/cache.ts'
import { language, locale, msg, rich, t } from '../lib/i18n.tsx'
import { duePresets, formatDateTime, formatSpan, toDateInputValue, toLocalInputValue } from '../lib/time.ts'
import { ConflictWarning } from './ConflictWarning.tsx'
import { DictateButton } from './DictateButton.tsx'
import { Modal } from './Modal.tsx'
import { ExtractReview } from './ExtractReview.tsx'

interface PlannedRepeat {
  title: string
  rule: ReturnType<typeof parseRecurrence> extends null ? never : NonNullable<ReturnType<typeof parseRecurrence>>['rule']
  summary: string
  hour: number
  minute: number
  /** First real occurrence, YYYY-MM-DD. */
  startsOn: string
  firstAt: Date | null
  /** True when no clock time was given and 9am was assumed. */
  timeAssumed: boolean
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Works out what a repeating sentence actually means: the title with the
 * recurrence words removed, the time of day, and — the part that matters — the
 * first occurrence that is genuinely still ahead.
 *
 * Anchoring the series on today would be wrong for "1st of every month" typed
 * on the 20th: the rule would be right but the first occurrence would sit in
 * the past, and the first thing the user saw would be an overdue item.
 */
function planRepeat(
  input: string,
  parsedRepeat: NonNullable<ReturnType<typeof parseRecurrence>>,
): PlannedRepeat {
  const rest = stripRecurrence(input, parsedRepeat)
  const when = parseWhen(rest)

  // parseWhen falls back to 9am whenever no time was said; a window like
  // "every evening" carries its representative hour, which is what we want.
  const hour = when ? when.date.getHours() : 9
  const minute = when ? when.date.getMinutes() : 0

  const now = new Date()
  const horizon = new Date(now.getTime())
  horizon.setFullYear(horizon.getFullYear() + 2)

  const [firstAt] = expandRecurrence(
    parsedRepeat.rule,
    { startsOn: now, hour, minute },
    { from: now, to: horizon },
  )

  return {
    title: when ? titleFrom(rest, when) : rest,
    rule: parsedRepeat.rule,
    summary: describeRecurrence(parsedRepeat.rule, { startsOn: firstAt ?? now, hour, minute }, language()),
    hour,
    minute,
    startsOn: ymd(firstAt ?? now),
    firstAt: firstAt ?? null,
    timeAssumed: !when || when.timeAssumed,
  }
}

/**
 * Something that has not happened yet — a dentist appointment, a client call,
 * a task with a deadline.
 *
 * The app could previously only record things *backwards*: log a visit, and a
 * follow-up falls out of it. That works for field work and not at all for the
 * rest of life, where half of what you need to remember is simply an
 * appointment somebody gave you.
 */
type RepeatChoice = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom'

// Labels here are shown with t().
const REPEAT_CHOICES: { value: RepeatChoice; label: string }[] = [
  { value: 'none', label: msg("Doesn't repeat") },
  { value: 'daily', label: msg('Every day') },
  { value: 'weekdays', label: msg('Weekdays') },
  { value: 'weekly', label: msg('Every week') },
  { value: 'monthly', label: msg('Every month') },
  { value: 'yearly', label: msg('Every year') },
  { value: 'custom', label: msg('Every few…') },
]

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_NAMES = [
  msg('Sunday'),
  msg('Monday'),
  msg('Tuesday'),
  msg('Wednesday'),
  msg('Thursday'),
  msg('Friday'),
  msg('Saturday'),
]
const CUSTOM_UNITS: { freq: Frequency; label: string }[] = [
  { freq: 'daily', label: msg('days') },
  { freq: 'weekly', label: msg('weeks') },
  { freq: 'monthly', label: msg('months') },
  { freq: 'yearly', label: msg('years') },
]

/** A day's one-letter name in English; in Hindi, which has none (शुक्र, शनि), its short name. */
function weekdayLetter(day: number, letter: string): string {
  const lang = locale()
  // 7 January 2024 was a Sunday.
  return lang ? new Date(2024, 0, 7 + day).toLocaleDateString(lang, { weekday: 'short' }) : letter
}

export function UpcomingForm({
  onDone,
  initialQuick = '',
  initialRepeat = false,
  onSchedule,
}: {
  /** Saved or cancelled: the sheet this lives in closes. */
  onDone: () => void
  /** A sentence the one-line box could not read, so it is not typed twice. */
  initialQuick?: string
  /** Open with "every week" already chosen — from the Repeating page. */
  initialRepeat?: boolean
  /** "Irregular dates…": hand over to the schedule form, with the title so far. */
  onSchedule?: (title: string) => void
}) {
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<CommitmentKind>('meeting')
  const [dueAt, setDueAtRaw] = useState<Date>(() => duePresets[2]!.at())
  /**
   * False until the time is actually the user's choice.
   *
   * The form opens on "tomorrow 10am" because it has to open on something. If
   * that guess happens to land on an existing meeting, blocking the save makes
   * the app refuse to proceed over a decision the user never made — they had
   * typed nothing at all. A clash with the opening guess is worth showing and
   * not worth blocking on; the server re-checks at save time either way, so
   * nothing can slip through.
   */
  const [timeChosen, setTimeChosen] = useState(false)

  const setDueAt = useCallback((next: Date) => {
    setDueAtRaw(next)
    setTimeChosen(true)
  }, [])
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION_MINUTES.meeting)
  const [notes, setNotes] = useState('')

  const [places, setPlaces] = useState<PlaceDTO[]>([])
  const [contacts, setContacts] = useState<ContactDTO[]>([])
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)

  const [flexibility, setFlexibility] = useState<Flexibility>('fixed')
  const [preferredWindow, setPreferredWindow] = useState<TimeWindow>('evening')
  const [priority, setPriority] = useState<Priority>('normal')
  const [slots, setSlots] = useState<SlotSuggestion[]>([])

  const [placeLabel, setPlaceLabel] = useState('')
  const [allDay, setAllDay] = useState(false)

  // Repeating, chosen rather than typed. Until now the only way to make a
  // plan repeat was to know to write "every tuesday" in the text box.
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>(initialRepeat ? 'weekly' : 'none')
  const [repeatDays, setRepeatDays] = useState<number[]>([])
  const [customEvery, setCustomEvery] = useState(2)
  const [customFreq, setCustomFreq] = useState<Frequency>('weekly')
  const [repeatEnd, setRepeatEnd] = useState<'never' | 'count' | 'until'>('never')
  const [repeatCount, setRepeatCount] = useState(10)
  const [repeatUntil, setRepeatUntil] = useState(() =>
    toDateInputValue(new Date(Date.now() + 90 * 86_400_000)),
  )
  const [endsOn, setEndsOn] = useState<Date>(() => new Date())
  const [quick, setQuick] = useState(initialQuick)
  const [aiProvider, setAiProvider] = useState<string>('none')
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ConflictReport | null>(null)
  const [allowConflict, setAllowConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadPlaces().then((r) => setPlaces(r.places))
    void loadContacts().then((r) => setContacts(r.contacts))
    // Only offer the AI fallback if this org actually configured one.
    void api<{ provider: string }>('/ai/settings')
      .then((r) => setAiProvider(r.provider))
      .catch(() => setAiProvider('none'))
  }, [])

  useEffect(() => {
    setDurationMinutes(DEFAULT_DURATION_MINUTES[kind])
  }, [kind])

  // An all-day item reminds at 9am on its first day and runs to the close of
  // its last — midnight would be a useless moment to be buzzed.
  const spanStart = (() => {
    if (!allDay) return dueAt
    const d = new Date(dueAt)
    d.setHours(9, 0, 0, 0)
    return d
  })()

  const spanEnd = (() => {
    if (!allDay) return null
    const d = new Date(endsOn)
    d.setHours(23, 59, 59, 0)
    return d < spanStart ? null : d
  })()

  const runConflictCheck = useCallback(async () => {
    try {
      setConflict(
        await api<ConflictReport>('/commitments/check-conflicts', {
          method: 'POST',
          body: {
            dueAt: dueAt.toISOString(),
            durationMinutes,
            allDay,
            placeLabel: placeLabel.trim() || null,
          },
        }),
      )
    } catch {
      setConflict(null)
    }
  }, [dueAt, durationMinutes, allDay, placeLabel])

  useEffect(() => {
    setAllowConflict(false)
    const handle = setTimeout(() => void runConflictCheck(), 400)
    return () => clearTimeout(handle)
  }, [runConflictCheck])

  // Only a flexible item needs somewhere to go; a fixed one already has a time.
  useEffect(() => {
    if (flexibility !== 'flexible') {
      setSlots([])
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      void api<{ slots: SlotSuggestion[] }>('/commitments/suggest-slots', {
        method: 'POST',
        body: {
          day: dueAt.toISOString(),
          window: preferredWindow,
          durationMinutes,
        },
      })
        .then((r) => !cancelled && setSlots(r.slots))
        .catch(() => !cancelled && setSlots([]))
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [flexibility, preferredWindow, durationMinutes, dueAt])

  async function shiftExisting(id: string, to: string) {
    setError(null)
    try {
      await api(`/commitments/${id}/reschedule`, { method: 'POST', body: { dueAt: to } })
      await runConflictCheck()
    } catch {
      setError(t('That time does not fit the other one either — pick another slot.'))
    }
  }

  const clashes = conflict?.conflicts ?? []
  const blocked =
    !allDay && flexibility === 'fixed' && clashes.length > 0 && !allowConflict && timeChosen

  // A repeat needs a clock time to repeat at; all-day and "sometime around
  // then" plans keep the single-plan path.
  const canRepeat = !allDay && flexibility === 'fixed'
  const seriesRule: RecurrenceRule | null = (() => {
    if (!canRepeat || repeatChoice === 'none') return null
    const ends = {
      until: repeatEnd === 'until' ? repeatUntil : null,
      count: repeatEnd === 'count' ? Math.min(500, Math.max(1, repeatCount)) : null,
    }
    switch (repeatChoice) {
      case 'daily':
        return { freq: 'daily', interval: 1, ...ends }
      case 'weekdays':
        return { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5], ...ends }
      case 'weekly':
        return {
          freq: 'weekly',
          interval: 1,
          byWeekday: repeatDays.length > 0 ? [...repeatDays].sort() : [dueAt.getDay()],
          ...ends,
        }
      case 'monthly':
        return { freq: 'monthly', interval: 1, ...ends }
      case 'yearly':
        return { freq: 'yearly', interval: 1, ...ends }
      default:
        return {
          freq: customFreq,
          interval: Math.min(52, Math.max(1, customEvery)),
          ...(customFreq === 'weekly' ? { byWeekday: [dueAt.getDay()] } : {}),
          ...ends,
        }
    }
  })()

  // The first real date, which is not always the date picked above: "every
  // Monday" chosen on a Thursday starts next Monday.
  const firstOccurrence = seriesRule
    ? (expandRecurrence(
        seriesRule,
        { startsOn: new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate()), hour: dueAt.getHours(), minute: dueAt.getMinutes() },
        { from: new Date(dueAt.getTime() - 60_000), to: new Date(dueAt.getTime() + 400 * 86_400_000) },
      )[0] ?? null)
    : null

  async function saveSeries(rule: RecurrenceRule) {
    setSaving(true)
    setError(null)
    try {
      await api('/recurrences', {
        method: 'POST',
        body: {
          title: title.trim(),
          kind,
          durationMinutes,
          priority,
          placeLabel: placeLabel.trim() || null,
          placeId,
          contactId,
          notes: notes.trim() || null,
          startsOn: toDateInputValue(dueAt),
          hour: dueAt.getHours(),
          minute: dueAt.getMinutes(),
          rule,
        },
      })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    if (seriesRule) return saveSeries(seriesRule)
    setSaving(true)
    setError(null)
    try {
      await api('/commitments', {
        method: 'POST',
        body: {
          title: title.trim(),
          kind,
          dueAt: spanStart.toISOString(),
          durationMinutes,
          allDay,
          endsAt: spanEnd ? spanEnd.toISOString() : null,
          flexibility,
          preferredWindow: flexibility === 'flexible' ? preferredWindow : null,
          priority,
          placeLabel: placeLabel.trim() || null,
          placeId,
          contactId,
          notes: notes.trim() || null,
          allowConflict,
        },
      })
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // They committed to this time by pressing save, so from here it blocks.
        setTimeChosen(true)
        setConflict(err.data as ConflictReport)
        setError(t('That slot was taken while you were filling this in.'))
        return
      }
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /**
   * Three grammars, tried most specific first. A sentence about a place has no
   * date in it, so asking the date parser about it first would always fail and
   * the user would conclude the box is broken — which is exactly what happened.
   */
  // Computed after the repeat check below, because a sentence like "gym on
  // mondays and thursdays" has no date in it and diagnose would otherwise
  // report a failure right next to a preview card that understood it fine.
  const asIntention = parseIntention(quick)
  const asTrip = asIntention ? null : parseTrip(quick)
  // Before parseWhen, not after. "standup every Tuesday at 10am" contains a
  // perfectly good one-off date, so asking the date parser first would quietly
  // create a single meeting and drop the repeat entirely.
  const asRepeat = asIntention || asTrip ? null : parseRecurrence(quick)
  const repeat = asRepeat ? planRepeat(quick, asRepeat) : null
  const parsed = asIntention || asTrip || asRepeat ? null : parseWhen(quick)
  const problem = asIntention || asTrip || asRepeat ? null : diagnose(quick, language())
  const parsedTitle = parsed ? titleFrom(quick, parsed) : ''
  const parsedPlace = parsed ? placeFrom(quick) : null
  // A date that parsed does not mean the whole sentence was understood: the
  // time may have been gibberish and silently replaced with a default.
  const ignoredTime = parsed ? findMalformedTime(quick) : null

  const [saveNote, setSaveNote] = useState<string | null>(null)

  /** "When I go to Mathura, buy peda" — stored with no date at all. */
  async function saveIntention() {
    if (!asIntention) return
    setSaving(true)
    setError(null)
    try {
      const r = await api<{ matchingTrips: { startsOn: string }[] }>('/intentions', {
        method: 'POST',
        body: {
          placeLabel: asIntention.placeLabel,
          title: asIntention.title,
          notes: originalIfInformative(quick, asIntention.title),
        },
      })
      setSaveNote(
        r.matchingTrips.length > 0
          ? t('Saved — and you already have a trip to {place} on {date}.', {
              place: asIntention.placeLabel,
              date: r.matchingTrips[0]!.startsOn,
            })
          : t('Saved. It will surface the moment you plan a trip to {place}.', { place: asIntention.placeLabel }),
      )
      setQuick('')
      // The sheet stays open on its note, so the page behind it is told now.
      announceChange()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** "Standup every Tuesday at 10am" — a rule, not a single meeting. */
  async function saveRepeat() {
    if (!repeat || !repeat.title) return
    setSaving(true)
    setError(null)
    try {
      const r = await api<{ recurrence: { summary: string; upcomingCount: number } }>(
        '/recurrences',
        {
          method: 'POST',
          body: {
            title: repeat.title,
            kind,
            durationMinutes,
            // Judged against the sentence with the recurrence words already
            // removed: "every tuesday at 10am" is captured in the rule, so
            // repeating it in the notes is noise, not detail.
            notes: originalIfInformative(stripRecurrence(quick, asRepeat!), repeat.title),
            startsOn: repeat.startsOn,
            hour: repeat.hour,
            minute: repeat.minute,
            rule: repeat.rule,
          },
        },
      )
      setQuick('')
      announceChange()
      setSaveNote(
        t('{summary} — {n} booked in, and it keeps going.', {
          summary: r.recurrence.summary,
          n: r.recurrence.upcomingCount,
        }),
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** "Going to Mathura from 12 to 14 October" — a trip, not an appointment. */
  async function saveTrip() {
    if (!asTrip) return
    setSaving(true)
    setError(null)
    try {
      const r = await api<{ waiting: { title: string }[] }>('/trips', {
        method: 'POST',
        body: {
          placeLabel: asTrip.placeLabel,
          startsOn: asTrip.startsOn,
          endsOn: asTrip.endsOn,
          notes: originalIfInformative(quick, asTrip.placeLabel),
        },
      })
      setQuick('')
      announceChange()
      if (r.waiting.length > 0) {
        const vars = {
          n: r.waiting.length,
          place: asTrip.placeLabel,
          list: r.waiting.map((w) => w.title).join(', '),
        }
        setSaveNote(
          r.waiting.length === 1
            ? t('Trip saved — you have 1 thing saved for {place}: {list}', vars)
            : t('Trip saved — you have {n} things saved for {place}: {list}', vars),
        )
      } else {
        navigate('/trips')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function applyQuick() {
    if (!parsed) return
    if (parsedTitle) setTitle(parsedTitle)
    if (parsedPlace) setPlaceLabel(parsedPlace)

    // The title is deliberately short. Everything else that was said is kept
    // here rather than thrown away.
    const original = originalIfInformative(quick, parsedTitle)
    if (original) setNotes((current) => (current ? `${current}

${original}` : original))
    setDueAt(parsed.date)
    if (parsed.durationMinutes) setDurationMinutes(parsed.durationMinutes)

    // "this afternoon" is a window, not 2pm. Record what was actually said and
    // let the app offer a real free slot rather than inventing one.
    if (parsed.window) {
      setFlexibility('flexible')
      setPreferredWindow(parsed.window)
    } else {
      setFlexibility('fixed')
    }
    setQuick('')
  }

  return (
    <div className="stack">
      <section className="card">
        <label>
          {t('Type it in plain words')}
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parsed) {
                e.preventDefault()
                applyQuick()
              }
            }}
            placeholder="dentist friday 6pm"
            autoFocus
          />
        </label>
        <div className="row">
          <DictateButton value={quick} onChange={setQuick} />
        </div>

        {asIntention && (
          <div className="parsed-preview">
            <div>
              <p className="commitment-title">{asIntention.title}</p>
              <p className="muted small">
                {t('Saved for {place} · no date, surfaces on a trip there', { place: asIntention.placeLabel })}
              </p>
            </div>
            <button className="primary small-btn" onClick={saveIntention} disabled={saving}>
              {t('Save it')}
            </button>
          </div>
        )}

        {repeat && (
          <div className="parsed-preview">
            <div>
              <p className="commitment-title">{repeat.title || t('(what should it be called?)')}</p>
              <p className="muted small">
                {repeat.summary}
                {repeat.firstAt
                  ? ` · ${t('from {date}', { date: formatDateTime(repeat.firstAt.toISOString()) })}`
                  : ` · ${t('nothing left in this series')}`}
                {repeat.timeAssumed && ` · ${t('time assumed')}`}
              </p>
              {!repeat.title && (
                <p className="error small">
                  {t('That is all repeat and no plan — say what it is, like “book club every second tuesday of the month”.')}
                </p>
              )}
            </div>
            <button
              className="primary small-btn"
              onClick={saveRepeat}
              disabled={saving || !repeat.title || !repeat.firstAt}
            >
              {t('Set it up')}
            </button>
          </div>
        )}

        {asTrip && (
          <div className="parsed-preview">
            <div>
              <p className="commitment-title">{t('Trip to {place}', { place: asTrip.placeLabel })}</p>
              <p className="muted small">
                {asTrip.startsOn} → {asTrip.endsOn}
              </p>
            </div>
            <button className="primary small-btn" onClick={saveTrip} disabled={saving}>
              {t('Plan it')}
            </button>
          </div>
        )}

        {saveNote && <p className="muted small">{saveNote}</p>}

        {/* Understood most of it but not all: say which part, and offer to
            carry the rest across so nothing has to be retyped. */}
        {problem && (
          <div className="conflict warn">
            <strong>{problem.message}</strong>
            {(problem.likelyTitle || problem.likelyPlace) && (
              <p className="muted small">
                {problem.likelyTitle && problem.likelyPlace
                  ? t('I did get “{title}” at {place}.', { title: problem.likelyTitle, place: problem.likelyPlace })
                  : problem.likelyTitle
                    ? t('I did get “{title}”.', { title: problem.likelyTitle })
                    : t('I did get at {place}.', { place: problem.likelyPlace ?? '' })}
              </p>
            )}
            <button
              className="primary small-btn"
              onClick={() => {
                if (problem.likelyTitle) setTitle(problem.likelyTitle)
                if (problem.likelyPlace) setPlaceLabel(problem.likelyPlace)
                const original = originalIfInformative(quick, problem.likelyTitle ?? '')
                if (original) {
                  setNotes((current) => (current ? `${current}

${original}` : original))
                }
                setQuick('')
                setSaveNote(t('Filled in what I understood — set the date and time below.'))
              }}
            >
              {t('Use that and I will pick the date')}
            </button>
          </div>
        )}

        {quick.trim() && !parsed && !asIntention && !asTrip && !asRepeat && !problem && (
          <>
            <p className="muted small">
              {t('No date spotted yet — try “friday 6pm”, “tomorrow 4”, “in 3 days”.')}
            </p>
            {/* Long sentences are exactly what the simple parser cannot do, so
                that is the only case worth spending an API call on. */}
            {aiProvider !== 'none' && quick.trim().length > 25 && (
              <button className="ghost" onClick={() => setReviewing(quick.trim())}>
                {t('Too complicated to type? Let AI read it')}
              </button>
            )}
          </>
        )}

        {parsed && (
          <div className="parsed-preview">
            <div>
              <p className="commitment-title">{parsedTitle || t('(no title yet)')}</p>
              <p className="muted small">
                {/* Showing "2:00 PM" for "this afternoon" would put back the
                    invented precision the parser was changed to avoid. */}
                {parsed.window
                  ? t('{day} {window} — no set time', {
                      day: parsed.date.toLocaleDateString(locale(), { weekday: 'long' }),
                      window: WINDOW_LABELS[parsed.window].toLowerCase(),
                    })
                  : formatDateTime(parsed.date.toISOString())}
                {parsed.timeAssumed && !parsed.window && ` · ${t('time assumed')}`}
                {parsed.durationMinutes ? ` · ${t('{n} min', { n: parsed.durationMinutes })}` : ''}
                {parsedPlace ? ` · ${parsedPlace}` : ''}
              </p>
              {ignoredTime && (
                <p className="error small">
                  {t('I could not read “{text}” as a time, so this is set to {time}. Change it below if that is wrong.', {
                    text: ignoredTime,
                    time: formatDateTime(parsed.date.toISOString()),
                  })}
                </p>
              )}
            </div>
            <button className="primary small-btn" onClick={applyQuick}>
              {t('Use this')}
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <label>
          {t('What is it?')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('Dentist appointment, client call, submit the report…')}
          />
        </label>

        <span className="label-text">{t('Type')}</span>
        <div className="chips">
          {SELECTABLE_KINDS.map((k) => (
            <button
              key={k}
              className={`chip${kind === k ? ' selected' : ''}`}
              onClick={() => setKind(k)}
            >
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <span className="label-text">{t('Is this at a set time?')}</span>
        <div className="row">
          <button
            className={`choice big${flexibility === 'fixed' ? ' selected' : ''}`}
            onClick={() => setFlexibility('fixed')}
          >
            {t('Yes, a set time')}
          </button>
          <button
            className={`choice big${flexibility === 'flexible' ? ' selected' : ''}`}
            onClick={() => setFlexibility('flexible')}
          >
            {t('Sometime around then')}
          </button>
        </div>

        {flexibility === 'flexible' && (
          <>
            <span className="label-text">{t('Roughly when?')}</span>
            <div className="chips">
              {TIME_WINDOWS.map((w) => (
                <button
                  key={w}
                  className={`chip${preferredWindow === w ? ' selected' : ''}`}
                  onClick={() => setPreferredWindow(w)}
                >
                  {WINDOW_LABELS[w]}
                </button>
              ))}
            </div>

            {slots.length > 0 ? (
              <>
                <span className="label-text">{t('You are actually free at')}</span>
                <ul className="plain">
                  {slots.map((slot) => (
                    <li key={slot.startsAt}>
                      <button
                        className="choice"
                        onClick={() => {
                          setDueAt(new Date(slot.startsAt))
                          setFlexibility('fixed')
                        }}
                      >
                        <span>{formatDateTime(slot.startsAt)}</span>
                        <span className="muted small">{slot.reason}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="muted small">
                  {t('Pick one to pin it down, or leave it flexible and decide later.')}
                </p>
              </>
            ) : (
              <p className="muted small">
                {t(
                  'Kept as an intention for that part of the day — it will not clash with anything, and it stays on your list until it is done.',
                )}
              </p>
            )}
          </>
        )}

        <span className="label-text">{t('How important?')}</span>
        <div className="chips">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              className={`chip${priority === p ? ' selected' : ''}`}
              onClick={() => setPriority(p)}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => {
              setAllDay(e.target.checked)
              if (e.target.checked) setEndsOn(new Date(dueAt))
            }}
          />
          <span>{t('All day, or spread over several days')}</span>
        </label>

        {allDay && (
          <>
            <div className="row">
              <label className="grow">
                {t('From')}
                <input
                  type="date"
                  value={toDateInputValue(dueAt)}
                  onChange={(e) => {
                    const next = new Date(e.target.value)
                    if (!Number.isNaN(next.getTime())) setDueAt(next)
                  }}
                />
              </label>
              <label className="grow">
                {t('To')}
                <input
                  type="date"
                  min={toDateInputValue(dueAt)}
                  value={toDateInputValue(endsOn)}
                  onChange={(e) => {
                    const next = new Date(e.target.value)
                    if (!Number.isNaN(next.getTime())) setEndsOn(next)
                  }}
                />
              </label>
            </div>
            <p className="muted small">
              {t(
                '{span}. Reminder at 9am on the first day. All-day items do not clash with anything — you can still book calls while you are away.',
                { span: formatSpan(spanStart.toISOString(), spanEnd ? spanEnd.toISOString() : null, true) },
              )}
            </p>
          </>
        )}

        {!allDay && (
          <>
        <span className="label-text">{flexibility === 'fixed' ? t('When?') : t('Which day?')}</span>
        <div className="chips">
          {duePresets.map((preset) => {
            const at = preset.at()
            const selected = Math.abs(at.getTime() - dueAt.getTime()) < 60_000
            return (
              <button
                key={preset.label}
                className={`chip${selected ? ' selected' : ''}`}
                onClick={() => setDueAt(at)}
              >
                {t(preset.label)}
              </button>
            )
          })}
        </div>

        <label>
          {t('Exact time')}
          <input
            type="datetime-local"
            value={toLocalInputValue(dueAt)}
            onChange={(e) => {
              const next = new Date(e.target.value)
              if (!Number.isNaN(next.getTime())) setDueAt(next)
            }}
          />
        </label>

        <span className="label-text">{t('How long will it block?')}</span>
        <div className="chips">
          {DURATION_CHOICES.map((minutes) => (
            <button
              key={minutes}
              className={`chip${durationMinutes === minutes ? ' selected' : ''}`}
              onClick={() => setDurationMinutes(minutes)}
            >
              {minutes < 60 ? t('{n} min', { n: minutes }) : t('{n}h', { n: minutes / 60 })}
            </button>
          ))}
        </div>

          </>
        )}

        {conflict && (allDay || flexibility !== 'fixed'
          ? (conflict.locationConflicts?.length ?? 0) > 0
          : true) && (
          <ConflictWarning
            report={conflict}
            allowConflict={allowConflict}
            onAllowConflictChange={setAllowConflict}
            onUseSuggestion={(iso) => setDueAt(new Date(iso))}
            onShiftExisting={(id, to) => void shiftExisting(id, to)}
            suggestedTimeOnly={!timeChosen}
          />
        )}

        {!allDay && flexibility === 'fixed' && (
          <p className="muted small">
            {t('You will be reminded at {time}, then chased every 15 minutes until you mark it done.', {
              time: formatDateTime(dueAt.toISOString()),
            })}
          </p>
        )}
      </section>

      {canRepeat && (
        <section className="card">
          <span className="label-text">{t('Repeats?')}</span>
          <div className="chips">
            {REPEAT_CHOICES.map((c) => (
              <button
                key={c.value}
                className={`chip${repeatChoice === c.value ? ' selected' : ''}`}
                onClick={() => setRepeatChoice(c.value)}
              >
                {t(c.label)}
              </button>
            ))}
            {onSchedule && (
              <button className="chip" onClick={() => onSchedule(title)}>
                {t('Irregular dates…')}
              </button>
            )}
          </div>

          {repeatChoice === 'weekly' && (
            <div className="weekday-pick" role="group" aria-label={t('On which days')}>
              {WEEKDAY_LETTERS.map((letter, day) => {
                const on = repeatDays.length > 0 ? repeatDays.includes(day) : day === dueAt.getDay()
                return (
                  <button
                    key={day}
                    className={`weekday${on ? ' selected' : ''}`}
                    aria-label={t(WEEKDAY_NAMES[day]!)}
                    aria-pressed={on}
                    onClick={() => {
                      const current = repeatDays.length > 0 ? repeatDays : [dueAt.getDay()]
                      const next = current.includes(day)
                        ? current.filter((d) => d !== day)
                        : [...current, day]
                      setRepeatDays(next.length > 0 ? next : current)
                    }}
                  >
                    {weekdayLetter(day, letter)}
                  </button>
                )
              })}
            </div>
          )}

          {repeatChoice === 'custom' && (
            <div className="row repeat-every">
              <span>{t('Every')}</span>
              <input
                type="number"
                min={1}
                max={52}
                value={customEvery}
                onChange={(e) => setCustomEvery(Number(e.target.value) || 1)}
                aria-label={t('How many')}
              />
              <select
                value={customFreq}
                onChange={(e) => setCustomFreq(e.target.value as Frequency)}
                aria-label={t('Days, weeks, months or years')}
              >
                {CUSTOM_UNITS.map((u) => (
                  <option key={u.freq} value={u.freq}>
                    {t(u.label)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {seriesRule && (
            <>
              <span className="label-text">{t('Until?')}</span>
              <div className="chips">
                <button
                  className={`chip${repeatEnd === 'never' ? ' selected' : ''}`}
                  onClick={() => setRepeatEnd('never')}
                >
                  {t('No end')}
                </button>
                <button
                  className={`chip${repeatEnd === 'count' ? ' selected' : ''}`}
                  onClick={() => setRepeatEnd('count')}
                >
                  {t('A number of times')}
                </button>
                <button
                  className={`chip${repeatEnd === 'until' ? ' selected' : ''}`}
                  onClick={() => setRepeatEnd('until')}
                >
                  {t('Until a date')}
                </button>
              </div>
              {repeatEnd === 'count' && (
                <div className="row repeat-every">
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={repeatCount}
                    onChange={(e) => setRepeatCount(Number(e.target.value) || 1)}
                    aria-label={t('How many times')}
                  />
                  <span>{t('times')}</span>
                </div>
              )}
              {repeatEnd === 'until' && (
                <input
                  type="date"
                  min={toDateInputValue(dueAt)}
                  value={repeatUntil}
                  onChange={(e) => setRepeatUntil(e.target.value)}
                  aria-label={t('Last date')}
                />
              )}
              <p className="muted small">
                {(() => {
                  const rule = describeRecurrence(
                    seriesRule,
                    { startsOn: dueAt, hour: dueAt.getHours(), minute: dueAt.getMinutes() },
                    language(),
                  )
                  return firstOccurrence
                    ? t('{rule}, first on {date}. Each one reminds you on its own, and the series is on the Repeating page.', {
                        rule,
                        date: formatDateTime(firstOccurrence.toISOString()),
                      })
                    : t('{rule}. Each one reminds you on its own, and the series is on the Repeating page.', { rule })
                })()}
              </p>
            </>
          )}

          {repeatChoice === 'none' && (
            <p className="muted small">
              {rich(
                'For dates that follow a plan rather than a rhythm — vaccinations, a course of treatment — use <b>Irregular dates</b>.',
                { b: (s) => <strong>{s}</strong> },
              )}
            </p>
          )}
        </section>
      )}

      {/* Everything below is optional — an appointment needs a time, not a dossier. */}
      <section className="card">
        <h2 className="section-title">{t('Anything else? (optional)')}</h2>

        <label>
          {t('Where?')}
          <input
            value={placeLabel}
            onChange={(e) => setPlaceLabel(e.target.value)}
            placeholder={t('e.g. BKC, Mumbai')}
          />
        </label>
        <p className="muted small">
          {t(
            'Naming a place lets the app notice when it clashes with a trip, or when there is not enough time to get between two things.',
          )}
        </p>

        {places.length > 0 && (
          <label>
            {t('Saved place')}
            <select value={placeId ?? ''} onChange={(e) => setPlaceId(e.target.value || null)}>
              <option value="">{t('— not tied to a place —')}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {contacts.length > 0 && (
          <label>
            {t('Who with')}
            <select value={contactId ?? ''} onChange={(e) => setContactId(e.target.value || null)}>
              <option value="">{t('— nobody in particular —')}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          {t('Notes')}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={t('Bring the old X-rays…')}
          />
        </label>
        <div className="row">
          <DictateButton value={notes} onChange={setNotes} />
        </div>
      </section>

      {reviewing && (
        <Modal title={t('Is this what you meant?')} onClose={() => setReviewing(null)}>
          <ExtractReview
            text={reviewing}
            onCancel={() => setReviewing(null)}
            onDone={(added) => {
              setReviewing(null)
              if (added > 0) onDone()
            }}
          />
        </Modal>
      )}

      {error && <p className="error">{error}</p>}

      {/* Sticky as a pair: abandoning a half-filled form should be as reachable
          as finishing it, rather than a scroll back up to the nav. */}
      <div className="form-actions">
        <button
          className="primary"
          onClick={save}
          // A clash is about one slot; a repeating plan is booked around it.
          disabled={saving || (!seriesRule && blocked) || !title.trim()}
        >
          {saving
            ? t('Saving…')
            : seriesRule
              ? t('Add repeating plan')
              : blocked
                ? t('Resolve the clash above')
                : t('Add to my list')}
        </button>
        <button
          className="ghost"
          onClick={() => {
            // Only worth confirming when there is something to lose.
            const started = title.trim() || notes.trim() || quick.trim()
            if (started && !window.confirm(t('Discard this?'))) return
            onDone()
          }}
          disabled={saving}
        >
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
}
