import { useCallback, useEffect, useMemo, useState } from 'react'
import { ACCOUNT_STAGES, ACCOUNT_STAGE_LABELS, type AccountStage } from '@cue/shared'
import { api } from '../lib/api.ts'
import { useOnChange } from '../lib/changes.ts'
import { rich, t } from '../lib/i18n.tsx'
import { initials, relativeDay } from '../lib/time.ts'

interface AccountRow {
  key: string
  name: string
  stage: AccountStage | null
  people: number
  peopleNames: string[]
  waiting: number
  waitingDue: number
  owe: number
  hasNext: boolean
  lastContact: string | null
  reachOut: number
  quiet: boolean
}

/**
 * The companies and organisations people work at, each with what is open there and
 * how far along things are. Made from "Works at": nothing to set up.
 */
export function AccountsView({
  onOpen,
  onAddPerson,
  reloadKey,
  showStages = true,
}: {
  /** Prospect to customer: for sales and clients, not a job hunt or a team. */
  showStages?: boolean
  onOpen: (name: string) => void
  onAddPerson: () => void
  /** Bumped by the page when something changed in a sheet. */
  reloadKey: number
}) {
  const [rows, setRows] = useState<AccountRow[] | null>(null)
  const [stages, setStages] = useState<Record<AccountStage, number> | null>(null)
  const [filter, setFilter] = useState<AccountStage | 'all'>('all')
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await api<{ stages: Record<AccountStage, number>; accounts: AccountRow[] }>('/accounts')
    setRows(r.accounts)
    setStages(r.stages)
  }, [])
  useOnChange(() => void load())
  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter(
      (a) =>
        (filter === 'all' || a.stage === filter) &&
        (!q || a.name.toLowerCase().includes(q) || a.peopleNames.some((n) => n.toLowerCase().includes(q))),
    )
  }, [rows, filter, query])

  /** An account before anyone there is saved: a prospect you have only heard of. */
  async function create() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      await api('/accounts', { method: 'PUT', body: { name, stage: 'prospect' } })
      setNewName('')
      await load()
      onOpen(name)
    } finally {
      setBusy(false)
    }
  }

  if (!rows) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="blank">
        <span className="blank-mark" aria-hidden>
          &#127970;
        </span>
        <h3>{showStages ? t('No accounts yet') : t('No companies yet')}</h3>
        <p>
          {rich(
            'Every company or organisation you put in someone’s <b>Works at</b> gets a page here, with everyone you know there and everything open with them.',
            { b: (s) => <strong>{s}</strong> },
          )}
          {showStages ? ` ${t('Or add one you are only starting to approach.')}` : ''}
        </p>
        <div className="row inline-field-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('e.g. {examples}', { examples: 'Tata Motors' })}
            aria-label={t('New account')}
          />
          <button className="primary small-btn" onClick={() => void create()} disabled={busy || !newName.trim()}>
            {t('Add account')}
          </button>
          <button className="ghost small-btn" onClick={onAddPerson}>
            {t('Add a person')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="row">
        <input
          className="grow"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search companies, or the people there')}
        />
      </div>

      {/* The pipeline at a glance, and a filter. */}
      {showStages && (
      <div className="chips">
        <button className={`chip${filter === 'all' ? ' selected' : ''}`} onClick={() => setFilter('all')}>
          {t('All')} · {rows.length}
        </button>
        {ACCOUNT_STAGES.map((s) => (
          <button
            key={s}
            className={`chip${filter === s ? ' selected' : ''}${stages?.[s] ? '' : ' is-empty'}`}
            onClick={() => setFilter(s)}
          >
            {ACCOUNT_STAGE_LABELS[s]} · {stages?.[s] ?? 0}
          </button>
        ))}
      </div>
      )}

      {shown.length === 0 ? (
        <p className="muted small">
          {query.trim() ? t('Nothing here matches “{query}”.', { query: query.trim() }) : t('Nothing here at this stage.')}
        </p>
      ) : (
        <div className="tiles two-up">
          {shown.map((a) => (
            <article key={a.key} className="tile">
              <span className={`tile-mark${a.stage === 'customer' ? ' is-accent' : ''}`} aria-hidden>
                {initials(a.name)}
              </span>
              <div className="tile-body">
                <p className="tile-title">{a.name}</p>
                <p className="tile-sub">
                  {a.people === 0
                    ? t('Nobody saved yet')
                    : `${a.peopleNames.join(', ')}${a.people > a.peopleNames.length ? ` +${a.people - a.peopleNames.length}` : ''}`}
                </p>
                <div className="tile-tags">
                  {showStages && a.stage && (
                    <span className={`tag${a.stage === 'customer' ? ' is-live' : ''}`}>
                      {ACCOUNT_STAGE_LABELS[a.stage]}
                    </span>
                  )}
                  {a.quiet && <span className="tag is-warn">{t('Gone quiet')}</span>}
                  {a.waiting > 0 && (
                    <span className={`tag${a.waitingDue ? ' is-warn' : ''}`}>
                      {t('Waiting')} · {a.waiting}
                    </span>
                  )}
                  {a.owe > 0 && (
                    <span className="tag">
                      {t('You owe')} · {a.owe}
                    </span>
                  )}
                  {a.hasNext && <span className="tag is-live">{t('Meeting booked')}</span>}
                  {a.reachOut > 0 && (
                    <span className="tag is-warn">
                      {t('Reach out')} · {a.reachOut}
                    </span>
                  )}
                  {a.lastContact && (
                    <span className="tag">{t('Last contact {when}', { when: relativeDay(a.lastContact) })}</span>
                  )}
                </div>
              </div>
              <div className="tile-actions">
                <button className="ghost small-btn" onClick={() => onOpen(a.name)}>
                  {t('Open')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="row inline-field-row">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={
            showStages
              ? t('Add an account you are approaching, e.g. {example}', { example: 'Tata Motors' })
              : t('Add a company, e.g. {example}', { example: 'Tata Motors' })
          }
          aria-label={t('New account')}
        />
        <button className="ghost small-btn" onClick={() => void create()} disabled={busy || !newName.trim()}>
          {t('Add account')}
        </button>
      </div>
    </div>
  )
}
