import { test } from 'node:test'
import assert from 'node:assert/strict'
import { examplesFor, groupSections, hasClients, hasCompanies, hasWork, sectionsFor, tabsFor, type Section } from './uses.ts'

const ALL: Section[] = ['people', 'history', 'trips', 'repeating', 'expenses', 'jobs', 'hiring', 'deals', 'bills', 'exams']
const TODAY: Section[] = ['people', 'history', 'trips', 'repeating', 'expenses']

test('tabs lead with what each use needs, taking turns between uses', () => {
  assert.deepEqual(tabsFor(['job_search'], ALL).main, ['jobs', 'people', 'history', 'repeating'])
  assert.deepEqual(tabsFor(['job_search', 'personal'], ALL).main, ['jobs', 'bills', 'people', 'history'])
  assert.deepEqual(tabsFor(['hiring'], ALL).main, ['hiring', 'people', 'repeating', 'history'])
  assert.deepEqual(tabsFor(['sales'], ALL).main, ['people', 'deals', 'expenses', 'trips'])
})

test('each use brings its own sections and no one else’s', () => {
  const all = (uses: string[], filled: string[] = []) => {
    const { main, more } = tabsFor(uses, ALL, filled)
    return [...main, ...more].sort()
  }
  assert.deepEqual(all(['personal']), ['bills', 'expenses', 'history', 'people', 'repeating', 'trips'])
  assert.deepEqual(all(['job_search']), ['history', 'jobs', 'people', 'repeating'], 'a job hunt: no bills, deals or candidates')
  assert.deepEqual(all(['hiring']), ['hiring', 'history', 'people', 'repeating'])
  assert.deepEqual(all(['freelance']), ['bills', 'deals', 'expenses', 'history', 'people', 'repeating'])
  assert.deepEqual(all(['student']), ['exams', 'history', 'people', 'repeating', 'trips'])
  assert.deepEqual(all(['exams']), ['exams', 'history', 'people', 'repeating', 'trips'], 'an aspirant: exams, and getting to them')
  assert.deepEqual(all([]), ['history', 'people', 'repeating', 'trips'], 'not said yet: only what everybody has')
  assert.deepEqual(all(['nonsense']), all([]), 'unknown uses are as good as none')
})

test('a section with something in it stays, whatever was picked', () => {
  assert.ok(tabsFor(['personal'], ALL, ['jobs']).more.includes('jobs'), 'an application typed in still has a home')
  assert.ok(sectionsFor(['job_search'], ALL, ['bills']).includes('bills'), 'a bill found in email shows Bills')
  assert.ok(!sectionsFor(['job_search'], ALL, ['hiring']).includes('deals'))
})

test('only sections that exist, and everything else under More', () => {
  const { main, more } = tabsFor(['personal'], TODAY)
  assert.deepEqual(main, ['people', 'trips', 'repeating', 'expenses'])
  assert.deepEqual(more, ['history'])
})

test('the menu, grouped', () => {
  assert.deepEqual(groupSections(['history', 'bills', 'jobs', 'expenses', 'hiring', 'exams']), [
    { label: 'Everyday', sections: ['history'] },
    { label: 'Money', sections: ['bills', 'expenses'] },
    { label: 'Work', sections: ['hiring'] },
    { label: 'Career & studies', sections: ['exams', 'jobs'] },
  ])
  assert.deepEqual(groupSections([]), [])
})

test('examples, and what counts as work and clients', () => {
  assert.deepEqual(examplesFor(['job_search']), ['interview at Infosys friday 11am'])
  assert.equal(examplesFor(['job_search', 'personal'])[0], 'interview at Infosys friday 11am', 'first picked, first shown')
  assert.equal(examplesFor([]).length, 2)
  assert.equal(hasWork(['personal']), false)
  assert.equal(hasWork(['personal', 'office']), true)
  assert.equal(hasWork(['job_search', 'student']), false, 'looking for work is not a working day of reports')
  assert.equal(hasWork([]), false, 'not said yet: no standups for someone who may have no job')
  assert.equal(hasClients(['job_search']), false)
  assert.equal(hasClients(['freelance']), true)
  assert.equal(hasClients(['office']), false, 'targets of calls and visits are not an office job’s')
  assert.equal(hasClients([]), false)
  assert.equal(hasCompanies(['job_search']), true)
  assert.equal(hasCompanies(['personal', 'student']), false)
  assert.equal(hasWork(['exams']), false, 'an aspirant has no standup')
})
