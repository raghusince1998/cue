import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { and, eq, ilike } from 'drizzle-orm'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Taking people off the phone.
 *
 * The valuable half is matching rather than inserting: anyone named in a
 * sentence already became a contact here with no phone number, which is
 * exactly why the Call button never appeared. Importing the same person has to
 * fill that gap in rather than sit a duplicate beside it — and must never
 * overwrite a number somebody typed deliberately with an old landline the
 * phone has not forgotten.
 *
 * The route's logic is reproduced here against the real schema; the picker
 * itself is browser-only and cannot be exercised from Node.
 */
let h: Harness
let me: Seeded
let other: Seeded
let dbm: typeof import('../db/index.ts')

before(async () => {
  h = await createTestDb('contactimport')
  process.env.DATABASE_URL = h.url
  dbm = await import('../db/index.ts')
  me = await seedUser(h.sql, 'import@test.local')
  other = await seedUser(h.sql, 'notme@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from contacts`
})

interface Picked {
  name: string
  phone?: string | null
  email?: string | null
}

/** Mirrors POST /contacts/import. */
async function importContacts(orgId: string, picked: Picked[]) {
  let added = 0
  let updated = 0
  let unchanged = 0

  for (const p of picked) {
    const name = p.name.trim()
    const [existing] = await dbm.db
      .select({
        id: dbm.schema.contacts.id,
        phone: dbm.schema.contacts.phone,
        email: dbm.schema.contacts.email,
      })
      .from(dbm.schema.contacts)
      .where(and(eq(dbm.schema.contacts.orgId, orgId), ilike(dbm.schema.contacts.name, name)))
      .limit(1)

    if (!existing) {
      await dbm.db
        .insert(dbm.schema.contacts)
        .values({ orgId, name, phone: p.phone ?? null, email: p.email ?? null })
      added += 1
      continue
    }

    const fill = {
      ...(existing.phone ? {} : { phone: p.phone ?? null }),
      ...(existing.email ? {} : { email: p.email ?? null }),
    }
    if (Object.values(fill).filter(Boolean).length === 0) {
      unchanged += 1
      continue
    }
    await dbm.db
      .update(dbm.schema.contacts)
      .set(fill)
      .where(eq(dbm.schema.contacts.id, existing.id))
    updated += 1
  }
  return { added, updated, unchanged }
}

async function seed(name: string, phone: string | null, orgId = me.orgId, role: string | null = null) {
  await h.sql`insert into contacts (org_id, name, phone, role) values (${orgId}, ${name}, ${phone}, ${role})`
}

const look = async (name: string) => {
  const [row] = await h.sql<{ phone: string | null; email: string | null }[]>`
    select phone, email from contacts where org_id = ${me.orgId} and lower(name) = lower(${name})`
  return row
}

const countNamed = async (name: string) => {
  const [row] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from contacts where org_id = ${me.orgId} and lower(name) = lower(${name})`
  return row!.n
}

test('somebody new is added', async () => {
  const r = await importContacts(me.orgId, [{ name: 'Priya Sharma', phone: '+91 98888 22222' }])
  assert.deepEqual(r, { added: 1, updated: 0, unchanged: 0 })
  assert.equal((await look('Priya Sharma'))!.phone, '+91 98888 22222')
})

test('an auto-created contact gets its number filled in, not a twin', async () => {
  // Exactly the case that made the Call button useless.
  await seed('dentist', null, me.orgId, 'dentist')

  const r = await importContacts(me.orgId, [{ name: 'dentist', phone: '+91 90000 11111' }])
  assert.deepEqual(r, { added: 0, updated: 1, unchanged: 0 })
  assert.equal(await countNamed('dentist'), 1)
  assert.equal((await look('dentist'))!.phone, '+91 90000 11111')
})

test('a number already there is never overwritten', async () => {
  // The one here was typed deliberately; the phone's may be an old landline.
  await seed('Ramesh Yadav', '+91 98765 43210')

  const r = await importContacts(me.orgId, [{ name: 'Ramesh Yadav', phone: '+91 70000 00000' }])
  assert.deepEqual(r, { added: 0, updated: 0, unchanged: 1 })
  assert.equal((await look('Ramesh Yadav'))!.phone, '+91 98765 43210')
})

test('an email can fill in even when the number is already known', async () => {
  await seed('Ramesh Yadav', '+91 98765 43210')

  const r = await importContacts(me.orgId, [
    { name: 'Ramesh Yadav', phone: '+91 70000 00000', email: 'ramesh@example.com' },
  ])
  assert.equal(r.updated, 1)
  const row = await look('Ramesh Yadav')
  assert.equal(row!.phone, '+91 98765 43210', 'still not overwritten')
  assert.equal(row!.email, 'ramesh@example.com')
})

test('matching ignores case', async () => {
  await seed('ramesh yadav', null)
  const r = await importContacts(me.orgId, [{ name: 'Ramesh Yadav', phone: '+91 1' }])
  assert.equal(r.updated, 1)
  assert.equal(await countNamed('ramesh yadav'), 1)
})

test('importing the same list twice changes nothing the second time', async () => {
  const list = [{ name: 'Priya Sharma', phone: '+91 98888 22222' }]
  await importContacts(me.orgId, list)
  const again = await importContacts(me.orgId, list)

  assert.deepEqual(again, { added: 0, updated: 0, unchanged: 1 })
  assert.equal(await countNamed('Priya Sharma'), 1)
})

test('a contact in another account is not matched or touched', async () => {
  await seed('Priya Sharma', '+91 55555 55555', other.orgId)

  const r = await importContacts(me.orgId, [{ name: 'Priya Sharma', phone: '+91 98888 22222' }])
  assert.equal(r.added, 1, 'it belongs to someone else, so this is a new person here')

  const [theirs] = await h.sql<{ phone: string }[]>`
    select phone from contacts where org_id = ${other.orgId} and name = 'Priya Sharma'`
  assert.equal(theirs!.phone, '+91 55555 55555', 'and theirs is untouched')
})

test('a picked contact with no number at all still lands', async () => {
  const r = await importContacts(me.orgId, [{ name: 'Someone', phone: null }])
  assert.equal(r.added, 1)
  assert.equal((await look('Someone'))!.phone, null)
})
