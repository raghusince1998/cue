import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm'
import { EXPENSE_CATEGORIES, type OwedShare } from '@cue/shared'
import { db, schema } from '../db/index.ts'

/**
 * Money people owe you: their part of an expense you paid, or money lent.
 *
 * A share of an expense is taken off what is claimed from the company, so a
 * cab split with a colleague is not claimed twice. Kept by name as well as by
 * contact, so someone who is not saved can owe you too.
 */

const o = schema.moneyOwed

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface OwedItem {
  id: string
  amountPaise: number
  /** What it was for: its own note, or the expense's. */
  note: string | null
  expenseId: string | null
  /** YYYY-MM-DD: the day of the expense, or when it was noted. */
  on: string
  askedAt: string | null
  askCount: number
}

export interface OwedPerson {
  /** The contact, or the name for someone not saved. */
  key: string
  contactId: string | null
  name: string
  phone: string | null
  organization: string | null
  totalPaise: number
  /** The oldest still owed: how long they have had it. */
  since: string
  lastAskedAt: string | null
  items: OwedItem[]
}

export interface OwedSummary {
  people: OwedPerson[]
  totalPaise: number
  /** Paid back in the last thirty days: the list working. */
  paidRecentlyPaise: number
}

/** Who owes you, most first, each with what for. */
export async function owedPeople(userId: string, now = new Date(), contactId?: string): Promise<OwedSummary> {
  const rows = await db
    .select({
      id: o.id,
      contactId: o.contactId,
      personName: o.personName,
      contactName: schema.contacts.name,
      phone: schema.contacts.phone,
      organization: schema.contacts.organization,
      amountPaise: o.amountPaise,
      note: o.note,
      expenseId: o.expenseId,
      expenseNote: schema.expenses.note,
      expenseCategory: schema.expenses.category,
      spentOn: schema.expenses.spentOn,
      askedAt: o.askedAt,
      askCount: o.askCount,
      createdAt: o.createdAt,
    })
    .from(o)
    .leftJoin(schema.contacts, eq(schema.contacts.id, o.contactId))
    .leftJoin(schema.expenses, eq(schema.expenses.id, o.expenseId))
    .where(and(eq(o.userId, userId), eq(o.status, 'owed'), contactId ? eq(o.contactId, contactId) : undefined))
    .orderBy(asc(o.createdAt))

  const byKey = new Map<string, OwedPerson>()
  for (const r of rows) {
    const key = r.contactId ?? `name:${r.personName.trim().toLowerCase()}`
    const on = r.spentOn ?? ymd(r.createdAt)
    const category = EXPENSE_CATEGORIES.find((c) => c.key === r.expenseCategory)
    const item: OwedItem = {
      id: r.id,
      amountPaise: r.amountPaise,
      note: r.note ?? r.expenseNote ?? (r.expenseId ? (category?.label ?? null) : null),
      expenseId: r.expenseId,
      on,
      askedAt: r.askedAt?.toISOString() ?? null,
      askCount: r.askCount,
    }
    const person = byKey.get(key)
    if (person) {
      person.items.push(item)
      person.totalPaise += item.amountPaise
      if (on < person.since) person.since = on
      if (item.askedAt && (!person.lastAskedAt || item.askedAt > person.lastAskedAt)) person.lastAskedAt = item.askedAt
    } else {
      byKey.set(key, {
        key,
        contactId: r.contactId,
        name: r.contactName ?? r.personName,
        phone: r.phone,
        organization: r.organization,
        totalPaise: item.amountPaise,
        since: on,
        lastAskedAt: item.askedAt,
        items: [item],
      })
    }
  }
  const people = [...byKey.values()].sort((a, b) => b.totalPaise - a.totalPaise || a.since.localeCompare(b.since))
  for (const p of people) p.items.sort((a, b) => a.on.localeCompare(b.on))

  const [paid] = await db
    .select({ paise: sql<number>`coalesce(sum(${o.amountPaise}), 0)::int` })
    .from(o)
    .where(and(eq(o.userId, userId), eq(o.status, 'paid'), gte(o.paidAt, new Date(now.getTime() - 30 * 86_400_000))))

  return {
    people,
    totalPaise: people.reduce((s, p) => s + p.totalPaise, 0),
    paidRecentlyPaise: paid?.paise ?? 0,
  }
}

