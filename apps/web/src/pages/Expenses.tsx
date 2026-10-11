import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  EXPENSE_CATEGORIES,
  categoryOf,
  formatRupees,
  shortName,
  splitEqually,
  type ExpenseCategory,
  type ExpenseDTO,
} from '@cue/shared'
import { api, apiFetchBlobUrl, BASE, getToken } from '../lib/api.ts'
import { useOnChange } from '../lib/changes.ts'
import { dayLabel, spanLabel } from '../lib/time.ts'
import { Modal } from '../components/Modal.tsx'
import { waNumber } from '../components/PersonSheet.tsx'
import { OwedCard, rupeesToPaise } from '../components/Owed.tsx'

interface Month {
  month: string
  expenses: ExpenseDTO[]
  totals: {
    all: number
    unclaimed: number
    claimed: number
    reimbursed: number
    /** Other people's parts, owed or paid back. */
    people: number
    byCategory: Record<string, number>
  }
}

interface Recipient {
  reportToName: string | null
  reportToEmail: string | null
  reportToPhone: string | null
}

const STATUS_WORD: Record<ExpenseDTO['claimStatus'], string> = {
  unclaimed: 'To claim',
  claimed: 'Claimed',
  reimbursed: 'Paid back',
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  return monthOf(new Date(y!, m! - 1 + by, 1))
}

/** "October", or "October 2025" when it is not this year. */
function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y!, m! - 1, 1)
  return d.toLocaleDateString([], {
    month: 'long',
    ...(y === new Date().getFullYear() ? {} : { year: 'numeric' }),
  })
}

const categoryInfo = (key: string) => EXPENSE_CATEGORIES.find((c) => c.key === key) ?? EXPENSE_CATEGORIES.at(-1)!

/** Who or what it was for, in one phrase. */
function forWhom(x: ExpenseDTO): string | null {
  if (x.contactName && x.account && !x.contactName.includes(x.account)) return `${x.contactName}, ${x.account}`
  return x.contactName ?? x.account
}

/** The longest edge a receipt is kept at: enough to read a printed total. */
const RECEIPT_EDGE = 1600

/**
 * A phone photo is several megabytes; a receipt needs to be legible, not
 * archival. Resized and re-encoded here so it uploads on a patchy connection.
 */
async function toReceiptJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, RECEIPT_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot resize images.')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read that image.'))), 'image/jpeg', 0.8)
    })
  } finally {
    bitmap.close()
  }
}

async function uploadReceipt(id: string, file: File): Promise<void> {
  const blob = await toReceiptJpeg(file)
  const token = getToken()
  const res = await fetch(`${BASE}/expenses/${id}/receipt`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: blob,
  })
  if (!res.ok) throw new Error(res.status === 413 ? 'That photo is too large.' : 'The receipt did not save. Try again.')
}

/**
 * Money spent on the road, logged as it happens and claimed back in one go.
 *
 * Each expense lands on the trip it was spent on by its date, and on the
 * person or company it was for when the capture box recognised them, so the
 * claim at the end of the month writes itself.
 */
