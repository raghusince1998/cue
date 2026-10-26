import { and, eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'

/** Empty strings from HTML inputs should clear a column, not store "". */
export function blankToNull(value: string | undefined | null): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * One workplace, one spelling: "mehta physio clinic " typed in a hurry becomes
 * the "Mehta Physio Clinic" already saved, so colleagues find each other.
 */
export async function canonicalWorkplace(orgId: string, value: string | undefined): Promise<string | null | undefined> {
  const typed = blankToNull(value)
  if (typed === undefined || typed === null) return typed
  const clean = typed.replace(/\s+/g, ' ')
  const same = sql`lower(${clean})`
  const [person] = await db
    .select({ name: schema.contacts.organization })
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.orgId, orgId),
        sql`lower(regexp_replace(btrim(${schema.contacts.organization}), '[[:space:]]+', ' ', 'g')) = ${same}`,
      ),
    )
    .limit(1)
  if (person?.name) return person.name.trim().replace(/\s+/g, ' ')
  const [place] = await db
    .select({ name: schema.places.name })
    .from(schema.places)
    .where(and(eq(schema.places.orgId, orgId), sql`lower(btrim(${schema.places.name})) = ${same}`))
    .limit(1)
  return place?.name.trim() ?? clean
}
