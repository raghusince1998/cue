import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
 * Each check runs in a child process started in UTC, deliberately. Running it
 * in-process would test whatever zone the developer's machine happens to be
 * in — and a machine in India already passes without the fix, which is
 * precisely how the bug went unnoticed in the first place.
 */

const here = dirname(fileURLToPath(import.meta.url))
const apiRoot = resolve(here, '..')
// A file:// URL, not a path: on Windows `import('D:\…')` reads "D:" as a scheme.
const envUrl = pathToFileURL(resolve(here, 'env.ts')).href

/** Run a snippet the way EC2 boots: a fresh process whose zone is UTC. */
function inUtcProcess(body: string): string {
  const script = `
    const { env } = await import(${JSON.stringify(envUrl)})
    const { parseWhen } = await import('@cue/shared')
    ${body}
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: apiRoot,
    env: { ...process.env, TZ: 'UTC', APP_TIMEZONE: 'Asia/Kolkata' },
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`child process failed:\n${result.stderr}`)
  }
  return result.stdout.trim()
}

test('a process started in UTC reads times in the app timezone', () => {
  const out = inUtcProcess(`
    // A fixed instant: 10:00 in India on Wednesday 7 October.
    const when = parseWhen('dentist tomorrow 9am', new Date('2026-10-07T04:30:00Z'))
    console.log(JSON.stringify({
      tz: process.env.TZ,
      configured: env.appTimezone,
      shown: when.date.toLocaleString('en-GB', {
        timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit',
      }),
    }))
  `)
  const r = JSON.parse(out) as { tz: string; configured: string; shown: string }

  assert.equal(r.tz, 'Asia/Kolkata', 'env.ts switched the zone it started in')
  assert.equal(r.configured, 'Asia/Kolkata')
  // Without the fix this reads "Thu 14:30" — the bug report, verbatim.
  assert.equal(r.shown, 'Thu 09:00')
})

test('the preview says what is stored', () => {
  // The preview text uses toLocaleString with no zone. It reported "9:00 AM"
  // while the stored instant was 2:30 PM because both were computed in UTC:
  // consistent with each other, and wrong for the person reading it.
  const out = inUtcProcess(`
    const nineAm = new Date(2026, 9, 8, 9, 0)
    console.log(JSON.stringify({
      label: nineAm.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      truth: nineAm.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }),
    }))
  `)
  const r = JSON.parse(out) as { label: string; truth: string }
  assert.equal(r.label, r.truth)
  assert.equal(r.truth, '09:00')
})

test('an unknown zone stops the server rather than falling back to UTC', () => {
  // Falling back would be the very 5h30 shift this exists to prevent, and it
  // would do so silently. A server that will not start gets noticed.
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(envUrl)})`,
    ],
    {
      cwd: apiRoot,
      env: { ...process.env, TZ: 'UTC', APP_TIMEZONE: 'Mars/Olympus_Mons' },
      encoding: 'utf8',
    },
  )
  assert.notEqual(result.status, 0, 'it refused to start')
  assert.match(result.stderr, /not a timezone/)
})
