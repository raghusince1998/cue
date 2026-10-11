import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  BILL_CATEGORIES,
  REPEATS,
  categoryOfBill,
  daysToDue,
  dueLabel,
  formatRupees,
  type BillDTO,
  type Repeat,
} from '@cue/shared'
import { api } from '../lib/api.ts'
import { announceChange, useOnChange } from '../lib/changes.ts'
import { dayLabel } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { rupeesToPaise } from '../components/Owed.tsx'

interface Summary {
  bills: BillDTO[]
  month: { duePaise: number; paidPaise: number; overdue: number; dueThisWeek: number }
}

const REMIND_CHOICES = [
  { days: 0, label: 'On the day' },
  { days: 1, label: '1 day before' },
  { days: 3, label: '3 days before' },
  { days: 7, label: 'A week before' },
  { days: 30, label: 'A month before' },
  { days: 60, label: 'Two months before' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const mark = (category: string) => BILL_CATEGORIES.find((c) => c.key === category)?.mark ?? '📌'
const repeatLabel = (r: Repeat) => REPEATS.find((x) => x.key === r)!.label

/**
 * Bills and renewals: what is due, what is overdue, and what expires. One tap
 * marks a bill paid and moves it to its next date; a renewal asks until when.
 */
export default function Bills() {
  const [data, setData] = useState<Summary | null>(null)
  const [editing, setEditing] = useState<BillDTO | 'new' | null>(null)
  const [renewing, setRenewing] = useState<BillDTO | null>(null)
  const [toast, setToast] = useState<{ text: string; billId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api<Summary>('/bills'))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useOnChange(() => void load())

  async function paid(bill: BillDTO, nextDueOn?: string) {
    const after = await api<BillDTO>(`/bills/${bill.id}/paid`, { method: 'POST', body: nextDueOn ? { nextDueOn } : {} })
    setToast({
      text: after.active
        ? `${bill.name} ${bill.kind === 'renewal' ? 'renewed' : 'paid'}. Next: ${dayLabel(after.dueOn)}.`
        : `${bill.name} paid. That was the last one.`,
      billId: bill.id,
    })
    await load()
    announceChange()
  }

  async function undo() {
    if (!toast) return
    await api(`/bills/${toast.billId}/undo-paid`, { method: 'POST', body: {} })
    setToast(null)
    await load()
    announceChange()
  }

  if (error && !data) return <p className="error">{error}</p>

  const today = new Date()
  const bills = (data?.bills ?? []).filter((x) => x.kind === 'bill')
  const renewals = (data?.bills ?? []).filter((x) => x.kind === 'renewal')
  const groups = [
    { title: 'Overdue', items: bills.filter((x) => daysToDue(x.dueOn, today) < 0), alert: true },
    { title: 'Due this week', items: bills.filter((x) => daysToDue(x.dueOn, today) >= 0 && daysToDue(x.dueOn, today) <= 7) },
    { title: 'Later', items: bills.filter((x) => daysToDue(x.dueOn, today) > 7) },
  ]

  return (
    <div className="stack bills-page">
      <div className="page-head">
        <h1 className="page-title">Bills &amp; renewals</h1>
        <button className="primary small-btn" onClick={() => setEditing('new')}>
          Add a bill
        </button>
      </div>

      {data && (bills.length > 0 || renewals.length > 0) && (
        <div className="brief-stats bills-stats">
          <span className="stat">
            <strong>{formatRupees(data.month.duePaise)}</strong>
            <span>still due this month</span>
          </span>
          <span className="stat">
            <strong>{formatRupees(data.month.paidPaise)}</strong>
            <span>paid this month</span>
          </span>
          {data.month.overdue > 0 && (
            <span className="stat is-alert">
              <strong>{data.month.overdue}</strong>
              <span>overdue</span>
            </span>
          )}
        </div>
      )}

      {toast && (
        <div className="bills-toast">
          <span>{toast.text}</span>
          <button className="link small" onClick={() => void undo()}>
            Undo
          </button>
        </div>
      )}

      {!data ? (
        <div className="boot">
          <span className="spinner" />
        </div>
      ) : bills.length === 0 && renewals.length === 0 ? (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#129534;
          </span>
          <h3>No bills yet</h3>
          <p>
            Rent, electricity, EMIs, subscriptions, insurance, and what expires, like a passport or a
            licence. Each gets a reminder before it is due. Quickest from the box on Today: type{' '}
            <strong>rent ₹15,000 on the 1st every month</strong> or{' '}
            <strong>passport expires 12 march 2028</strong>.
          </p>
          <button className="primary small-btn" onClick={() => setEditing('new')}>
            Add a bill
          </button>
        </div>
      ) : (
        <>
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <section key={g.title} className="stack tight">
                  <h2 className={`section-title${g.alert ? ' danger' : ''}`}>
                    {g.title} · {g.items.length}
                  </h2>
                  <div className="bills-list">
                    {g.items.map((x) => (
                      <BillRow key={x.id} bill={x} onPaid={() => void paid(x)} onEdit={() => setEditing(x)} />
                    ))}
                  </div>
                </section>
              ),
          )}
          {renewals.length > 0 && (
            <section className="stack tight">
              <h2 className="section-title">Renewals &amp; expiry dates · {renewals.length}</h2>
              <div className="bills-list">
                {renewals.map((x) => (
                  <BillRow key={x.id} bill={x} onPaid={() => setRenewing(x)} onEdit={() => setEditing(x)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {editing && (
        <Modal title={editing === 'new' ? 'Add a bill or renewal' : editing.name} onClose={() => setEditing(null)} closeOnBackdrop={false}>
          <BillForm
            initial={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null)
              void load()
              announceChange()
            }}
          />
        </Modal>
      )}

      {renewing && (
        <Modal title={`Renewed: ${renewing.name}`} onClose={() => setRenewing(null)}>
          <RenewForm
            bill={renewing}
            onRenewed={(next) => {
              const b = renewing
              setRenewing(null)
              void paid(b, next)
            }}
          />
        </Modal>
      )}
    </div>
  )
}

function BillRow({ bill, onPaid, onEdit }: { bill: BillDTO; onPaid: () => void; onEdit: () => void }) {
  const n = daysToDue(bill.dueOn)
  const tone = n < 0 ? 'is-late' : n <= Math.max(bill.remindDays, 1) ? 'is-soon' : ''
  return (
    <article className="bill-row">
      <span className="bill-mark" aria-hidden>
        {mark(bill.category)}
      </span>
      <button className="bill-main" onClick={onEdit} aria-label={`Edit ${bill.name}`}>
        <span className="bill-name">{bill.name}</span>
        <span className="bill-sub">
          {[bill.kind === 'renewal' ? null : repeatLabel(bill.repeat), bill.autopay ? 'pays itself' : null, dayLabel(bill.dueOn)]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      <div className="bill-side">
        {bill.amountPaise && <strong>{formatRupees(bill.amountPaise)}</strong>}
        <span className={`bill-due ${tone}`}>{dueLabel(bill.dueOn, bill.kind)}</span>
      </div>
      <button className="ghost small-btn bill-paid" onClick={onPaid}>
        {bill.kind === 'renewal' ? 'Renewed' : 'Paid'}
      </button>
    </article>
  )
}

function RenewForm({ bill, onRenewed }: { bill: BillDTO; onRenewed: (next: string) => void }) {
  const [next, setNext] = useState('')
  return (
    <div className="stack tight">
      <p className="muted small">Until when is it valid now? The reminder moves to the new date.</p>
      <input type="date" value={next} min={ymd(new Date())} onChange={(e) => setNext(e.target.value)} aria-label="New expiry date" />
      <div className="row">
        <button className="primary small-btn" disabled={!next || next <= bill.dueOn} onClick={() => onRenewed(next)}>
          Save
        </button>
      </div>
    </div>
  )
}

function BillForm({ initial, onDone }: { initial: BillDTO | null; onDone: () => void }) {
  const [kind, setKind] = useState<'bill' | 'renewal'>(initial?.kind ?? 'bill')
  const [name, setName] = useState(initial?.name ?? '')
  const [amount, setAmount] = useState(initial?.amountPaise ? String(initial.amountPaise / 100) : '')
  const [dueOn, setDueOn] = useState(initial?.dueOn ?? '')
  const [repeat, setRepeat] = useState<Repeat>(initial?.repeat ?? 'monthly')
  const [remindDays, setRemindDays] = useState(initial?.remindDays ?? 3)
  const [autopay, setAutopay] = useState(initial?.autopay ?? false)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [payments, setPayments] = useState<{ id: string; dueOn: string; paidOn: string; amountPaise: number | null }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!initial) return
    void api<typeof payments>(`/bills/${initial.id}/payments`)
      .then(setPayments)
      .catch(() => undefined)
  }, [initial])

  function pickKind(k: 'bill' | 'renewal') {
    setKind(k)
    if (!initial) {
      setRepeat(k === 'renewal' ? 'none' : 'monthly')
      setRemindDays(k === 'renewal' ? 30 : 3)
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !dueOn) {
      setError(kind === 'renewal' ? 'What is it, and when does it expire?' : 'What is it, and when is it due?')
      return
    }
    const paise = amount.trim() ? rupeesToPaise(amount) : null
    if (amount.trim() && !paise) {
      setError('The amount is just a number, e.g. 1200.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = {
        name,
        kind,
        category: categoryOfBill(name),
        amountPaise: paise,
        dueOn,
        repeat,
        remindDays,
        autopay: kind === 'bill' ? autopay : false,
        notes: notes || null,
      }
      if (initial) await api(`/bills/${initial.id}`, { method: 'PATCH', body })
      else await api('/bills', { method: 'POST', body })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!initial || !window.confirm(`Delete ${initial.name}? Its payment history goes with it.`)) return
    await api(`/bills/${initial.id}`, { method: 'DELETE' })
    onDone()
  }

  return (
    <form className="stack tight bill-form" onSubmit={(e) => void save(e)}>
      <div className="viewswitch">
        <button type="button" className={kind === 'bill' ? 'selected' : ''} onClick={() => pickKind('bill')}>
          A bill to pay
        </button>
        <button type="button" className={kind === 'renewal' ? 'selected' : ''} onClick={() => pickKind('renewal')}>
          Something that expires
        </button>
      </div>
      <label>
        What is it?
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === 'renewal' ? 'e.g. Passport, Driving licence, Car insurance' : 'e.g. Rent, Electricity, Home loan EMI'}
          maxLength={120}
          autoFocus={!initial}
        />
      </label>
      <div className="bill-form-row">
        <label>
          {kind === 'renewal' ? 'Expires on' : 'Next due on'}
          <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
        <label>
          {kind === 'renewal' ? 'Renewal fee (optional)' : 'Amount (optional)'}
          <span className="amount-field small-amount">
            <span aria-hidden>₹</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" />
          </span>
        </label>
      </div>
      <div className="bill-form-row">
        <label>
          How often
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            {REPEATS.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Remind me
          <select value={remindDays} onChange={(e) => setRemindDays(Number(e.target.value))}>
            {REMIND_CHOICES.map((r) => (
              <option key={r.days} value={r.days}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind === 'bill' && (
        <label className="checkbox">
          <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
          <span>It pays itself (autopay): just remind me to keep the balance in</span>
        </label>
      )}
      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Account number, where to pay…" />
      </label>
      <div className="row">
        <button className="primary small-btn" type="submit" disabled={busy}>
          {initial ? 'Save' : 'Add'}
        </button>
        {initial && (
          <button type="button" className="link small danger-text" onClick={() => void remove()}>
            Delete
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}

      {payments.length > 0 && (
        <>
          <span className="label-text">History</span>
          <ul className="plain bill-history">
            {payments.map((x) => (
              <li key={x.id}>
                {kind === 'renewal' ? 'Renewed' : 'Paid'} {dayLabel(x.paidOn)}
                {x.amountPaise ? ` · ${formatRupees(x.amountPaise)}` : ''}
                <span className="muted"> · for {dayLabel(x.dueOn)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </form>
  )
}
