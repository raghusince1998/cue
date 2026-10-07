import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DEFAULT_DURATION_MINUTES,
  DURATION_CHOICES,
  KIND_LABELS,
  OUTCOME_OPTIONS,
  COMMITMENT_KIND,
  type CommitmentKind,
  type ConflictReport,
  type ContactDTO,
  type LogVisitInput,
  type PlaceCandidateDTO,
  type PlaceDTO,
  type PlaceSuggestionDTO,
  type Purpose,
} from '@cue/shared'
import { ApiError, api } from '../lib/api.ts'
import { formatDistance, getFix, type Fix } from '../lib/geo.ts'
import { duePresets, formatDateTime, toLocalInputValue } from '../lib/time.ts'
import { ConflictWarning } from '../components/ConflictWarning.tsx'
import { VoiceNotes } from '../components/VoiceNotes.tsx'
import { loadContacts, loadPlaces, matchPlacesLocally } from '../lib/cache.ts'
import { enqueueVisit, newId, type PendingClip } from '../lib/outbox.ts'
import { useOnline } from '../lib/online.ts'
import { RepeatVisitCard, suggestedDueAt } from '../components/RepeatVisitCard.tsx'
import { UpcomingForm } from '../components/UpcomingForm.tsx'
import { QuickAdd } from '../components/QuickAdd.tsx'
import { DictateButton } from '../components/DictateButton.tsx'

