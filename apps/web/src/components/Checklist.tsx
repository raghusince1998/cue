import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'

/**
 * The list attached to a plan.
 *
 * Ticked one at a time by somebody standing in a shop, so each tick is its own
 * small write and the row updates on the spot rather than waiting for a reload
 * of the whole screen.
 */

interface Item {
  id: string
  text: string
  done: boolean
}

export function Checklist({ commitmentId }: { commitmentId: string }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ items: Item[] }>(`/commitments/${commitmentId}/checklist`)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]))
  }, [commitmentId])

  async function toggle(item: Item) {
    // Flipped locally first: a tick that waits for the network feels broken in
    // a shop with one bar of signal.
    setItems((list) =>
      (list ?? []).map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
    )
    try {
      await api(`/checklist/${item.id}`, { method: 'PATCH', body: { done: !item.done } })
    } catch {
      setItems((list) => (list ?? []).map((i) => (i.id === item.id ? { ...i, done: item.done } : i)))
    }
  }

  async function add() {
    const text = adding.trim()
    if (!text) return
    setBusy(true)
    try {
      // One line may carry several, the same way the capture box does.
      const parts = text.split(/\s*,\s*|\s+and\s+/).map((p) => p.trim()).filter(Boolean)
      const r = await api<{ items: Item[] }>(`/commitments/${commitmentId}/checklist`, {
        method: 'POST',
        body: { items: parts },
      })
      setItems((list) => [...(list ?? []), ...r.items])
      setAdding('')
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: Item) {
    setItems((list) => (list ?? []).filter((i) => i.id !== item.id))
    await api(`/checklist/${item.id}`, { method: 'DELETE' }).catch(() => undefined)
  }

  if (items === null) return null

  const done = items.filter((i) => i.done).length

  return (
    <div className="checklist">
      {items.length > 0 && (
        <p className="checklist-count muted small">
          {done} of {items.length} done
        </p>
      )}

      <ul className="plain">
        {items.map((item) => (
          <li key={item.id}>
            <label className={`checklist-row${item.done ? ' is-done' : ''}`}>
              <input type="checkbox" checked={item.done} onChange={() => void toggle(item)} />
              <span>{item.text}</span>
              <button
                className="checklist-remove"
                aria-label={`Remove ${item.text}`}
                onClick={(e) => {
                  e.preventDefault()
                  void remove(item)
                }}
              >
                ×
              </button>
            </label>
          </li>
        ))}
      </ul>

      <div className="checklist-add">
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void add()
            }
          }}
          placeholder={items.length === 0 ? 'Add something to the list…' : 'Add another…'}
        />
        <button className="ghost tiny-btn" onClick={() => void add()} disabled={busy || !adding.trim()}>
          Add
        </button>
      </div>
    </div>
  )
}
