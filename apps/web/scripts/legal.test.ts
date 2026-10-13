import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The privacy policy and the terms are written twice, in English and Hindi.
// A section or a point added to one and not the other would leave Hindi
// readers agreeing to something they were never shown: each pair must have
// the same headings, points, links, emails and permission names.

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'pages', 'LegalText.tsx'), 'utf8')

function body(name: string): string {
  const start = source.indexOf(`export function ${name}()`)
  assert.ok(start >= 0, `${name} is in LegalText.tsx`)
  const next = source.indexOf('export function ', start + 1)
  return source.slice(start, next < 0 ? undefined : next)
}

function shape(text: string) {
  const count = (re: RegExp) => (text.match(re) ?? []).length
  return {
    headings: count(/<h2[ >]/g),
    points: count(/<li>/g),
    paragraphs: count(/<p[ >]/g),
    links: count(/<Link |<a /g),
    emails: count(/\{mail\}/g),
    googlePolicy: count(/\{googlePolicy\}/g),
    permissions: [...text.matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1]),
    anchors: [...text.matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
  }
}

for (const [en, hi] of [
  ['PrivacyEn', 'PrivacyHi'],
  ['TermsEn', 'TermsHi'],
] as const) {
  test(`${hi} says what ${en} says, part for part`, () => {
    assert.deepEqual(shape(body(hi)), shape(body(en)))
  })
}

test('the Hindi is Hindi', () => {
  for (const name of ['PrivacyHi', 'TermsHi']) {
    const words = body(name).match(/[ऀ-ॿ]+/g) ?? []
    assert.ok(words.length > 50, `${name} is written in Devanagari`)
  }
})
