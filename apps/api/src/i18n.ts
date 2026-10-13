import { eq, inArray } from 'drizzle-orm'
import type { Lang } from '@cue/shared'
import { db, schema } from './db/index.ts'
import type { Executor } from './db/util.ts'
import { HI } from './hi/index.ts'

/**
 * What Cue says from the server — reminders, the morning brief, what quick
 * add understood — in the language each person reads. English is the source,
 * as on the web: t(lang, 'Bill due today') looks the line up in hi/ for
 * someone who chose Hindi, and a line not there yet goes out in English. The
 * test in i18n.test.ts checks every line has its Hindi.
 */

export type Vars = Record<string, string | number>

function fill(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

export function t(lang: Lang, en: string, vars?: Vars): string {
  const said = lang === 'hi' ? (HI[en] ?? en) : en
  return vars ? fill(said, vars) : said
}

/** Marks an English line kept in a table, said later with t(lang, line). */
export function msg<T extends string>(en: T): T {
  return en
}

/** For toLocaleString: Hindi day and month names, or Indian English. */
export function localeOf(lang: Lang): 'hi-IN' | 'en-IN' {
  return lang === 'hi' ? 'hi-IN' : 'en-IN'
}

/** The language a person reads Cue in. */
export async function langOf(userId: string, exec: Executor = db): Promise<Lang> {
  const [u] = await exec.select({ language: schema.users.language }).from(schema.users).where(eq(schema.users.id, userId))
  return u?.language === 'hi' ? 'hi' : 'en'
}

/** The same for many people at once, for the jobs that write to everyone. */
export async function langsOf(userIds: string[], exec: Executor = db): Promise<Map<string, Lang>> {
  const out = new Map<string, Lang>()
  if (!userIds.length) return out
  const rows = await exec
    .select({ id: schema.users.id, language: schema.users.language })
    .from(schema.users)
    .where(inArray(schema.users.id, [...new Set(userIds)]))
  for (const r of rows) out.set(r.id, r.language === 'hi' ? 'hi' : 'en')
  return out
}
