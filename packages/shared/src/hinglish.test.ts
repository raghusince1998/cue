import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HINDI_LEFTOVER, normalizeHinglish } from './hinglish.ts'
import { parseWhen, titleFrom } from './parseWhen.ts'
import { parseBill } from './bills.ts'
import { parseOwed } from './owed.ts'
import { parseExamLine } from './exams.ts'
import { USES } from './uses.ts'

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

test('how often, said in Hindi', () => {
  assert.equal(normalizeHinglish('sabzi lana har sunday'), 'sabzi lana every sunday')
  assert.equal(normalizeHinglish('roz subah 7 baje walk'), 'every day 7am walk')
  assert.equal(normalizeHinglish('dawai har din raat 9 baje'), 'dawai every day 9pm')
  assert.equal(normalizeHinglish('kiraya har mahine 1 tarikh'), 'kiraya every month on the 1st')
  assert.equal(normalizeHinglish('mandir har somvar'), 'mandir every monday')
  assert.equal(normalizeHinglish('Har Gobind birthday on 5 Jan'), 'Har Gobind birthday on 5 Jan', 'a name, not "every"')
})

test('Hindi left in a title is spotted', () => {
  assert.ok(HINDI_LEFTOVER.test('sabzi lana'))
  assert.ok(HINDI_LEFTOVER.test('mom ko call karna hai'))
  assert.ok(!HINDI_LEFTOVER.test('call mom'))
  assert.ok(!HINDI_LEFTOVER.test('Har Gobind birthday'))
})

test('dates said in Hindi: a month, or a day of the month', () => {
  assert.equal(normalizeHinglish('15 नवंबर को जयपुर जाना'), '15 november जयपुर जाना')
  const r = parseWhen(normalizeHinglish('15 नवंबर को जयपुर जाना'), NOW)
  assert.equal(r?.date.getMonth(), 10)
  assert.equal(r?.date.getDate(), 15)
  assert.equal(normalizeHinglish('बिजली का बिल 5 तारीख को'), 'बिजली का बिल on the 5th')
  assert.equal(normalizeHinglish('rent 21 tarikh'), 'rent on the 21st')
})

test('from now: दिन बाद, घंटे में', () => {
  assert.equal(normalizeHinglish('2 दिन बाद डॉक्टर'), 'in 2 days डॉक्टर')
  assert.equal(normalizeHinglish('do din baad doctor'), 'in 2 days doctor')
  assert.equal(normalizeHinglish('ek hafte baad dentist'), 'in 1 week dentist')
  assert.equal(normalizeHinglish('आधे घंटे में कॉल'), 'in 30 minutes कॉल')
  assert.equal(plan('3 घंटे बाद मम्मी को कॉल').time, '13:00')
  assert.equal(normalizeHinglish('do it in 2 days'), 'do it in 2 days', 'English stays English')
})

test('next, this and by', () => {
  const r = plan('अगले सोमवार को मीटिंग 10 बजे')
  assert.equal(r.day, 12, 'the coming Monday')
  assert.equal(r.title, 'मीटिंग', 'no stray अगले in the title')
  assert.equal(normalizeHinglish('शुक्रवार तक रिपोर्ट भेजनी है'), 'रिपोर्ट भेजनी है by friday')
  assert.equal(normalizeHinglish('शुक्रवार शाम 5 बजे तक रिपोर्ट'), 'रिपोर्ट by friday 5pm')
  assert.equal(normalizeHinglish('agle hafte meeting'), 'next week meeting')
  assert.equal(normalizeHinglish('is monday free?'), 'is monday free?')
})

test('money owed, said the Hindi way', () => {
  assert.equal(normalizeHinglish('रवि को 500 रुपये उधार दिए'), 'lent रवि ₹500')
  assert.deepEqual(parseOwed(normalizeHinglish('रवि को 500 रुपये उधार दिए')), { name: 'रवि', amountPaise: 50000, note: null })
  assert.deepEqual(parseOwed(normalizeHinglish('Ravi se 500 wapas lene hain')), { name: 'Ravi', amountPaise: 50000, note: null })
  assert.deepEqual(parseOwed(normalizeHinglish('रवि पर 1,200 रुपये बाकी हैं')), { name: 'रवि', amountPaise: 120000, note: null })
  assert.deepEqual(parseOwed(normalizeHinglish('प्रिया ने 2000 उधार लिए')), { name: 'प्रिया', amountPaise: 200000, note: null })
  // Paid, not lent: an expense, never money to chase.
  assert.equal(parseOwed(normalizeHinglish('दुकानदार को 500 रुपये दिए')), null)
})

test('bills said in Hindi', () => {
  const light = parseBill(normalizeHinglish('बिजली का बिल 5 तारीख को भरना है'), NOW)
  assert.equal(light?.name, 'बिजली का बिल')
  assert.equal(light?.category, 'electricity')
  assert.equal(light?.repeat, 'monthly')
  assert.equal(light?.dueOn, '2026-11-05')
  const rent = parseBill(normalizeHinglish('किराया 15000 रुपये हर महीने 1 तारीख को'), NOW)
  assert.equal(rent?.name, 'किराया')
  assert.equal(rent?.category, 'rent')
  assert.equal(rent?.amountPaise, 1500000)
  assert.equal(rent?.dueOn, '2026-11-01')
  assert.equal(parseBill(normalizeHinglish('शर्मा जी को 1 तारीख को बिल भेजना'), NOW), null, 'a bill to send is not one to pay')
})

test('every example offered in Hindi is one Cue understands', () => {
  for (const use of USES) {
    const text = normalizeHinglish(use.exampleHi)
    const read = parseWhen(text, NOW) ?? parseBill(text, NOW) ?? parseExamLine(use.exampleHi, NOW)
    assert.ok(read, `${use.key}: "${use.exampleHi}"`)
  }
})
