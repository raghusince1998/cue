import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { categoryOfBill, dueLabel, formatRupees, nextDue, type BillDTO, type Repeat } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { sendToUser } from '../push.ts'

/**
 * Bills and renewals. Paying one moves it on to its next due date, and the
 * payment is kept; a reminder goes some days before, on the day, and once
 * the day after if it is still unpaid.
 */

const b = schema.bills
const p = schema.billPayments

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const selection = {
  id: b.id,
  name: b.name,
  kind: b.kind,
  category: b.category,
  amountPaise: b.amountPaise,
  dueOn: b.dueOn,
  repeat: b.repeat,
  remindDays: b.remindDays,
  autopay: b.autopay,
  notes: b.notes,
  active: b.active,
  lastPaidOn: b.lastPaidOn,
}

function toDTO(r: typeof b.$inferSelect | Record<keyof typeof selection, unknown>): BillDTO {
  return r as unknown as BillDTO
}

export interface BillSummary {
  bills: BillDTO[]
  /** This calendar month: what falls due in it, and what was paid in it. */
  month: { duePaise: number; paidPaise: number; overdue: number; dueThisWeek: number }
}

/** Every active bill, soonest first, with the month at a glance. */
export async function listBills(userId: string, now = new Date()): Promise<BillSummary> {
  const rows = await db.select(selection).from(b).where(and(eq(b.userId, userId), eq(b.active, true))).orderBy(asc(b.dueOn))
  const bills = rows.map(toDTO)

  const today = ymd(now)
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1))
  const monthEnd = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1))
  const weekOn = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))

  const [paid] = await db
    .select({ paise: sql<number>`coalesce(sum(${p.amountPaise}), 0)::bigint` })
    .from(p)
    .innerJoin(b, eq(b.id, p.billId))
    .where(and(eq(b.userId, userId), gte(p.paidOn, monthStart), lt(p.paidOn, monthEnd)))

  const owing = bills.filter((x) => x.kind === 'bill')
  return {
    bills,
    month: {
      duePaise: owing.filter((x) => x.dueOn < monthEnd).reduce((s, x) => s + (x.amountPaise ?? 0), 0),
      paidPaise: Number(paid?.paise ?? 0),
      overdue: owing.filter((x) => x.dueOn < today).length,
      dueThisWeek: owing.filter((x) => x.dueOn >= today && x.dueOn <= weekOn).length,
    },
  }
}

export async function billById(userId: string, id: string): Promise<BillDTO | null> {
  const [row] = await db.select(selection).from(b).where(and(eq(b.id, id), eq(b.userId, userId)))
  return row ? toDTO(row) : null
}

/** A monthly-ish bill keeps its day of the month; others need none. */
function anchorFor(dueOn: string, repeat: Repeat): number | null {
  return repeat === 'none' || repeat === 'weekly' ? null : Number(dueOn.slice(8, 10))
}

export async function createBill(
  orgId: string,
  userId: string,
  input: {
    name: string
    kind?: 'bill' | 'renewal'
    category?: string
    amountPaise?: number | null
    dueOn: string
    repeat?: Repeat
    remindDays?: number
    autopay?: boolean
    notes?: string | null
  },
): Promise<BillDTO> {
  const kind = input.kind ?? 'bill'
  const repeat = input.repeat ?? (kind === 'renewal' ? 'none' : 'monthly')
  const [row] = await db
    .insert(b)
    .values({
      orgId,
      userId,
      name: input.name.trim(),
      kind,
      category: input.category ?? categoryOfBill(input.name),
      amountPaise: input.amountPaise ?? null,
      dueOn: input.dueOn,
      anchorDay: anchorFor(input.dueOn, repeat),
      repeat,
      // A renewal needs weeks: a passport is not renewed in three days.
      remindDays: input.remindDays ?? (kind === 'renewal' ? 30 : 3),
      autopay: input.autopay ?? false,
      notes: input.notes?.trim() || null,
    })
    .returning({ id: b.id })
  return (await billById(userId, row!.id))!
}

export async function updateBill(
  userId: string,
  id: string,
  input: Partial<Parameters<typeof createBill>[2]>,
): Promise<BillDTO | null> {
  const current = await billById(userId, id)
  if (!current) return null
  const set: Partial<typeof b.$inferInsert> = {}
  if (input.name !== undefined) set.name = input.name.trim()
  if (input.kind !== undefined) set.kind = input.kind
  if (input.category !== undefined) set.category = input.category
  if (input.amountPaise !== undefined) set.amountPaise = input.amountPaise
  if (input.remindDays !== undefined) set.remindDays = input.remindDays
  if (input.autopay !== undefined) set.autopay = input.autopay
  if (input.notes !== undefined) set.notes = input.notes?.trim() || null
  if (input.dueOn !== undefined || input.repeat !== undefined) {
    const dueOn = input.dueOn ?? current.dueOn
    const repeat = input.repeat ?? current.repeat
    set.dueOn = dueOn
    set.repeat = repeat
    set.anchorDay = anchorFor(dueOn, repeat)
    // A new date is a new reminder.
    set.lastRemindedOn = null
  }
  if (Object.keys(set).length) await db.update(b).set(set).where(and(eq(b.id, id), eq(b.userId, userId)))
  return billById(userId, id)
}

/**
 * Paid, or renewed. It moves to its next due date — or, for a renewal, to
 * the new expiry it was given — and one with no next date is done.
 */
