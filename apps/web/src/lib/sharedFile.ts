/**
 * A file shared into Cue Exams, as the service worker kept it (shareTarget.ts):
 * taken once, then gone. Nothing is uploaded until the admit card reader
 * reads it, the same as choosing the file by hand.
 */

import { SHARED_CACHE as CACHE, SHARED_FILE as KEY } from './shareTarget.ts'

export async function takeSharedFile(): Promise<File | null> {
  try {
    if (!('caches' in window)) return null
    const cache = await caches.open(CACHE)
    const res = await cache.match(KEY)
    if (!res) return null
    await cache.delete(KEY)
    const name = decodeURIComponent(res.headers.get('x-file-name') ?? 'shared')
    const blob = await res.blob()
    return new File([blob], name, { type: res.headers.get('content-type') ?? blob.type })
  } catch {
    return null
  }
}
