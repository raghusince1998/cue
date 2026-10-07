/**
 * Which wall clock "9am" means, for the whole process.
 *
 * Every parser, the recurrence expander, the free-slot finder and the preview
 * text build times with local-time arithmetic, so the process timezone decides
 * what "tomorrow 9am" refers to. That was invisible in development, where the
 * server ran on a laptop in India. On EC2 the process is UTC, so every time
 * typed into the live app was stored 5h30 late — "9am" became 2:30 PM, and its
 * reminder fired at 2:30 PM. The preview even said 9:00 AM, because it was
 * formatted in the same wrong zone it was computed in.
 *
 * A function rather than a top-level statement, called by whoever loads `.env`
 * once it has done so — env.ts for the server, the test harness for tests.
 * As an import side effect it would run before `.env` is read and ignore an
 * APP_TIMEZONE set there. And it lives apart from env.ts so the harness can use
 * it: importing env.ts there would capture DATABASE_URL before each test points
 * it at its own schema, and every test would run against the shared one.
 *
 * One zone for the whole server. Users elsewhere would see their times
 * shifted; doing that properly means threading each user's zone through every
 * date computation, which is a larger change than this.
 */
export function applyAppTimezone(): string {
  const zone = process.env.APP_TIMEZONE || 'Asia/Kolkata'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch {
    // Refuse rather than fall back to UTC — falling back is exactly the silent
    // 5h30 shift this exists to prevent.
    throw new Error(`APP_TIMEZONE "${zone}" is not a timezone this runtime knows.`)
  }
  process.env.TZ = zone
  return zone
}
