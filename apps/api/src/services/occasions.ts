import { and, desc, eq, inArray, or, isNotNull, sql } from 'drizzle-orm'
import { daysUntil, nextMonthDay, type Lang, type OccasionKind } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { t } from '../i18n.ts'

/**
 * Occasions: whose birthday or anniversary is coming, and festival greetings
 * sent across a contact list, one person at a time, without anyone getting
 * them twice.
 */

export interface Occasion {
  contactId: string
  name: string
  organization: string | null
  phone: string | null
  kind: OccasionKind
  /** YYYY-MM-DD of the next one. */
  date: string
  daysAway: number
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Birthdays and anniversaries in the next `days` days, soonest first, today included. */
export async function upcomingOccasions(orgId: string, days = 30, now = new Date()): Promise<Occasion[]> {
  const ct = schema.contacts
  const rows = await db
    .select({
      id: ct.id,
      name: ct.name,
      organization: ct.organization,
      phone: ct.phone,
      birthday: ct.birthday,
      anniversary: ct.anniversary,
    })
    .from(ct)
    .where(and(eq(ct.orgId, orgId), or(isNotNull(ct.birthday), isNotNull(ct.anniversary))))

  const out: Occasion[] = []
  for (const r of rows) {
    for (const kind of ['birthday', 'anniversary'] as const) {
      const md = r[kind]
      if (!md) continue
      const next = nextMonthDay(md, now)
      if (!next) continue
      const away = daysUntil(next, now)
      if (away > days) continue
      out.push({
        contactId: r.id,
        name: r.name,
        organization: r.organization,
        phone: r.phone,
        kind,
        date: ymd(next),
        daysAway: away,
      })
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name))
}

/** "Dr. Mehta's birthday", "Ravi Kumar's anniversary". */
export function occasionLabel(o: Pick<Occasion, 'name' | 'kind'>, lang: Lang = 'en'): string {
  return o.kind === 'birthday' ? t(lang, "{name}'s birthday", { name: o.name }) : t(lang, "{name}'s anniversary", { name: o.name })
}

// ------------------------------------------------------------- greetings

export async function startGreetings(
  orgId: string,
  userId: string,
  input: { occasion: string; message: string; contactIds: string[] },
) {
  // Only people in this org, in the order given, each once.
  const ids = [...new Set(input.contactIds)]
  const found = await db
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), inArray(schema.contacts.id, ids)))
  const mine = new Set(found.map((f) => f.id))
  const contactIds = ids.filter((id) => mine.has(id))
  if (contactIds.length === 0) return null

  const [run] = await db
    .insert(schema.greetingRuns)
    .values({ orgId, userId, occasion: input.occasion, message: input.message, contactIds })
    .returning()
  return run!
}

/** A round, with each person and whether they have had it. Null if it is not theirs. */
export async function greetingRun(userId: string, runId: string) {
  const [run] = await db
    .select()
    .from(schema.greetingRuns)
    .where(and(eq(schema.greetingRuns.id, runId), eq(schema.greetingRuns.userId, userId)))
  if (!run) return null

  const [people, sends] = await Promise.all([
    run.contactIds.length
      ? db
          .select({
            id: schema.contacts.id,
            name: schema.contacts.name,
            organization: schema.contacts.organization,
            phone: schema.contacts.phone,
            email: schema.contacts.email,
          })
          .from(schema.contacts)
          .where(inArray(schema.contacts.id, run.contactIds))
      : [],
    db.select().from(schema.greetingSends).where(eq(schema.greetingSends.runId, run.id)),
  ])
  const sentAt = new Map(sends.map((s) => [s.contactId, s.sentAt]))
  const byId = new Map(people.map((p) => [p.id, p]))
  return {
    id: run.id,
    occasion: run.occasion,
    message: run.message,
    createdAt: run.createdAt.toISOString(),
    // Someone deleted since the round started is simply no longer in it.
    people: run.contactIds
      .map((id) => byId.get(id))
      .filter((p) => p !== undefined)
      .map((p) => ({ ...p, sentAt: sentAt.get(p.id)?.toISOString() ?? null })),
  }
}

/** Recent rounds, with how far each got. */
export async function greetingRuns(userId: string, limit = 5) {
  const runs = await db
    .select({
      id: schema.greetingRuns.id,
      occasion: schema.greetingRuns.occasion,
      total: sql<number>`cardinality(${schema.greetingRuns.contactIds})`,
      sent: sql<number>`(select count(*)::int from greeting_sends s where s.run_id = ${schema.greetingRuns.id})`,
      createdAt: schema.greetingRuns.createdAt,
    })
    .from(schema.greetingRuns)
    .where(eq(schema.greetingRuns.userId, userId))
    .orderBy(desc(schema.greetingRuns.createdAt))
    .limit(limit)
  return runs.map((r) => ({ ...r, total: Number(r.total), sent: Number(r.sent), createdAt: r.createdAt.toISOString() }))
}

/**
 * Sent to one person. A greeting is contact, so it counts towards keeping in
 * touch: Diwali is as good a reason as any to have been in touch.
 */
export async function markGreeted(userId: string, runId: string, contactId: string): Promise<boolean> {
  const [run] = await db
    .select({ contactIds: schema.greetingRuns.contactIds, orgId: schema.greetingRuns.orgId })
    .from(schema.greetingRuns)
    .where(and(eq(schema.greetingRuns.id, runId), eq(schema.greetingRuns.userId, userId)))
  if (!run || !run.contactIds.includes(contactId)) return false
  await db.transaction(async (tx) => {
    await tx.insert(schema.greetingSends).values({ runId, contactId }).onConflictDoNothing()
    await tx
      .update(schema.contacts)
      .set({ lastContactedAt: new Date() })
      .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.orgId, run.orgId)))
  })
  return true
}
