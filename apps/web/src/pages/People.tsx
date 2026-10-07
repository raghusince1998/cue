import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ContactDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { initials, relativeDay } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { ContactEditor } from '../components/ContactEditor.tsx'
import {
  deviceContactsAvailable,
  deviceContactsReason,
  pickDeviceContacts,
} from '../lib/deviceContacts.ts'

/** `undefined` = closed, `null` = creating a new person, string = editing one. */
type Editing = string | null | undefined

export default function People() {
  const [canPick] = useState(() => deviceContactsAvailable())
  const [pickReason] = useState(() => deviceContactsReason())
  const [importing, setImporting] = useState(false)
  const [importNote, setImportNote] = useState<string | null>(null)

  const [contacts, setContacts] = useState<ContactDTO[]>([])
  const withNumbers = contacts.filter((c) => c.phone).length

  /**
   * Called straight from the tap: the picker refuses to open otherwise, and
   * awaiting anything first is enough to lose the gesture.
   */
  async function importFromPhone() {
    setImporting(true)
    setImportNote(null)
    try {
      const picked = await pickDeviceContacts()
      if (picked.length === 0) {
        setImportNote('Nobody picked.')
        return
      }
      const r = await api<{ added: number; updated: number; unchanged: number }>(
        '/contacts/import',
        { method: 'POST', body: { contacts: picked } },
      )
      const parts = [
        r.added ? `${r.added} added` : null,
        r.updated ? `${r.updated} filled in` : null,
        r.unchanged ? `${r.unchanged} already complete` : null,
      ].filter(Boolean)
      setImportNote(parts.length ? `${parts.join(', ')}.` : 'Nothing changed.')
      await load()
    } catch (err) {
      setImportNote((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing>(undefined)

  const load = useCallback(async () => {
    setContacts(await api<ContactDTO[]>('/contacts'))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter((c) =>
      [c.name, c.role, c.phone, c.placeName].some((f) => f?.toLowerCase().includes(q)),
    )
  }, [contacts, query])

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">People</h1>
        <span className="page-count">
          {contacts.length} saved
          {withNumbers > 0 ? ` · ${withNumbers} with a number` : ''}
        </span>
      </div>

      <div className="row">
        <input
          className="grow"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, role, phone or place"
        />
        <button className="primary" onClick={() => setEditing(null)}>
          Add
        </button>
        {/* The native picker, where there is one. Not a sync, and the note
            below says so rather than implying one that cannot exist. */}
        <button
          className="ghost"
          disabled={!canPick || importing}
          title={canPick ? undefined : pickReason}
          onClick={() => void importFromPhone()}
        >
          {importing ? 'Importing…' : 'From my phone'}
        </button>
      </div>

      {importNote && <p className="muted small">{importNote}</p>}

      {contacts.length === 0 ? (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#128100;
          </span>
          <h3>Nobody here yet</h3>
          <p>
            Anyone you name while planning something is saved here on their own — say
            &ldquo;call the plumber&rdquo; and they appear. Add one by hand, or bring them over
            from your phone.
          </p>
          <div className="row">
            <button className="primary small-btn" onClick={() => setEditing(null)}>
              Add someone
            </button>
            {canPick && (
              <button className="ghost small-btn" onClick={() => void importFromPhone()}>
                From my phone
              </button>
            )}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="blank">
          <h3>Nobody matches &ldquo;{query}&rdquo;</h3>
          <p>Try part of a name, a job like &ldquo;plumber&rdquo;, or a phone number.</p>
        </div>
      ) : (
        <div className="tiles two-up">
          {filtered.map((c) => (
            <article key={c.id} className="tile">
              <span className={`tile-mark${c.phone ? ' is-accent' : ''}`} aria-hidden>
                {initials(c.name)}
              </span>

              <div className="tile-body">
                <p className="tile-title">{c.name}</p>
                {/* Only facts that exist. "No role recorded" and "Not met yet"
                    were two lines per card saying nothing. */}
                {(c.role || c.placeName) && (
                  <p className="tile-sub">{[c.role, c.placeName].filter(Boolean).join(' · ')}</p>
                )}

                <div className="tile-tags">
                  {c.phone && <span className="tag is-live">{c.phone}</span>}
                  {c.visitCount ? (
                    <span className="tag">
                      {c.visitCount} meeting{c.visitCount === 1 ? '' : 's'}
                      {c.lastSeenAt ? ` · ${relativeDay(c.lastSeenAt)}` : ''}
                    </span>
                  ) : null}
                  {!c.phone && <span className="tag is-warn">No number</span>}
                </div>
              </div>

              <div className="tile-actions">
                {c.phone && (
                  <a className="primary small-btn call-btn" href={`tel:${c.phone}`}>
                    Call
                  </a>
                )}
                <button className="ghost small-btn" onClick={() => setEditing(c.id)}>
                  Open
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing !== undefined && (
        <Modal title={editing ? 'Person' : 'Add person'} onClose={() => setEditing(undefined)}>
          <ContactEditor
            contactId={editing}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined)
              void load()
            }}
          />
        </Modal>
      )}
    </div>
  )
}
