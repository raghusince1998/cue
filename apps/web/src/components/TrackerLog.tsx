import { useState, type FormEvent } from 'react'
import type { BoardKey, TrackerItemDTO, TrackerPlace, TrackerUpdateDTO, TrackerUpdateKind } from '@cue/shared'
import { api } from '../lib/api.ts'
import { errorText } from '../lib/errors.ts'
import { getFix } from '../lib/geo.ts'
import { msg, t } from '../lib/i18n.tsx'
import { formatDateTime, relativeDay } from '../lib/time.ts'
import { toast } from '../lib/toast.ts'
import { DictateButton } from './DictateButton.tsx'
import { PersonPicker, personBody, type PersonChoice, type PersonOption } from './PersonPicker.tsx'
import { VoiceNotes } from './VoiceNotes.tsx'

/**
 * What happened on a deal, an application or with a candidate: a visit or a
 * call, who it was with, how it went, what was said, and what comes next —
 * logged in one go, from where you stand.
 */

/** How it went, one tap each. Shown with t(). */
const DEAL_OUTCOMES: string[] = [msg('Interested'), msg('Will think about it'), msg('Already uses one'), msg('Not interested')]
const OTHER_OUTCOMES: string[] = [msg('Went well'), msg('Not sure yet'), msg('Did not go well')]
/** Nobody met, nobody picked up: logged, but not contact. */
const MISSED: Record<TrackerUpdateKind, string> = { visit: msg('Could not meet'), call: msg('No answer') }
const GOOD = new Set<string>([msg('Interested'), msg('Went well')])
const BAD = new Set<string>([msg('Already uses one'), msg('Not interested'), msg('Did not go well')])
const KNOWN = new Set([...DEAL_OUTCOMES, ...OTHER_OUTCOMES, ...Object.values(MISSED)])

/** An outcome said with t() when it is one of ours; what the person typed, as typed. */
export const outcomeText = (outcome: string) => (KNOWN.has(outcome) ? t(outcome) : outcome)
const tone = (outcome: string) =>
  GOOD.has(outcome) ? 'good' : BAD.has(outcome) ? 'bad' : Object.values(MISSED).includes(outcome) ? 'missed' : 'plain'

/** A visit on a deal; a meeting in person with a company or a candidate. */
const kindWord = (board: BoardKey, kind: TrackerUpdateKind) =>
  kind === 'call' ? t('Call') : board === 'deals' ? t('Visit') : t('Meeting')

/** "Visited yesterday · Interested", for a card. */
export function lastUpdateLine(board: BoardKey, last: NonNullable<TrackerItemDTO['lastUpdate']>): string {
  const when = relativeDay(last.at)
  const done =
    last.kind === 'call'
      ? t('Called {when}', { when })
      : board === 'deals'
        ? t('Visited {when}', { when })
        : t('Met {when}', { when })
  return last.outcome ? `${done} · ${outcomeText(last.outcome)}` : done
}

export const NEXT_WHEN = [
  { label: msg('Tomorrow'), days: 1 },
  { label: msg('In 3 days'), days: 3 },
  { label: msg('Next week'), days: 7 },
]

/** That many days from now, at ten in the morning. */
export function dueIn(days: number): Date {
  const due = new Date()
  due.setDate(due.getDate() + days)
  due.setHours(10, 0, 0, 0)
  return due
}

/** A next step on the item: an ordinary plan, with its reminder, linked to it. */
export async function bookNext(itemId: string, contactId: string | null, title: string, due: Date): Promise<void> {
  await api('/commitments', {
    method: 'POST',
    body: {
      title,
      kind: /interview|meeting|call|meet|visit/i.test(title) ? 'meeting' : 'task',
      dueAt: due.toISOString(),
      trackerItemId: itemId,
      contactId,
      allowConflict: true,
    },
  })
}

