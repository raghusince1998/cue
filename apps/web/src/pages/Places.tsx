import { useEffect, useState } from 'react'
import type { CommitmentDTO, PlaceDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { formatDateTime } from '../lib/time.ts'

interface Interaction {
  id: string
  purpose: string
  contactName: string | null
  outcome: string | null
  notes: string | null
  startedAt: string
}

interface PlaceDetail {
  place: PlaceDTO
  interactions: Interaction[]
  commitments: CommitmentDTO[]
}

export default function Places() {
  const [places, setPlaces] = useState<PlaceDTO[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PlaceDetail | null>(null)

  useEffect(() => {
    void api<PlaceDTO[]>('/places').then(setPlaces)
  }, [])

  useEffect(() => {
    if (!openId) {
      setDetail(null)
      return
    }
    void api<PlaceDetail>(`/places/${openId}`).then(setDetail)
  }, [openId])

  if (places.length === 0) {
    return (
      <div className="empty">
        <p>No places yet.</p>
        <p className="muted small">
          The first time you log a visit somewhere new, it gets saved here and recognised
          automatically on every visit after that.
        </p>
      </div>
    )
  }

  return (
    <div className="stack">
      <ul className="list">
        {places.map((p) => (
          <li key={p.id} className="card">
            <button
              className="place-row"
              onClick={() => setOpenId(openId === p.id ? null : p.id)}
            >
              <div>
                <p className="commitment-title">{p.name}</p>
                <p className="muted small">{p.kind ?? 'place'}</p>
              </div>
              <span className="muted">{openId === p.id ? '−' : '+'}</span>
            </button>

            {openId === p.id && detail && (
              <div className="detail">
                {detail.commitments.filter((c) => c.status === 'pending').length > 0 && (
                  <>
                    <h3 className="section-title small-title">Open with this place</h3>
                    <ul className="plain">
                      {detail.commitments
                        .filter((c) => c.status === 'pending')
                        .map((c) => (
                          <li key={c.id}>
                            {c.title} · <span className="muted">{formatDateTime(c.dueAt)}</span>
                          </li>
                        ))}
                    </ul>
                  </>
                )}

                <h3 className="section-title small-title">History</h3>
                {detail.interactions.length === 0 ? (
                  <p className="muted small">No visits recorded yet.</p>
                ) : (
                  <ul className="plain">
                    {detail.interactions.map((i) => (
                      <li key={i.id}>
                        <span className="muted small">{formatDateTime(i.startedAt)}</span>
                        {' — '}
                        {i.outcome ?? i.purpose}
                        {i.contactName ? ` · ${i.contactName}` : ''}
                        {i.notes && <p className="notes">{i.notes}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