export async function payBill(
  userId: string,
  id: string,
  input: { paidOn?: string; amountPaise?: number | null; nextDueOn?: string },
  now = new Date(),
): Promise<BillDTO | null> {
  const [row] = await db
    .select({ dueOn: b.dueOn, repeat: b.repeat, anchorDay: b.anchorDay, amountPaise: b.amountPaise })
    .from(b)
    .where(and(eq(b.id, id), eq(b.userId, userId), eq(b.active, true)))
  if (!row) return null
  const paidOn = input.paidOn ?? ymd(now)
  const next = input.nextDueOn ?? nextDue(row.dueOn, row.repeat as Repeat, row.anchorDay)
  await db.transaction(async (tx) => {
    await tx.insert(p).values({
      billId: id,
      dueOn: row.dueOn,
      paidOn,
      amountPaise: input.amountPaise === undefined ? row.amountPaise : input.amountPaise,
    })
    await tx
      .update(b)
      .set(
        next
          ? { dueOn: next, lastPaidOn: paidOn, lastRemindedOn: null, anchorDay: input.nextDueOn ? anchorFor(next, row.repeat as Repeat) : row.anchorDay }
          : { active: false, lastPaidOn: paidOn },
      )
      .where(eq(b.id, id))
  })
  return billById(userId, id)
}

/** The last payment was a mistake: it goes, and the bill is due again as it was. */
export async function undoPayment(userId: string, id: string): Promise<BillDTO | null> {
  const [owned] = await db.select({ id: b.id }).from(b).where(and(eq(b.id, id), eq(b.userId, userId)))
  if (!owned) return null
  const [last] = await db.select().from(p).where(eq(p.billId, id)).orderBy(desc(p.createdAt)).limit(1)
  if (!last) return billById(userId, id)
  const [before] = await db
    .select({ paidOn: p.paidOn })
    .from(p)
    .where(and(eq(p.billId, id), lt(p.createdAt, last.createdAt)))
    .orderBy(desc(p.createdAt))
    .limit(1)
  await db.transaction(async (tx) => {
    await tx.delete(p).where(eq(p.id, last.id))
    await tx
      .update(b)
      .set({ dueOn: last.dueOn, active: true, lastPaidOn: before?.paidOn ?? null })
      .where(eq(b.id, id))
  })
  return billById(userId, id)
}

export async function billPaymentsOf(userId: string, id: string) {
  const [owned] = await db.select({ id: b.id }).from(b).where(and(eq(b.id, id), eq(b.userId, userId)))
  if (!owned) return null
  return db
    .select({ id: p.id, dueOn: p.dueOn, paidOn: p.paidOn, amountPaise: p.amountPaise })
    .from(p)
    .where(eq(p.billId, id))
    .orderBy(desc(p.paidOn))
    .limit(24)
}

export async function deleteBill(userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(b).where(and(eq(b.id, id), eq(b.userId, userId))).returning({ id: b.id })
  return rows.length > 0
}

interface DueBill {
  id: string
  user_id: string
  name: string
  kind: 'bill' | 'renewal'
  amount_paise: string | null
  due_on: string
  local_date: string
}

/**
 * Bills to remind about now: the reminder day, the due day, and the day after
 * if still unpaid — in daytime where the person is, once a day at most. One
 * that pays itself is mentioned only ahead of time, to keep the balance in.
 */
export async function billsToRemind(now = new Date()): Promise<DueBill[]> {
  const at = now.toISOString()
  const rows = await db.execute(sql`
    select b.id, b.user_id, b.name, b.kind, b.amount_paise::text, b.due_on::text, l.local_date::text
    from bills b
    join users u on u.id = b.user_id
    cross join lateral (select (${at}::timestamptz at time zone u.timezone) as local_ts) t
    cross join lateral (select t.local_ts::date as local_date) l
    where b.active
      and extract(hour from t.local_ts) between 9 and 20
      and (b.last_reminded_on is null or b.last_reminded_on < l.local_date)
      and (
        b.due_on - b.remind_days = l.local_date
        or (not b.autopay and (b.due_on = l.local_date or b.due_on = l.local_date - 1))
      )
    order by b.user_id, b.due_on
  `)
  return rows as unknown as DueBill[]
}

/** What a reminder says about one bill: "Rent ₹15,000 due tomorrow". */
function line(x: DueBill): string {
  const today = new Date(`${x.local_date}T12:00:00`)
  const amount = x.amount_paise ? ` ${formatRupees(Number(x.amount_paise))}` : ''
  return `${x.name}${amount} ${dueLabel(x.due_on, x.kind, today)}`
}

/** One notification per person, however many bills: marked before it goes. */
export async function runBillReminders(now = new Date()): Promise<number> {
  const due = await billsToRemind(now)
  const byUser = new Map<string, DueBill[]>()
  for (const x of due) byUser.set(x.user_id, [...(byUser.get(x.user_id) ?? []), x])
  let sent = 0
  for (const [userId, list] of byUser) {
    try {
      await db
        .update(b)
        .set({ lastRemindedOn: list[0]!.local_date })
        .where(inArray(b.id, list.map((x) => x.id)))
      const title = list.length === 1 ? line(list[0]!) : `${list.length} bills and renewals coming up`
      const body = list.length === 1 ? 'Tap to mark it paid when it is done.' : list.map(line).join(' · ')
      await sendToUser(userId, { title, body, url: '/bills', tag: 'bills' })
      sent += 1
    } catch (err) {
      console.error('[bills] failed for user', userId, (err as Error).message)
    }
  }
  return sent
}

export function startBillWorker(intervalMs = 15 * 60_000) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const sent = await runBillReminders()
      if (sent > 0) console.log(`[bills] sent ${sent} bill reminder(s)`)
    } catch (err) {
      console.error('[bills] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  void run()
  const handle = setInterval(run, intervalMs)
  console.log(`[bills] bill reminder worker checking every ${intervalMs / 60_000} min`)
  return () => clearInterval(handle)
}