/** What was typed before, one tap to use again. */
export function Suggest({ label, options, onPick }: { label: string; options: string[]; onPick: (text: string) => void }) {
  if (options.length === 0) return null
  return (
    <div className="tracker-suggest">
      <span className="muted small">{label}</span>
      {options.map((o) => (
        <button key={o} type="button" className="chip" onClick={() => onPick(o)}>
          {o}
        </button>
      ))}
    </div>
  )
}

/** Up to `n` of these not already typed, the first of each spelling kept. */
export function fresh(options: string[], typed: string, n = 4): string[] {
  const seen = new Set([typed.trim().toLowerCase()])
  const out: string[] = []
  for (const o of options) {
    const key = o.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(o.trim())
    if (out.length === n) break
  }
  return out
}

const directions = (place: TrackerPlace) =>
  `https://www.google.com/maps/dir/?api=1&destination=${place.lat.toFixed(6)},${place.lng.toFixed(6)}`

/** Where it is: directions there, or saved now from where you stand. */
export function PlaceBlock({
  place,
  busy,
  onPatch,
}: {
  place: TrackerPlace | null
  busy: boolean
  onPatch: (body: Record<string, unknown>) => Promise<unknown>
}) {
  const [address, setAddress] = useState('')
  const [finding, setFinding] = useState(false)

  if (place) {
    return (
      <div className="tracker-place">
        <span className="tracker-place-pin" aria-hidden>
          &#128205;
        </span>
        <div className="tracker-place-text">
          <strong>{place.name}</strong>
          {place.address && <span className="muted small">{place.address}</span>}
        </div>
        <div className="tracker-place-actions">
          <a className="ghost small-btn" href={directions(place)} target="_blank" rel="noopener noreferrer">
            {t('Directions')}
          </a>
          <button className="link small" disabled={busy} onClick={() => void onPatch({ placeId: null })}>
            {t('Remove')}
          </button>
        </div>
      </div>
    )
  }

  async function saveHere() {
    setFinding(true)
    try {
      const fix = await getFix(12_000)
      await onPatch({ here: { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, ...(address.trim() ? { address: address.trim() } : {}) } })
      setAddress('')
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setFinding(false)
    }
  }

  return (
    <div className="tracker-place is-empty">
      <div className="person-search">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={t('Area or address (optional)')}
          aria-label={t('Area or address (optional)')}
          maxLength={500}
        />
        <button className="ghost small-btn" disabled={busy || finding} onClick={() => void saveHere()}>
          {finding ? t('Finding you…') : t('Save where I am')}
        </button>
      </div>
      <span className="muted small">{t('Saved as a place, so the next visit has directions.')}</span>
    </div>
  )
}

interface LogItem {
  id: string
  title: string
  contactId: string | null
  contactName: string | null
  contactPhone: string | null
  place: TrackerPlace | null
}

