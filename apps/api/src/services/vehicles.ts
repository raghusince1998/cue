import { and, eq, ilike, sql } from 'drizzle-orm'
import { formatRupees, type ChallanNotice, type FastagNotice, type Lang } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { localeOf, t } from '../i18n.ts'
import { createBill, payBill } from './bills.ts'
import { scheduleFirstReminder } from './reminders.ts'

/**
 * A vehicle's running reminders from its messages: a FASTag to recharge — a
 * to-do that closes itself when the recharge goes through — and a traffic
 * challan to pay, which leaves Bills when it is paid. What is found, and the
 * notes kept with it, are in the person's language; the titles stay English,
 * because the next message is matched against them.
 */

const c = schema.commitments
const b = schema.bills

const dayWords = (ymd: string, lang: Lang) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' })

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Soon, but at a sensible hour: within the hour by day, nine the next morning by night. */
function soon(now: Date): Date {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0)
  if (next.getHours() >= 21 || next.getHours() < 8) {
    const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getHours() >= 8 ? 1 : 0), 9, 0)
    return morning
  }
  return next
}

/** The open "recharge" to-do for this tag, if there is one. */
async function openRecharge(userId: string, vehicle: string | null) {
  const [row] = await db
    .select({ id: c.id })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        eq(c.status, 'pending'),
        ilike(c.title, 'Recharge FASTag%'),
        vehicle ? ilike(c.title, `%${vehicle}%`) : undefined,
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Low: a to-do to recharge, once — later warnings update its balance rather
 * than adding another. Recharged: that to-do is done. Returns what happened,
 * in words, or null when nothing new did.
 */
export async function fastagFromNotice(
  orgId: string,
  userId: string,
  n: FastagNotice,
  now = new Date(),
  lang: Lang = 'en',
): Promise<string | null> {
  const open = await openRecharge(userId, n.vehicle)
  const title = `Recharge FASTag${n.vehicle ? ` · ${n.vehicle}` : ''}`

  if (n.status === 'recharged') {
    if (!open) return null
    await db.update(c).set({ status: 'done', completedAt: now }).where(eq(c.id, open.id))
    const name = title.replace('Recharge ', '')
    return n.balancePaise !== null
      ? t(lang, '{name}: recharged, balance {balance}', { name, balance: formatRupees(n.balancePaise) })
      : t(lang, '{name}: recharged', { name })
  }

  const balance = n.balancePaise !== null ? formatRupees(n.balancePaise) : null
  const notes =
    balance && n.issuer
      ? t(lang, 'Balance {balance} on your {issuer} FASTag. Running out can mean paying double at the toll.', { balance, issuer: n.issuer })
      : balance
        ? t(lang, 'Balance {balance}. Running out can mean paying double at the toll.', { balance })
        : n.issuer
          ? t(lang, 'Low balance on your {issuer} FASTag. Running out can mean paying double at the toll.', { issuer: n.issuer })
          : t(lang, 'Low balance. Running out can mean paying double at the toll.')
  if (open) {
    await db.update(c).set({ notes }).where(eq(c.id, open.id))
    return null
  }
  const dueAt = soon(now)
  const [row] = await db
    .insert(c)
    .values({ orgId, userId, title, kind: 'task', dueAt, durationMinutes: 10, notes, flexibility: 'flexible' })
    .returning({ id: c.id })
  await scheduleFirstReminder({ orgId, commitmentId: row!.id, fireAt: dueAt })
  return balance ? t(lang, '{title} ({balance} left)', { title, balance }) : title
}

/** What the challan is called on Bills: the vehicle and what it was for. */
function challanName(n: ChallanNotice): string {
  return `Traffic challan${n.vehicle ? ` · ${n.vehicle}` : ''}${n.offence ? ` · ${n.offence}` : ''}`
}

/** The challan already on Bills: by its number, or by what it is called. */
async function existingChallan(userId: string, n: ChallanNotice) {
  const [row] = await db
    .select({ id: b.id, amountPaise: b.amountPaise })
    .from(b)
    .where(
      and(
        eq(b.userId, userId),
        eq(b.active, true),
        eq(b.category, 'vehicle'),
        n.number ? ilike(b.notes, `%${n.number}%`) : sql`lower(${b.name}) = lower(${challanName(n)})`,
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * Issued: on Bills to pay by the date given — or a month from when it was
 * issued, when none is — with the challan number to pay it by. Paid: off
 * Bills, the payment kept.
 */
export async function challanFromNotice(
  orgId: string,
  userId: string,
  n: ChallanNotice,
  now = new Date(),
  lang: Lang = 'en',
): Promise<string | null> {
  const existing = await existingChallan(userId, n)
  const name = challanName(n)
  if (n.status === 'paid') {
    if (!existing) return null
    await payBill(userId, existing.id, {}, now)
    return t(lang, '{name}: paid', { name })
  }
  if (existing) return null

  const issued = n.issuedOn ? new Date(`${n.issuedOn}T00:00:00`) : now
  const dueOn = n.dueOn ?? ymd(new Date(issued.getFullYear(), issued.getMonth(), issued.getDate() + 30))
  await createBill(orgId, userId, {
    name,
    kind: 'bill',
    category: 'vehicle',
    amountPaise: n.amountPaise,
    dueOn,
    repeat: 'none',
    remindDays: 5,
    notes: [
      n.number ? t(lang, 'Challan No. {number}', { number: n.number }) : null,
      n.issuedOn ? t(lang, 'issued {day}', { day: dayWords(n.issuedOn, lang) }) : null,
      t(lang, 'Pay at echallan.parivahan.gov.in or your state traffic police site'),
    ]
      .filter(Boolean)
      .join(' · '),
  })
  return n.amountPaise
    ? t(lang, '{name}: {amount}, pay by {day}', { name, amount: formatRupees(n.amountPaise), day: dayWords(dueOn, lang) })
    : t(lang, '{name}, pay by {day}', { name, day: dayWords(dueOn, lang) })
}
