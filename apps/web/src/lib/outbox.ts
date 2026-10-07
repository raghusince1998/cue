import type { LogVisitInput } from '@cue/shared'
import { ApiError, api, apiUploadAudio } from './api.ts'
import { STORE_OUTBOX, idbDelete, idbGetAll, idbPut, idbSupported } from './idb.ts'

/**
 * Visits captured with no usable connection. Each entry carries its own
 * `clientId`, so replaying it after a dropped response cannot create a
 * duplicate — the server returns the visit it already stored.
 */
export interface PendingClip {
  localId: string
  blob: Blob
  mimeType: string
  durationMs: number
}

export interface OutboxEntry {
  id: string
  payload: LogVisitInput
  clips: PendingClip[]
  createdAt: string
  attempts: number
  lastError?: string
  /** Set when the server rejected it outright — retrying will never help. */
  failed?: boolean
}

export function newId(): string {
  return crypto.randomUUID()
}

export async function enqueueVisit(
  payload: LogVisitInput,
  clips: PendingClip[],
): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    id: newId(),
    payload,
    clips,
    createdAt: new Date().toISOString(),
    attempts: 0,
  }
  await idbPut(STORE_OUTBOX, entry)
  notify()
  return entry
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  if (!idbSupported()) return []
  const all = await idbGetAll<OutboxEntry>(STORE_OUTBOX)
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function pendingCount(): Promise<number> {
  return (await listOutbox()).filter((e) => !e.failed).length
}

export async function discardEntry(id: string): Promise<void> {
  await idbDelete(STORE_OUTBOX, id)
  notify()
}

// --------------------------------------------------------------- listeners

type Listener = () => void
const listeners = new Set<Listener>()

export function onOutboxChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  listeners.forEach((l) => l())
}

/** A failure that means "no network" rather than "the server said no". */
function isTransport(err: unknown): boolean {
  return !(err instanceof ApiError)
}

async function sendOne(entry: OutboxEntry): Promise<void> {
  // Clips first: the visit references them by server id, so they have to exist
  // before it is posted.
  const voiceNoteIds: string[] = [...(entry.payload.voiceNoteIds ?? [])]

  for (const clip of entry.clips) {
    const uploaded = await apiUploadAudio('/voice-notes', clip.blob, {
      durationMs: String(clip.durationMs),
    })
    voiceNoteIds.push(uploaded.id)
  }

  // Clips are uploaded — drop them from the entry so a later failure does not
  // upload them a second time.
  if (entry.clips.length > 0) {
    entry.clips = []
    entry.payload = { ...entry.payload, voiceNoteIds }
    await idbPut(STORE_OUTBOX, entry)
  }

  try {
    await api('/visits', { method: 'POST', body: { ...entry.payload, voiceNoteIds } })
  } catch (err) {
    // A clash cannot be negotiated with the user hours after the fact, and
    // losing the visit is far worse than a double-booking. Force it through and
    // let the Today screen show the overlap.
    if (err instanceof ApiError && err.status === 409) {
      await api('/visits', {
        method: 'POST',
        body: { ...entry.payload, voiceNoteIds, allowConflict: true },
      })
    } else {
      throw err
    }
  }
}

let syncing = false

export interface SyncResult {
  sent: number
  failed: number
  remaining: number
}

/**
 * Drains the queue. Stops at the first transport error — if the network is
 * down there is no point marching through the rest.
 */
export async function syncOutbox(): Promise<SyncResult> {
  if (syncing || !idbSupported()) return { sent: 0, failed: 0, remaining: 0 }
  syncing = true

  let sent = 0
  let failed = 0

  try {
    for (const entry of await listOutbox()) {
      if (entry.failed) continue

      try {
        await sendOne(entry)
        await idbDelete(STORE_OUTBOX, entry.id)
        sent += 1
      } catch (err) {
        entry.attempts += 1
        entry.lastError = (err as Error).message

        if (isTransport(err)) {
          // Still offline. Leave everything queued and try again later.
          await idbPut(STORE_OUTBOX, entry)
          break
        }

        // The server rejected it. Retrying the same body will not change that,
        // so park it and surface it rather than looping forever.
        entry.failed = true
        failed += 1
        await idbPut(STORE_OUTBOX, entry)
      }
    }
  } finally {
    syncing = false
    notify()
  }

  return { sent, failed, remaining: await pendingCount() }
}