/** A visit or a call, logged: who, how it went, what was said, what is next. */
export function UpdateForm({
  board,
  item,
  kind: startKind,
  people,
  nextSteps,
  onDone,
}: {
  board: BoardKey
  item: LogItem
  kind: TrackerUpdateKind
  people: PersonOption[]
  nextSteps: string[]
  /** Saved, with how it went; or null, put away unsaved. */
  onDone: (saved: { outcome: string | null } | null) => void
}) {
  const [kind, setKind] = useState<TrackerUpdateKind>(startKind)
  const [who, setWho] = useState<PersonChoice | null>(
    item.contactId && item.contactName ? { kind: 'existing', id: item.contactId, name: item.contactName, phone: item.contactPhone } : null,
  )
  const [outcome, setOutcome] = useState('')
  const [note, setNote] = useState('')
  const [clips, setClips] = useState<string[]>([])
  const canPlace = board !== 'hiring' && !item.place && 'geolocation' in navigator
  const [savePlace, setSavePlace] = useState(true)
  const [next, setNext] = useState('')
  const [nextDays, setNextDays] = useState<number | null>(1)
  const [nextAt, setNextAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const outcomes = [...(board === 'deals' ? DEAL_OUTCOMES : OTHER_OUTCOMES), MISSED[kind]]

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (next.trim() && nextDays === null && !nextAt) {
      setError(t('Pick a day and time.'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Where you stand, only when it is to be saved as the place.
      let fix: Awaited<ReturnType<typeof getFix>> | null = null
      if (canPlace && kind === 'visit' && savePlace) {
        try {
          fix = await getFix(12_000)
        } catch (err) {
          toast(errorText(err), 'error')
        }
      }
      const saved = await api<{ update: TrackerUpdateDTO; contactCreated: boolean; placeSaved: boolean }>(
        `/tracker-items/${item.id}/updates`,
        {
          method: 'POST',
          body: {
            kind,
            outcome: outcome || null,
            note: note.trim() || null,
            connected: outcome !== MISSED[kind],
            ...(who ? personBody(who) : { contactId: null }),
            ...(fix ? { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, savePlace: true } : {}),
            ...(clips.length ? { voiceNoteIds: clips } : {}),
          },
        },
      )
      if (next.trim()) {
        const due = nextAt ? new Date(nextAt) : dueIn(nextDays ?? 1)
        await bookNext(item.id, saved.update.contactId, next.trim(), due)
      }
      if (saved.contactCreated && saved.update.contactName) {
        toast(t('{name} saved to your People.', { name: saved.update.contactName }))
      }
      if (saved.placeSaved) toast(t('Location saved for {name}.', { name: item.title }))
      onDone({ outcome: outcome || null })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="tracker-log-form" onSubmit={(e) => void submit(e)}>
      <div className="tracker-tabs" role="tablist" aria-label={t('What happened')}>
        {(['visit', 'call'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? 'is-on' : ''}
            onClick={() => {
              setKind(k)
              if (outcome === MISSED[kind]) setOutcome('')
            }}
          >
            {kindWord(board, k)}
          </button>
        ))}
      </div>

      <PersonPicker
        people={people}
        value={who}
        onChange={setWho}
        label={kind === 'call' ? t('Who did you speak to? (optional)') : t('Who did you meet? (optional)')}
      />

      <span className="label-text">{t('How did it go?')}</span>
      <div className="chips" role="group" aria-label={t('How did it go?')}>
        {outcomes.map((o) => (
          <button
            key={o}
            type="button"
            className={`chip${outcome === o ? ' selected' : ''}`}
            aria-pressed={outcome === o}
            onClick={() => setOutcome(outcome === o ? '' : o)}
          >
            {t(o)}
          </button>
        ))}
      </div>

      <label>
        {t('What was said (optional)')}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000} placeholder={t('e.g. Liked it; wants to talk again after the 10th')} />
      </label>
      <div className="row">
        <DictateButton value={note} onChange={setNote} label={t('Speak')} />
      </div>
      <span className="label-text">{t('Voice note (optional)')}</span>
      <VoiceNotes onIdsChange={setClips} />

      {canPlace && kind === 'visit' && (
        <label className="checkbox">
          <input type="checkbox" checked={savePlace} onChange={(e) => setSavePlace(e.target.checked)} />
          <span>{t('Save where I am as {name}’s location', { name: item.title })}</span>
        </label>
      )}

      <label>
        {t('What next? (optional)')}
        <input value={next} onChange={(e) => setNext(e.target.value)} maxLength={300} placeholder={board === 'deals' ? t('e.g. Visit again to confirm the setup') : t('e.g. Follow up on Monday')} />
      </label>
      <Suggest label={t('Used before')} options={fresh(nextSteps, next, 3)} onPick={setNext} />
      {next.trim() && (
        <div className="row">
          {NEXT_WHEN.map((w) => (
            <button
              key={w.label}
              type="button"
              className={`chip${nextDays === w.days && !nextAt ? ' selected' : ''}`}
              aria-pressed={nextDays === w.days && !nextAt}
              onClick={() => {
                setNextDays(w.days)
                setNextAt('')
              }}
            >
              {t(w.label)}
            </button>
          ))}
          <input
            type="datetime-local"
            value={nextAt}
            onChange={(e) => setNextAt(e.target.value)}
            aria-label={t('Or pick a time')}
            className="tracker-next-at"
          />
        </div>
      )}

      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button className="primary small-btn" type="submit" disabled={busy}>
          {busy ? t('Saving…') : kind === 'call' ? t('Save call') : board === 'deals' ? t('Save visit') : t('Save meeting')}
        </button>
        <button className="ghost small-btn" type="button" onClick={() => onDone(null)} disabled={busy}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  )
}

/** What was said on one entry, put right — typed, spoken, or recorded — after it was logged. */
function SaidEditor({
  itemId,
  update,
  onDone,
}: {
  itemId: string
  update: TrackerUpdateDTO
  /** Closed; true when anything changed. */
  onDone: (changed: boolean) => void
}) {
  const [note, setNote] = useState(update.notes ?? '')
  const [clipsChanged, setClipsChanged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (note.trim() !== (update.notes ?? '')) {
        await api(`/tracker-items/${itemId}/updates/${update.id}`, { method: 'PATCH', body: { note: note.trim() || null } })
      }
      onDone(true)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tracker-said">
      <label>
        {t('What was said')}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000} autoFocus />
      </label>
      <div className="row">
        <DictateButton value={note} onChange={setNote} label={t('Speak')} />
      </div>
      <span className="label-text">{t('Voice notes')}</span>
      <VoiceNotes interactionId={update.id} onIdsChange={() => setClipsChanged(true)} />
      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button className="primary small-btn" onClick={() => void save()} disabled={busy}>
          {busy ? t('Saving…') : t('Save')}
        </button>
        <button className="ghost small-btn" onClick={() => onDone(clipsChanged)} disabled={busy}>
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
}

/** Every visit and call on it, the latest first. */
export function UpdateList({
  board,
  itemId,
  updates,
  onRemove,
  onChanged,
}: {
  board: BoardKey
  itemId: string
  updates: TrackerUpdateDTO[]
  onRemove: (id: string) => void
  onChanged: () => void
}) {
  const [all, setAll] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  if (updates.length === 0) return null
  const shown = all ? updates : updates.slice(0, 3)
  return (
    <>
      <ul className="plain tracker-log">
        {shown.map((u) => (
          <li key={u.id} className="tracker-log-item">
            <div className="tracker-log-head">
              <strong>{kindWord(board, u.kind)}</strong>
              <span className="muted small">
                {formatDateTime(u.at)}
                {u.contactName ? ` · ${u.contactName}` : ''}
              </span>
              {u.outcome && <span className={`tracker-log-outcome is-${tone(u.outcome)}`}>{outcomeText(u.outcome)}</span>}
              <button
                className="link small tracker-log-remove"
                aria-label={t('Delete')}
                title={t('Delete')}
                onClick={() => {
                  if (window.confirm(t('Delete this entry?'))) onRemove(u.id)
                }}
              >
                &times;
              </button>
            </div>
            {editing === u.id ? (
              <SaidEditor
                itemId={itemId}
                update={u}
                onDone={(changed) => {
                  setEditing(null)
                  if (changed) onChanged()
                }}
              />
            ) : (
              <>
                {u.notes && <p className="small tracker-log-note">{u.notes}</p>}
                <div className="tracker-log-actions">
                  <button className="link small" onClick={() => setEditing(u.id)}>
                    {u.notes ? t('Edit what was said') : t('+ What was said')}
                  </button>
                  {u.voiceNotes > 0 && (
                    <button className="link small" onClick={() => setEditing(u.id)}>
                      {u.voiceNotes === 1 ? t('▶ 1 voice note') : t('▶ {n} voice notes', { n: u.voiceNotes })}
                    </button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {updates.length > 3 && (
        <button className="link small" onClick={() => setAll(!all)}>
          {all ? t('Show fewer') : t('Show all {n}', { n: updates.length })}
        </button>
      )}
    </>
  )
}