export default function Expenses() {
  const location = useLocation()
  const navigate = useNavigate()
  const [month, setMonth] = useState(() => monthOf(new Date()))
  const [data, setData] = useState<Month | null>(null)
  const [toClaim, setToClaim] = useState<ExpenseDTO[]>([])
  const [awaiting, setAwaiting] = useState<ExpenseDTO[]>([])
  const [accounts, setAccounts] = useState<string[]>([])
  const [people, setPeople] = useState<{ id: string; name: string }[]>([])
  const [owedKey, setOwedKey] = useState(0)
  const [owedFocus, setOwedFocus] = useState(false)
  const [filter, setFilter] = useState<ExpenseCategory | null>(null)
  const [editing, setEditing] = useState<ExpenseDTO | null>(null)
  const [viewing, setViewing] = useState<ExpenseDTO | null>(null)
  const [sheet, setSheet] = useState<'claim' | 'paid' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [m, u, c] = await Promise.all([
        api<Month>('/expenses', { query: { month } }),
        api<ExpenseDTO[]>('/expenses/unclaimed'),
        api<ExpenseDTO[]>('/expenses/claimed'),
      ])
      setData(m)
      setToClaim(u)
      setAwaiting(c)
      setOwedKey((k) => k + 1)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])
  // "₹450 cab" typed in the capture box lands here.
  useOnChange(() => void load())

  useEffect(() => {
    void api<{ accounts: { name: string }[] }>('/accounts')
      .then((r) => setAccounts(r.accounts.map((a) => a.name)))
      .catch(() => undefined)
    void api<{ id: string; name: string }[]>('/contacts')
      .then((r) => setPeople(r.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => undefined)
  }, [])

  // Arriving from an insight: "Make a claim", "See claims", "Remind them".
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.has('claim')) setSheet('claim')
    else if (params.has('paid')) setSheet('paid')
    else if (params.has('owed')) setOwedFocus(true)
    else return
    navigate('/expenses', { replace: true })
  }, [location.search, navigate])

  useEffect(() => {
    if (owedFocus) document.getElementById('owed')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [owedFocus])

  const shown = useMemo(
    () => (data?.expenses ?? []).filter((x) => !filter || x.category === filter),
    [data, filter],
  )
  const days = useMemo(() => {
    const out: { day: string; items: ExpenseDTO[]; total: number }[] = []
    for (const x of shown) {
      const last = out.at(-1)
      if (last?.day === x.spentOn) {
        last.items.push(x)
        last.total += x.amountPaise
      } else out.push({ day: x.spentOn, items: [x], total: x.amountPaise })
    }
    return out
  }, [shown])

  const claimTotal = toClaim.reduce((s, x) => s + x.claimablePaise, 0)
  const awaitingTotal = awaiting.reduce((s, x) => s + x.claimablePaise, 0)
  const thisMonth = monthOf(new Date())
  const older = toClaim.filter((x) => x.spentOn < `${thisMonth}-01`).length
  const olderNote =
    older === 0
      ? ''
      : older === toClaim.length
        ? `, ${older === 1 ? '' : 'all '}from before this month`
        : `, ${older} from before this month`
  const cats = data
    ? EXPENSE_CATEGORIES.filter((c) => data.totals.byCategory[c.key]).sort(
        (a, b) => data.totals.byCategory[b.key]! - data.totals.byCategory[a.key]!,
      )
    : []
  const biggest = cats.length ? data!.totals.byCategory[cats[0]!.key]! : 0

  if (error && !data) return <p className="error">{error}</p>

  return (
    <div className="stack expenses-page">
      <div className="page-head">
        <h1 className="page-title">Expenses</h1>
        {data && <span className="page-count">{formatRupees(data.totals.all)} in {monthName(month)}</span>}
      </div>

      <div className="expense-top">
        <ExpenseForm
          accounts={accounts}
          people={people}
          onSaved={(x) => {
            setNote(
              `Saved ${formatRupees(x.amountPaise)}${x.tripLabel ? ` on your ${x.tripLabel} trip` : ''}${x.spentOn.startsWith(month) ? '' : `, in ${monthName(x.spentOn.slice(0, 7))}`}.`,
            )
            void load()
          }}
        />

        <div className="stack expense-side-col">
        <section className="card expense-claims">
          <h2 className="section-title">Claims</h2>
          {toClaim.length === 0 && awaiting.length === 0 ? (
            <p className="muted small">
              Nothing waiting. Everything you log stays here until you claim it, then until it is paid back.
            </p>
          ) : (
            <>
              <button className="primary claim-btn" disabled={toClaim.length === 0} onClick={() => setSheet('claim')}>
                {toClaim.length ? `Make a claim · ${formatRupees(claimTotal)}` : 'Nothing to claim'}
              </button>
              <p className="muted small">
                {toClaim.length ? `${toClaim.length} expense${toClaim.length === 1 ? '' : 's'} not claimed yet${olderNote}.` : 'Everything is claimed.'}
              </p>
              {awaiting.length > 0 && (
                <button className="ghost small-btn fit-btn" onClick={() => setSheet('paid')}>
                  {formatRupees(awaitingTotal)} claimed, waiting to be paid back
                </button>
              )}
            </>
          )}
        </section>

        <OwedCard people={people} highlight={owedFocus} reloadKey={owedKey} onChanged={() => void load()} />
        </div>
      </div>

      {note && <p className="muted small">{note}</p>}

      <div className="month-switch">
        <button className="ghost small-btn" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
          ‹
        </button>
        <strong>{monthName(month)}</strong>
        <button
          className="ghost small-btn"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          disabled={month >= thisMonth}
          aria-label="Next month"
        >
          ›
        </button>
        {data && data.totals.all > 0 && (
          <span className="muted small month-split">
            {[
              data.totals.unclaimed && `${formatRupees(data.totals.unclaimed)} to claim`,
              data.totals.claimed && `${formatRupees(data.totals.claimed)} claimed`,
              data.totals.people && `${formatRupees(data.totals.people)} from people`,
              data.totals.reimbursed && `${formatRupees(data.totals.reimbursed)} paid back`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>

      {!data ? (
        <div className="boot">
          <span className="spinner" />
        </div>
      ) : data.expenses.length === 0 ? (
        <div className="blank">
          <span className="blank-mark" aria-hidden>
            &#129534;
          </span>
          <h3>Nothing spent in {monthName(month)}</h3>
          <p>
            Log a cab, a meal or a hotel as you spend it, and claim the month back in one go. Quickest from the
            box on Today: type <strong>₹450 cab to the airport</strong>.
          </p>
        </div>
      ) : (
        <>
          {/* Where the money went, and a filter. */}
          <div className="expense-cats">
            {cats.map((c) => (
              <button
                key={c.key}
                className={`expense-cat${filter === c.key ? ' selected' : ''}`}
                onClick={() => setFilter((f) => (f === c.key ? null : c.key))}
                aria-pressed={filter === c.key}
              >
                <span className="expense-cat-name">
                  <span aria-hidden>{c.mark}</span> {c.label}
                </span>
                <span className="expense-cat-bar">
                  <span style={{ width: `${Math.max(4, (data.totals.byCategory[c.key]! / biggest) * 100)}%` }} />
                </span>
                <strong>{formatRupees(data.totals.byCategory[c.key]!)}</strong>
              </button>
            ))}
          </div>

          {filter && (
            <button className="link small fit-btn" onClick={() => setFilter(null)}>
              Show everything
            </button>
          )}

          <div className="stack tight">
            {days.map((d) => (
              <section key={d.day} className="expense-day">
                <h3 className="expense-day-head">
                  <span>{dayLabel(d.day)}</span>
                  <span>{formatRupees(d.total)}</span>
                </h3>
                {d.items.map((x) => (
                  <ExpenseRow key={x.id} x={x} onEdit={() => setEditing(x)} onReceipt={() => setViewing(x)} />
                ))}
              </section>
            ))}
          </div>
        </>
      )}

      {editing && (
        <Modal title="Edit expense" onClose={() => setEditing(null)} closeOnBackdrop={false}>
          <ExpenseForm
            initial={editing}
            accounts={accounts}
            people={people}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              void load()
            }}
            onDeleted={() => {
              setEditing(null)
              setNote('Deleted.')
              void load()
            }}
          />
        </Modal>
      )}

      {viewing && (
        <Modal title="Receipt" onClose={() => setViewing(null)}>
          <ReceiptView
            x={viewing}
            onChanged={() => {
              setViewing(null)
              void load()
            }}
          />
        </Modal>
      )}

      {sheet === 'claim' && (
        <Modal title="Make a claim" onClose={() => setSheet(null)}>
          <ClaimSheet
            items={toClaim}
            onClaimed={() => void load()}
            onClose={() => setSheet(null)}
          />
        </Modal>
      )}

      {sheet === 'paid' && (
        <Modal title="Waiting to be paid back" onClose={() => setSheet(null)}>
          <PaidSheet items={awaiting} onChanged={() => void load()} />
        </Modal>
      )}
    </div>
  )
}

function ExpenseRow({ x, onEdit, onReceipt }: { x: ExpenseDTO; onEdit: () => void; onReceipt: () => void }) {
  const c = categoryInfo(x.category)
  const who = forWhom(x)
  return (
    <article className="expense-row">
      <span className="expense-mark" aria-hidden>
        {c.mark}
      </span>
      <button className="expense-main" onClick={onEdit} aria-label={`Edit ${x.note ?? c.label}`}>
        <span className="expense-title">{x.note ?? c.label}</span>
        <span className="expense-sub">
          {[x.note ? c.label : null, x.tripLabel && `${x.tripLabel} trip`, who && `for ${who}`].filter(Boolean).join(' · ')}
        </span>
        {x.shares.length > 0 && (
          <span className="expense-sub expense-shares">
            {x.shares
              .map((s) => `${shortName(s.name)} ${s.status === 'paid' ? 'paid back' : 'owes'} ${formatRupees(s.amountPaise)}`)
              .join(' · ')}
          </span>
        )}
      </button>
      <div className="expense-side">
        <strong>{formatRupees(x.amountPaise)}</strong>
        {x.claimablePaise > 0 ? (
          <span className={`expense-status is-${x.claimStatus}`}>{STATUS_WORD[x.claimStatus]}</span>
        ) : x.shares.every((s) => s.status === 'paid') ? (
          <span className="expense-status is-reimbursed">Paid back</span>
        ) : (
          <span className="expense-status is-people">Owed to you</span>
        )}
      </div>
      <button className="link small expense-receipt" onClick={onReceipt}>
        {x.hasReceipt ? 'Receipt' : '+ Receipt'}
      </button>
    </article>
  )
}

interface ShareDraft {
  name: string
  amount: string
  contactId: string | null
}

const BLANK_SHARE: ShareDraft = { name: '', amount: '', contactId: null }
const sharedTotal = (list: { amountPaise: number }[]) => list.reduce((sum, x) => sum + x.amountPaise, 0)

/** Adding one, or changing one: the same few fields. */
function ExpenseForm({
  initial,
  accounts,
  people,
  onSaved,
  onCancel,
  onDeleted,
}: {
  initial?: ExpenseDTO
  accounts: string[]
  people: { id: string; name: string }[]
  onSaved: (x: ExpenseDTO) => void
  onCancel?: () => void
  onDeleted?: () => void
}) {
  const today = ymd(new Date())
  const [amount, setAmount] = useState(initial ? String(initial.amountPaise / 100) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  // Null until a category is picked by hand: until then it follows the note.
  const [picked, setPicked] = useState<ExpenseCategory | null>(initial?.category ?? null)
  const [spentOn, setSpentOn] = useState(initial?.spentOn ?? today)
  const [account, setAccount] = useState(initial?.account ?? '')
  const [file, setFile] = useState<File | null>(null)
  // Who pays their part back. Shares already paid back are shown, not edited.
  const paidShares = (initial?.shares ?? []).filter((x) => x.status === 'paid')
  const [shares, setShares] = useState<ShareDraft[]>(() =>
    (initial?.shares ?? [])
      .filter((x) => x.status === 'owed')
      .map((x) => ({ name: x.name, amount: String(x.amountPaise / 100), contactId: x.contactId })),
  )
  const [sharing, setSharing] = useState(shares.length > 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  const guessed = note.trim() ? categoryOf(note) : null
  const category = picked ?? (guessed && guessed !== 'other' ? guessed : null)
  const paise = rupeesToPaise(amount)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!paise) {
      setError('How much? Just the number, e.g. 450.')
      return
    }
    const shareList = shares
      .filter((x) => x.name.trim() && rupeesToPaise(x.amount))
      .map((x) => {
        const match = people.find((p) => p.name.toLowerCase() === x.name.trim().toLowerCase())
        return { contactId: match?.id ?? x.contactId, personName: x.name.trim(), amountPaise: rupeesToPaise(x.amount)! }
      })
    if (sharedTotal(shareList) + sharedTotal(paidShares) > paise) {
      setError(`Their parts come to more than the ${formatRupees(paise)} spent.`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = {
        amountPaise: paise,
        category: category ?? 'other',
        note: note.trim() || null,
        spentOn,
        account: account.trim() || null,
      }
      let saved = initial
        ? await api<ExpenseDTO>(`/expenses/${initial.id}`, { method: 'PATCH', body })
        : await api<ExpenseDTO>('/expenses', { method: 'POST', body })
      if (sharing || initial?.shares.some((x) => x.status === 'owed')) {
        saved = await api<ExpenseDTO>(`/expenses/${saved.id}/shares`, { method: 'PUT', body: { shares: shareList } })
      }
      if (file) {
        try {
          await uploadReceipt(saved.id, file)
          saved.hasReceipt = true
        } catch (err) {
          setError(`Saved, but ${(err as Error).message.toLowerCase()}`)
        }
      }
      if (!initial) {
        setAmount('')
        setNote('')
        setPicked(null)
        setAccount('')
        setFile(null)
        setShares([])
        setSharing(false)
        amountRef.current?.focus()
      }
      onSaved(saved)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!initial || !window.confirm('Delete this expense?')) return
    setBusy(true)
    try {
      await api(`/expenses/${initial.id}`, { method: 'DELETE' })
      onDeleted?.()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className={`stack tight expense-form${initial ? '' : ' card'}`} onSubmit={(e) => void save(e)}>
      {!initial && <h2 className="section-title">Add an expense</h2>}
      <div className="expense-amount-row">
        <label className="amount-field">
          <span aria-hidden>₹</span>
          <input
            ref={amountRef}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            aria-label="Amount in rupees"
            autoFocus={Boolean(initial)}
          />
        </label>
        <input
          className="grow"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What for? e.g. cab to the airport"
          aria-label="What it was for"
          maxLength={300}
        />
      </div>

      <div className="chips expense-chips" role="group" aria-label="Category">
        {EXPENSE_CATEGORIES.map((c) => (
          <button
            type="button"
            key={c.key}
            className={`chip${category === c.key ? ' selected' : ''}`}
            onClick={() => setPicked((p) => (p === c.key ? null : c.key))}
            aria-pressed={category === c.key}
          >
            <span aria-hidden>{c.mark}</span> {c.label}
          </button>
        ))}
      </div>

      <div className="expense-meta">
        <label className="field">
          <span className="muted small">Date</span>
          <input type="date" value={spentOn} max={today} onChange={(e) => setSpentOn(e.target.value || today)} />
        </label>
        <label className="field grow">
          <span className="muted small">For (optional)</span>
          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="Client or company"
            list="expense-accounts"
            maxLength={200}
          />
        </label>
        <datalist id="expense-accounts">
          {accounts.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </div>

      {sharing ? (
        <div className="share-box">
          <div className="row share-head">
            <span className="label-text">Who pays you back?</span>
            {paise && shares.length > 0 && (
              <span className="row">
                <button
                  type="button"
                  className="link small"
                  onClick={() => {
                    const parts = splitEqually(paise - sharedTotal(paidShares), shares.length + paidShares.length)
                    setShares((list) => list.map((x, i) => ({ ...x, amount: String(parts[i]! / 100) })))
                  }}
                >
                  Split equally
                </button>
                {shares.length === 1 && paidShares.length === 0 && (
                  <button
                    type="button"
                    className="link small"
                    onClick={() => setShares((list) => [{ ...list[0]!, amount: String(paise / 100) }])}
                  >
                    They pay it all
                  </button>
                )}
              </span>
            )}
          </div>
          {shares.map((x, i) => (
            <div className="row share-row" key={i}>
              <input
                className="grow"
                value={x.name}
                onChange={(e) => {
                  const name = e.target.value
                  setShares((list) => list.map((y, j) => (j === i ? { ...y, name, contactId: null } : y)))
                }}
                placeholder="Who? e.g. Ravi"
                aria-label="Who pays back"
                list="share-people"
                autoFocus={i === shares.length - 1 && !x.name}
              />
              <label className="amount-field small-amount">
                <span aria-hidden>₹</span>
                <input
                  value={x.amount}
                  onChange={(e) => {
                    const amount = e.target.value
                    setShares((list) => list.map((y, j) => (j === i ? { ...y, amount } : y)))
                  }}
                  inputMode="decimal"
                  placeholder="0"
                  aria-label="Their part"
                />
              </label>
              <button
                type="button"
                className="link small danger-text"
                onClick={() => setShares((list) => list.filter((_, j) => j !== i))}
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
          {paidShares.map((x) => (
            <p key={x.id} className="muted small">
              {x.name} paid back {formatRupees(x.amountPaise)}.
            </p>
          ))}
          <button type="button" className="link small fit-btn" onClick={() => setShares((list) => [...list, BLANK_SHARE])}>
            + Add a person
          </button>
          {paise && (
            <p className="muted small">
              {(() => {
                const theirs = sharedTotal(shares.map((x) => ({ amountPaise: rupeesToPaise(x.amount) ?? 0 }))) + sharedTotal(paidShares)
                if (theirs > paise) return `Their parts come to more than the ${formatRupees(paise)} spent.`
                if (theirs === paise) return 'Nothing left to claim from the company.'
                return `You claim ${formatRupees(paise - theirs)} from the company.`
              })()}
            </p>
          )}
          <datalist id="share-people">
            {people.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </div>
      ) : (
        <button
          type="button"
          className="link small fit-btn"
          onClick={() => {
            setSharing(true)
            setShares([BLANK_SHARE])
          }}
        >
          + Split it, or someone pays you back
        </button>
      )}

      <div className="row expense-actions">
        <label className="ghost small-btn file-btn">
          {file ? `📎 ${file.name.length > 18 ? `${file.name.slice(0, 15)}…` : file.name}` : '📎 Receipt photo'}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
        {file && (
          <button type="button" className="link small" onClick={() => setFile(null)}>
            Remove
          </button>
        )}
        <span className="grow" />
        {onCancel && (
          <button type="button" className="ghost small-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary small-btn" disabled={busy || !amount.trim()}>
          {busy ? 'Saving…' : initial ? 'Save' : paise ? `Save ${formatRupees(paise)}` : 'Save'}
        </button>
      </div>

      {initial && (
        <div className="row">
          <button type="button" className="link small danger-text" onClick={() => void remove()} disabled={busy}>
            Delete this expense
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </form>
  )
}

function ReceiptView({ x, onChanged }: { x: ExpenseDTO; onChanged: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!x.hasReceipt) return
    let url: string | null = null
    let cancelled = false
    apiFetchBlobUrl(`/expenses/${x.id}/receipt`)
      .then((u) => {
        url = u
        if (cancelled) URL.revokeObjectURL(u)
        else setSrc(u)
      })
      .catch(() => !cancelled && setError('Could not load the receipt.'))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [x.id, x.hasReceipt])

  async function replace(file: File) {
    setBusy(true)
    setError(null)
    try {
      await uploadReceipt(x.id, file)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Remove this receipt?')) return
    setBusy(true)
    try {
      await api(`/expenses/${x.id}/receipt`, { method: 'DELETE' })
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="stack tight">
      <p className="muted small">
        {formatRupees(x.amountPaise)} · {x.note ?? categoryInfo(x.category).label} · {dayLabel(x.spentOn)}
      </p>
      {x.hasReceipt ? (
        src ? (
          <img className="receipt-image" src={src} alt="Receipt" />
        ) : (
          !error && (
            <div className="boot">
              <span className="spinner" />
            </div>
          )
        )
      ) : (
        <p className="muted small">No photo yet. One taken now is kept with the expense for the claim.</p>
      )}
      <div className="row">
        <label className={`${x.hasReceipt ? 'ghost' : 'primary'} small-btn file-btn`}>
          {busy ? 'Saving…' : x.hasReceipt ? 'Replace photo' : '📎 Add a photo'}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void replace(f)
            }}
          />
        </label>
        {x.hasReceipt && (
          <button className="ghost small-btn danger-text" onClick={() => void remove()} disabled={busy}>
            Remove
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

/** "15 Oct" — a claim lists dates, not weekdays. */
const shortDate = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })

function composeClaim(items: ExpenseDTO[], toName: string | null): string {
  const total = items.reduce((s, x) => s + x.claimablePaise, 0)
  const days = items.map((x) => x.spentOn).sort()
  const lines: string[] = []
  if (toName?.trim()) lines.push(`Hi ${toName.trim().split(/\s+/)[0]},`, '')
  lines.push(
    `Expense claim for ${spanLabel(days[0]!, days.at(-1)!)}: ${formatRupees(total)} (${items.length} item${items.length === 1 ? '' : 's'})`,
    '',
  )
  const byCat = new Map<string, number>()
  for (const x of items) byCat.set(x.category, (byCat.get(x.category) ?? 0) + x.claimablePaise)
  for (const [key, paise] of [...byCat].sort((a, b) => b[1] - a[1])) {
    lines.push(`• ${categoryInfo(key).label}: ${formatRupees(paise)}`)
  }
  lines.push('', 'Details:')
  for (const x of [...items].sort((a, b) => a.spentOn.localeCompare(b.spentOn))) {
    const who = forWhom(x)
    const what = [
      x.note ?? categoryInfo(x.category).label,
      x.tripLabel && `${x.tripLabel} trip`,
      who && `for ${who}`,
      x.shares.length > 0 && `my part of ${formatRupees(x.amountPaise)}`,
    ]
      .filter(Boolean)
      .join(', ')
    lines.push(`${shortDate(x.spentOn)} · ${what} · ${formatRupees(x.claimablePaise)}`)
  }
  const receipts = items.filter((x) => x.hasReceipt).length
  if (receipts) lines.push('', `I have receipts for ${receipts === items.length ? 'all of these' : `${receipts} of these`}.`)
  return lines.join('\n')
}

/** A field as a spreadsheet cell: quoted when it needs to be, never read as a formula. */
function cell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function toCsv(items: ExpenseDTO[]): string {
  const rows = [['Date', 'Category', 'What for', 'Trip', 'For', 'Paid (INR)', 'Shared with', 'Amount (INR)', 'Receipt']]
  for (const x of [...items].sort((a, b) => a.spentOn.localeCompare(b.spentOn))) {
    rows.push([
      x.spentOn,
      categoryInfo(x.category).label,
      x.note ?? '',
      x.tripLabel ?? '',
      forWhom(x) ?? '',
      (x.amountPaise / 100).toFixed(2),
      x.shares.map((y) => y.name).join('; '),
      (x.claimablePaise / 100).toFixed(2),
      x.hasReceipt ? 'Yes' : 'No',
    ])
  }
  const total = items.reduce((s, x) => s + x.claimablePaise, 0)
  rows.push(['', '', '', '', '', '', 'Total', (total / 100).toFixed(2), ''])
  return rows.map((r) => r.map(cell).join(',')).join('\r\n')
}

/**
 * Everything not yet claimed, written up for whoever approves it: the total,
 * by category, then line by line. Sent by WhatsApp or email, or downloaded
 * as a spreadsheet, and then marked claimed so it is not claimed twice.
 */
function ClaimSheet({ items, onClaimed, onClose }: { items: ExpenseDTO[]; onClaimed: () => void; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map((x) => x.id)))
  const [to, setTo] = useState<Recipient>({ reportToName: null, reportToEmail: null, reportToPhone: null })
  const [message, setMessage] = useState('')
  const [edited, setEdited] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api<Recipient>('/me/preferences').then(setTo).catch(() => undefined)
  }, [])

  const chosen = useMemo(() => items.filter((x) => selected.has(x.id)), [items, selected])
  const total = chosen.reduce((s, x) => s + x.claimablePaise, 0)

  // The message follows the selection until it is edited by hand.
  useEffect(() => {
    if (!edited) setMessage(chosen.length ? composeClaim(chosen, to.reportToName) : '')
  }, [chosen, to.reportToName, edited])

  const toggle = (id: string) => {
    setEdited(false)
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const days = chosen.map((x) => x.spentOn).sort()
  const subject = chosen.length ? `Expense claim: ${spanLabel(days[0]!, days.at(-1)!)}, ${formatRupees(total)}` : ''
  const first = to.reportToName?.trim().split(/\s+/)[0] ?? null
  const text = encodeURIComponent(message)

  function download() {
    // A byte-order mark, so Excel reads ₹ and names in any script correctly.
    const blob = new Blob(['﻿', toCsv(chosen)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expense-claim-${ymd(new Date())}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
    } catch {
      setError('Could not copy — select the message and copy it yourself.')
    }
  }

  async function markClaimed() {
    setBusy(true)
    setError(null)
    try {
      await api('/expenses/claim', { method: 'POST', body: { ids: chosen.map((x) => x.id), status: 'claimed' } })
      setDone(total)
      onClaimed()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done !== null) {
    return (
      <div className="stack tight">
        <p>
          <strong>{formatRupees(done)}</strong> marked as claimed. When the money arrives, mark it paid back from
          the Expenses page.
        </p>
        <div className="row">
          <button className="primary small-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    )
  }

  if (items.length === 0) return <p className="muted">Nothing left to claim.</p>

  return (
    <div className="stack tight claim-sheet">
      <p className="muted small">Everything not claimed yet, from any month. Untick what is not part of this claim.</p>

      <div className="claim-list">
        {items.map((x) => (
          <label key={x.id} className="claim-item">
            <input type="checkbox" checked={selected.has(x.id)} onChange={() => toggle(x.id)} />
            <span className="claim-date">{shortDate(x.spentOn)}</span>
            <span className="claim-what">
              <span aria-hidden>{categoryInfo(x.category).mark}</span> {x.note ?? categoryInfo(x.category).label}
              {x.hasReceipt && <span className="muted"> · 📎</span>}
            </span>
            <strong>{formatRupees(x.claimablePaise)}</strong>
          </label>
        ))}
      </div>
      <div className="row claim-total">
        <span>
          <strong>{formatRupees(total)}</strong>{' '}
          <span className="muted small">
            · {chosen.length} of {items.length}
          </span>
        </span>
        <button
          className="link small"
          onClick={() => {
            setEdited(false)
            setSelected(chosen.length === items.length ? new Set() : new Set(items.map((x) => x.id)))
          }}
        >
          {chosen.length === items.length ? 'Select none' : 'Select all'}
        </button>
      </div>

      {chosen.length > 0 && (
        <>
          <textarea
            className="report-text"
            value={message}
            rows={Math.min(14, Math.max(6, message.split('\n').length + 1))}
            onChange={(e) => {
              setMessage(e.target.value)
              setEdited(true)
              setCopied(false)
            }}
            aria-label="Claim message"
          />
          <p className="muted small">
            {to.reportToName || to.reportToEmail || to.reportToPhone
              ? `Goes to ${to.reportToName ?? to.reportToEmail ?? to.reportToPhone}, the same person as your daily report.`
              : 'Set who you report to in the daily report on Today, and this goes to them in one tap.'}
          </p>
          <div className="row nudge-send">
            <button
              className="ghost small-btn"
              onClick={() =>
                window.open(
                  `https://wa.me/${to.reportToPhone ? waNumber(to.reportToPhone) : ''}?text=${text}`,
                  '_blank',
                  'noopener',
                )
              }
            >
              {to.reportToPhone && first ? `WhatsApp ${first}` : 'WhatsApp'}
            </button>
            <button
              className="ghost small-btn"
              onClick={() =>
                window.open(
                  `mailto:${to.reportToEmail ?? ''}?subject=${encodeURIComponent(subject)}&body=${text}`,
                  '_blank',
                  'noopener',
                )
              }
            >
              {to.reportToEmail && first ? `Email ${first}` : 'Email'}
            </button>
            <button className="ghost small-btn" onClick={download}>
              Spreadsheet
            </button>
            <button className="ghost small-btn" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <button className="primary" disabled={busy} onClick={() => void markClaimed()}>
            {busy ? 'Saving…' : `Mark ${chosen.length === 1 ? 'it' : `these ${chosen.length}`} as claimed`}
          </button>
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

/** Claims sent and not yet paid, one group per day they were claimed. */
function PaidSheet({ items, onChanged }: { items: ExpenseDTO[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [left, setLeft] = useState(items)
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo(() => {
    const out: { day: string; items: ExpenseDTO[]; total: number }[] = []
    for (const x of left) {
      const day = x.claimedAt ? ymd(new Date(x.claimedAt)) : x.spentOn
      const g = out.find((o) => o.day === day)
      if (g) {
        g.items.push(x)
        g.total += x.claimablePaise
      } else out.push({ day, items: [x], total: x.claimablePaise })
    }
    return out
  }, [left])

  async function mark(day: string, ids: string[], status: 'reimbursed' | 'unclaimed') {
    setBusy(day)
    setError(null)
    try {
      await api('/expenses/claim', { method: 'POST', body: { ids, status } })
      setLeft((l) => l.filter((x) => !ids.includes(x.id)))
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (left.length === 0) return <p className="muted">All paid back.</p>

  return (
    <div className="stack">
      {groups.map((g) => (
        <section key={g.day} className="card paid-group">
          <div className="row paid-head">
            <span>
              Claimed {dayLabel(g.day)} · <strong>{formatRupees(g.total)}</strong>
            </span>
          </div>
          <ul className="paid-items">
            {g.items.map((x) => (
              <li key={x.id}>
                <span>
                  {shortDate(x.spentOn)} · {x.note ?? categoryInfo(x.category).label}
                </span>
                <span>{formatRupees(x.claimablePaise)}</span>
              </li>
            ))}
          </ul>
          <div className="row">
            <button
              className="primary small-btn"
              disabled={busy === g.day}
              onClick={() => void mark(g.day, g.items.map((x) => x.id), 'reimbursed')}
            >
              Paid back
            </button>
            <button
              className="link small"
              disabled={busy === g.day}
              onClick={() => void mark(g.day, g.items.map((x) => x.id), 'unclaimed')}
            >
              Not claimed after all
            </button>
          </div>
        </section>
      ))}
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
