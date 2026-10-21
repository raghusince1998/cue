/**
 * How the running server is doing, for the admin portal's System page: each
 * background job's last run, push delivery, and the latest server errors.
 *
 * In memory, since this process started — the page says so. One server, so
 * one process holds the whole picture.
 */

export const startedAt = new Date()

export interface JobState {
  name: string
  everyMs: number | null
  runs: number
  failures: number
  running: boolean
  lastStartedAt: string | null
  lastOkAt: string | null
  lastDurationMs: number | null
  lastError: string | null
  lastErrorAt: string | null
}

const jobs = new Map<string, JobState>()

function stateOf(name: string, everyMs: number | null): JobState {
  let state = jobs.get(name)
  if (!state) {
    state = {
      name,
      everyMs,
      runs: 0,
      failures: 0,
      running: false,
      lastStartedAt: null,
      lastOkAt: null,
      lastDurationMs: null,
      lastError: null,
      lastErrorAt: null,
    }
    jobs.set(name, state)
  }
  if (everyMs !== null) state.everyMs = everyMs
  return state
}

/**
 * Run one tick of a background job, noting how it went. What it returns or
 * throws passes straight through: the job's own loop still decides what a
 * failure means.
 */
export async function tracked<T>(name: string, everyMs: number | null, run: () => Promise<T>): Promise<T> {
  const state = stateOf(name, everyMs)
  const started = Date.now()
  state.running = true
  state.runs += 1
  state.lastStartedAt = new Date(started).toISOString()
  try {
    const result = await run()
    state.lastOkAt = new Date().toISOString()
    return result
  } catch (err) {
    state.failures += 1
    state.lastError = ((err as Error).message ?? String(err)).slice(0, 300)
    state.lastErrorAt = new Date().toISOString()
    throw err
  } finally {
    state.running = false
    state.lastDurationMs = Date.now() - started
  }
}

export function jobStates(): JobState[] {
  return [...jobs.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Push delivery since start. */
export const pushStats = { sent: 0, failed: 0, expired: 0 }

export interface ServerError {
  at: string
  method: string
  route: string
  status: number
  message: string
}

const errors: ServerError[] = []
const KEEP_ERRORS = 50

/** A 5xx, kept for the System page — its text never goes to the caller. */
export function noteServerError(e: Omit<ServerError, 'at'>): void {
  errors.unshift({ ...e, message: e.message.slice(0, 300), at: new Date().toISOString() })
  errors.length = Math.min(errors.length, KEEP_ERRORS)
}

export function recentErrors(): ServerError[] {
  return [...errors]
}
