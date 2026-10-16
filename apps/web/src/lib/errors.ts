import { ApiError } from './api.ts'
import { msg, t } from './i18n.tsx'

/**
 * What went wrong, said for a person: never `not_found`, `invalid_input` or a
 * database's own words. The server's codes are for the code; a line the
 * server wrote for people (it has spaces in it) is shown as it is.
 */

/** Shown with t(). */
const BY_CODE: Record<string, string> = {
  not_found: msg('That one is no longer here.'),
  invalid_input: msg('Something in that did not look right. Check it and try again.'),
  request_failed: msg('That did not go through. Try again.'),
  bad_response: msg('That did not go through. Try again.'),
  upload_failed: msg('The upload did not go through. Try again.'),
  internal_error: msg('Something went wrong on our side. Try again in a moment.'),
  too_many: msg('Too many tries. Wait a minute and try again.'),
  rate_limited: msg('Too many tries. Wait a minute and try again.'),
}

const OFFLINE = msg('Could not reach Cue. Try again in a moment.')

/** True for a request that never reached the server: no signal, server down. */
export function isOffline(err: unknown): boolean {
  return err instanceof TypeError && !(err instanceof ApiError)
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const known = BY_CODE[err.code]
    if (known) return t(known)
    if (err.status === 429) return t(BY_CODE.too_many!)
    if (err.status >= 500) return t(BY_CODE.internal_error!)
    if (/\s/.test(err.message)) return err.message
    return t(BY_CODE.request_failed!)
  }
  if (isOffline(err)) return t(OFFLINE)
  // Thrown on purpose with a sentence in it: say that.
  if (err instanceof Error && /\s/.test(err.message)) return err.message
  return t(BY_CODE.request_failed!)
}
