/**
 * A very small IndexedDB wrapper. localStorage cannot hold audio Blobs and is
 * synchronous, so the outbox needs the real thing — but only these few
 * operations, which is not worth a dependency.
 */

/**
 * Still the old name on purpose. The database holds the offline outbox — visits
 * and voice notes captured with no signal and not yet sent. Renaming it opens a
 * different, empty database, orphaning anything queued on a phone that has not
 * synced since the last update. Nothing would error; the work would just be
 * gone. Not worth matching the app's name.
 */
const DB_NAME = 'recall'
const DB_VERSION = 1

export const STORE_OUTBOX = 'outbox'
export const STORE_CACHE = 'cache'

let handle: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (handle) return handle

  handle = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' })
      }
      // Reference data (places, contacts) keyed by a plain string name.
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'))
  })

  return handle
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const request = work(tx.objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
}

export function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
  return run(store, 'readwrite', (s) =>
    key === undefined ? s.put(value) : s.put(value, key),
  )
}

export function idbDelete(store: string, key: IDBValidKey): Promise<undefined> {
  return run(store, 'readwrite', (s) => s.delete(key))
}

export function idbSupported(): boolean {
  return typeof indexedDB !== 'undefined'
}
