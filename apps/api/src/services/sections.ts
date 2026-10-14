import { sql } from 'drizzle-orm'
import { db } from '../db/index.ts'

/**
 * The sections with something of this person's in them. They stay in the
 * menu whatever was picked: a bill found in email shows Bills, an
 * application typed in shows Jobs (see sectionsFor in shared/uses.ts).
 * Not Exams: that is for those who chose Competitive exams.
 */
export async function filledSections(userId: string): Promise<string[]> {
  const rows = await db.execute(sql`
    select 'trips' as section where exists (select 1 from trips where user_id = ${userId})
    union all select 'expenses' where exists (select 1 from expenses where user_id = ${userId})
    union all select 'bills' where exists (select 1 from bills where user_id = ${userId})
    union all select distinct board from tracker_items where user_id = ${userId}
  `)
  return (rows as unknown as { section: string }[]).map((r) => r.section)
}
