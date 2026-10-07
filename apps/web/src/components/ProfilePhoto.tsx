import { useEffect, useRef, useState } from 'react'
import { BASE, getToken } from '../lib/api.ts'

/**
 * The photo on the account.
 *
 * Resized and re-encoded in the browser before it is sent. A phone camera
 * produces several megabytes; an avatar is displayed at forty pixels. Uploading
 * the original would spend somebody's mobile data on detail that is thrown away
 * the moment it is drawn, and on a patchy connection it is the difference
 * between a photo that uploads and one that times out.
 */

/** Twice the largest size it is drawn at, so it stays sharp on a retina screen. */
const SIZE = 256

const ACCEPT = 'image/png,image/jpeg,image/webp'

/**
 * Square, centre-cropped, re-encoded.
 *
 * Always JPEG regardless of what came in: it is the one format every browser
 * can encode, and a photograph in PNG is several times larger for no visible
 * gain.
 */
async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    // Crop to the centre square first, so a portrait photo keeps the face
    // rather than being squashed into a circle.
    const edge = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - edge) / 2
    const sy = (bitmap.height - edge) / 2

    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot resize images.')
    ctx.drawImage(bitmap, sx, sy, edge, edge, 0, 0, SIZE, SIZE)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not read that image.'))),
        'image/jpeg',
        0.85,
      )
    })
  } finally {
    bitmap.close()
  }
}

export function ProfilePhoto({
  userId,
  name,
  avatarKey,
  onChanged,
}: {
  userId: string
  name: string
  /** Changes whenever the photo does, which is what busts the browser cache. */
  avatarKey: string | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')

  /**
   * Fetched with the token, then handed to the <img> as a blob URL.
   *
   * The obvious thing — pointing src straight at the API — cannot work: an
   * <img> request carries no Authorization header, so the route answers 401
   * and every avatar silently falls back to initials. The alternative, putting
   * the token in the query string, writes a credential into browser history
   * and any proxy log on the way.
   *
   * `avatarKey` changes whenever the photo does, which is what re-runs this
   * rather than leaving the previous picture on screen.
   */
  useEffect(() => {
    if (!avatarKey) {
      setSrc(null)
      return
    }
    let url: string | null = null
    let cancelled = false

    void (async () => {
      try {
        const token = getToken()
        const res = await fetch(`${BASE}/auth/avatar/${userId}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) return
        const blob = await res.blob()
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      } catch {
        // No photo is a fine outcome; the initials stand in.
      }
    })()

    return () => {
      cancelled = true
      // Released explicitly — a blob URL pins its data in memory until it is.
      if (url) URL.revokeObjectURL(url)
    }
  }, [userId, avatarKey])

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      const blob = await toSquareJpeg(file)
      const res = await fetch(`${BASE}/auth/avatar`, {
        method: 'POST',
        headers: {
          'content-type': 'image/jpeg',
          ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
        },
        body: blob,
      })
      if (!res.ok) throw new Error('That image was not accepted.')
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await fetch(`${BASE}/auth/avatar`, {
        method: 'DELETE',
        headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {},
      })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="photo-row">
      <div className="avatar-lg" aria-hidden>
        {src ? <img src={src} alt="" /> : <span>{initials || '?'}</span>}
      </div>

      <div className="stack tight">
        <div className="row">
          <button
            className="ghost small-btn"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            {busy ? 'Working…' : src ? 'Change photo' : 'Add a photo'}
          </button>
          {src && (
            <button className="ghost small-btn" onClick={() => void remove()} disabled={busy}>
              Remove
            </button>
          )}
        </div>
        <p className="muted small">Square works best. It is resized on this device before it goes.</p>
        {error && <p className="error small">{error}</p>}
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Cleared so picking the same file twice still fires.
          e.target.value = ''
          if (file) void upload(file)
        }}
      />
    </div>
  )
}
