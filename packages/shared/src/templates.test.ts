import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillTemplate, STARTER_TEMPLATES } from './templates.ts'

test('filled in for the person, addressed the way they are addressed', () => {
  const body = 'Hi {first}, good to meet you at {company} today.\n\nRegards,\n{me}'
  assert.equal(
    fillTemplate(body, { name: 'Dr. Anil Mehta', company: 'Mehta Physio Clinic', me: 'Sid Rao' }),
    'Hi Dr. Mehta, good to meet you at Mehta Physio Clinic today.\n\nRegards,\nSid Rao',
  )
  assert.equal(fillTemplate('Dear {name},', { name: '  Ravi   Kumar ' }), 'Dear Ravi Kumar,')
  assert.equal(fillTemplate('Hi {FIRST}!', { name: 'Ravi Kumar' }), 'Hi Ravi!', 'tokens ignore case')
})

test('what is not known leaves no gap behind', () => {
  assert.equal(fillTemplate('Hi {first}, thanks.', {}), 'Hi, thanks.')
  assert.equal(fillTemplate('Good to see the team at {company} again.', {}), 'Good to see the team at again.')
  assert.equal(fillTemplate('Thanks,\n{me}', {}), 'Thanks,\n')
  // Something that only looks like a field is left alone.
  assert.equal(fillTemplate('Use {code} at checkout', { name: 'Ravi' }), 'Use {code} at checkout')
})

test('every starter fills in cleanly', () => {
  for (const t of STARTER_TEMPLATES) {
    const out = fillTemplate(t.body, { name: 'Priya Shah', company: 'Infosys', me: 'Sid' })
    assert.ok(!/\{[a-z]+\}/i.test(out), `${t.title} left a field unfilled`)
    assert.ok(out.startsWith('Hi Priya,'), t.title)
  }
})
