import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Money people owe you: a part of an expense comes off the company claim,
 * money lent stands alone, and both are listed by person until paid back.
 */
let h: Harness
let me: Seeded
let other: Seeded
let owed: typeof import('./owed.ts')
let expenses: typeof import('./expenses.ts')
let ravi: string

before(async () => {
  h = await createTestDb('owed')
  process.env.DATABASE_URL = h.url
  owed = await import('./owed.ts')
  expenses = await import('./expenses.ts')
  me = await seedUser(h.sql, 'owed@test.local')
  other = await seedUser(h.sql, 'owed-other@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from money_owed`
  await h.sql`delete from expenses`
  await h.sql`delete from contacts`
  const [c] = await h.sql<{ id: string }[]>`
    insert into contacts (org_id, name, organization, phone)
    values (${me.orgId}, 'Ravi Kumar', 'Infosys', '+91 99000 44556') returning id`
  ravi = c!.id
})

test('a split comes off the company claim, and a full share takes it off altogether', async () => {
  const cab = await expenses.createExpense(me.orgId, me.userId, { amountPaise: 90000, category: 'travel', note: 'cab to Infosys', spentOn: '2026-10-11' })
  const dinner = await expenses.createExpense(me.orgId, me.userId, { amountPaise: 120000, category: 'food', note: 'dinner', spentOn: '2026-10-12' })

  assert.equal(await owed.setShares(me.orgId, me.userId, cab.id, [{ contactId: ravi, amountPaise: 45000 }]), 'ok')
  assert.equal(await owed.setShares(me.orgId, me.userId, dinner.id, [{ personName: 'Priya', amountPaise: 120000 }]), 'ok')
  assert.equal(await owed.setShares(me.orgId, me.userId, cab.id, [{ contactId: ravi, amountPaise: 90001 }]), 'too_much')
  assert.equal(await owed.setShares(other.orgId, other.userId, cab.id, [{ personName: 'X', amountPaise: 100 }]), 'not_found')

  const after = await expenses.expenseById(me.userId, cab.id)
  assert.equal(after!.claimablePaise, 45000)
  assert.deepEqual(after!.shares.map((s) => [s.name, s.amountPaise, s.status]), [['Ravi Kumar', 45000, 'owed']])

  const toClaim = await expenses.unclaimed(me.userId)
  assert.deepEqual(toClaim.map((x) => [x.note, x.claimablePaise]), [['cab to Infosys', 45000]], 'dinner is Priya’s to pay back')

  const month = await expenses.expenseMonth(me.userId, '2026-10')
  assert.equal(month.totals.all, 210000, 'spent is what you paid')
  assert.equal(month.totals.unclaimed, 45000)
  assert.equal(month.totals.people, 165000)
})

test('by person, most first, until paid back', async () => {
  const cab = await expenses.createExpense(me.orgId, me.userId, { amountPaise: 90000, category: 'travel', note: 'cab to Infosys', spentOn: '2026-10-11' })
  await owed.setShares(me.orgId, me.userId, cab.id, [{ contactId: ravi, amountPaise: 45000 }])
  const lent = await owed.addOwed(me.orgId, me.userId, { contactId: ravi, amountPaise: 200000, note: ' concert tickets ' })
  await owed.addOwed(me.orgId, me.userId, { personName: ' Priya ', amountPaise: 30000 })
  assert.equal(await owed.addOwed(me.orgId, me.userId, { amountPaise: 100 }), null, 'someone has to owe it')
  await owed.addOwed(other.orgId, other.userId, { personName: 'Not mine', amountPaise: 5000 })

  const list = await owed.owedPeople(me.userId)
  assert.equal(list.totalPaise, 275000)
  assert.deepEqual(
    list.people.map((p) => [p.name, p.totalPaise, p.phone, p.items.length]),
    [
      ['Ravi Kumar', 245000, '+91 99000 44556', 2],
      ['Priya', 30000, null, 1],
    ],
  )
  const [first] = list.people[0]!.items
  assert.equal(first!.note, 'cab to Infosys', 'the expense says what for')
  assert.equal(first!.on, '2026-10-11')

  assert.equal(await owed.markAsked(me.userId, [lent!]), 1)
  assert.ok((await owed.owedPeople(me.userId)).people[0]!.lastAskedAt)

  assert.equal(await owed.setOwedStatus(other.userId, [lent!], 'paid'), 0, 'not someone else’s to settle')
  assert.equal(await owed.setOwedStatus(me.userId, [lent!], 'paid'), 1)
  const now = await owed.owedPeople(me.userId)
  assert.equal(now.totalPaise, 75000)
  assert.equal(now.paidRecentlyPaise, 200000)

  // A paid share stays when the rest are changed.
  const [share] = (await expenses.expenseById(me.userId, cab.id))!.shares
  await owed.setOwedStatus(me.userId, [share!.id], 'paid')
  await owed.setShares(me.orgId, me.userId, cab.id, [{ personName: 'Sneha', amountPaise: 20000 }])
  assert.deepEqual(
    (await expenses.expenseById(me.userId, cab.id))!.shares.map((s) => [s.name, s.status]),
    [['Ravi Kumar', 'paid'], ['Sneha', 'owed']],
  )
  assert.equal(await owed.setShares(me.orgId, me.userId, cab.id, [{ personName: 'Sneha', amountPaise: 45001 }]), 'too_much', 'with what is paid')
})

test('a deleted contact still owes you; a deleted expense takes its shares with it', async () => {
  const cab = await expenses.createExpense(me.orgId, me.userId, { amountPaise: 90000, category: 'travel', spentOn: '2026-10-11' })
  await owed.setShares(me.orgId, me.userId, cab.id, [{ personName: 'Priya', amountPaise: 30000 }])
  await owed.addOwed(me.orgId, me.userId, { contactId: ravi, amountPaise: 50000 })

  await h.sql`delete from contacts where id = ${ravi}`
  await expenses.deleteExpense(me.userId, cab.id)
  const list = await owed.owedPeople(me.userId)
  assert.deepEqual(list.people.map((p) => [p.name, p.contactId, p.totalPaise]), [['Ravi Kumar', null, 50000]])
})
