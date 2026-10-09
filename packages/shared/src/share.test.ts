import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeShared } from './share.ts'

test('a WhatsApp message arrives as it is', () => {
  assert.deepEqual(composeShared(null, 'Can you send the quotation by Friday?', null), {
    text: 'Can you send the quotation by Friday?',
    original: null,
  })
})

test('a shared link keeps its title, and nothing is said twice', () => {
  assert.equal(composeShared('Apollo Clinic', null, 'https://apollo.example')!.text, 'Apollo Clinic — https://apollo.example')
  assert.equal(composeShared('Read this', 'Read this https://x.example', 'https://x.example')!.text, 'Read this https://x.example')
  assert.equal(composeShared('Same', 'Same', null)!.text, 'Same')
})

test('a long message becomes one line for the box, and the whole of it is kept', () => {
  const message = `Hi Sid,\n\nThanks for the demo today. ${'We discussed a lot. '.repeat(20)}\nRegards, Dr. Mehta`
  const s = composeShared(null, message, null)!
  assert.ok(!s.text.includes('\n'))
  assert.ok(s.text.length <= 280 && s.text.endsWith('…'))
  assert.equal(s.original, message)
  assert.equal(composeShared(null, 'Line one\nline two', null)!.original, 'Line one\nline two', 'flattened, so kept')
})

test('nothing shared is nothing', () => {
  assert.equal(composeShared(null, '   ', null), null)
  assert.equal(composeShared(null, null, null), null)
})
