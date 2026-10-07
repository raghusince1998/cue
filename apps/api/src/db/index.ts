import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.ts'
import * as schema from './schema.ts'

const client = postgres(env.databaseUrl, { max: 10 })

export const db = drizzle(client, { schema })
export { schema }
export type Db = typeof db
