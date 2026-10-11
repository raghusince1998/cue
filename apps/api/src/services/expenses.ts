import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import type { ExpenseDTO } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { sharesOf } from './owed.ts'

/**
 * Expenses: logged as they happen, claimed back at the end of the month.
 *
 * Each is linked, where it can be, to the trip it was spent on — found by its
 * date, so "₹450 cab" typed in Pune is on the Pune trip without being told —
 * and to the person or clinic it was for, so a claim can say why.
 */

const e = schema.expenses

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The trip this person was on that day, if any. */
export async function tripOn(userId: string, day: string): Promise<{ id: string; placeLabel: string } | null> {
  const [trip] = await db
    .select({ id: schema.trips.id, placeLabel: schema.trips.placeLabel })
    .from(schema.trips)
    .where(and(eq(schema.trips.userId, userId), lte(schema.trips.startsOn, day), gte(schema.trips.endsOn, day)))
    .orderBy(asc(schema.trips.startsOn))
    .limit(1)
  return trip ?? null
}

function select() {
  return db
    .select({
      id: e.id,
      amountPaise: e.amountPaise,
      category: e.category,
      note: e.note,
      spentOn: e.spentOn,
      tripId: e.tripId,
      tripLabel: schema.trips.placeLabel,
      contactId: e.contactId,
      contactName: schema.contacts.name,
      account: e.account,
      hasReceipt: sql<boolean>`${e.receipt} is not null`,
      claimStatus: e.claimStatus,
      claimedAt: e.claimedAt,
    })
    .from(e)
    .leftJoin(schema.trips, eq(schema.trips.id, e.tripId))
    .leftJoin(schema.contacts, eq(schema.contacts.id, e.contactId))
}

type Row = Awaited<ReturnType<ReturnType<typeof select>['where']>>[number]

/** Rows as sent, each with who is paying their part back. */
async function toDTOs(rows: Row[]): Promise<ExpenseDTO[]> {
  const shares = await sharesOf(rows.map((r) => r.id))
  return rows.map((r) => {
    const mine = shares.get(r.id) ?? []
    return {
      ...r,
      category: r.category as ExpenseDTO['category'],
      claimStatus: r.claimStatus as ExpenseDTO['claimStatus'],
      hasReceipt: Boolean(r.hasReceipt),
      claimedAt: r.claimedAt?.toISOString() ?? null,
      shares: mine,
      claimablePaise: Math.max(0, r.amountPaise - mine.reduce((s, x) => s + x.amountPaise, 0)),
    }
  })
}

