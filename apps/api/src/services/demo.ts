import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { loadSampleDay } from './sampleDay.ts'
import { createBill } from './bills.ts'
import { recordDelivery } from './deliveries.ts'
import { createItem } from './trackers.ts'
import { addOwed } from './owed.ts'
import { loadExamsDemo } from './examsDemo.ts'

/**
 * Trying Cue without signing up: an account of its own, filled with a
 * realistic week — plans, a trip, bills, a parcel, a job application, money
 * owed — and gone a day later. Nothing in it is anyone's real data. From
 * Cue Exams, an aspirant's account instead (examsDemo.ts). In the language
 * the visitor was reading, set first, so every title is made in it.
 */

/** How long a demo lives. */
const DEMO_HOURS = 24

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const inDays = (now: Date, n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)

export async function createDemo(
  now = new Date(),
  opts: { kind?: 'everyday' | 'exams'; language?: 'en' | 'hi' } = {},
): Promise<{ userId: string; orgId: string; email: string }> {
  const exams = opts.kind === 'exams'
  const email = `demo-${randomBytes(6).toString('hex')}@demo.cue`
  // Nobody signs in to a demo with a password; this one exists only to fill the column.
  const passwordHash = await bcrypt.hash(randomBytes(24).toString('hex'), 8)

  const { org, user } = await db.transaction(async (tx) => {
    const [org] = await tx.insert(schema.orgs).values({ name: 'Demo' }).returning()
    const [user] = await tx
      .insert(schema.users)
      .values({
        orgId: org!.id,
        name: 'Asha',
        email,
        passwordHash,
        role: 'owner',
        isDemo: true,
        uses: exams ? ['exams'] : ['personal', 'office'],
        homeCity: exams ? 'Jaipur' : 'Mumbai',
        language: opts.language ?? 'en',
        ...(exams ? { examLevel: 'graduate' as const } : {}),
      })
      .returning()
    return { org: org!, user: user! }
  })

  if (exams) {
    await loadExamsDemo(org.id, user.id, now)
    return { userId: user.id, orgId: org.id, email }
  }

  await loadSampleDay(org.id, user.id, now)

  // The things that usually arrive from email, so they can be seen too.
  await createBill(org.id, user.id, { name: 'Rent', amountPaise: 1500000, dueOn: ymd(inDays(now, 6)) })
  await createBill(org.id, user.id, { name: 'Electricity', amountPaise: 124000, dueOn: ymd(inDays(now, -1)) })
  await createBill(org.id, user.id, {
    name: 'Car insurance · MH12AB1234 (ACKO)',
    kind: 'renewal',
    category: 'insurance',
    amountPaise: 845000,
    dueOn: ymd(inDays(now, 24)),
    repeat: 'yearly',
    remindDays: 30,
  })
  await recordDelivery(org.id, user.id, {
    store: 'Flipkart',
    item: 'Redmi Note 13 5G',
    status: 'out_for_delivery',
    expectedOn: ymd(now),
    codPaise: 1799900,
    orderRef: `OD${randomBytes(8).toString('hex').replace(/\D/g, '').padEnd(18, '0').slice(0, 18)}`,
    trackingUrl: null,
  })
  const job = await createItem(org.id, user.id, 'jobs', { title: 'Infosys', detail: 'Data analyst', stage: 'applied' })
  if (typeof job === 'object') {
    await db
      .update(schema.trackerItems)
      .set({ stageChangedAt: inDays(now, -9) })
      .where(eq(schema.trackerItems.id, job.id))
  }
  await addOwed(org.id, user.id, { personName: 'Ravi', amountPaise: 45000, note: 'cab to the airport' })

  return { userId: user.id, orgId: org.id, email }
}

/** Demos past their day, removed with everything in them. */
export async function removeOldDemos(now = new Date()): Promise<number> {
  const old = await db
    .select({ orgId: schema.users.orgId })
    .from(schema.users)
    .where(and(eq(schema.users.isDemo, true), lt(schema.users.createdAt, new Date(now.getTime() - DEMO_HOURS * 3_600_000))))
  if (old.length === 0) return 0
  // Only organisations that hold nothing but demos: a real account is never in one.
  const orgIds = [...new Set(old.map((o) => o.orgId))]
  const removed = await db
    .delete(schema.orgs)
    .where(
      and(
        inArray(schema.orgs.id, orgIds),
        sql`not exists (select 1 from users u where u.org_id = ${schema.orgs.id} and not u.is_demo)`,
      ),
    )
    .returning({ id: schema.orgs.id })
  return removed.length
}

export function startDemoCleanup(intervalMs = 60 * 60_000) {
  const run = () =>
    void removeOldDemos()
      .then((n) => n > 0 && console.log(`[demo] removed ${n} old demo account(s)`))
      .catch((err) => console.error('[demo] cleanup failed:', (err as Error).message))
  run()
  const handle = setInterval(run, intervalMs)
  return () => clearInterval(handle)
}

/** At most this many demos from one address an hour, and this many in all. */
const PER_ADDRESS = 5
const OVERALL = 120
const recent: { at: number; address: string }[] = []

/**
 * Whether one more demo may be made now. In memory: a restart forgets, which
 * is fine for keeping a sign-up-free door from being leaned on.
 */
export function demoAllowed(address: string, now = Date.now()): boolean {
  const hourAgo = now - 3_600_000
  while (recent.length && recent[0]!.at < hourAgo) recent.shift()
  if (recent.length >= OVERALL) return false
  if (recent.filter((r) => r.address === address).length >= PER_ADDRESS) return false
  recent.push({ at: now, address })
  return true
}
