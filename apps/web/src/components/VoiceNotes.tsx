import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceNoteDTO } from '@cue/shared'
import { api, apiFetchBlobUrl, apiUploadAudio } from '../lib/api.ts'
import type { PendingClip } from '../lib/outbox.ts'
import { newId } from '../lib/outbox.ts'
import {
  formatDuration,
  formatSize,
  recordingSupported,
  startRecording,
  type RecordingSession,
} from '../lib/audio.ts'

function Player({ note }: { note: VoiceNoteDTO }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let url: string | null = null
    let cancelled = false

    void apiFetchBlobUrl(`/voice-notes/${note.id}/audio`)
      .then((next) => {
        if (cancelled) {
          URL.revokeObjectURL(next)
          return
        }
        url = next
        setSrc(next)
      })
      .catch(() => setError(true))

    return () => {
      cancelled = true
      // Blob URLs leak for the life of the document if never revoked.
      if (url) URL.revokeObjectURL(url)
    }
  }, [note.id])

  if (error) return <p className="error small">Could not load this clip.</p>
  if (!src) return <span className="muted small">Loading…</span>
  return <audio controls src={src} className="audio-player" />
}

export function VoiceNotes({
  interactionId,
  onIdsChange,
  onPendingClipsChange,
}: {
  /** When set, clips attach to this visit immediately instead of on save. */
  interactionId?: string
  /** Used by the capture screen to send the ids along with the visit. */
  onIdsChange?: (ids: string[]) => void
  /** Clips that could not be uploaded yet; they ride along in the outbox. */
  onPendingClipsChange?: (clips: PendingClip[]) => void
}) {
  const [notes, setNotes] = useState<VoiceNoteDTO[]>([])
  const [localClips, setLocalClips] = useState<PendingClip[]>([])
  const [session, setSession] = useState<RecordingSession | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startedAt = useRef(0)

  const supported = recordingSupported()

  useEffect(() => {
    if (!interactionId) return
    void api<VoiceNoteDTO[]>('/voice-notes', { query: { interactionId } }).then(setNotes)
  }, [interactionId])

  const publish = useCallback(
    (next: VoiceNoteDTO[]) => {
      setNotes(next)
      onIdsChange?.(next.map((n) => n.id))
    },
    [onIdsChange],
  )

  // Live timer while recording.
  useEffect(() => {
    if (!session) return
    const handle = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 200)
    return () => clearInterval(handle)
  }, [session])

  async function begin() {
    setError(null)
    try {
      startedAt.current = Date.now()
      setElapsedMs(0)
      setSession(await startRecording())
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function finish() {
    if (!session) return
    setBusy(true)
    try {
      const recording = await session.stop()
      setSession(null)

      try {
        const uploaded = await apiUploadAudio('/voice-notes', recording.blob, {
          durationMs: String(recording.durationMs),
          ...(interactionId ? { interactionId } : {}),
        })

        publish([
          ...notes,
          {
            id: uploaded.id,
            mimeType: uploaded.mimeType,
            durationMs: uploaded.durationMs,
            sizeBytes: uploaded.sizeBytes,
            createdAt: new Date().toISOString(),
          },
        ])
      } catch {
        // No connection. Keep the audio in memory and let the outbox carry it,
        // rather than making the user re-record it later.
        if (!onPendingClipsChange) {
          setError('Could not upload that clip — check your connection.')
          return
        }
        const next = [
          ...localClips,
          {
            localId: newId(),
            blob: recording.blob,
            mimeType: recording.mimeType,
            durationMs: recording.durationMs,
          },
        ]
        setLocalClips(next)
        onPendingClipsChange(next)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function discard() {
    session?.cancel()
    setSession(null)
  }

  async function remove(id: string) {
    try {
      await api(`/voice-notes/${id}`, { method: 'DELETE' })
      publish(notes.filter((n) => n.id !== id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!supported) {
    return (
      <p className="muted small">
        This browser cannot record audio. On a phone you can still tap the microphone on your
        keyboard to dictate into the notes field.
      </p>
    )
  }

  return (
    <div className="stack tight">
      {notes.length > 0 && (
        <ul className="plain">
          {notes.map((note) => (
            <li key={note.id} className="voice-note">
              <div className="commitment-head">
                <span className="muted small">
                  {formatDuration(note.durationMs)} · {formatSize(note.sizeBytes)}
                </span>
                <button className="link danger-link" onClick={() => void remove(note.id)}>
                  Delete
                </button>
              </div>
              <Player note={note} />
              {note.transcript && <p className="notes">{note.transcript}</p>}
            </li>
          ))}
        </ul>
      )}

      {localClips.length > 0 && (
        <p className="muted small">
          {localClips.length} clip{localClips.length === 1 ? '' : 's'} held on this device — they
          upload with the visit once you are back online.
        </p>
      )}

      {session ? (
        <div className="row recording-row">
          <span className="rec-dot" />
          <span className="muted small">Recording {formatDuration(elapsedMs)}</span>
          <button className="primary small-btn" onClick={finish} disabled={busy}>
            {busy ? 'Saving…' : 'Stop & save'}
          </button>
          <button className="ghost small-btn" onClick={discard} disabled={busy}>
            Discard
          </button>
        </div>
      ) : (
        <button className="ghost" onClick={begin} disabled={busy}>
          Record a voice note
        </button>
      )}

      {error && <p className="error small">{error}</p>}
    </div>
  )
}
