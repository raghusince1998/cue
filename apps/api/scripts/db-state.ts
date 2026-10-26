import postgres from 'postgres'
import { env } from '../src/env.ts'

/**
 * Whether Cue's tables are in the database — for the rebuild workflow, which
 * only rebuilds a database that has lost them. Reads no one's data: only
 * whether the tables exist, and the names of any that are left. Prints one
 * line of JSON.
 */
const sql = postgres(env.databaseUrl, { max: 1, onnotice: () => {} })
try {
  const [row] = await sql<{ migrations: boolean; users: boolean; commitments: boolean }[]>`
    select
      to_regclass('_migrations') is not null as migrations,
      to_regclass('users') is not null as users,
      to_regclass('commitments') is not null as commitments`
  // What is left, by name only: after a wipe, often a note from whoever did it.
  const left = await sql<{ name: string }[]>`
    select table_name as name from information_schema.tables
    where table_schema = 'public' order by table_name limit 50`
  console.log(JSON.stringify({ ...row, tables: left.map((t) => t.name) }))
} finally {
  await sql.end({ timeout: 2 })
}
