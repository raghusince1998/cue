import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Whose birthday or anniversary is coming, said where it will be seen, and
 * festival greetings that reach everyone once and count as being in touch.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./occasions.ts')
let insights: typeof import('./insights.ts')
let brief: typeof import('./morningBrief.ts')

before(async () => {
  h = await createTestDb('occasions')
  process.env.DATABASE_URL = h.url
  svc = await import('./occasions.ts')
  insights = await import('./insights.ts')
  brief = await import('./morningBrief.ts')
  me = await seedUser(h.sql, 'occasions@test.local')
  other = await seedUser(h.sql, 'elsewhere@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from greeting_runs`
  await h.sql`delete from contacts`
})

/** Sunday 11 October 2026, 9 in the morning. */
const NOW = new Date(2026, 9, 11, 9, 0)

async function person(
  name: string,
  opts: { birthday?: string; anniversary?: string; organization?: string; who?: Seeded } = {},
): Promise<string> {
  const who = opts.who ?? me
  const [row] = await h.sql<{ id: string }[]>`
    insert into contacts (org_id, name, birthday, anniversary, organization, phone)
    values (${who.orgId}, ${name}, ${opts.birthday ?? null}, ${opts.anniversary ?? null}, ${opts.organization ?? null}, '9820011223')
    returning id`
  return row!.id
}

test('what is coming, soonest first, and nothing past the window', async () => {
  const mehta = await person('Dr. Anil Mehta', { birthday: '10-11', organization: 'Mehta Physio Clinic' })
  const ravi = await person('Ravi Kumar', { anniversary: '10-12' })
  await person('Priya Shah', { birthday: '10-14' })
  await person('Sneha Kulkarni', { birthday: '11-25' })
  await person('Old Friend', { birthday: '10-10' }) // yesterday: next year

  const soon = await svc.upcomingOccasions(me.orgId, 30, NOW)
  assert.deepEqual(
    soon.map((o) => [o.name, o.kind, o.daysAway]),
    [
      ['Dr. Anil Mehta', 'birthday', 0],
      ['Ravi Kumar', 'anniversary', 1],
      ['Priya Shah', 'birthday', 3],
    ],
  )

  const cards = await insights.buildInsights(me.userId, NOW)
  const today = cards.find((c) => c.id.startsWith(`occasion-${mehta}`))!
  assert.equal(today.headline, "Dr. Anil Mehta's birthday today")
  assert.deepEqual(today.action, { label: 'Send wishes', href: `/people?wish=${mehta}&for=birthday` })
  assert.ok(cards.some((c) => c.id.startsWith(`occasion-${ravi}`) && c.headline.endsWith('tomorrow')))

  const stats = await brief.briefStats(me.userId, 'Asia/Kolkata', NOW)
  assert.deepEqual(stats.occasions, ["Dr. Anil Mehta's birthday"])
  assert.match(brief.composeBrief(stats, 'Asia/Kolkata')!.body, /Today: Dr\. Anil Mehta's birthday\./)
})

test('a round of greetings reaches each person once, and counts as being in touch', async () => {
  const a = await person('Dr. Anil Mehta')
  const b = await person('Ravi Kumar')
  const theirs = await person('Not mine', { who: other })

  const run = await svc.startGreetings(me.orgId, me.userId, {
    occasion: 'Diwali',
    message: 'Hi {first}, happy Diwali!',
    contactIds: [a, b, a, theirs],
  })
  assert.deepEqual(run!.contactIds, [a, b], 'once each, and only people of this org')

  assert.equal(await svc.markGreeted(me.userId, run!.id, a), true)
  assert.equal(await svc.markGreeted(me.userId, run!.id, a), true, 'twice is still once')
  assert.equal(await svc.markGreeted(me.userId, run!.id, theirs), false)
  assert.equal(await svc.markGreeted(other.userId, run!.id, b), false, 'not their round')

  const detail = await svc.greetingRun(me.userId, run!.id)
  assert.deepEqual(detail!.people.map((p) => [p.name, p.sentAt !== null]), [
    ['Dr. Anil Mehta', true],
    ['Ravi Kumar', false],
  ])
  const [touched] = await h.sql`select last_contacted_at from contacts where id = ${a}`
  assert.ok(touched!.last_contacted_at, 'a greeting is contact')

  const [listed] = await svc.greetingRuns(me.userId)
  assert.deepEqual({ occasion: listed!.occasion, sent: listed!.sent, total: listed!.total }, { occasion: 'Diwali', sent: 1, total: 2 })
  assert.equal(await svc.greetingRun(other.userId, run!.id), null)
})