export interface ExpenseMonth {
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

/** One month, newest first, with what is still to be claimed. */
export async function expenseMonth(userId: string, month: string): Promise<ExpenseMonth> {
  const [y, m] = month.split('-').map(Number)
  const from = ymd(new Date(y!, m! - 1, 1))
  const to = ymd(new Date(y!, m!, 1))
  const rows = await select()
    .where(and(eq(e.userId, userId), gte(e.spentOn, from), lt(e.spentOn, to)))
    .orderBy(desc(e.spentOn), desc(e.createdAt))
  const expenses = await toDTOs(rows)

  // Spent is what you paid; to claim is what is left once others pay their part.
  const totals = { all: 0, unclaimed: 0, claimed: 0, reimbursed: 0, people: 0, byCategory: {} as Record<string, number> }
  for (const x of expenses) {
    totals.all += x.amountPaise
    totals[x.claimStatus] += x.claimablePaise
    totals.people += x.amountPaise - x.claimablePaise
    totals.byCategory[x.category] = (totals.byCategory[x.category] ?? 0) + x.amountPaise
  }
  return { month, expenses, totals }
}

/** Everything still to be claimed, across months: what a claim is usually made of. */
export async function unclaimed(userId: string): Promise<ExpenseDTO[]> {
  const rows = await select()
    .where(and(eq(e.userId, userId), eq(e.claimStatus, 'unclaimed')))
    .orderBy(asc(e.spentOn), asc(e.createdAt))
  // Paid back in full by someone else: nothing left for the company.
  return (await toDTOs(rows)).filter((x) => x.claimablePaise > 0)
}

/** Claimed and not yet paid back, oldest claim first: what to chase. */
export async function awaitingPayment(userId: string): Promise<ExpenseDTO[]> {
  const rows = await select()
    .where(and(eq(e.userId, userId), eq(e.claimStatus, 'claimed')))
    .orderBy(asc(e.claimedAt), asc(e.spentOn))
  return (await toDTOs(rows)).filter((x) => x.claimablePaise > 0)
}

export async function expenseById(userId: string, id: string): Promise<ExpenseDTO | null> {
  const [row] = await select().where(and(eq(e.id, id), eq(e.userId, userId)))
  return row ? (await toDTOs([row]))[0]! : null
}

export async function createExpense(
  orgId: string,
  userId: string,
  input: {
    amountPaise: number
    category: string
    note?: string | null
    spentOn: string
    tripId?: string | null
    contactId?: string | null
    account?: string | null
  },
): Promise<ExpenseDTO> {
  // Spent while away: on that trip, unless told otherwise.
  const tripId = input.tripId === undefined ? ((await tripOn(userId, input.spentOn))?.id ?? null) : input.tripId
  // For a person and no clinic named: where they work, so the claim says where.
  let account = input.account?.trim() || null
  if (!account && input.contactId) {
    const [c] = await db
      .select({ organization: schema.contacts.organization })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, input.contactId), eq(schema.contacts.orgId, orgId)))
    account = c?.organization?.trim() || null
  }
  const [row] = await db
    .insert(e)
    .values({
      orgId,
      userId,
      amountPaise: input.amountPaise,
      category: input.category,
      note: input.note?.trim() || null,
      spentOn: input.spentOn,
      tripId,
      contactId: input.contactId ?? null,
      account,
    })
    .returning({ id: e.id })
  return (await expenseById(userId, row!.id))!
}

export async function updateExpense(
  userId: string,
  id: string,
  input: Partial<{
    amountPaise: number
    category: string
    note: string | null
    spentOn: string
    tripId: string | null
    contactId: string | null
    account: string | null
  }>,
): Promise<ExpenseDTO | null> {
  const set: Partial<typeof e.$inferInsert> = {}
  if (input.amountPaise !== undefined) set.amountPaise = input.amountPaise
  if (input.category !== undefined) set.category = input.category
  if (input.note !== undefined) set.note = input.note?.trim() || null
  if (input.spentOn !== undefined) set.spentOn = input.spentOn
  if (input.tripId !== undefined) set.tripId = input.tripId
  // A new date can put it on a different trip, or on none.
  else if (input.spentOn !== undefined) set.tripId = (await tripOn(userId, input.spentOn))?.id ?? null
  if (input.contactId !== undefined) set.contactId = input.contactId
  if (input.account !== undefined) set.account = input.account?.trim() || null
  if (Object.keys(set).length) {
    await db.update(e).set(set).where(and(eq(e.id, id), eq(e.userId, userId)))
  }
  return expenseById(userId, id)
}

export async function deleteExpense(userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(e).where(and(eq(e.id, id), eq(e.userId, userId))).returning({ id: e.id })
  return rows.length > 0
}

/** Claimed, reimbursed, or back to unclaimed. Returns how many changed. */
export async function setClaim(userId: string, ids: string[], status: 'unclaimed' | 'claimed' | 'reimbursed') {
  const rows = await db
    .update(e)
    .set({ claimStatus: status, claimedAt: status === 'unclaimed' ? null : sql`coalesce(${e.claimedAt}, now())` })
    .where(and(eq(e.userId, userId), inArray(e.id, ids)))
    .returning({ id: e.id })
  return rows.length
}

export async function setReceipt(userId: string, id: string, image: Buffer | null, mime: string | null) {
  const rows = await db
    .update(e)
    .set({ receipt: image, receiptMime: mime })
    .where(and(eq(e.id, id), eq(e.userId, userId)))
    .returning({ id: e.id })
  return rows.length > 0
}

export async function receiptOf(userId: string, id: string) {
  const [row] = await db
    .select({ receipt: e.receipt, mime: e.receiptMime })
    .from(e)
    .where(and(eq(e.id, id), eq(e.userId, userId)))
  return row?.receipt && row.mime ? { image: row.receipt, mime: row.mime } : null
}
