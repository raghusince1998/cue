/**
 * A check-in's title is stored as said — "Waiting on Vikram: signed contract"
 * — and shown without the prefix wherever the person is already named.
 */
export function stripWaitingOn(title: string): string {
  return title.replace(/^Waiting on [^:]+:\s*/i, '')
}
