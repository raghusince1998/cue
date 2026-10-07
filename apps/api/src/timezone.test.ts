import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * "9am" has to mean nine in the morning where the user is.
 *
 * Every parser, the recurrence expander and the free-slot finder build times
 * with local-time arithmetic, so the process timezone decides what a typed
 * time refers to. On a laptop in India that was invisible. On EC2 the process
 * starts in UTC, and every time typed into the live app was stored 5h30 late —
 * "kal subah 9 baje" previewed as 9:00 AM and saved as 2:30 PM, with its
 * reminder firing at 2:30 PM too.
 *
 * CI starts in UTC as well, which is what makes this worth running there: it
 * is the production failure, reproduced on every push.
 */

test('times are read in the app timezone, whatever the process started in', async () => {
  const { env } = await import('./env.ts')
  const { parseWhen } = await import('@cue/shared')

  assert.equal(process.env.TZ, env.appTimezone, 'env.ts sets the process timezone')

  // A fixed instant: 10:00 in India on Wednesday 7 October.
  const now = new Date('2026-10-07T04:30:00Z')
  const when = parseWhen('dentist tomorrow 9am', now)
  assert.ok(when)

  const shown = when.date.toLocaleString('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  // In a UTC process without the fix this reads "Thu 14:30".
  assert.equal(shown, 'Thu 09:00')
})

test('the preview is formatted in the same zone it was computed in', async () => {
  await import('./env.ts')
  // The preview text uses toLocaleString with no zone. It reported "9:00 AM"
  // while the stored instant was 2:30 PM because both were computed in UTC —
  // consistent with each other, and wrong for the person reading it.
  const nineAm = new Date(2026, 9, 8, 9, 0)
  const label = nineAm.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const truth = nineAm.toLocaleString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  })
  assert.equal(label, truth, 'what the preview says is what gets stored')
})