/** The name to keep for whoever owes it: the contact's, when it is one of yours. */
async function whoOwes(orgId: string, contactId: string | null | undefined, personName: string | null | undefined) {
  if (contactId) {
    const [c] = await db
      .select({ id: schema.contacts.id, name: schema.contacts.name })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.orgId, orgId)))
    if (c) return { contactId: c.id, personName: c.name }
  }
  const name = personName?.trim()
  return name ? { contactId: null, personName: name } : null
}

/** Money lent, or owed for anything that is not one of your expenses. */
export async function addOwed(
  orgId: string,
  userId: string,
  input: { contactId?: string | null; personName?: string | null; amountPaise: number; note?: string | null },
): Promise<string | null> {
  const who = await whoOwes(orgId, input.contactId, input.personName)
  if (!who) return null
  const [row] = await db
    .insert(o)
    .values({ orgId, userId, ...who, amountPaise: input.amountPaise, note: input.note?.trim() || null })
    .returning({ id: o.id })
  return row!.id
}

/**
 * Who is paying back their part of an expense. Replaces the parts still owed;
 * what has already been paid back stays as it was.
 */
export async function setShares(
  orgId: string,
  userId: string,
  expenseId: string,
  shares: { contactId?: string | null; personName?: string | null; amountPaise: number }[],
): Promise<'ok' | 'not_found' | 'too_much'> {
  const [expense] = await db
    .select({ amountPaise: schema.expenses.amountPaise })
    .from(schema.expenses)
    .where(and(eq(schema.expenses.id, expenseId), eq(schema.expenses.userId, userId)))
  if (!expense) return 'not_found'

  const paid = await db
    .select({ amountPaise: o.amountPaise })
    .from(o)
    .where(and(eq(o.expenseId, expenseId), eq(o.status, 'paid')))
  const total = [...paid, ...shares].reduce((s, x) => s + x.amountPaise, 0)
  if (total > expense.amountPaise) return 'too_much'

  const rows: (typeof o.$inferInsert)[] = []
  for (const s of shares) {
    const who = await whoOwes(orgId, s.contactId, s.personName)
    if (who) rows.push({ orgId, userId, ...who, expenseId, amountPaise: s.amountPaise })
  }
  await db.transaction(async (tx) => {
    await tx.delete(o).where(and(eq(o.expenseId, expenseId), eq(o.status, 'owed')))
    if (rows.length) await tx.insert(o).values(rows)
  })
  return 'ok'
}

/** The shares of each of these expenses, for showing beside them. */
export async function sharesOf(expenseIds: string[]): Promise<Map<string, OwedShare[]>> {
  const out = new Map<string, OwedShare[]>()
  if (expenseIds.length === 0) return out
  const rows = await db
    .select({
      id: o.id,
      expenseId: o.expenseId,
      contactId: o.contactId,
      name: sql<string>`coalesce(${schema.contacts.name}, ${o.personName})`,
      amountPaise: o.amountPaise,
      status: o.status,
    })
    .from(o)
    .leftJoin(schema.contacts, eq(schema.contacts.id, o.contactId))
    .where(inArray(o.expenseId, expenseIds))
    .orderBy(asc(o.createdAt))
  for (const r of rows) {
    const list = out.get(r.expenseId!) ?? []
    list.push({ id: r.id, contactId: r.contactId, name: r.name, amountPaise: r.amountPaise, status: r.status as OwedShare['status'] })
    out.set(r.expenseId!, list)
  }
  return out
}

/** Paid back, or not after all. Returns how many changed. */
export async function setOwedStatus(userId: string, ids: string[], status: 'owed' | 'paid'): Promise<number> {
  const rows = await db
    .update(o)
    .set({ status, paidAt: status === 'paid' ? new Date() : null })
    .where(and(eq(o.userId, userId), inArray(o.id, ids)))
    .returning({ id: o.id })
  return rows.length
}

/** A reminder went: so the next one is not sent the same afternoon. */
export async function markAsked(userId: string, ids: string[]): Promise<number> {
  const rows = await db
    .update(o)
    .set({ askedAt: new Date(), askCount: sql`${o.askCount} + 1` })
    .where(and(eq(o.userId, userId), inArray(o.id, ids), eq(o.status, 'owed')))
    .returning({ id: o.id })
  return rows.length
}

export async function deleteOwed(userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(o).where(and(eq(o.id, id), eq(o.userId, userId))).returning({ id: o.id })
  return rows.length > 0
}
