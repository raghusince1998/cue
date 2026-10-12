import { and, asc, desc, eq, gte, inArray, notInArray, or, sql } from 'drizzle-orm'
import { DELIVERY_STATUS_RANK, formatRupees, type DeliveryDTO, type DeliveryStatus, type ParsedDelivery } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { sendToUser } from '../push.ts'

/**
 * Parcels on their way, from the messages shops and couriers send. A second
 * message about the same parcel moves it along rather than adding another,
 * and never moves it back: a late "Shipped" after "Out for delivery" changes
 * nothing.
 */

const d = schema.deliveries
const DONE: DeliveryStatus[] = ['delivered', 'cancelled']

const selection = {
  id: d.id,
  store: d.store,
  item: d.item,
  status: d.status,
  expectedOn: d.expectedOn,
  codPaise: d.codPaise,
  orderRef: d.orderRef,
  trackingUrl: d.trackingUrl,
  deliveredAt: d.deliveredAt,
  updatedAt: d.updatedAt,
}

type Row = { [K in keyof typeof selection]: unknown } & { deliveredAt: Date | null; updatedAt: Date }

function toDTO(r: Row): DeliveryDTO {
  return {
    ...(r as unknown as DeliveryDTO),
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }
}

const sameItem = (a: string | null, b: string | null) => {
  if (!a || !b) return false
  const x = a.toLowerCase().slice(0, 15)
  const y = b.toLowerCase().slice(0, 15)
  return x.startsWith(y) || y.startsWith(x)
}

/** The parcel this message is about, if Cue already knows it. */
async function existing(userId: string, p: ParsedDelivery) {
  const since = new Date(Date.now() - 60 * 86_400_000)
  const rows = await db
    .select()
    .from(d)
    .where(and(eq(d.userId, userId), gte(d.updatedAt, since)))
    .orderBy(desc(d.updatedAt))
  if (p.orderRef) {
    const byRef = rows.find((r) => r.orderRef === p.orderRef)
    if (byRef) return byRef
  }
  const open = rows.filter((r) => !DONE.includes(r.status as DeliveryStatus) && r.store === p.store)
  const byItem = open.find((r) => sameItem(r.item, p.item))
  if (byItem) return byItem
  // One open parcel from that shop and a message that does not say which: that one.
  if (p.store && (!p.item || open.every((r) => !r.item)) && open.length === 1) return open[0]!
  return null
}

/** Records what a message says: a new parcel, or news of one already known. */
export async function recordDelivery(
  orgId: string,
  userId: string,
  p: ParsedDelivery,
): Promise<{ delivery: DeliveryDTO; created: boolean }> {
  const found = await existing(userId, p)
  if (!found) {
    const [row] = await db
      .insert(d)
      .values({
        orgId,
        userId,
        store: p.store,
        item: p.item,
        status: p.status,
        expectedOn: p.expectedOn,
        codPaise: p.codPaise,
        orderRef: p.orderRef,
        trackingUrl: p.trackingUrl,
        deliveredAt: p.status === 'delivered' ? new Date() : null,
      })
      .returning(selection)
    return { delivery: toDTO(row as Row), created: true }
  }

  const before = found.status as DeliveryStatus
  const forward = DELIVERY_STATUS_RANK[p.status] > DELIVERY_STATUS_RANK[before]
  const status = forward ? p.status : before
  const expectedOn = DONE.includes(status) ? found.expectedOn : (p.expectedOn ?? found.expectedOn)
  const [row] = await db
    .update(d)
    .set({
      status,
      expectedOn,
      item: found.item ?? p.item,
      codPaise: p.codPaise ?? found.codPaise,
      orderRef: found.orderRef ?? p.orderRef,
      trackingUrl: p.trackingUrl ?? found.trackingUrl,
      deliveredAt: status === 'delivered' ? (found.deliveredAt ?? new Date()) : null,
      // A new day is a new reminder.
      lastRemindedOn: expectedOn !== found.expectedOn ? null : found.lastRemindedOn,
      updatedAt: new Date(),
    })
    .where(eq(d.id, found.id))
    .returning(selection)
  return { delivery: toDTO(row as Row), created: false }
}

