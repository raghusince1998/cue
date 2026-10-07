import { randomBytes } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import postgres from 'postgres'
import { applyAppTimezone } from '../timezone.ts'

/**
 * A throwaway schema for the API tests.
 *
 * Deliberately a real PostgreSQL instance rather than a mock or an in-memory
 * stand-in. Every API bug found by hand in this project lived in the layer a
 * mock would have faked away: a unique index that collided, a check constraint
 * that fired, a cascade that did or did not reach. Testing against anything
 * but the real schema would have caught none of them.
 *
 * A schema rather than a separate database, because creating a database needs
 * the CREATEDB privilege and the application's own role has no reason to hold
 * it. Tests should run with the permissions the app already has, not require
 * the developer to widen them.
 */

const here = dirname(fileURLToPath(import.meta.url))
const apiRoot = resolve(here, '../..')
const migrationsDir = resolve(apiRoot, 'migrations')

// The same .env the app reads. Loaded here rather than relying on env.ts,
// because the harness needs the connection details before any app module is
// imported — importing env.ts first would build the pool against the wrong
// schema and there would be no way back.
config({ path: resolve(apiRoot, '../../.env') })

// The same zone the server uses, applied before any test file evaluates. Test
// files build dates at their top level — `const NOW = new Date(2026, 9, 5, 8)`
// — and import the service under test later. Without this, a process that
// starts in UTC (CI does, as EC2 does) builds those dates in UTC and then the
// service, once env.ts has switched the zone, reads them five and a half hours
// out. A laptop in India starts in the right zone, which is how it hid.
applyAppTimezone()

/** Same database, but every table lands in an isolated schema. */
function urlFor(schema: string): string {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL must be set to run the API tests.')
  const url = new URL(base)
  // A libpq startup option, which postgres.js passes through: every statement
  // on this connection resolves unqualified names inside the test schema.
  url.searchParams.set('options', `-c search_path=${schema}`)
  return url.toString()
}

export interface Harness {
  sql: postgres.Sql
  url: string
  schema: string
  /** Drops everything this run created, and lets the process exit. */
  close: () => Promise<void>
}

/**
 * Shuts the application's own pool.
 *
 * db/index.ts opens connections at import time and nothing in the app ever
 * closes them, because a server is meant to hold them for its lifetime. In a
 * test that means the process hangs after the last assertion, with the runner
 * waiting on an event loop that will never drain.
 */
async function closeAppPool(): Promise<void> {
  try {
    const mod = await import('../db/index.ts')
    await (mod.db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  } catch {
    // This file's tests never imported it; nothing to close.
  }
}

/** Applies the real migrations, in order, into the current search_path. */
async function migrate(sql: postgres.Sql): Promise<void> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    await sql.unsafe(await readFile(join(migrationsDir, file), 'utf8'))
  }
}

/** Unique to this process, so no other run can mistake our schemas for litter. */
const RUN_ID = randomBytes(4).toString('hex')

/**
 * Old enough that nothing could still be using it. Deliberately generous: the
 * cost of waiting is a dead schema sitting around, and the cost of being wrong
 * is deleting the tables out from under a test that is still running.
 */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000

/** Anything before this is not a timestamp, whatever it parses to. */
const PLAUSIBLE_FROM = Date.UTC(2024, 0, 1)

/**
 * Clears schemas left behind by runs that never finished.
 *
 * The cleanup lives in an `after` hook, which a Ctrl-C or a timeout never
 * reaches, so an interrupted run leaves a full copy of the schema behind.
 *
 * Staleness is judged by **age**, not by whether a process id still exists.
 * The process check was right for exactly one machine and silently wrong for
 * two: a CI runner and a laptop sharing a database have unrelated process ids,
 * so each would look at the other's schema, find no such process locally,
 * conclude it was abandoned, and drop it halfway through a live test run. The
 * failure that produces reads as a flaky test, which is the worst way to spend
 * an afternoon.
 */
async function dropStaleSchemas(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ name: string }[]>`
    select schema_name as name from information_schema.schemata
    where schema_name like 'test\_%'`

  const now = Date.now()

  for (const { name } of rows) {
    const parts = name.split('_')
    if (parts.at(-1) === RUN_ID) continue // ours

    const created = Number.parseInt(parts.at(-2) ?? '', 36)
    // A name this does not understand is left alone. Being unable to prove
    // something is litter is not evidence that it is.
    if (!Number.isFinite(created) || created < PLAUSIBLE_FROM || created > now + 86_400_000) {
      continue
    }
    if (now - created < STALE_AFTER_MS) continue

    await sql.unsafe(`drop schema if exists "${name}" cascade`)
  }
}

/**
 * One schema per test file, named after it, so files can run concurrently
 * without dropping each other's tables halfway through.
 */
export async function createTestDb(label: string): Promise<Harness> {
  // Timestamp then run id: the first says when it may be cleaned up, the
  // second says whose it is. Both are needed once more than one machine can
  // point at the same database.
  const stamp = Date.now().toString(36)
  const schema = `test_${label}_${stamp}_${RUN_ID}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')

  // Identifiers cannot be parameterised, hence unsafe; `schema` is built here
  // from a fixed alphabet, never from anything a user supplies.
  const setup = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
  await dropStaleSchemas(setup)
  await setup.unsafe(`drop schema if exists "${schema}" cascade`)
  await setup.unsafe(`create schema "${schema}"`)
  await setup.end()

  const url = urlFor(schema)
  const sql = postgres(url, { max: 4 })
  await migrate(sql)

  return {
    sql,
    url,
    schema,
    close: async () => {
      await closeAppPool()
      await sql.end()
      const cleanup = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} })
      await cleanup.unsafe(`drop schema if exists "${schema}" cascade`)
      await cleanup.end()
    },
  }
}

export interface Seeded {
  orgId: string
  userId: string
}

/** The minimum a commitment needs to exist: an org and a user. */
export async function seedUser(sql: postgres.Sql, email = 'test@example.com'): Promise<Seeded> {
  const [org] = await sql<{ id: string }[]>`
    insert into orgs (name) values ('Test org') returning id`
  const [user] = await sql<{ id: string }[]>`
    insert into users (org_id, name, email, password_hash)
    values (${org!.id}, 'Test', ${email}, 'x') returning id`
  return { orgId: org!.id, userId: user!.id }
}
