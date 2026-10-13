import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.ts'
import { locale, msg, t } from '../lib/i18n.tsx'

/**
 * One box, everything behind it.
 *
 * Months of commitments, visits, trips and notes were write-only — the data
 * was all there and the only way back in was scrolling. The person asking
 * "what did I agree with Ramesh?" does not know which screen holds the answer,
 * so the box does not ask them to choose one.
 */

type Kind = 'commitment' | 'trip' | 'intention' | 'contact' | 'place' | 'recurrence' | 'visit'

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
  }, [q])

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
                    navigate(hit.href)
                    onClose?.()
                  }}
                >
                  <span className="search-hit-title">{hit.title}</span>
                  {hit.when && <span className="muted small">{when(hit.when)}</span>}
                  {hit.detail && <span className="muted small search-hit-detail">{hit.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
