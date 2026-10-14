import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expectedScore, markingFor } from './marking.ts'

test('a score from the answer key, by the board’s own marking', () => {
  // SSC CGL Tier 1: 2 for right, half a mark off for wrong.
  assert.deepEqual(expectedScore(78, 12, markingFor('ssc-cgl', 'tier1')!), { score: 150, outOf: 200, unattempted: 10 })
  // RRB NTPC CBT 1: a third off for each wrong.
  assert.deepEqual(expectedScore(70, 15, markingFor('rrb-ntpc', 'cbt1')!), { score: 65, outOf: 100, unattempted: 15 })
  // NEET: 4 and 1.
  assert.deepEqual(expectedScore(150, 20, markingFor('neet-ug', 'exam')!), { score: 580, outOf: 720, unattempted: 10 })
  // CTET: nothing taken off.
  assert.equal(expectedScore(100, 50, markingFor('ctet', null)!).score, 100, 'one round: no need to name it')
  // UPSC prelims: two-thirds of a mark off, to two places.
  assert.equal(expectedScore(60, 30, markingFor('upsc-cse', 'prelims')!).score, 100)
})

test('only where the board has set it plainly', () => {
  assert.equal(markingFor('ssc-cgl', 'tier2'), null, 'Tier 2 has papers of its own')
  assert.equal(markingFor('raj-police-constable', 'exam'), null)
  assert.equal(markingFor(null, null), null)
})
