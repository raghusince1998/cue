import { useEffect, useState } from 'react'
import type { ContactDTO, PlaceDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { formatDateTime } from '../lib/time.ts'

interface ContactProfile extends ContactDTO {
  visits: { id: string; purpose: string; outcome: string | null; notes: string | null; startedAt: string }[]
  commitments: { id: string; title: string; dueAt: string; status: string }[]
}

export function ContactEditor({
  contactId,
  onSaved,
  onClose,
  initialName = '',
}: {
  /** null means "create a new person". */
  contactId: string | null
  onSaved: () => void
  onClose: () => void
  /** For a new person: a name already known, e.g. someone a check-in is waiting on. */
  initialName?: string
}) {
  const [profile, setProfile] = useState<ContactProfile | null>(null)
  const [places, setPlaces] = useState<PlaceDTO[]>([])
  const [loaded, setLoaded] = useState(false)

  const [name, setName] = useState(initialName)
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [placeId, setPlaceId] = useState<string | null>(null)

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [p, loadedPlaces] = await Promise.all([
        contactId ? api<ContactProfile>(`/contacts/${contactId}`) : Promise.resolve(null),
        api<PlaceDTO[]>('/places'),
      ])
      if (p) {
        setProfile(p)
        setName(p.name)
        setRole(p.role ?? '')
        setPhone(p.phone ?? '')
        setEmail(p.email ?? '')
        setNotes(p.notes ?? '')
        setPlaceId(p.placeId)
      }
      setPlaces(loadedPlaces)
      setLoaded(true)
    })()
  }, [contactId])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const body = {
        name: name.trim(),
        role: role.trim(),
        phone: phone.trim(),
        email: email.trim(),
        notes: notes.trim(),
        placeId,
      }
      if (contactId) await api(`/contacts/${contactId}`, { method: 'PATCH', body })
      else await api('/contacts', { method: 'POST', body })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!contactId) return
    setBusy(true)
    try {
      await api(`/contacts/${contactId}`, { method: 'DELETE' })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  return (
    <div className="stack tight">
      {phone.trim() && (
        <a className="primary call-cta" href={`tel:${phone.trim()}`}>
          Call {name || phone}
        </a>
      )}

      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Sharma" />
      </label>

      <label>
        Role
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Dermatologist, Owner, Receptionist…"
        />
      </label>

      <label>
        Phone
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98765 43210"
        />
      </label>

      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>

      <label>
        Place
        <select value={placeId ?? ''} onChange={(e) => setPlaceId(e.target.value || null)}>
          <option value="">— none —</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Prefers evening calls, decision maker, etc."
        />
      </label>

      {profile && (profile.commitments.length > 0 || profile.visits.length > 0) && (
        <>
          {profile.commitments.filter((c) => c.status === 'pending').length > 0 && (
            <>
              <span className="label-text">Open with this person</span>
              <ul className="plain">
                {profile.commitments
                  .filter((c) => c.status === 'pending')
                  .map((c) => (
                    <li key={c.id}>
                      {c.title} · <span className="muted small">{formatDateTime(c.dueAt)}</span>
                    </li>
                  ))}
              </ul>
            </>
          )}

          {profile.visits.length > 0 && (
            <>
              <span className="label-text">
                {profile.visits.length} meeting{profile.visits.length === 1 ? '' : 's'}
              </span>
              <ul className="plain">
                {profile.visits.slice(0, 8).map((v) => (
                  <li key={v.id} className="muted small">
                    {formatDateTime(v.startedAt)} — {v.outcome ?? v.purpose}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {error && <p className="error small">{error}</p>}

      <div className="row">
        <button className="primary" onClick={save} disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : contactId ? 'Save changes' : 'Add person'}
        </button>
        <button className="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>

      {contactId && (
        <div className="danger-zone">
          {confirmDelete ? (
            <div className="row">
              <button className="danger-btn" onClick={remove} disabled={busy}>
                Yes, delete
              </button>
              <button className="ghost small-btn" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </div>
          ) : (
            <button className="link danger-link" onClick={() => setConfirmDelete(true)}>
              Delete this person
            </button>
          )}
          <p className="muted small">
            Visits and follow-ups involving them are kept — deleting someone from your address book
            should not erase the record that you met them.
          </p>
        </div>
      )}
    </div>
  )
}
