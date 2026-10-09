/**
 * When a reopened plan should remind you.
 *
 * Its own time if that is still to come. If it has gone, the next whole hour
 * at least half an hour off, because reopening something with a time in the
 * past would set off an "overdue" reminder the moment it was tapped. Late in
 * the evening that means tomorrow morning.
 */
export function reopenTime(dueAt: string | Date, now = new Date()): Date {
  const was = new Date(dueAt)
  if (was.getTime() > now.getTime() + 5 * 60_000) return was
  const next = new Date(now.getTime() + 30 * 60_000)
  next.setMinutes(0, 0, 0)
  next.setHours(next.getHours() + 1)
  if (next.getHours() >= 21 || next.getDate() !== now.getDate()) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0)
  }
  return next
}
