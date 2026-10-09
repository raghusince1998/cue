import { reopenTime } from '@cue/shared'
import { api } from './api.ts'
import { announceChange } from './changes.ts'
import { formatDateTime } from './time.ts'

/** Reopens a done or cancelled plan in one step. Says when it will remind you. */
export async function reopenPlan(c: { id: string; dueAt: string }): Promise<string> {
  const at = reopenTime(c.dueAt)
  const moved = at.getTime() !== new Date(c.dueAt).getTime()
  await api(`/commitments/${c.id}`, {
    method: 'PATCH',
    body: {
      status: 'pending',
      ...(moved ? { dueAt: at.toISOString() } : {}),
      // Reopening is never refused for a clash: the editor that opens next
      // shows one, with ways out, if there is one.
      allowConflict: true,
    },
  })
  announceChange()
  return `Reopened. It will remind you ${formatDateTime(at.toISOString())}${moved ? ', since its old time has passed' : ''}. Change anything below, or just close this.`
}
