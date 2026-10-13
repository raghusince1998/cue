import { test } from 'node:test'
import assert from 'node:assert/strict'
import { examplesFor, hasClients, hasWork, sectionsFor, tabsFor, type Section } from './uses.ts'

const ALL: Section[] = ['people', 'history', 'trips', 'repeating', 'expenses', 'jobs', 'hiring', 'deals', 'bills']
const TODAY: Section[] = ['people', 'history', 'trips', 'repeating', 'expenses']

test('tabs lead with what each use needs, taking turns between uses', () => {
  assert.deepEqual(tabsFor(['job_search'], ALL).main, ['jobs', 'people', 'history', 'repeating'])
  assert.deepEqual(tabsFor(['job_search', 'personal'], ALL).main, ['jobs', 'bills', 'people', 'history'])
  assert.deepEqual(tabsFor(['hiring'], ALL).main, ['hiring', 'people', 'repeating', 'history'])
  assert.deepEqual(tabsFor(['sales'], ALL).main, ['people', 'deals', 'expenses', 'trips'])
})

test('jobs, hiring and deals only for those who said so, or have something in them', () => {
  const homeOnly = tabsFor(['personal'], ALL)
  assert.deepEqual([...homeOnly.main, ...homeOnly.more].filter((s) => s === 'jobs' || s === 'hiring' || s === 'deals'), [])
  assert.deepEqual(sectionsFor([], ALL), ['people', 'history', 'trips', 'repeating', 'expenses', 'bills'], 'not said yet: none of them')
  assert.ok(tabsFor(['job_search'], ALL).main.includes('jobs'))
  assert.ok(!tabsFor(['job_search'], ALL).more.includes('deals'), 'a job seeker has no deals')
  assert.ok(tabsFor(['hiring'], ALL).main.includes('hiring'))
  assert.ok(tabsFor(['freelance'], ALL).main.includes('deals'))
  assert.ok(tabsFor(['personal'], ALL, ['jobs']).more.includes('jobs'), 'an application typed in still has a home')
})

test('only sections that exist, and everything else under More', () => {
  const { main, more } = tabsFor(['personal'], TODAY)
  assert.deepEqual(main, ['people', 'trips', 'repeating', 'expenses'])
  assert.deepEqual(more, ['history'])
  const unsaid = tabsFor([], TODAY)
  assert.deepEqual(unsaid.main, ['people', 'trips', 'repeating', 'history'])
  assert.deepEqual(unsaid.more, ['expenses'])
  assert.deepEqual(tabsFor(['nonsense'], TODAY).main, unsaid.main, 'unknown uses are as good as none')
})

test('examples and what counts as work', () => {
  assert.deepEqual(examplesFor(['job_search']), ['interview at Infosys friday 11am'])
  assert.equal(examplesFor(['job_search', 'personal'])[0], 'interview at Infosys friday 11am', 'first picked, first shown')
  assert.equal(examplesFor([]).length, 2)
  assert.equal(hasWork(['personal']), false)
  assert.equal(hasWork(['personal', 'office']), true)
  assert.equal(hasWork([]), true, 'not asked yet: show everything')
  assert.equal(hasClients(['job_search']), false)
  assert.equal(hasClients(['freelance']), true)
  assert.equal(hasClients([]), false, 'a pipeline of clients only for those with clients')
})
