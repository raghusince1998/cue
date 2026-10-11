import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLaterStage, mentions, parseTrackerLine, quietFor } from './trackers.ts'

test('a job application, a candidate or a lead, read from one line', () => {
  assert.deepEqual(parseTrackerLine('applied to Infosys for the data analyst role'), {
    board: 'jobs',
    stage: 'applied',
    title: 'Infosys',
    detail: 'Data analyst',
  })
  assert.deepEqual(parseTrackerLine('Applied for Product Manager at Swiggy'), {
    board: 'jobs',
    stage: 'applied',
    title: 'Swiggy',
    detail: 'Product Manager',
  })
  assert.deepEqual(parseTrackerLine('applied to tcs'), { board: 'jobs', stage: 'applied', title: 'Tcs', detail: null })
  assert.deepEqual(parseTrackerLine('apply for frontend developer at Zoho'), {
    board: 'jobs',
    stage: 'saved',
    title: 'Zoho',
    detail: 'Frontend developer',
  })
  assert.deepEqual(parseTrackerLine('candidate Priya Nair for product designer'), {
    board: 'hiring',
    stage: 'new',
    title: 'Priya Nair',
    detail: 'Product designer',
  })
  assert.equal(parseTrackerLine('shortlisted Arjun for the designer role')!.stage, 'screening')
  assert.deepEqual(parseTrackerLine('new lead: Tata Motors for 50 laptops'), {
    board: 'deals',
    stage: 'lead',
    title: 'Tata Motors',
    detail: '50 laptops',
  })

  assert.equal(parseTrackerLine('call Ravi tomorrow 4pm'), null)
  assert.equal(parseTrackerLine('interview at Infosys friday 11am'), null, 'a plan, not a new application')
})

test('gone quiet: open, nothing booked, past the stage’s patience', () => {
  const now = new Date('2026-10-20T10:00:00Z')
  const nine = '2026-10-11T10:00:00Z'
  assert.equal(quietFor('jobs', { stage: 'applied', stageChangedAt: nine, hasNextStep: false }, now), 9)
  assert.equal(quietFor('jobs', { stage: 'applied', stageChangedAt: nine, hasNextStep: true }, now), null, 'a next step is booked')
  assert.equal(quietFor('jobs', { stage: 'rejected', stageChangedAt: nine, hasNextStep: false }, now), null, 'closed')
  assert.equal(quietFor('jobs', { stage: 'applied', stageChangedAt: '2026-10-17T10:00:00Z', hasNextStep: false }, now), null, 'too soon')
  assert.equal(quietFor('hiring', { stage: 'new', stageChangedAt: '2026-10-16T10:00:00Z', hasNextStep: false }, now), 4)
})

test('stages in order, and whole-word mentions', () => {
  assert.equal(isLaterStage('jobs', 'applied', 'interview'), true)
  assert.equal(isLaterStage('jobs', 'offer', 'interview'), false)
  assert.equal(mentions('interview at Infosys friday 11am', 'Infosys'), true)
  assert.equal(mentions('interview at infosys', 'Infosys'), true)
  assert.equal(mentions('Infosystems call', 'Infosys'), false)
  assert.equal(mentions('call Priya Nair about the offer', 'Priya Nair'), true)
  assert.equal(mentions('anything', 'A'), false)
})
