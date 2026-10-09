import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { env } from '../src/env.ts'

/**
 * Plain forward-only SQL migrations, applied in filename order and recorded so
 * they run once.
 *
 * This exists because `drizzle-kit push` mis-diffs against PostgreSQL 18 — it
 * emits `alter column id drop not null` on primary keys, which Postgres
 * rejects with 42P16. Hand-written SQL also happens to be what you want on a
 * server, where silently reshaping a live table is not acceptable.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '../migrations')

const sql = postgres(env.databaseUrl, { max: 1 })

/**
 * Refuses to build a schema over a database with no migration history, unless
 * told it is new.
 *
 * On 9 October 2026 every table in production was dropped (by what is still
 * unknown) and the next deploy did not notice: it rebuilt all the tables,
 * empty, and only stopped on a leftover enum. Had that enum not been there,
 * it would have restarted the app on an empty database and reported success.
 * A wiped database and a brand-new one look the same from here, so telling
 * them apart is left to the person setting up a new database.
 */
async function assertHasHistory() {
  if (process.env.CUE_NEW_DATABASE === '1') return
  const [table] = await sql<{ found: boolean }[]>`
    select to_regclass('_migrations') is not null as found`
  const [history] = table?.found
    ? await sql<{ count: number }[]>`select count(*)::int as count from _migrations`
    : []
  if ((history?.count ?? 0) > 0) return

  console.error(
    [
      'This database has no record of any migration.',
      '',
      'Either it is brand new, or its tables were deleted. Stopping here rather',
      'than building empty tables over it and letting the app start on no data.',
      '',
      '  - Tables deleted? Restore the database from a backup first.',
      '  - Genuinely new? Run it once with CUE_NEW_DATABASE=1:',
      '      CUE_NEW_DATABASE=1 npm run db:migrate',
    ].join('\n'),
  )
  await sql.end()
  process.exit(1)
}

async function main() {
  await assertHasHistory()

  await sql`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `

  const applied = new Set(
    (await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name),
  )

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()

  let ran = 0
  for (const file of files) {
    if (applied.has(file)) continue

    const statements = await readFile(join(migrationsDir, file), 'utf8')

    // Each migration is one transaction: it either lands fully or not at all.
    await sql.begin(async (tx) => {
      await tx.unsafe(statements)
      await tx`insert into _migrations (name) values (${file})`
    })

    console.log(`applied ${file}`)
    ran += 1
  }

  console.log(ran === 0 ? 'already up to date' : `${ran} migration(s) applied`)
  await sql.end()
}

main().catch(async (err) => {
  console.error(err)
  await sql.end({ timeout: 1 })
  process.exit(1)
})
