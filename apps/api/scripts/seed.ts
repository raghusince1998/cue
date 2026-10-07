import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../src/db/index.ts'

/**
 * Creates a demo tenant with one place and one commitment that comes due in a
 * minute, so the reminder path can be exercised without waiting around.
 */
async function main() {
  const email = 'demo@cue.local'

  const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
  if (existing[0]) {
    console.log(`Demo user already exists: ${email} / demo1234`)
    process.exit(0)
  }

  const [org] = await db.insert(schema.orgs).values({ name: 'Vitelio (demo)' }).returning()
  if (!org) throw new Error('failed to create org')

  const [user] = await db
    .insert(schema.users)
    .values({
      orgId: org.id,
      name: 'Demo User',
      email,
      passwordHash: await bcrypt.hash('demo1234', 10),
    })
    .returning()
  if (!user) throw new Error('failed to create user')

  // Connaught Place, New Delhi — replace with somewhere near you to test the
  // "you are here" match on a real device.
  const [place] = await db
    .insert(schema.places)
    .values({
      orgId: org.id,
      name: 'Sunrise Skin Clinic (demo)',
      kind: 'clinic',
      lat: 28.6315,
      lng: 77.2167,
      radiusM: 200,
    })
    .returning()
  if (!place) throw new Error('failed to create place')

  const dueAt = new Date(Date.now() + 60_000)

  const [commitment] = await db
    .insert(schema.commitments)
    .values({
      orgId: org.id,
      userId: user.id,
      placeId: place.id,
      title: 'Call back Dr. Sharma about the demo slot',
      kind: 'callback',
      dueAt,
    })
    .returning()
  if (!commitment) throw new Error('failed to create commitment')

  await db.insert(schema.reminders).values({
    orgId: org.id,
    commitmentId: commitment.id,
    fireAt: dueAt,
    attempt: 0,
  })

  console.log('Seeded.')
  console.log(`  login: ${email} / demo1234`)
  console.log(`  a reminder fires at ${dueAt.toLocaleTimeString()} (about a minute from now)`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
