import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AREAS } from './hi/index.ts'
import { t } from './i18n.ts'

// What the server says in Hindi: every line handed to t(lang, …) or msg(…)
// has Hindi, with the same {placeholders}; no Hindi is left over; a line says
// the same in every area.

const SRC = dirname(fileURLToPath(import.meta.url))

function files(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return path === join(SRC, 'hi') ? [] : files(path)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

const unescape = (body: string) =>
  body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|[\s\S])/g, (_, e: string) =>
    e[0] === 'u' ? String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16)) : e === 'n' ? '\n' : e,
  )

const STRING = /'((?:\\[\s\S]|[^'\\])*)'|"((?:\\[\s\S]|[^"\\])*)"|`((?:\\[\s\S]|[^`\\$]|\$(?!\{))*)`/.source
const CALL = new RegExp(`(?<![\\w$.])(?:t\\(\\s*[^,()'"\`]+?,\\s*|msg\\(\\s*)(?:${STRING})`, 'g')

const used = new Map<string, string>()
for (const file of files()) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(CALL)) {
    const before = text.slice(text.lastIndexOf('\n', m.index) + 1, m.index).trim()
    if (/^(\*|\/\/|\/\*)/.test(before)) continue
    const en = unescape(m[1] ?? m[2] ?? m[3] ?? '')
    if (!used.has(en)) used.set(en, `${relative(SRC, file).replace(/\\/g, '/')}:${text.slice(0, m.index).split('\n').length}`)
  }
}

const defined = new Map<string, { area: string; hi: string }[]>()
for (const [area, words] of Object.entries(AREAS)) {
  for (const [en, hi] of Object.entries(words)) defined.set(en, [...(defined.get(en) ?? []), { area, hi }])
}
const marks = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[0]).sort().join(' ')

test('every line the server says has Hindi', () => {
  assert.deepEqual([...used].filter(([en]) => !defined.has(en)).map(([en, where]) => `${where} ${en}`), [])
})

test('Hindi keeps every {placeholder}', () => {
  const bad = [...defined].flatMap(([en, entries]) => entries.filter((e) => marks(e.hi) !== marks(en) || !e.hi.trim()).map((e) => `[${e.area}] ${en} → ${e.hi}`))
  assert.deepEqual(bad, [])
})

test('a line means the same in every area', () => {
  assert.deepEqual([...defined].filter(([, e]) => new Set(e.map((x) => x.hi)).size > 1).map(([en]) => en), [])
})

test('no Hindi is left over from a line that is gone', () => {
  assert.deepEqual([...defined.keys()].filter((en) => !used.has(en)), [])
})

test('t fills in the blanks, in either language', () => {
  assert.equal(t('en', 'Due {when}', { when: 'today' }), 'Due today')
  assert.equal(t('hi', 'A line with no Hindi yet'), 'A line with no Hindi yet')
})
