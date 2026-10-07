import type { db } from './index.ts'

export type Db = typeof db
/** Either the pool or an open transaction — lets services compose either way. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

export function takeFirst<T>(rows: T[], what = 'row'): T {
  const row = rows[0]
  if (!row) throw new Error(`expected a ${what} but got none`)
  return row
}