export default function LogVisit() {
  const navigate = useNavigate()
  // Two things belong on this screen: something that already happened, and
  // something that has not. They were previously the same screen with only the
  // first half built.
  const [mode, setMode] = useState<'past' | 'upcoming'>('upcoming')
  // The detailed form is opt-in, and stays open once asked for. ?full=1 is how
  // the quick box hands over a sentence it could not read.
  const [fullForm, setFullForm] = useState(
    () => new URLSearchParams(window.location.search).get('full') === '1',
  )
  /** Remounts the detailed form after a quick save, so it starts clean. */
  const [quickSaves, setQuickSaves] = useState(0)

  const [fix, setFix] = useState<Fix | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [matches, setMatches] = useState<PlaceDTO[] | null>(null)

  const [allPlaces, setAllPlaces] = useState<PlaceDTO[]>([])
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [creatingPlace, setCreatingPlace] = useState(false)
  const [newPlaceName, setNewPlaceName] = useState('')
  const [newPlaceKind, setNewPlaceKind] = useState('clinic')

  const [nearby, setNearby] = useState<PlaceCandidateDTO[] | null>(null)
  const [lookupProvider, setLookupProvider] = useState<string | null>(null)
  const [newPlacePhone, setNewPlacePhone] = useState('')
  const [newPlaceAddress, setNewPlaceAddress] = useState('')
  const [newPlaceSource, setNewPlaceSource] = useState<'manual' | 'osm' | 'google'>('manual')
  const [newPlaceExternalId, setNewPlaceExternalId] = useState<string | null>(null)

  const [contacts, setContacts] = useState<ContactDTO[]>([])
  const [contactId, setContactId] = useState<string | null>(null)
  const [creatingContact, setCreatingContact] = useState(false)
  const [newContactRole, setNewContactRole] = useState('')
  const [newContactPhone, setNewContactPhone] = useState('')

  const [purpose, setPurpose] = useState<Purpose | null>(null)
  const [contactName, setContactName] = useState('')
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')

  const [hasNextStep, setHasNextStep] = useState<boolean | null>(null)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<CommitmentKind>('callback')
  const [dueAt, setDueAtRaw] = useState<Date>(() => duePresets[0]!.at())
  /** See UpcomingForm: a clash with the form's opening guess informs, not blocks. */
  const [timeChosen, setTimeChosen] = useState(false)

  const setDueAt = useCallback((next: Date) => {
    setDueAtRaw(next)
    setTimeChosen(true)
  }, [])
  const [durationMinutes, setDurationMinutes] = useState<number>(
    DEFAULT_DURATION_MINUTES.callback,
  )

  const [conflict, setConflict] = useState<ConflictReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [allowConflict, setAllowConflict] = useState(false)

  const [voiceNoteIds, setVoiceNoteIds] = useState<string[]>([])
  const [pendingClips, setPendingClips] = useState<PendingClip[]>([])
  const [suggestion, setSuggestion] = useState<PlaceSuggestionDTO | null>(null)
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false)
  // Stable for the life of this form, so a retry cannot create a second visit.
  const [clientId] = useState(() => newId())
  const online = useOnline()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<LogVisitInput | null>(null)

  useEffect(() => {
    void loadPlaces().then((r) => setAllPlaces(r.places))
    void loadContacts().then((r) => setContacts(r.contacts))
  }, [])

  /**
   * Fire location the moment the screen opens, so the common case costs no tap
   * at all. Only once permission is already granted — prompting unasked the
   * first time would be rude, and someone logging a phone call from a desk does
   * not want it.
   */
  useEffect(() => {
    let cancelled = false
    void navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (!cancelled && status.state === 'granted') void locate()
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // Deliberately once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** People already recorded at the chosen place come first. */
  const contactsHere = useMemo(() => {
    if (!placeId) return contacts
    const here = contacts.filter((c) => c.placeId === placeId)
    return here.length > 0 ? here : contacts
  }, [contacts, placeId])

  const selectedPlace = useMemo(
    () => matches?.find((p) => p.id === placeId) ?? allPlaces.find((p) => p.id === placeId) ?? null,
    [matches, allPlaces, placeId],
  )

  // Suggest a sensible title so the common case is zero typing.
  useEffect(() => {
    if (hasNextStep !== true || title) return
    const who = contactName || selectedPlace?.name || newPlaceName
    if (who) setTitle(kind === 'meeting' ? `Meeting — ${who}` : `Call back ${who}`)
  }, [hasNextStep, kind, contactName, selectedPlace, newPlaceName, title])

  // A meeting blocks an hour, a callback fifteen minutes. Follow the kind
  // unless the user has overridden it below.
  useEffect(() => {
    setDurationMinutes(DEFAULT_DURATION_MINUTES[kind])
  }, [kind])

  // Whenever a saved place is chosen, ask what this visit usually looks like.
  useEffect(() => {
    if (!placeId) {
      setSuggestion(null)
      return
    }
    let cancelled = false
    void api<PlaceSuggestionDTO>(`/places/${placeId}/suggestion`)
      .then((next) => {
        if (!cancelled) setSuggestion(next)
      })
      .catch(() => setSuggestion(null))
    return () => {
      cancelled = true
    }
  }, [placeId])

  // Prefill the long-hand form from the same pattern, so even "Something else"
  // starts most of the way there.
  useEffect(() => {
    if (!suggestion || suggestion.confidence === 'none') return
    setPurpose((current) => current ?? 'business')
    if (suggestion.contact) {
      setContactId((current) => current ?? suggestion.contact!.id)
      setContactName((current) => current || suggestion.contact!.name)
    }
    if (suggestion.outcome) setOutcome((current) => current || suggestion.outcome!)

    const proposed = suggestedDueAt(suggestion)
    if (proposed && suggestion.lastCommitment) {
      setHasNextStep((current) => current ?? true)
      setKind(suggestion.lastCommitment.kind)
      setDurationMinutes(suggestion.lastCommitment.durationMinutes)
      setTitle((current) => current || suggestion.lastCommitment!.title)
      setDueAt(proposed)
    }
  }, [suggestion])

  const runConflictCheck = useCallback(async () => {
    setChecking(true)
    try {
      const report = await api<ConflictReport>('/commitments/check-conflicts', {
        method: 'POST',
        body: { dueAt: dueAt.toISOString(), durationMinutes },
      })
      setConflict(report)
    } catch {
      // A failed check must never block saving — the server re-checks anyway.
      setConflict(null)
    } finally {
      setChecking(false)
    }
  }, [dueAt, durationMinutes])

  // Check as soon as a time is chosen, so the clash appears while they are
  // still deciding rather than after they commit to it.
  useEffect(() => {
    if (hasNextStep !== true) {
      setConflict(null)
      return
    }
    setAllowConflict(false)
    const handle = setTimeout(() => void runConflictCheck(), 400)
    return () => clearTimeout(handle)
  }, [hasNextStep, runConflictCheck])

  async function locate() {
    setLocating(true)
    setLocationError(null)
    try {
      const next = await getFix()
      setFix(next)
      // Matching is just distance arithmetic over data we already hold, so it
      // should never need a connection.
      let found: PlaceDTO[]
      try {
        found = await api<PlaceDTO[]>('/places/match', {
          method: 'POST',
          body: { lat: next.lat, lng: next.lng, searchRadiusM: 1000 },
        })
      } catch {
        found = matchPlacesLocally(allPlaces, next.lat, next.lng)
      }
      setMatches(found)
      const confident = found.find((p) => p.withinRadius)
      if (confident) setPlaceId(confident.id)
      else setCreatingPlace(found.length === 0)

      // Only worth asking an external provider when we do not already know
      // this place ourselves.
      if (!confident && online) {
        void api<{ provider: string; candidates: PlaceCandidateDTO[] }>('/places/lookup', {
          method: 'POST',
          body: { lat: next.lat, lng: next.lng, radiusM: 250 },
        })
          .then((res) => {
            setLookupProvider(res.provider)
            setNearby(res.candidates)
          })
          .catch(() => setNearby([]))
      }
    } catch (err) {
      setLocationError((err as Error).message)
    } finally {
      setLocating(false)
    }
  }

  /** Accepting a discovered business prefills the new-place form, nothing more. */
  function acceptCandidate(candidate: PlaceCandidateDTO) {
    setCreatingPlace(true)
    setPlaceId(null)
    setNewPlaceName(candidate.name)
    setNewPlaceKind(candidate.category ?? 'clinic')
    setNewPlaceAddress(candidate.address ?? '')
    setNewPlacePhone(candidate.phone ?? '')
    setNewPlaceSource(candidate.source)
    setNewPlaceExternalId(candidate.externalId)
  }

  /**
   * The whole point of the feature: log the visit exactly as last time, in one
   * tap. Goes through the normal /visits endpoint so it gets the same conflict
   * check, idempotency and offline queueing as the long-hand form.
   */
  async function acceptRepeat() {
    if (!suggestion) return
    setSaving(true)
    setError(null)

    const proposed = suggestedDueAt(suggestion)
    const body: LogVisitInput = {
      clientId,
      placeId: suggestion.placeId,
      purpose: 'business',
      contactId: suggestion.contact?.id ?? null,
      outcome: suggestion.outcome ?? undefined,
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      accuracyM: fix?.accuracyM ?? null,
      startedAt: new Date().toISOString(),
      commitment:
        proposed && suggestion.lastCommitment
          ? {
              title: suggestion.lastCommitment.title,
              kind: suggestion.lastCommitment.kind,
              dueAt: proposed.toISOString(),
              durationMinutes: suggestion.lastCommitment.durationMinutes,
            }
          : null,
    }

    try {
      if (!online) {
        await enqueueVisit(body, [])
        navigate('/')
        return
      }
      await api('/visits', { method: 'POST', body })
      navigate('/')
    } catch (err) {
      // The usual slot is taken. Shifting to the next free one keeps this a
      // one-tap action instead of dumping the user into the full form.
      if (err instanceof ApiError && err.status === 409) {
        const report = err.data as ConflictReport
        const freeSlot = report.suggestions[0]
        if (freeSlot && body.commitment) {
          try {
            await api('/visits', {
              method: 'POST',
              body: { ...body, commitment: { ...body.commitment, dueAt: freeSlot } },
            })
            navigate('/')
            return
          } catch {
            /* fall through to the form */
          }
        }
        setConflict(report)
        setDismissedSuggestion(true)
        setError('Your usual time is taken — pick another below.')
        return
      }

      if (!(err instanceof ApiError)) {
        await enqueueVisit(body, [])
        navigate('/')
        return
      }
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** The "shift the other one" branch: move the existing commitment instead. */
  async function moveExisting(id: string, to: string) {
    setError(null)
    try {
      await api(`/commitments/${id}/reschedule`, { method: 'POST', body: { dueAt: to } })
      await runConflictCheck()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('That time does not fit the other commitment either — pick another slot.')
        return
      }
      setError((err as Error).message)
    }
  }

  const clashes = conflict?.conflicts ?? []
  const blockedByConflict =
    hasNextStep === true && clashes.length > 0 && !allowConflict && timeChosen

  // A place is no longer required: plenty of things that happen have no
  // location. The only real requirement is that a follow-up, if there is one,
  // actually says what it is.
  const canSave =
    !blockedByConflict && purpose !== null && (hasNextStep !== true || Boolean(title.trim()))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const body: LogVisitInput = {
        clientId,
        placeId: creatingPlace ? null : placeId,
        newPlace:
          creatingPlace && fix
            ? {
                name: newPlaceName.trim(),
                kind: newPlaceKind || undefined,
                address: newPlaceAddress.trim() || undefined,
                phone: newPlacePhone.trim() || undefined,
                lat: fix.lat,
                lng: fix.lng,
                radiusM: 150,
                source: newPlaceSource,
                externalId: newPlaceExternalId ?? undefined,
              }
            : undefined,
        purpose: purpose ?? 'unknown',
        contactId: creatingContact ? null : contactId,
        newContact:
          creatingContact && contactName.trim()
            ? {
                name: contactName.trim(),
                role: newContactRole.trim() || undefined,
                phone: newContactPhone.trim() || undefined,
              }
            : undefined,
        contactName: contactName.trim() || undefined,
        outcome: outcome || undefined,
        notes: notes.trim() || undefined,
        lat: fix?.lat ?? null,
        lng: fix?.lng ?? null,
        accuracyM: fix?.accuracyM ?? null,
        startedAt: new Date().toISOString(),
        voiceNoteIds,
        commitment:
          hasNextStep === true
            ? { title: title.trim(), kind, dueAt: dueAt.toISOString(), durationMinutes }
            : null,
        allowConflict,
      }
      bodyRef.current = body

      // Queue straight away when the browser already knows it is offline —
      // no point waiting on a request that cannot leave the device.
      if (!online) {
        await enqueueVisit(body, pendingClips)
        navigate('/')
        return
      }

      await api('/visits', { method: 'POST', body })
      navigate('/')
    } catch (err) {
      // Something claimed the slot between the pre-check and the save.
      if (err instanceof ApiError && err.status === 409) {
        // Pressing save is choosing the time, so from here a clash blocks.
        setTimeChosen(true)
        setConflict(err.data as ConflictReport)
        setError('That slot was taken while you were filling this in.')
        return
      }

      // Not an answer from the server, so the request never got there. Keep the
      // visit rather than making the user retype it.
      if (!(err instanceof ApiError)) {
        try {
          await enqueueVisit(bodyRef.current!, pendingClips)
          navigate('/')
          return
        } catch {
          setError('Could not reach the server and could not save locally either.')
          return
        }
      }

      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const showRepeat =
    suggestion !== null && suggestion.confidence === 'strong' && !dismissedSuggestion

  const modeSwitch = (
    <>
      <div className="page-head">
        <h1 className="page-title">Add</h1>
        <span className="page-count">
          {mode === 'upcoming' ? 'something that has not happened yet' : 'something that already did'}
        </span>
      </div>

      {/* A segmented control rather than two big buttons: these are two shapes
          of the same action, not two destinations. */}
      <div className="viewswitch">
        <button
          className={mode === 'upcoming' ? 'selected' : ''}
          onClick={() => setMode('upcoming')}
        >
          Coming up
        </button>
        <button className={mode === 'past' ? 'selected' : ''} onClick={() => setMode('past')}>
          Already happened
        </button>
      </div>
    </>
  )

  if (mode === 'upcoming') {
    return (
      <div className="stack page-form">
        {modeSwitch}

        {/* One line and Enter is the path almost everything takes. The full
            form stays for what a sentence genuinely cannot carry — a place
            from your saved list, a specific person, an all-day span.

            One or the other, never both. The detailed form opens with its own
            "type it in plain words" box, and showing the quick one above it
            meant two inputs for the same sentence, each with its own Dictate
            button, and no way to tell which one would save. */}
        {fullForm ? (
          <>
            <button className="quick-more" onClick={() => setFullForm(false)}>
              Back to one line
            </button>
            <UpcomingForm key={quickSaves} />
          </>
        ) : (
          <>
            <QuickAdd onSaved={() => setQuickSaves((n) => n + 1)} />
            <button className="quick-more" onClick={() => setFullForm(true)}>
              Set it up in detail instead
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="stack page-form">
      {modeSwitch}

      {showRepeat && suggestion && (
        <RepeatVisitCard
          suggestion={suggestion}
          dueAt={suggestedDueAt(suggestion)}
          busy={saving}
          onAccept={() => void acceptRepeat()}
          onDismiss={() => setDismissedSuggestion(true)}
        />
      )}

      {/* ---------------------------------------------------------- where */}
      <section className="card">
        <h2 className="section-title">Where? (optional)</h2>

        {!fix && (
          <>
            <button className="primary" onClick={locate} disabled={locating}>
              {locating ? 'Getting your location…' : 'Use my location'}
            </button>
            {locationError && <p className="error small">{locationError}</p>}
            <p className="muted small">
              Or pick one below. Leave it blank for a call or a video meeting.
            </p>
          </>
        )}

        {fix && (
          <p className="muted small">
            Fix accurate to {formatDistance(fix.accuracyM)}.{' '}
            <button className="link" onClick={locate}>
              Retry
            </button>
          </p>
        )}

        {matches && matches.length > 0 && !creatingPlace && (
          <ul className="choices">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  className={`choice${placeId === p.id ? ' selected' : ''}`}
                  onClick={() => setPlaceId(p.id)}
                >
                  <span>{p.name}</span>
                  <span className="muted small">
                    {p.distanceM !== undefined ? formatDistance(p.distanceM) : ''}
                    {p.withinRadius ? ' · you are here' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!creatingPlace && allPlaces.length > 0 && (
          <label>
            {matches ? 'Or another saved place' : 'Saved place'}
            <select value={placeId ?? ''} onChange={(e) => setPlaceId(e.target.value || null)}>
              <option value="">— none —</option>
              {allPlaces.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {nearby && nearby.length > 0 && !creatingPlace && (
          <>
            <span className="label-text">
              Businesses registered at this location ({lookupProvider})
            </span>
            <ul className="choices">
              {nearby.slice(0, 6).map((c) => (
                <li key={c.externalId}>
                  <button className="choice" onClick={() => acceptCandidate(c)}>
                    <span>
                      {c.name}
                      {c.phone && <span className="muted small"> · {c.phone}</span>}
                    </span>
                    <span className="muted small">{formatDistance(c.distanceM)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted small">
              Pick one to prefill the details. Nothing is saved until you save the visit.
            </p>
          </>
        )}

        {nearby && nearby.length === 0 && !creatingPlace && (
          <p className="muted small">
            No businesses found here in {lookupProvider === 'osm' ? 'OpenStreetMap' : 'the map data'}
            . Add the place manually below — it will be recognised on every visit after that.
          </p>
        )}

        {!creatingPlace ? (
          <button
            className="link"
            onClick={() => {
              setCreatingPlace(true)
              setPlaceId(null)
            }}
          >
            + This is a new place
          </button>
        ) : (
          <>
            <label>
              New place name
              <input
                value={newPlaceName}
                onChange={(e) => setNewPlaceName(e.target.value)}
                placeholder="e.g. Sunrise Skin Clinic"
              />
            </label>
            <label>
              Type
              <input
                value={newPlaceKind}
                onChange={(e) => setNewPlaceKind(e.target.value)}
                placeholder="clinic, office, site…"
              />
            </label>
            <label>
              Address
              <input
                value={newPlaceAddress}
                onChange={(e) => setNewPlaceAddress(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label>
              Reception phone
              <input
                type="tel"
                value={newPlacePhone}
                onChange={(e) => setNewPlacePhone(e.target.value)}
                placeholder="Optional"
              />
            </label>
            {!fix && (
              <p className="error small">
                Get your location first so this place can be recognised next time.
              </p>
            )}
            <button className="link" onClick={() => setCreatingPlace(false)}>
              Cancel
            </button>
          </>
        )}
      </section>

      {/* -------------------------------------------------------- purpose */}
      <section className="card">
        <h2 className="section-title">What kind of thing was it?</h2>
        <div className="row">
          <button
            className={`choice big${purpose === 'business' ? ' selected' : ''}`}
            onClick={() => setPurpose('business')}
          >
            Business
          </button>
          <button
            className={`choice big${purpose === 'personal' ? ' selected' : ''}`}
            onClick={() => {
              setPurpose('personal')
              setHasNextStep(null)
            }}
          >
            Personal
          </button>
        </div>
        {purpose === 'personal' && (
          <p className="muted small">
            Logged and left alone — no follow-up questions, no reminders.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------- business */}
      {purpose !== 'personal' && (
        <>
          <section className="card">
            <h2 className="section-title">How did it go? (optional)</h2>
            <span className="label-text">Who was it with?</span>
            {!creatingContact ? (
              <>
                {contactsHere.length > 0 && (
                  <select
                    value={contactId ?? ''}
                    onChange={(e) => {
                      const id = e.target.value || null
                      setContactId(id)
                      setContactName(contacts.find((c) => c.id === id)?.name ?? '')
                    }}
                  >
                    <option value="">— pick someone —</option>
                    {contactsHere.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.role ? ` (${c.role})` : ''}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="link"
                  onClick={() => {
                    setCreatingContact(true)
                    setContactId(null)
                    setContactName('')
                  }}
                >
                  + Someone new
                </button>
              </>
            ) : (
              <>
                <label>
                  Name
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Dr. Sharma"
                  />
                </label>
                <label>
                  Role
                  <input
                    value={newContactRole}
                    onChange={(e) => setNewContactRole(e.target.value)}
                    placeholder="Dermatologist, owner…"
                  />
                </label>
                <label>
                  Phone — so you can call straight from the reminder
                  <input
                    type="tel"
                    value={newContactPhone}
                    onChange={(e) => setNewContactPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                  />
                </label>
                <button className="link" onClick={() => setCreatingContact(false)}>
                  Pick an existing person instead
                </button>
              </>
            )}
            <div className="chips">
              {OUTCOME_OPTIONS.map((o) => (
                <button
                  key={o}
                  className={`chip${outcome === o ? ' selected' : ''}`}
                  onClick={() => setOutcome(outcome === o ? '' : o)}
                >
                  {o}
                </button>
              ))}
            </div>
            <label>
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="What was discussed, what they asked for…"
              />
            </label>
            <div className="row">
              <DictateButton value={notes} onChange={setNotes} />
            </div>

            <span className="label-text">Voice note</span>
            <p className="muted small">
              Faster than typing in a car park, and it keeps what they actually said.
            </p>
            <VoiceNotes onIdsChange={setVoiceNoteIds} onPendingClipsChange={setPendingClips} />
          </section>

          <section className="card">
            <h2 className="section-title">Anything to follow up?</h2>
            <p className="muted small">
              A callback, a next appointment, anything you said you would do.
            </p>
            <div className="row">
              <button
                className={`choice big${hasNextStep === true ? ' selected' : ''}`}
                onClick={() => setHasNextStep(true)}
              >
                Yes
              </button>
              <button
                className={`choice big${hasNextStep === false ? ' selected' : ''}`}
                onClick={() => setHasNextStep(false)}
              >
                No
              </button>
            </div>

            {hasNextStep && (
              <div className="stack tight">
                <div className="chips">
                  {COMMITMENT_KIND.map((k) => (
                    <button
                      key={k}
                      className={`chip${kind === k ? ' selected' : ''}`}
                      onClick={() => setKind(k)}
                    >
                      {KIND_LABELS[k]}
                    </button>
                  ))}
                </div>

                <label>
                  What exactly?
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>

                <span className="label-text">When?</span>
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
                        {preset.label}
                      </button>
                    )
                  })}
                </div>

                <label>
                  Exact time
                  <input
                    type="datetime-local"
                    value={toLocalInputValue(dueAt)}
                    onChange={(e) => {
                      const next = new Date(e.target.value)
                      if (!Number.isNaN(next.getTime())) setDueAt(next)
                    }}
                  />
                </label>

                <span className="label-text">How long will it block?</span>
                <div className="chips">
                  {DURATION_CHOICES.map((minutes) => (
                    <button
                      key={minutes}
                      className={`chip${durationMinutes === minutes ? ' selected' : ''}`}
                      onClick={() => setDurationMinutes(minutes)}
                    >
                      {minutes < 60 ? `${minutes} min` : `${minutes / 60}h`}
                    </button>
                  ))}
                </div>

                {/* ------------------------------------------- clash warning */}
                {checking && <p className="muted small">Checking that slot…</p>}

                {conflict && (
                  <ConflictWarning
                    report={conflict}
                    allowConflict={allowConflict}
                    onAllowConflictChange={setAllowConflict}
                    onUseSuggestion={(iso) => setDueAt(new Date(iso))}
                    suggestedTimeOnly={!timeChosen}
                    onShiftExisting={(id, to) => void moveExisting(id, to)}
                  />
                )}

                <p className="muted small">
                  You will be reminded at {formatDateTime(dueAt.toISOString())}, then chased every
                  15 minutes until you mark it done.
                </p>
              </div>
            )}
          </section>
        </>
      )}

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button className="primary" onClick={save} disabled={!canSave || saving}>
          {saving
            ? 'Saving…'
            : blockedByConflict
              ? 'Resolve the clash above'
              : online
                ? 'Save'
                : 'Save on this device'}
        </button>
      </div>
    </div>
  )
}
