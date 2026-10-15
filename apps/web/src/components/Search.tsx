import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { locale, msg, t } from '../lib/i18n.tsx'
import { readNotes } from '../lib/sample.ts'
import { CommitmentSheet } from './CommitmentSheet.tsx'
import { ContactEditor } from './ContactEditor.tsx'
import { Modal } from './Modal.tsx'
import { PersonSheet } from './PersonSheet.tsx'
import { TripDetail } from './TripDetail.tsx'

/**
 * One box, everything behind it.
 *
 * Months of commitments, visits, trips and notes were write-only — the data
 * was all there and the only way back in was scrolling. The person asking
 * "what did I agree with Ramesh?" does not know which screen holds the answer,
 * so the box does not ask them to choose one.
 */

type Kind = 'commitment' | 'trip' | 'intention' | 'contact' | 'place' | 'recurrence' | 'visit'

/** What opens in place, over the results: the thing itself, all of it. The rest go to their page. */
type Opened = { kind: 'commitment' | 'contact' | 'trip' | 'edit-contact'; id: string }
const OPENS_HERE = new Set<Kind>(['commitment', 'contact', 'trip'])

interface Hit {
  kind: Kind
  id: string
  title: string
  when: string | null
  detail: string | null
  href: string
}

/** Shown with t(). */
const KIND_LABEL: Record<Kind, string> = {
  commitment: msg('Plan'),
  trip: msg('Trip'),
  intention: msg('Saved for'),
  contact: msg('Person'),
  place: msg('Place'),
  recurrence: msg('Repeats'),
  visit: msg('Visit'),
}

/** How often a repeating plan repeats, in the reader's language. Shown with t(). */
const FREQ: Record<string, string> = {
  daily: msg('Every day'),
  weekly: msg('Every week'),
  monthly: msg('Every month'),
  yearly: msg('Every year'),
}

/** The line under a result: a repeat said in words, the sample week's marker as nothing. */
function detailOf(hit: Hit): string | null {
  if (!hit.detail) return null
  if (hit.kind === 'recurrence') return FREQ[hit.detail] ? t(FREQ[hit.detail]!) : null
  return readNotes(hit.detail).notes
}

function when(value: string | null): string {
  if (!value) return ''
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

export function Search({
  onClose,
  /**
   * Inline sits on a screen that already has content, so it stays quiet until
   * used: no helper text, no empty state, nothing until there is a query. The
   * modal is the opposite — it is the only thing on screen and should explain
   * itself.
   */
  variant = 'modal',
}: {
  onClose?: () => void
  variant?: 'modal' | 'inline'
}) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [refresh, setRefresh] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Only the modal steals focus. An inline field grabbing the caret on every
    // visit to the dashboard would fight the person who came to read it.
    if (variant === 'modal') inputRef.current?.focus()
  }, [variant])

  // Debounced: a query per keystroke is a request per character, and the
  // answer only settles once someone stops typing anyway.
  useEffect(() => {
    const value = q.trim()
    if (value.length < 2) {
      setHits(null)
      return
    }
    setBusy(true)
    const handle = setTimeout(() => {
      api<{ hits: Hit[] }>('/search', { query: { q: value } })
        .then((r) => setHits(r.hits))
        .catch(() => setHits([]))
        .finally(() => setBusy(false))
    }, 220)
    return () => clearTimeout(handle)
  }, [q, refresh])

  // Something changed in what was opened: the results, and the screen behind, catch up.
  const changed = () => {
    announceChange()
    setRefresh((n) => n + 1)
  }

  // Grouped, because "three plans and a person" is easier to scan than seven
  // rows in score order.
  const grouped = (hits ?? []).reduce<Record<string, Hit[]>>((acc, hit) => {
    ;(acc[hit.kind] ??= []).push(hit)
    return acc
  }, {})

  const inline = variant === 'inline'

  return (
    <div className={`stack tight${inline ? ' search-inline' : ''}`}>
      <div className="search-field">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
        <input
          ref={inputRef}
          className="search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={inline ? t('Search anything…') : t('A person, a place, a word in a note…')}
          aria-label={t('Search everything')}
        />
        {q && (
          <button className="search-clear" aria-label={t('Clear')} onClick={() => setQ('')}>
            ×
          </button>
        )}
      </div>

      {!inline && q.trim().length < 2 && (
        <p className="muted small">
          {t('Try a name, a town, or anything you wrote in a note — “Ramesh”, “Mathura”, “invoice”.')}
        </p>
      )}

      {busy && hits === null && <p className="muted small">{t('Looking…')}</p>}

      {hits !== null && hits.length === 0 && !busy && (
        <p className="muted small">{t('Nothing matches that.')}</p>
      )}

      {Object.entries(grouped).map(([kind, list]) => (
        <section key={kind}>
          <h3 className="section-title muted-title">
            {t(KIND_LABEL[kind as Kind])} · {list.length}
          </h3>
          <ul className="plain">
            {list.map((hit) => (
              <li key={`${hit.kind}-${hit.id}`}>
                <button
                  className="search-hit"
                  onClick={() => {
                    if (OPENS_HERE.has(hit.kind)) {
                      setOpened({ kind: hit.kind as Opened['kind'], id: hit.id })
                      return
                    }
                    navigate(hit.href)
                    onClose?.()
                  }}
                >
                  <span className="search-hit-title">{hit.title}</span>
                  {hit.when && <span className="muted small">{when(hit.when)}</span>}
                  {detailOf(hit) && <span className="muted small search-hit-detail">{detailOf(hit)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {opened?.kind === 'commitment' && (
        <CommitmentSheet
          key={opened.id}
          commitmentId={opened.id}
          onClose={() => setOpened(null)}
          onChanged={changed}
          onOpenOther={(id) => setOpened({ kind: 'commitment', id })}
        />
      )}

      {opened?.kind === 'contact' && (
        <Modal title={t('Person')} onClose={() => setOpened(null)}>
          <PersonSheet
            key={opened.id}
            contactId={opened.id}
            onEdit={() => setOpened({ kind: 'edit-contact', id: opened.id })}
            onChanged={changed}
            onOpenPerson={(id) => setOpened({ kind: 'contact', id })}
          />
        </Modal>
      )}

      {opened?.kind === 'edit-contact' && (
        <Modal title={t('Edit person')} onClose={() => setOpened({ kind: 'contact', id: opened.id })}>
          <ContactEditor
            contactId={opened.id}
            onClose={() => setOpened({ kind: 'contact', id: opened.id })}
            onSaved={() => {
              changed()
              setOpened({ kind: 'contact', id: opened.id })
            }}
          />
        </Modal>
      )}

      {opened?.kind === 'trip' && (
        <Modal title={t('Trip')} onClose={() => setOpened(null)}>
          <TripDetail tripId={opened.id} onClose={() => setOpened(null)} onChanged={changed} />
        </Modal>
      )}
    </div>
  )
}
