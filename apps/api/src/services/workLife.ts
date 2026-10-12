import { eq } from 'drizzle-orm'
import { hasWork, isWorkTime, nextWorkBoundary, sphereOf, type Sphere, type WorkHours } from '@cue/shared'
import { db, schema } from '../db/index.ts'

/**
 * Work and personal on one day: whose working week it is, and what a plan
 * is part of.
 *
 * The rule it serves is small on purpose. A time the person chose is always
 * kept — a 1pm call to mom rings at 1pm, a 7pm client call rings at 7pm. What
 * waits is only what nags: the "still open" chase after a reminder, and plans
 * with no set time. During the working day those wait if they are personal;
 * outside it, if they are work. Critical things, bookings and focus blocks
 * never wait.
 */

export interface WorkLife {
  timezone: string
  hours: WorkHours
  /** Has a working life (see hasWork) and keeps it apart: the rule applies. */
  apart: boolean
}

export async function workLifeOf(userId: string): Promise<WorkLife | null> {
  const [u] = await db
    .select({
      timezone: schema.users.timezone,
      uses: schema.users.uses,
      keepApart: schema.users.keepApart,
      workDays: schema.users.workDays,
      workStartHour: schema.users.workStartHour,
      workEndHour: schema.users.workEndHour,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  if (!u) return null
  return {
    timezone: u.timezone,
    hours: { days: u.workDays, start: u.workStartHour, end: u.workEndHour },
    apart: u.keepApart && hasWork(u.uses),
  }
}

/** Which half a plan is: the person's own say, or what its words say. */
export function planSphere(plan: { sphere?: string | null; title: string; kind?: string | null; booking?: unknown }): Sphere | null {
  if (plan.sphere === 'work' || plan.sphere === 'personal') return plan.sphere
  return sphereOf(plan.title, { kind: plan.kind, booking: Boolean(plan.booking) })
}

/**
 * When a reminder that only nags should go instead of now, or null to send
 * it now: a personal one waits for the working day to end, a work one for the
 * next working day to start.
 */
export function holdUntil(life: WorkLife | null, sphere: Sphere | null, now: Date): Date | null {
  if (!life?.apart || !sphere) return null
  const working = isWorkTime(now, life.timezone, life.hours)
  if ((sphere === 'personal' && working) || (sphere === 'work' && !working)) {
    return nextWorkBoundary(now, life.timezone, life.hours)
  }
  return null
}
