import { useCallback, useEffect, useState } from 'react'
import { DELIVERY_STATUS_LABEL, formatRupees, type DeliveryDTO } from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange, useOnChange } from '../lib/changes.ts'
import { dayLabel } from '../lib/time.ts'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** "Arriving today", "Expected Wed 14 Oct", "Was due 10 Oct — has it come?" */
function whenLine(x: DeliveryDTO): { text: string; tone: '' | 'is-today' | 'is-late' | 'is-done' } {
  if (x.status === 'delivered') return { text: 'Delivered', tone: 'is-done' }
  const now = new Date()
  const today = ymd(now)
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  if (x.expectedOn === today) return { text: x.status === 'out_for_delivery' ? 'Out for delivery today' : 'Arriving today', tone: 'is-today' }
  if (x.expectedOn === tomorrow) return { text: 'Arriving tomorrow', tone: '' }
  if (x.expectedOn && x.expectedOn < today) return { text: `Was due ${dayLabel(x.expectedOn)}. Has it come?`, tone: 'is-late' }
  if (x.expectedOn) return { text: `Expected ${dayLabel(x.expectedOn)}`, tone: '' }
  return { text: DELIVERY_STATUS_LABEL[x.status], tone: '' }
}

/**
 * Parcels on their way, from the messages shops and couriers send: shared
 * into Cue or pasted in the box. What comes today, and the cash to keep ready.
 */
export function Deliveries() {
  const [items, setItems] = useState<DeliveryDTO[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await api<DeliveryDTO[]>('/deliveries'))
    } catch {
      // Not worth a message: the rest of Today still works.
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useOnChange(() => void load())

  async function act(id: string, how: 'got' | 'remove') {
    setBusy(id)
    try {
      if (how === 'got') await api(`/deliveries/${id}`, { method: 'PATCH', body: { status: 'delivered' } })
      else await api(`/deliveries/${id}`, { method: 'DELETE' })
      await load()
      announceChange()
    } finally {
      setBusy(null)
    }
  }

  if (items.length === 0) return null

  const today = ymd(new Date())
  const cash = items
    .filter((x) => x.expectedOn === today && x.status !== 'delivered')
    .reduce((s, x) => s + (x.codPaise ?? 0), 0)
  return (
    <section className="card deliveries-card">
      <div className="row deliveries-head">
        <h2 className="section-title">Deliveries</h2>
        {cash > 0 && <span className="delivery-cash">Keep {formatRupees(cash)} ready today</span>}
      </div>
      <ul className="plain deliveries-list">
        {items.map((x) => {
          const when = whenLine(x)
          return (
            <li key={x.id} className={`delivery${x.status === 'delivered' ? ' is-done' : ''}`}>
              <span className="delivery-mark" aria-hidden>
                {(x.store ?? 'P')[0]!.toUpperCase()}
              </span>
              <div className="delivery-body">
                <span className="delivery-what">
                  {x.store ?? 'Parcel'}
                  {x.item && <span className="muted"> · {x.item}</span>}
                </span>
                <span className={`delivery-when ${when.tone}`}>
                  {when.text}
                  {x.codPaise && x.status !== 'delivered' ? ` · ${formatRupees(x.codPaise)} cash on delivery` : ''}
                </span>
              </div>
              <div className="delivery-actions">
                {x.status !== 'delivered' && (
                  <button className="ghost tiny-btn" onClick={() => void act(x.id, 'got')} disabled={busy === x.id}>
                    Got it
                  </button>
                )}
                {x.trackingUrl && x.status !== 'delivered' && (
                  <a className="ghost tiny-btn link-btn" href={x.trackingUrl} target="_blank" rel="noopener noreferrer">
                    Track
                  </a>
                )}
                <button
                  className="link small danger-text"
                  onClick={() => void act(x.id, 'remove')}
                  disabled={busy === x.id}
                  aria-label={`Remove ${x.store ?? 'parcel'}`}
                >
                  ✕
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
