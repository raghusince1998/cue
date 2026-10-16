import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CommitmentDTO, PlaceDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { formatDateTime } from '../lib/time.ts'
import { t } from '../lib/i18n.tsx'
import { readNotes } from '../lib/sample.ts'

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
  const [places, setPlaces] = useState<PlaceDTO[] | null>(null)
  const [error, setError] = useState(false)
  const [params, setParams] = useSearchParams()
  // /places?place=<id>: a search result, opened.
  const [openId, setOpenId] = useState<string | null>(() => params.get('place'))
  const [detail, setDetail] = useState<PlaceDetail | null>(null)

  const load = () => {
    setError(false)
    void api<PlaceDTO[]>('/places')
      .then(setPlaces)
      .catch(() => setError(true))
  }
  useEffect(load, [])

  useEffect(() => {
    if (!params.has('place')) return
    params.delete('place')
    setParams(params, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    if (!openId) {
      setDetail(null)
      return
    }
    void api<PlaceDetail>(`/places/${openId}`).then(setDetail)
  }, [openId])

  if (error) {
    return (
      <div className="stack">
        <h1 className="page-title">{t('Places')}</h1>
        <p className="error small">{t('Could not load your places just now.')}</p>
        <button className="ghost small-btn fit-btn" onClick={load}>
          {t('Try again')}
        </button>
      </div>
    )
  }

  if (places === null) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  if (places.length === 0) {
    return (
      <div className="empty">
        <p>{t('No places yet.')}</p>
        <p className="muted small">
          {t(
            'The first time you log a visit somewhere new, it gets saved here and recognised automatically on every visit after that.',
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="stack">
      <h1 className="page-title">{t('Places')}</h1>
      <ul className="list">
        {places.map((p) => (
          <li key={p.id} className="card">
            <button
              className="place-row"
              onClick={() => setOpenId(openId === p.id ? null : p.id)}
            >
              <div>
                <p className="commitment-title">{p.name}</p>
                <p className="muted small">{p.kind ?? t('place')}</p>
              </div>
              <span className="muted">{openId === p.id ? '−' : '+'}</span>
            </button>

            {openId === p.id && detail && (
              <div className="detail">
                {detail.commitments.filter((c) => c.status === 'pending').length > 0 && (
                  <>
                    <h3 className="section-title small-title">{t('Open with this place')}</h3>
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

                <h3 className="section-title small-title">{t('History')}</h3>
                {detail.interactions.length === 0 ? (
                  <p className="muted small">{t('No visits recorded yet.')}</p>
                ) : (
                  <ul className="plain">
                    {detail.interactions.map((i) => (
                      <li key={i.id}>
                        <span className="muted small">{formatDateTime(i.startedAt)}</span>
                        {' — '}
                        {t(i.outcome ?? i.purpose)}
                        {i.contactName ? ` · ${i.contactName}` : ''}
                        {readNotes(i.notes).notes && <p className="notes">{readNotes(i.notes).notes}</p>}
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
