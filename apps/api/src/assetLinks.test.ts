import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetLinks } from './assetLinks.ts'

const KEY = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5'

test('both apps vouched for, each with its own keys; one without keys left out', () => {
  assert.deepEqual(
    assetLinks([
      { package: 'in.vitelio.cue', fingerprints: [KEY] },
      { package: 'in.vitelio.cue.exams', fingerprints: [] },
    ]).map((s) => s.target.package_name),
    ['in.vitelio.cue'],
  )
  const both = assetLinks([
    { package: 'in.vitelio.cue', fingerprints: [KEY] },
    { package: 'in.vitelio.cue.exams', fingerprints: [KEY] },
  ])
  assert.equal(both.length, 2)
  assert.deepEqual(both[1], {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'in.vitelio.cue.exams', sha256_cert_fingerprints: [KEY] },
  })
})
