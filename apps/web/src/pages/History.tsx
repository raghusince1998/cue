import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  visit: { label: 'Logged', className: '' },
  done: { label: 'Done', className: 'is-live' },
  cancelled: { label: 'Cancelled', className: 'is-warn' },
  deleted: { label: 'Let go', className: 'is-warn' },
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
import { relativeDay } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { VisitEditor } from '../components/VisitEditor.tsx'
import { CommitmentEditor } from '../components/CommitmentEditor.tsx'

type Editing = { type: 'visit'; id: string } | { type: 'commitment'; id: string } | null

export default function History() {
  const navigate = useNavigate()
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
    const what =
      entry.kind === 'visit' ? 'this visit' : entry.kind === 'done' ? 'this finished plan' : 'this entry'
    if (!window.confirm(`Remove ${what} from your history? This cannot be undone.`)) return

    setRemoving(entry.id)
    try {
      await api(`/history/${entry.kind}/${entry.id}`, { method: 'DELETE' })
      setVisits((list) => list.filter((e) => !(e.id === entry.id && e.kind === entry.kind)))
    } catch (err) {
      window.alert(`Could not remove it: ${(err as Error).message}`)
    } finally {
      setRemoving(null)
    }
  }

  const load = useCallback(async () => {
    setVisits((await api<{ entries: Entry[] }>('/history')).entries)
    setLoading(false)
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

  if (visits.length === 0) {
    return (
      <div className="stack">
        <div className="page-head">
          <h1 className="page-title">History</h1>
        </div>
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#128220;
          </span>
          <h3>Nothing has happened yet</h3>
          <p>
            Everything you finish, log or decide against ends up here — ticked plans, meetings
            you recorded, and the things you let go. Tick something off on <strong>Today</strong>,
            or record a meeting from <strong>Add</strong> &rarr; <strong>Already happened</strong>.
          </p>
          <button className="primary small-btn" onClick={() => navigate('/log')}>
            Record something
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">History</h1>
        <span className="page-count">{visits.length} recorded</span>
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
                  {when.toLocaleDateString([], { month: 'short' })}
                </span>
                <span className="mark-main">{when.getDate()}</span>
              </span>

              <div className="tile-body">
                <p className="tile-title">{v.title}</p>
                <p className="tile-sub">
                  {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ·{' '}
                  {relativeDay(v.at)}
                </p>

                <div className="tile-tags">
                  <span className={`tag ${tagFor(v.kind).className}`}>{tagFor(v.kind).label}</span>
                  {v.place && <span className="tag">{v.place}</span>}
                  {v.contact && v.contact !== v.title && <span className="tag">{v.contact}</span>}
                  {v.outcome && <span className="tag is-live">{v.outcome}</span>}
                </div>

                {v.notes && <p className="notes">{v.notes}</p>}
              </div>

              {/* Only a logged visit has an editor; a finished plan is edited
                  from where it lives, and a dropped one is simply a record. */}
              <div className="tile-actions">
                {v.kind === 'visit' && (
                  <button
                    className="ghost small-btn"
                    onClick={() => setEditing({ type: 'visit', id: v.id })}
                  >
                    Edit
                  </button>
                )}
                <button
                  className="ghost small-btn danger-text"
                  onClick={() => void remove(v)}
                  disabled={removing === v.id}
                  aria-label={`Remove ${v.title} from history`}
                >
                  {removing === v.id ? 'Removing…' : 'Delete'}
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {editing?.type === 'visit' && (
        <Modal title="Edit entry" onClose={() => setEditing(null)}>
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
        <Modal title="Edit follow-up" onClose={() => setEditing(null)}>
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
