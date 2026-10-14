/**
 * Shared into Cue Exams from another app: an admit card's PDF from WhatsApp
 * or Downloads, or a forwarded notice's text. A share is a POST, which no
 * page can receive, so the service worker answers it with this (sw.ts). The
 * file is kept on this device only, for the exams page to read and drop
 * (sharedFile.ts); text goes to the box on Today as any share does.
 */

export const SHARED_CACHE = 'cue-shared'
export const SHARED_FILE = '/shared/admit-card'

export interface CacheLike {
  put(key: string, response: Response): Promise<void>
}

export async function receiveShare(request: Request, open: (name: string) => Promise<CacheLike>): Promise<Response> {
  const form = await request.formData()
  const file = form.get('file')
  if (file instanceof File && file.size > 0) {
    const cache = await open(SHARED_CACHE)
    await cache.put(
      SHARED_FILE,
      new Response(file, { headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) } }),
    )
    return Response.redirect(new URL('/exams?app=exams&card=shared', request.url).toString(), 303)
  }
  const q = new URLSearchParams()
  for (const key of ['title', 'text', 'url']) {
    const value = form.get(key)
    if (typeof value === 'string' && value.trim()) q.set(key, value)
  }
  return Response.redirect(new URL(`/share?${q.toString()}`, request.url).toString(), 303)
}
