import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GREETING_OCCASIONS, OCCASION_MESSAGES, daysUntil, monthDayLabel, nextMonthDay } from './occasions.ts'
import { fillTemplate } from './templates.ts'

const ymd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null
const NOW = new Date(2026, 9, 11, 15, 0) // Sunday 11 October 2026, afternoon

test('the next birthday: today counts, a passed one is next year', () => {
  assert.equal(ymd(nextMonthDay('10-11', NOW)), '2026-10-11', 'today, even late in the day')
  assert.equal(ymd(nextMonthDay('11-08', NOW)), '2026-11-08')
  assert.equal(ymd(nextMonthDay('03-14', NOW)), '2027-03-14')
  assert.equal(daysUntil(nextMonthDay('10-11', NOW)!, NOW), 0)
  assert.equal(daysUntil(nextMonthDay('10-14', NOW)!, NOW), 3)
})

test('29 February is the 28th in other years; days that do not exist are refused', () => {
  assert.equal(ymd(nextMonthDay('02-29', NOW)), '2027-02-28')
  assert.equal(ymd(nextMonthDay('02-29', new Date(2028, 0, 5))), '2028-02-29')
  assert.equal(nextMonthDay('04-31', NOW), null)
  assert.equal(nextMonthDay('13-01', NOW), null)
  assert.equal(nextMonthDay('3-14', NOW), null)
})

test('labels and messages', () => {
  assert.equal(monthDayLabel('03-14'), '14 Mar')
  for (const o of GREETING_OCCASIONS.filter((x) => x.key !== 'custom')) {
    const text = fillTemplate(o.message, { name: 'Dr. Anil Mehta', me: 'Sid' })
    assert.ok(text.startsWith('Hi Dr. Mehta,') && text.endsWith('Sid'), o.label)
  }
  assert.ok(fillTemplate(OCCASION_MESSAGES.birthday, { name: 'Ravi Kumar' }).startsWith('Hi Ravi, wishing you'))
})
