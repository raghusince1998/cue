import { useMemo, useState } from 'react'
import { t } from '../lib/i18n.tsx'
import { canPickFromPhone, pickFromPhone } from '../lib/phoneContacts.ts'

/**
 * Who something is with: picked from People, typed in new (a name, a number,
 * an email — saved to People as the thing is saved), or chosen from the
 * phone's own contacts. Never "add them to People first".
 */

export interface PersonOption {
  id: string
  name: string
  phone: string | null
  organization: string | null
}

export type PersonChoice =
  | { kind: 'existing'; id: string; name: string; phone: string | null }
  | { kind: 'new'; name: string; phone: string; email: string }

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-10)

export function PersonPicker({
  people,
  value,
  onChange,
  label,
}: {
  people: PersonOption[]
  value: PersonChoice | null
  onChange: (next: PersonChoice | null) => void
  label: string
}) {
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const qd = q.replace(/\D/g, '')
    return people
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.organization ?? '').toLowerCase().includes(q) ||
          (qd.length >= 3 && digits(p.phone).includes(qd)),
      )
      .slice(0, 6)
  }, [people, query])
  const exact = matches.some((p) => p.name.toLowerCase() === query.trim().toLowerCase())

  async function fromPhone() {
    setPicking(true)
    setError(null)
    try {
      const picked = await pickFromPhone()
      if (!picked) return
      // Already in People under that number: that person, not a copy.
      const known = picked.phone ? people.find((p) => digits(p.phone) && digits(p.phone) === digits(picked.phone)) : null
      onChange(
        known
          ? { kind: 'existing', id: known.id, name: known.name, phone: known.phone }
          : { kind: 'new', name: picked.name, phone: picked.phone, email: picked.email },
      )
      setQuery('')
    } catch {
      setError(t('Could not open your phone’s contacts.'))
    } finally {
      setPicking(false)
    }
  }

  if (value?.kind === 'existing') {
    return (
      <div className="person-picker">
        <span className="label-text">{label}</span>
        <div className="person-chosen">
          <span className="person-avatar" aria-hidden>
            {value.name.charAt(0).toUpperCase()}
          </span>
          <span className="person-chosen-text">
            <strong>{value.name}</strong>
            {value.phone && <span className="muted small">{value.phone}</span>}
          </span>
          <button type="button" className="link small" onClick={() => onChange(null)}>
            {t('Change')}
          </button>
        </div>
      </div>
    )
  }

  if (value?.kind === 'new') {
    const set = (patch: Partial<Extract<PersonChoice, { kind: 'new' }>>) => onChange({ ...value, ...patch })
    return (
      <div className="person-picker">
        <span className="label-text">{label}</span>
        <div className="person-new">
          <label>
            {t('Name')}
            <input value={value.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} />
          </label>
          <label>
            {t('Phone (optional)')}
            <input
              type="tel"
              inputMode="tel"
              value={value.phone}
              onChange={(e) => set({ phone: e.target.value })}
              placeholder="98765 43210"
              maxLength={40}
            />
          </label>
          <label>
            {t('Email (optional)')}
            <input type="email" value={value.email} onChange={(e) => set({ email: e.target.value })} maxLength={200} />
          </label>
          <p className="muted small">{t('Saved to your People when you save this.')}</p>
          <button type="button" className="link small fit-btn" onClick={() => onChange(null)}>
            {t('Pick someone else')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="person-picker">
      <span className="label-text">{label}</span>
      <div className="person-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search your People, or type a new name')}
          aria-label={label}
        />
        {canPickFromPhone() && (
          <button type="button" className="ghost small-btn" onClick={() => void fromPhone()} disabled={picking}>
            {t('From phone')}
          </button>
        )}
      </div>
      {(matches.length > 0 || (query.trim() && !exact)) && (
        <ul className="person-options" role="listbox" aria-label={label}>
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange({ kind: 'existing', id: p.id, name: p.name, phone: p.phone })
                  setQuery('')
                }}
              >
                <strong>{p.name}</strong>
                <span className="muted small">{[p.organization, p.phone].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
          {query.trim() && !exact && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="person-option-new"
                onClick={() => {
                  // A number typed is a number, not a name.
                  const typed = query.trim()
                  const isNumber = /^[+\d][\d\s-]{5,}$/.test(typed)
                  onChange({ kind: 'new', name: isNumber ? '' : typed, phone: isNumber ? typed : '', email: '' })
                  setQuery('')
                }}
              >
                {t('+ Add “{name}” as someone new', { name: query.trim() })}
              </button>
            </li>
          )}
        </ul>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

/** What to send for the choice: an id from People, or the new person to save there. */
export function personBody(choice: PersonChoice | null): Record<string, unknown> {
  if (!choice) return {}
  if (choice.kind === 'existing') return { contactId: choice.id }
  const name = choice.name.trim()
  if (!name) return {}
  return {
    person: {
      name,
      ...(choice.phone.trim() ? { phone: choice.phone.trim() } : {}),
      ...(choice.email.trim() ? { email: choice.email.trim() } : {}),
    },
  }
}
