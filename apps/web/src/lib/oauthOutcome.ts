import { ApiError } from './api.ts'
import { errorText } from './errors.ts'
import { msg, t } from './i18n.tsx'

/**
 * What a sign-in round trip with Google or Microsoft came back with.
 *
 * The callback can only hand back a fixed code, never free text — it arrives
 * in a URL the browser was sent to by a third party — so the wording lives
 * here, once, for every screen that reads `?connected=`.
 */
const OUTCOME: Record<string, { text: string; bad: boolean }> = {
  mail_connected: { text: msg('Email connected. Cue is looking through the last two weeks now.'), bad: false },
  // An older calendar-only sign-in, still finishing.
  connected: { text: msg('Connected. Choose which calendars to mirror.'), bad: false },
  cancelled: { text: msg('No change — you cancelled at the sign-in screen.'), bad: false },
  mail_scope_missing: {
    text: msg('Email permission was not granted. Connect again and leave the box for reading email ticked.'),
    bad: true,
  },
  scope_missing: {
    text: msg('Neither calendar nor email access was granted. Connect again and leave the boxes ticked.'),
    bad: true,
  },
  no_refresh_token: {
    text: msg('That account did not grant lasting access. Remove Cue from your account permissions, then connect again.'),
    bad: true,
  },
  bad_state: { text: msg('That sign-in link had already been used. Start again.'), bad: true },
  expired_state: { text: msg('That sign-in took too long. Start again.'), bad: true },
  // You signed in, but the provider would not hand the connection over. With
  // a sign-in that otherwise works, this is almost always the server's client
  // id or secret for that provider being wrong or swapped.
  exchange_failed: {
    text: msg('You signed in, but the provider would not hand the connection to Cue. The client id or secret this server has for it is probably wrong.'),
    bad: true,
  },
  not_configured: { text: msg('This server has no credentials for that provider.'), bad: true },
}

/** The outcome for a code, in the reader's language. */
export function outcomeOf(code: string): { text: string; bad: boolean } {
  const known = OUTCOME[code]
  return known
    ? { text: t(known.text), bad: known.bad }
    : { text: t('That did not work. Try connecting again.'), bad: true }
}

/** A failed connect, calendar or email call: the server's own sentence when it wrote one. */
export function connectionError(err: unknown): string {
  if (err instanceof ApiError) return (err.data as { message?: string } | null)?.message ?? errorText(err)
  return errorText(err)
}
