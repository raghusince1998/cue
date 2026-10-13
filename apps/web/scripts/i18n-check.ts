/**
 * Checks Cue's Hindi against the screens. Every line the web app shows
 * through t(), msg() or rich() needs a Hindi entry in src/lib/hi, with the
 * same {placeholders} and <tags>; no entry may go unused; and a line that is
 * in two areas must say the same in both.
 *
 *   npx tsx apps/web/scripts/i18n-check.ts                  everything
 *   npx tsx apps/web/scripts/i18n-check.ts src/pages/Bills.tsx …   these files only
 *   npx tsx apps/web/scripts/i18n-check.ts --leftovers src/pages/Bills.tsx
 *       English that looks shown but is not wrapped yet (a heuristic)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AREAS } from '../src/lib/hi/index.ts'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(WEB, 'src')

function sourceFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (path !== join(SRC, 'lib', 'hi')) out.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path)
    }
  }
  return out
}

function unescape(body: string): string {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, e: string) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16))
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16))
    return e === 'n' ? '\n' : e === 't' ? '\t' : e
  })
}

/** The English lines a file hands to t(), msg() or rich(), with their line numbers. */
export function linesIn(file: string): { en: string; line: number }[] {
  const text = readFileSync(file, 'utf8')
  const out: { en: string; line: number }[] = []
  const re = /(?<![\w$.])(?:t|msg|rich)\(\s*(?:'((?:\\[\s\S]|[^'\\])*)'|"((?:\\[\s\S]|[^"\\])*)"|`((?:\\[\s\S]|[^`\\$]|\$(?!\{))*)`)/g
  for (const m of text.matchAll(re)) {
    // Not in comments: the examples in i18n.tsx are not lines anyone sees.
    const before = text.slice(text.lastIndexOf('\n', m.index) + 1, m.index).trim()
    if (/^(\*|\/\/|\/\*)/.test(before)) continue
    const body = m[1] ?? m[2] ?? m[3] ?? ''
    out.push({ en: unescape(body), line: text.slice(0, m.index).split('\n').length })
  }
  return out
}

/** Every string literal in packages/shared's code. */
function sharedLines(): Set<string> {
  const dir = resolve(WEB, '..', '..', 'packages', 'shared', 'src')
  const out = new Set<string>()
  for (const name of readdirSync(dir)) {
    if (!/\.ts$/.test(name) || /\.test\.ts$|\.samples\.ts$/.test(name)) continue
    const text = readFileSync(join(dir, name), 'utf8')
    for (const m of text.matchAll(/'((?:\\[\s\S]|[^'\\\n])*)'|"((?:\\[\s\S]|[^"\\\n])*)"/g)) out.add(unescape(m[1] ?? m[2] ?? ''))
  }
  return out
}

const marks = (s: string) =>
  [...s.matchAll(/\{(\w+)\}|<\/?(\w+)>/g)].map((m) => m[0]).sort().join(' ')

export interface Report {
  missing: { en: string; where: string }[]
  unused: { en: string; area: string }[]
  conflicts: { en: string; areas: string[] }[]
  mismatched: { en: string; hi: string; area: string }[]
}

export function check(files?: string[]): Report {
  const all = sourceFiles()
  const used = new Map<string, string>()
  for (const file of all) {
    for (const { en, line } of linesIn(file)) {
      if (!used.has(en)) used.set(en, `${relative(WEB, file).replace(/\\/g, '/')}:${line}`)
    }
  }

  const defined = new Map<string, { area: string; hi: string }[]>()
  for (const [area, words] of Object.entries(AREAS)) {
    for (const [en, hi] of Object.entries(words)) {
      defined.set(en, [...(defined.get(en) ?? []), { area, hi }])
    }
  }

  const only = files?.map((f) => resolve(WEB, f))
  const wanted = only
    ? new Map(only.flatMap((f) => linesIn(f).map(({ en, line }) => [en, `${relative(WEB, f).replace(/\\/g, '/')}:${line}`] as const)))
    : used

  // Labels shown from @cue/shared's own tables (what Cue is used for, a
  // tracker's stages) reach t() as variables: a line written in shared counts.
  const shared = sharedLines()

  const report: Report = { missing: [], unused: [], conflicts: [], mismatched: [] }
  for (const [en, where] of wanted) {
    if (!defined.has(en)) report.missing.push({ en, where })
  }
  for (const [en, entries] of defined) {
    if (!only && !used.has(en) && !shared.has(en)) report.unused.push({ en, area: entries[0]!.area })
    if (new Set(entries.map((e) => e.hi)).size > 1) report.conflicts.push({ en, areas: entries.map((e) => e.area) })
    for (const { area, hi } of entries) {
      if ((!only || wanted.has(en)) && (marks(en) !== marks(hi) || !hi.trim())) report.mismatched.push({ en, hi, area })
    }
  }
  return report
}

/** English that looks like it is shown and is not wrapped: text between tags, and the usual attributes. */
export function leftovers(file: string): string[] {
  const out: string[] = []
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('{/*')) return
    const jsxText = /^[^<>{}=()'"`]*[A-Za-z]{2,}[^<>{}=]*$/.test(trimmed) && !/^(import|export|const|let|return|if|else|function|type|interface|case|default|\}|\)|\]|[\w.]+\(|[\w.]+ =|\.\.\.)/.test(trimmed) && !/[;:]$/.test(trimmed)
    const between = />\s*[A-Za-z][^<>{}]*[a-z][^<>{}]*</.test(line)
    const attr = /\b(?:placeholder|title|aria-label|alt|label)=["'][^"']*[A-Za-z]{2,}/.test(line)
    if (jsxText || between || attr) out.push(`${i + 1}: ${trimmed}`)
  })
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args[0] === '--leftovers') {
    for (const f of args.slice(1)) {
      const found = leftovers(resolve(WEB, f))
      if (found.length) console.log(`\n${f}\n  ${found.join('\n  ')}`)
    }
  } else {
    const r = check(args.length ? args : undefined)
    for (const m of r.missing) console.log(`missing   ${m.where}  ${JSON.stringify(m.en)}`)
    for (const m of r.mismatched) console.log(`mismatch  [${m.area}] ${JSON.stringify(m.en)} → ${JSON.stringify(m.hi)}`)
    for (const c of r.conflicts) console.log(`conflict  ${JSON.stringify(c.en)} in ${c.areas.join(', ')}`)
    for (const u of r.unused) console.log(`unused    [${u.area}] ${JSON.stringify(u.en)}`)
    const bad = r.missing.length + r.mismatched.length + r.conflicts.length + r.unused.length
    console.log(bad ? `\n${bad} to fix` : 'All Hindi in place.')
    process.exitCode = bad ? 1 : 0
  }
}
