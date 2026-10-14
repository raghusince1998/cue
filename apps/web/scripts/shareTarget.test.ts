import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SHARED_CACHE, SHARED_FILE, receiveShare } from '../src/lib/shareTarget.ts'

// A share into Cue Exams, as Android sends it: a multipart POST. The file is
// kept on the device for the exams page; text goes to the box on Today.

const pdf = readFileSync(new URL('../../api/src/services/fixtures/rrb-admit-card.pdf', import.meta.url))

function fakeCaches() {
  const kept = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    const cache = kept.get(name) ?? new Map<string, Response>()
    kept.set(name, cache)
    return { put: async (key: string, res: Response) => void cache.set(key, res) }
  }
  return { kept, open }
}

test('a shared PDF is kept for the exams page, which opens to read it', async () => {
  const form = new FormData()
  form.set('title', 'Admit card')
  form.set('file', new File([pdf], 'RRB NTPC admit card.pdf', { type: 'application/pdf' }))
  const { kept, open } = fakeCaches()
  const res = await receiveShare(new Request('https://cue.vitelio.in/share-file', { method: 'POST', body: form }), open)

  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), 'https://cue.vitelio.in/exams?app=exams&card=shared')
  const saved = kept.get(SHARED_CACHE)?.get(SHARED_FILE)
  assert.ok(saved, 'kept on the device')
  assert.equal(saved.headers.get('content-type'), 'application/pdf')
  assert.equal(decodeURIComponent(saved.headers.get('x-file-name')!), 'RRB NTPC admit card.pdf')
  assert.equal((await saved.arrayBuffer()).byteLength, pdf.byteLength, 'the whole file')
})

test('shared text goes to the box on Today, as any share does', async () => {
  const form = new FormData()
  form.set('title', 'SSC')
  form.set('text', 'SSC CGL 2026 notification out, last date 15 Nov')
  form.set('url', '')
  const { kept, open } = fakeCaches()
  const res = await receiveShare(new Request('https://cue.vitelio.in/share-file', { method: 'POST', body: form }), open)

  assert.equal(res.status, 303)
  const to = new URL(res.headers.get('location')!)
  assert.equal(to.pathname, '/share')
  assert.equal(to.searchParams.get('text'), 'SSC CGL 2026 notification out, last date 15 Nov')
  assert.equal(to.searchParams.get('title'), 'SSC')
  assert.equal(to.searchParams.has('url'), false, 'nothing empty passed on')
  assert.equal(kept.size, 0, 'nothing kept')
})
