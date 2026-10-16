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
import { language, msg, rich, t } from '../lib/i18n.tsx'
import { dayLabel } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { rupeesToPaise } from '../components/Owed.tsx'
import { errorText } from '../lib/errors.ts'

interface Summary {
  bills: BillDTO[]
  month: { duePaise: number; paidPaise: number; overdue: number; dueThisWeek: number }
}

const REMIND_CHOICES = [
  { days: 0, label: msg('On the day') },
  { days: 1, label: msg('1 day before') },
  { days: 3, label: msg('3 days before') },
  { days: 7, label: msg('A week before') },
  { days: 30, label: msg('A month before') },
  { days: 60, label: msg('Two months before') },
]

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const mark = (category: string) => BILL_CATEGORIES.find((c) => c.key === category)?.mark ?? '📌'
const repeatLabel = (r: Repeat) => t(REPEATS.find((x) => x.key === r)!.label)

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
      setError(errorText(err))
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
        ? bill.kind === 'renewal'
          ? t('{name} renewed. Next: {day}.', { name: bill.name, day: dayLabel(after.dueOn) })
          : t('{name} paid. Next: {day}.', { name: bill.name, day: dayLabel(after.dueOn) })
        : t('{name} paid. That was the last one.', { name: bill.name }),
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
    { title: t('Overdue'), items: bills.filter((x) => daysToDue(x.dueOn, today) < 0), alert: true },
    { title: t('Due this week'), items: bills.filter((x) => daysToDue(x.dueOn, today) >= 0 && daysToDue(x.dueOn, today) <= 7) },
    { title: t('Later'), items: bills.filter((x) => daysToDue(x.dueOn, today) > 7) },
  ]

  return (
    <div className="stack bills-page">
      <div className="page-head">
        <h1 className="page-title">{t('Bills & renewals')}</h1>
        <button className="primary small-btn" onClick={() => setEditing('new')}>
          {t('Add a bill')}
        </button>
      </div>

      {data && (bills.length > 0 || renewals.length > 0) && (
        <div className="brief-stats bills-stats">
          <span className="stat">
            <strong>{formatRupees(data.month.duePaise)}</strong>
            <span>{t('still due this month')}</span>
          </span>
          <span className="stat">
            <strong>{formatRupees(data.month.paidPaise)}</strong>
            <span>{t('paid this month')}</span>
          </span>
          {data.month.overdue > 0 && (
            <span className="stat is-alert">
              <strong>{data.month.overdue}</strong>
              <span>{t('overdue')}</span>
            </span>
          )}
        </div>
      )}

      {toast && (
        <div className="bills-toast">
          <span>{toast.text}</span>
          <button className="link small" onClick={() => void undo()}>
            {t('Undo')}
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
          <h3>{t('No bills yet')}</h3>
          <p>
            {rich(
              'Rent, electricity, EMIs, subscriptions, insurance, and what expires, like a passport or a licence. Each gets a reminder before it is due. Quickest from the box on Today: type {first} or {second}.',
              {
                first: <strong>rent ₹15,000 on the 1st every month</strong>,
                second: <strong>passport expires 12 march 2028</strong>,
              },
            )}
          </p>
          <button className="primary small-btn" onClick={() => setEditing('new')}>
            {t('Add a bill')}
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
              <h2 className="section-title">
                {t('Renewals & expiry dates')} · {renewals.length}
              </h2>
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
        <Modal title={editing === 'new' ? t('Add a bill or renewal') : editing.name} onClose={() => setEditing(null)} closeOnBackdrop={false}>
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
        <Modal title={t('Renewed: {name}', { name: renewing.name })} onClose={() => setRenewing(null)} closeOnBackdrop={false}>
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
      <button className="bill-main" onClick={onEdit} aria-label={t('Edit {name}', { name: bill.name })}>
        <span className="bill-name">{bill.name}</span>
        <span className="bill-sub">
          {[bill.kind === 'renewal' ? null : repeatLabel(bill.repeat), bill.autopay ? t('pays itself') : null, dayLabel(bill.dueOn)]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>
      <div className="bill-side">
        {bill.amountPaise && <strong>{formatRupees(bill.amountPaise)}</strong>}
        <span className={`bill-due ${tone}`}>{dueLabel(bill.dueOn, bill.kind, new Date(), language())}</span>
      </div>
      <button className="ghost small-btn bill-paid" onClick={onPaid}>
        {bill.kind === 'renewal' ? t('Renewed') : t('Paid')}
      </button>
    </article>
  )
}

function RenewForm({ bill, onRenewed }: { bill: BillDTO; onRenewed: (next: string) => void }) {
  const [next, setNext] = useState('')
  return (
    <div className="stack tight">
      <p className="muted small">{t('Until when is it valid now? The reminder moves to the new date.')}</p>
      <input
        type="date"
        value={next}
        min={ymd(new Date())}
        onChange={(e) => setNext(e.target.value)}
        aria-label={t('New expiry date')}
      />
      <div className="row">
        <button className="primary small-btn" disabled={!next || next <= bill.dueOn} onClick={() => onRenewed(next)}>
          {t('Save')}
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
      setError(kind === 'renewal' ? t('What is it, and when does it expire?') : t('What is it, and when is it due?'))
      return
    }
    const paise = amount.trim() ? rupeesToPaise(amount) : null
    if (amount.trim() && !paise) {
      setError(t('The amount is just a number, e.g. 1200.'))
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
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!initial || !window.confirm(t('Delete {name}? Its payment history goes with it.', { name: initial.name }))) return
    await api(`/bills/${initial.id}`, { method: 'DELETE' })
    onDone()
  }

  return (
    <form className="stack tight bill-form" onSubmit={(e) => void save(e)}>
      <div className="viewswitch">
        <button type="button" className={kind === 'bill' ? 'selected' : ''} onClick={() => pickKind('bill')}>
          {t('A bill to pay')}
        </button>
        <button type="button" className={kind === 'renewal' ? 'selected' : ''} onClick={() => pickKind('renewal')}>
          {t('Something that expires')}
        </button>
      </div>
      <label>
        {t('What is it?')}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            kind === 'renewal'
              ? t('e.g. {examples}', { examples: 'Passport, Driving licence, Car insurance' })
              : t('e.g. {examples}', { examples: 'Rent, Electricity, Home loan EMI' })
          }
          maxLength={120}
          autoFocus={!initial}
        />
      </label>
      <div className="bill-form-row">
        <label>
          {kind === 'renewal' ? t('Expires on') : t('Next due on')}
          <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
        <label>
          {kind === 'renewal' ? t('Renewal fee (optional)') : t('Amount (optional)')}
          <span className="amount-field small-amount">
            <span aria-hidden>₹</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" />
          </span>
        </label>
      </div>
      <div className="bill-form-row">
        <label>
          {t('How often')}
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            {REPEATS.map((r) => (
              <option key={r.key} value={r.key}>
                {t(r.label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Remind me')}
          <select value={remindDays} onChange={(e) => setRemindDays(Number(e.target.value))}>
            {REMIND_CHOICES.map((r) => (
              <option key={r.days} value={r.days}>
                {t(r.label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind === 'bill' && (
        <label className="checkbox">
          <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
          <span>{t('It pays itself (autopay): just remind me to keep the balance in')}</span>
        </label>
      )}
      <label>
        {t('Notes')}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder={t('Account number, where to pay…')}
        />
      </label>
      <div className="row">
        <button className="primary small-btn" type="submit" disabled={busy}>
          {initial ? t('Save') : t('Add')}
        </button>
        {initial && (
          <button type="button" className="link small danger-text" onClick={() => void remove()}>
            {t('Delete')}
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}

      {payments.length > 0 && (
        <>
          <span className="label-text">{t('History')}</span>
          <ul className="plain bill-history">
            {payments.map((x) => (
              <li key={x.id}>
                {kind === 'renewal'
                  ? t('Renewed {day}', { day: dayLabel(x.paidOn) })
                  : t('Paid {day}', { day: dayLabel(x.paidOn) })}
                {x.amountPaise ? ` · ${formatRupees(x.amountPaise)}` : ''}
                <span className="muted"> · {t('for {day}', { day: dayLabel(x.dueOn) })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </form>
  )
}
