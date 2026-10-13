import { Fragment, type ReactNode } from 'react'
import { HI } from './hi/index.ts'

/**
 * Cue's words in the language the person reads. English is the source: a
 * line is written in English where it is shown, wrapped in t(), and looked up
 * in the Hindi dictionary (lib/hi) for someone who chose Hindi in Settings. A
 * line with no Hindi yet shows in English, never blank; the test in
 * i18n.test.ts makes sure there is none.
 *
 *   t('Nothing planned')                      → 'कुछ तय नहीं'
 *   t('{n} plans today', { n: 3 })            → 'आज 3 प्लान'
 *   rich('Open <b>Settings</b>', { b: (s) => <strong>{s}</strong> })
 *
 * The language lives here rather than in a hook so that plain helpers — a
 * date formatter, a label table — can speak it too. AuthProvider sets it as
 * soon as it knows who is signed in, and the app shell is keyed on it, so a
 * change in Settings redraws everything.
 */

export type Lang = 'en' | 'hi'
export type Vars = Record<string, string | number>

const KEY = 'cue.language'

function stored(): Lang {
  try {
    const kept = localStorage.getItem(KEY)
    if (kept === 'hi' || kept === 'en') return kept
  } catch {
    // Nothing kept: the device decides.
  }
  return typeof navigator !== 'undefined' && /^hi\b/i.test(navigator.languages?.[0] ?? navigator.language ?? '') ? 'hi' : 'en'
}

// Remembered on the device, so the sign-in screen of someone who reads Hindi
// is in Hindi before Cue knows who they are; on a first visit, the device's
// own language.
let current: Lang = typeof localStorage === 'undefined' ? 'en' : stored()

/** The page's own lang, so screen readers and fonts treat Hindi as Hindi. */
function mark(lang: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}
mark(current)

export function setLanguage(next: Lang): void {
  if (next === current) return
  current = next
  mark(next)
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Private windows: only this visit is in Hindi.
  }
}

export function language(): Lang {
  return current
}

/** For toLocaleString and friends: Hindi day and month names, or the device's own. */
export function locale(): string | undefined {
  return current === 'hi' ? 'hi-IN' : undefined
}

function fill(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

/** An English line in the person's language, with {name} filled from vars. */
export function t(en: string, vars?: Vars): string {
  const said = current === 'hi' ? (HI[en] ?? en) : en
  return vars ? fill(said, vars) : said
}

/**
 * Marks an English line kept in a table or a constant, to be shown later
 * with t(label). Returns it as it is; it is only there so the test can see
 * the line needs Hindi.
 */
export function msg<T extends string>(en: T): T {
  return en
}

type Part = ReactNode | ((inner: string) => ReactNode)

/**
 * A line with markup in it, for when a link or bold word sits mid-sentence
 * and Hindi puts it somewhere else. <name>…</name> is drawn by parts.name
 * given the words inside; {name} is parts.name as it is.
 */
export function rich(en: string, parts: Record<string, Part>): ReactNode {
  const said = current === 'hi' ? (HI[en] ?? en) : en
  const words: Vars = {}
  for (const [name, part] of Object.entries(parts)) {
    if (typeof part === 'string' || typeof part === 'number') words[name] = part
  }
  const out: ReactNode[] = []
  const re = /<(\w+)>([\s\S]*?)<\/\1>|\{(\w+)\}/g
  let at = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(said))) {
    if (m.index > at) out.push(said.slice(at, m.index))
    const name = m[1] ?? m[3]!
    const part = parts[name]
    const inner = fill(m[2] ?? '', words)
    out.push(<Fragment key={out.length}>{typeof part === 'function' ? part(inner) : (part ?? m[0])}</Fragment>)
    at = re.lastIndex
  }
  if (at < said.length) out.push(said.slice(at))
  return <>{out}</>
}
