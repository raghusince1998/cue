/**
 * Browser-only audio capture. Nothing here talks to a transcription service —
 * the clip is recorded, uploaded, and played back as-is.
 */

/** Ordered by preference: opus is tiny, mp4 is what Safari will give us. */
const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/aac',
]

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

export function recordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    pickMimeType() !== null
  )
}

export interface Recording {
  blob: Blob
  mimeType: string
  durationMs: number
}

export interface RecordingSession {
  stop: () => Promise<Recording>
  cancel: () => void
}

export async function startRecording(): Promise<RecordingSession> {
  const mimeType = pickMimeType()
  if (!mimeType) throw new Error('This browser cannot record audio.')

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    const name = (err as Error).name
    if (name === 'NotAllowedError') {
      throw new Error('Microphone permission was denied. Allow it for this site and try again.')
    }
    if (name === 'NotFoundError') throw new Error('No microphone found on this device.')
    throw new Error((err as Error).message)
  }

  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks: BlobPart[] = []
  const startedAt = Date.now()

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  // Emit a chunk per second so a crash mid-recording still leaves something.
  recorder.start(1000)

  const releaseMic = () => stream.getTracks().forEach((track) => track.stop())

  return {
    stop: () =>
      new Promise<Recording>((resolve) => {
        recorder.onstop = () => {
          releaseMic()
          resolve({
            blob: new Blob(chunks, { type: mimeType }),
            mimeType,
            durationMs: Date.now() - startedAt,
          })
        }
        recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = releaseMic
      if (recorder.state !== 'inactive') recorder.stop()
      else releaseMic()
    },
  }
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