/** On their way, soonest first; and what arrived in the last half day, for the tick. */
export async function activeDeliveries(userId: string, now = new Date()): Promise<DeliveryDTO[]> {
  const rows = await db
    .select(selection)
    .from(d)
    .where(
      and(
        eq(d.userId, userId),
        or(notInArray(d.status, DONE), and(eq(d.status, 'delivered'), gte(d.deliveredAt, new Date(now.getTime() - 12 * 3_600_000)))),
      ),
    )
    .orderBy(sql`${d.expectedOn} asc nulls last`, asc(d.createdAt))
  return rows.map((r) => toDTO(r as Row))
}

export async function updateDelivery(
  userId: string,
  id: string,
  input: { status?: DeliveryStatus; expectedOn?: string | null; item?: string | null },
): Promise<DeliveryDTO | null> {
  const set: Partial<typeof d.$inferInsert> = { updatedAt: new Date() }
  if (input.status !== undefined) {
    set.status = input.status
    set.deliveredAt = input.status === 'delivered' ? new Date() : null
  }
  if (input.expectedOn !== undefined) {
    set.expectedOn = input.expectedOn
    set.lastRemindedOn = null
  }
  if (input.item !== undefined) set.item = input.item?.trim() || null
  const [row] = await db
    .update(d)
    .set(set)
    .where(and(eq(d.id, id), eq(d.userId, userId)))
    .returning(selection)
  return row ? toDTO(row as Row) : null
}

export async function deleteDelivery(userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(d).where(and(eq(d.id, id), eq(d.userId, userId))).returning({ id: d.id })
  return rows.length > 0
}

interface Arriving {
  id: string
  user_id: string
  store: string | null
  item: string | null
  cod_paise: string | null
  local_date: string
}

/** Parcels due today where the person is, in their daytime, not yet mentioned today. */
export async function deliveriesToRemind(now = new Date()): Promise<Arriving[]> {
  const at = now.toISOString()
  const rows = await db.execute(sql`
    select v.id, v.user_id, v.store, v.item, v.cod_paise::text, l.local_date::text
    from deliveries v
    join users u on u.id = v.user_id
    cross join lateral (select (${at}::timestamptz at time zone u.timezone) as local_ts) t
    cross join lateral (select t.local_ts::date as local_date) l
    where v.status in ('ordered', 'shipped', 'out_for_delivery')
      and v.expected_on = l.local_date
      and extract(hour from t.local_ts) between 8 and 20
      and (v.last_reminded_on is null or v.last_reminded_on < l.local_date)
    order by v.user_id, v.created_at
  `)
  return rows as unknown as Arriving[]
}

const named = (x: { store: string | null; item: string | null }) =>
  [x.store, x.item].filter(Boolean).join(' · ') || 'A parcel'

/** One notification per person: what is coming, and the cash to keep ready. */
export async function runDeliveryReminders(now = new Date()): Promise<number> {
  const due = await deliveriesToRemind(now)
  const byUser = new Map<string, Arriving[]>()
  for (const x of due) byUser.set(x.user_id, [...(byUser.get(x.user_id) ?? []), x])
  let sent = 0
  for (const [userId, list] of byUser) {
    try {
      await db
        .update(d)
        .set({ lastRemindedOn: list[0]!.local_date })
        .where(inArray(d.id, list.map((x) => x.id)))
      const cod = list.reduce((s, x) => s + Number(x.cod_paise ?? 0), 0)
      const cash = cod ? ` Keep ${formatRupees(cod)} ready for cash on delivery.` : ''
      const title = list.length === 1 ? `Arriving today: ${named(list[0]!)}` : `${list.length} parcels arriving today`
      const body = (list.length === 1 ? 'Be around to collect it.' : list.map(named).join(', ') + '.') + cash
      await sendToUser(userId, { title, body, url: '/', tag: 'deliveries' })
      sent += 1
    } catch (err) {
      console.error('[deliveries] failed for user', userId, (err as Error).message)
    }
  }
  return sent
}

export function startDeliveryWorker(intervalMs = 15 * 60_000) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const sent = await runDeliveryReminders()
      if (sent > 0) console.log(`[deliveries] sent ${sent} delivery reminder(s)`)
    } catch (err) {
      console.error('[deliveries] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  void run()
  const handle = setInterval(run, intervalMs)
  console.log(`[deliveries] delivery reminder worker checking every ${intervalMs / 60_000} min`)
  return () => clearInterval(handle)
}
