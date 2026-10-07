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

async function main() {
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
