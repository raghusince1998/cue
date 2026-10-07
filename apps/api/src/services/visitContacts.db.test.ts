import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { and, eq, ilike } from 'drizzle-orm'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Naming somebody while logging a visit.
 *
 * The visit route inserted the named contact blindly, so logging two visits
 * with the same plumber left two plumbers — each holding half the details,
 * and neither findable as "the" one. Every other path that creates a person
 * had already learned to match first; this one had not.
 *
 * The route's logic is reproduced here against the real schema.
 */
let h: Harness
let me: Seeded
let other: Seeded
let dbm: typeof import('../db/index.ts')

before(async () => {
  h = await createTestDb('visitcontacts')
  process.env.DATABASE_URL = h.url
  dbm = await import('../db/index.ts')
  me = await seedUser(h.sql, 'visit@test.local')
  other = await seedUser(h.sql, 'notme@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from contacts`
})

/** Mirrors the newContact branch of POST /visits. */
async function nameSomeone(
  orgId: string,
  input: { name: string; role?: string | null; phone?: string | null },
  placeId: string | null = null,
): Promise<string> {
  const name = input.name.trim()
  const role = input.role?.trim() || null
  const phone = input.phone?.trim() || null

  const [existing] = await dbm.db
    .select({
      id: dbm.schema.contacts.id,
      role: dbm.schema.contacts.role,
      phone: dbm.schema.contacts.phone,
      placeId: dbm.schema.contacts.placeId,
    })
    .from(dbm.schema.contacts)
    .where(and(eq(dbm.schema.contacts.orgId, orgId), ilike(dbm.schema.contacts.name, name)))
    .limit(1)

  if (existing) {
    const fill = {
      ...(existing.role ? {} : role ? { role } : {}),
      ...(existing.phone ? {} : phone ? { phone } : {}),
      ...(existing.placeId ? {} : placeId ? { placeId } : {}),
    }
    if (Object.keys(fill).length > 0) {
      await dbm.db.update(dbm.schema.contacts).set(fill).where(eq(dbm.schema.contacts.id, existing.id))
    }
    return existing.id
  }

  const [made] = await dbm.db
    .insert(dbm.schema.contacts)
    .values({ orgId, placeId, name, role, phone })
    .returning({ id: dbm.schema.contacts.id })
  return made!.id
}

const countNamed = async (name: string, orgId = me.orgId) => {
  const [row] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from contacts where org_id = ${orgId} and lower(name) = lower(${name})`
  return row!.n
}

const look = async (name: string) => {
  const [row] = await h.sql<{ role: string | null; phone: string | null }[]>`
    select role, phone from contacts where org_id = ${me.orgId} and lower(name) = lower(${name})`
  return row
}

test('somebody new is created', async () => {
  await nameSomeone(me.orgId, { name: 'Ananya Deshpande', role: 'procurement lead' })
  assert.equal(await countNamed('Ananya Deshpande'), 1)
})

test('naming the same person twice does not make two of them', async () => {
  const first = await nameSomeone(me.orgId, { name: 'Suresh Kumar', role: 'plumber', phone: '+91 1' })
  const second = await nameSomeone(me.orgId, { name: 'Suresh Kumar', role: 'plumber', phone: '+91 1' })

  assert.equal(second, first)
  assert.equal(await countNamed('Suresh Kumar'), 1)
})

test('a second mention fills in what the first did not have', async () => {
  await nameSomeone(me.orgId, { name: 'Suresh Kumar', role: 'plumber' })
  await nameSomeone(me.orgId, { name: 'Suresh Kumar', phone: '+91 91234 56789' })

  const row = await look('Suresh Kumar')
  assert.equal(row!.role, 'plumber')
  assert.equal(row!.phone, '+91 91234 56789')
})

test('a detail already recorded is not replaced', async () => {
  await nameSomeone(me.orgId, { name: 'Suresh Kumar', phone: '+91 91234 56789' })
  await nameSomeone(me.orgId, { name: 'Suresh Kumar', phone: '+91 70000 00000' })

  // The first was entered deliberately; the second is whatever got typed today.
  assert.equal((await look('Suresh Kumar'))!.phone, '+91 91234 56789')
})

test('matching ignores case and surrounding space', async () => {
  await nameSomeone(me.orgId, { name: 'Suresh Kumar' })
  await nameSomeone(me.orgId, { name: '  suresh kumar  ' })
  assert.equal(await countNamed('Suresh Kumar'), 1)
})

test('two accounts may each have their own person of the same name', async () => {
  await nameSomeone(me.orgId, { name: 'Suresh Kumar', phone: '+91 1' })
  await nameSomeone(other.orgId, { name: 'Suresh Kumar', phone: '+91 2' })

  assert.equal(await countNamed('Suresh Kumar', me.orgId), 1)
  assert.equal(await countNamed('Suresh Kumar', other.orgId), 1)
  assert.equal((await look('Suresh Kumar'))!.phone, '+91 1', 'and they do not bleed into each other')
})
