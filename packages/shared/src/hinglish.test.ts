import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeHinglish } from './hinglish.ts'
import { parseWhen, titleFrom } from './parseWhen.ts'

/**
 * Hindi time words, end to end through the real parser.
 *
 * Every case asserts the *time* that comes out, not the intermediate English,
 * because the intermediate form is an implementation detail and the time is the
 * thing somebody turns up for. The title is checked too: translating the time
 * words must not leave stray English, or mangle the words that were not about
 * time at all.
 */

// Wednesday 7 October 2026, 10:00 local. Tests run in the process zone, so
// they check local components rather than instants.
const NOW = new Date(2026, 9, 7, 10, 0)

function plan(text: string) {
  const normalized = normalizeHinglish(text)
  const when = parseWhen(normalized, NOW)
  if (!when) return { normalized, day: null, time: null, title: null }
  const d = when.date
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    normalized,
    day: d.getDate(),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    title: titleFrom(normalized, when),
  }
}

test('the sentence that was reported', () => {
  const r = plan('kal subah mandir jaunga 9 baje')
  assert.equal(r.day, 8, 'kal is tomorrow')
  assert.equal(r.time, '09:00')
  assert.equal(r.title, 'mandir jaunga', 'the activity survives, in the words used')
})

test('subah decides the half of the clock even when the hour is far away', () => {
  // Without this, a bare 7 falls to the English convention that 1–7 is the
  // afternoon, and a morning gym trip is booked for seven at night.
  const r = plan('kal subah gym jaunga 7 baje')
  assert.equal(r.time, '07:00')
})

test('shaam makes it evening', () => {
  assert.equal(plan('kal shaam 7 baje mandir').time, '19:00')
  assert.equal(plan('shaam ko 6 baje chai').time, '18:00', '"ko" is grammar, not content')
})

test('dopahar makes it afternoon, including noon', () => {
  assert.equal(plan('kal dopahar 2 baje meeting').time, '14:00')
  assert.equal(plan('kal dopahar 12 baje lunch').time, '12:00')
})

test('raat covers both ends of the night', () => {
  assert.equal(plan('kal raat 10 baje train').time, '22:00')
  assert.equal(plan('kal raat 2 baje flight').time, '02:00', 'nobody means 2pm by night')
  assert.equal(plan('kal raat 12 baje').time, '00:00')
})

test('minutes are kept', () => {
  assert.equal(plan('kal subah 7:30 baje walk').time, '07:30')
})

test('baje with no part of the day reads like "at"', () => {
  assert.equal(plan('kal 9 baje dentist').time, '09:00')
  assert.equal(plan('kal 3 baje dentist').time, '15:00', 'as "at 3" does in English')
})

test('a part of the day with no hour is still understood', () => {
  const r = plan('kal shaam mandir')
  assert.equal(r.day, 8)
  assert.equal(r.time, '18:00', 'the evening default, as in English')
})

test('aaj and parso', () => {
  assert.equal(plan('aaj shaam 6 baje gym').day, 7)
  assert.equal(plan('parso subah 8 baje doctor').day, 9)
})

test('Devanagari, including its digits', () => {
  const r = plan('कल सुबह मंदिर जाऊंगा ९ बजे')
  assert.equal(r.day, 8)
  assert.equal(r.time, '09:00')
  assert.equal(r.title, 'मंदिर जाऊंगा', 'the Devanagari activity survives untouched')
})

test('names that look like time words are left alone', () => {
  // The failure this guards against is worse than not understanding a
  // spelling: the title changes and the plan is booked at the wrong time.
  assert.equal(normalizeHinglish('call Sham tomorrow 5pm'), 'call Sham tomorrow 5pm')
  assert.equal(normalizeHinglish('meet Kalpana friday'), 'meet Kalpana friday')
  assert.equal(normalizeHinglish('Kalyan visit monday'), 'Kalyan visit monday')
  assert.equal(normalizeHinglish('rat trap on saturday'), 'rat trap on saturday')
})

test('plain English passes through unchanged', () => {
  for (const text of ['dentist friday 6pm', 'gym every mon wed fri at 7', 'call amma tomorrow morning']) {
    assert.equal(normalizeHinglish(text), text)
  }
})
