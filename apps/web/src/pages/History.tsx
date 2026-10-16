import { useCallback, useEffect, useState } from 'react'
/**
 * Three things that are all, in plain terms, "what happened": a visit you
 * logged, a plan you completed, and a plan you decided against.
 */
interface Entry {
  kind: 'visit' | 'done' | 'cancelled' | 'deleted'
  id: string
  title: string
  at: string
  place: string | null
  contact: string | null
  outcome: string | null
  notes: string | null
}

/**
 * Cancelled and let go are different things and read as different things.
 * Cancelling keeps the plan — it is still on its day, struck through.
 * Letting go takes it off every list, and only that earns the dimmed row.
 */
const KIND_TAG: Record<Entry['kind'], { label: string; className: string }> = {
  visit: { label: msg('Logged'), className: '' },
  done: { label: msg('Done'), className: 'is-live' },
  cancelled: { label: msg('Cancelled'), className: 'is-warn' },
  deleted: { label: msg('Let go'), className: 'is-warn' },
}

/**
 * A kind this build has never heard of still has to render.
 *
 * Adding 'cancelled' to the API blanked this entire page against the previous
 * bundle — one unknown key, and `KIND_TAG[kind].className` threw inside a map,
 * taking the whole screen with it. A served PWA is always some version behind
 * the API it talks to, so the lookup cannot be allowed to be the thing that
 * decides whether the page exists.
 */
const tagFor = (kind: Entry['kind']) => KIND_TAG[kind] ?? { label: kind, className: '' }
import { api } from '../lib/api.ts'
import { locale, msg, rich, t } from '../lib/i18n.tsx'
import { readNotes } from '../lib/sample.ts'
import { openAdd } from '../lib/addSheet.ts'
import { openPlan } from '../lib/open.ts'
import { relativeDay } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { VisitEditor } from '../components/VisitEditor.tsx'
import { CommitmentEditor } from '../components/CommitmentEditor.tsx'
import { errorText } from '../lib/errors.ts'
import { LoadFailed } from '../components/LoadFailed.tsx'

type Editing = { type: 'visit'; id: string } | { type: 'commitment'; id: string } | null

export default function History() {
  const [visits, setVisits] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Editing>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  /**
   * Take one entry off the record, for good.
   *
   * Asks first, because nothing brings it back: this is not the ordinary
   * delete, which keeps a "let go" line here. Removed from the screen only once
   * the server confirms, so a failure does not leave the list claiming
   * something is gone that is not.
   */
  async function remove(entry: Entry) {
    const question =
      entry.kind === 'visit'
        ? t('Remove this visit from your history? This cannot be undone.')
        : entry.kind === 'done'
          ? t('Remove this finished plan from your history? This cannot be undone.')
          : t('Remove this entry from your history? This cannot be undone.')
    if (!window.confirm(question)) return

    setRemoving(entry.id)
    try {
      await api(`/history/${entry.kind}/${entry.id}`, { method: 'DELETE' })
      setVisits((list) => list.filter((e) => !(e.id === entry.id && e.kind === entry.kind)))
    } catch (err) {
      window.alert(t('Could not remove it: {error}', { error: errorText(err) }))
    } finally {
      setRemoving(null)
    }
  }

  const [failed, setFailed] = useState(false)
  const load = useCallback(async () => {
    try {
      setVisits((await api<{ entries: Entry[] }>('/history')).entries)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  if (failed && visits.length === 0) {
    return (
      <LoadFailed
        what={t('Could not load your history just now.')}
        onRetry={() => {
          setLoading(true)
          void load()
        }}
      />
    )
  }

  if (visits.length === 0) {
    return (
      <div className="stack">
        <div className="page-head">
          <h1 className="page-title">{t('History')}</h1>
        </div>
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#128220;
          </span>
          <h3>{t('Nothing has happened yet')}</h3>
          <p>
            {rich(
              'Everything you finish, log or decide against ends up here — ticked plans, meetings you recorded, and the things you let go. Tick something off on <b>Today</b>, or record a meeting with <b>+ Add</b> → <b>Already happened</b>.',
              { b: (s) => <strong>{s}</strong> },
            )}
          </p>
          <button className="primary small-btn" onClick={() => openAdd({ mode: 'past' })}>
            {t('Record something')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">{t('History')}</h1>
        <span className="page-count">{t('{n} recorded', { n: visits.length })}</span>
      </div>

      <div className="tiles">
        {visits.map((v) => {
          const when = new Date(v.at)
          return (
            <article key={`${v.kind}-${v.id}`} className={`tile${v.kind === 'deleted' ? ' dimmed' : ''}`}>
              {/* The date as the anchor: history is scanned by when, so that
                  is what the eye should land on first. */}
              <span className={`tile-mark${v.kind === 'done' ? ' is-done-mark' : ''}`} aria-hidden>
                <span className="mark-top">
                  {when.toLocaleDateString(locale(), { month: 'short' })}
                </span>
                <span className="mark-main">{when.getDate()}</span>
              </span>

              <div className="tile-body">
                <p className="tile-title">
                  {v.kind === 'done' || v.kind === 'cancelled' ? (
                    <button className="plan-link" onClick={() => openPlan(v.id)}>
                      {v.title}
                    </button>
                  ) : (
                    v.title
                  )}
                </p>
                <p className="tile-sub">
                  {when.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })} ·{' '}
                  {relativeDay(v.at)}
                </p>

                <div className="tile-tags">
                  <span className={`tag ${tagFor(v.kind).className}`}>{t(tagFor(v.kind).label)}</span>
                  {v.place && <span className="tag">{v.place}</span>}
                  {v.contact && v.contact !== v.title && <span className="tag">{v.contact}</span>}
                  {v.outcome && <span className="tag is-live">{v.outcome}</span>}
                  {/* The sample week's marker, said as a tag rather than shown raw. */}
                  {readNotes(v.notes).sample && <span className="sample-tag">{t('Sample')}</span>}
                </div>

                {readNotes(v.notes).notes && <p className="notes">{readNotes(v.notes).notes}</p>}
              </div>

              {/* Only a logged visit has an editor; a finished plan is edited
                  from where it lives, and a dropped one is simply a record. */}
              <div className="tile-actions">
                {v.kind === 'visit' && (
                  <button
                    className="ghost small-btn"
                    onClick={() => setEditing({ type: 'visit', id: v.id })}
                  >
                    {t('Edit')}
                  </button>
                )}
                <button
                  className="ghost small-btn danger-text"
                  onClick={() => void remove(v)}
                  disabled={removing === v.id}
                  aria-label={t('Remove {title} from history', { title: v.title })}
                >
                  {removing === v.id ? t('Removing…') : t('Delete')}
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {editing?.type === 'visit' && (
        <Modal title={t('Edit entry')} onClose={() => setEditing(null)} closeOnBackdrop={false}>
          <VisitEditor
            visitId={editing.id}
            onClose={() => setEditing(null)}
            onEditCommitment={(id) => setEditing({ type: 'commitment', id })}
            onSaved={() => {
              setEditing(null)
              void load()
            }}
          />
        </Modal>
      )}

      {editing?.type === 'commitment' && (
        <Modal title={t('Edit follow-up')} onClose={() => setEditing(null)} closeOnBackdrop={false}>
          <CommitmentEditor
            commitmentId={editing.id}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              void load()
            }}
          />
        </Modal>
      )}
    </div>
  )
}
