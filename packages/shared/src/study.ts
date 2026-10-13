/**
 * Preparing for an exam: what to study, on which days, and the mock tests
 * along the way. A study plan is a set of repeating plans — each subject on
 * its own days, at the hour chosen, until the exam — so it is on Today and
 * reminded like anything else, and stopped in one tap.
 *
 * The subjects are the usual sections of each exam, as buckets to rotate
 * through, not an official syllabus: anyone can change them.
 */

const GOVT = ['Quantitative aptitude', 'Reasoning', 'English', 'General awareness']
const RAILWAYS = ['Mathematics', 'Reasoning', 'General science', 'General awareness']
const BANKS = ['Quantitative aptitude', 'Reasoning', 'English', 'Banking & general awareness', 'Computer knowledge']
const RAJASTHAN = ['Rajasthan GK', 'History & culture', 'Polity', 'Geography', 'Science', 'Reasoning & maths', 'Hindi', 'Current affairs']
const TEACHING = ['Child development & pedagogy', 'Language I', 'Language II', 'Mathematics', 'Environmental studies']

const SUBJECTS: Record<string, string[]> = {
  'rrb-ntpc': ['Mathematics', 'General intelligence & reasoning', 'General awareness'],
  'rrb-group-d': RAILWAYS,
  'rrb-alp': [...RAILWAYS, 'Technical (trade)'],
  'rrb-je': [...RAILWAYS, 'Technical (branch)'],
  'rrb-technician': [...RAILWAYS, 'Technical (trade)'],
  rpf: ['Arithmetic', 'Reasoning', 'General awareness'],
  'ssc-cgl': GOVT,
  'ssc-chsl': GOVT,
  'ssc-mts': ['Numerical aptitude', 'Reasoning', 'English', 'General awareness'],
  'ssc-gd': ['Elementary maths', 'Reasoning', 'English or Hindi', 'General knowledge'],
  'ssc-cpo': GOVT,
  'ssc-je': ['Technical (branch)', 'Reasoning', 'General awareness'],
  'ssc-steno': ['Reasoning', 'English', 'General awareness', 'Shorthand practice'],
  'ssc-selection-post': GOVT,
  'upsc-cse': ['History', 'Polity', 'Geography', 'Economy', 'Environment', 'Science & technology', 'Current affairs', 'CSAT'],
  'upsc-nda': ['Mathematics', 'English', 'General knowledge'],
  'upsc-cds': ['Mathematics', 'English', 'General knowledge'],
  'upsc-capf': ['General ability & intelligence', 'Essay & comprehension', 'Current affairs'],
  'upsc-ese': ['Engineering (branch)', 'General studies & engineering aptitude'],
  'ibps-po': BANKS,
  'ibps-clerk': BANKS,
  'ibps-rrb': BANKS,
  'ibps-so': [...BANKS.slice(0, 3), 'Professional knowledge'],
  'sbi-po': BANKS,
  'sbi-clerk': BANKS,
  'rbi-grade-b': ['Quantitative aptitude', 'Reasoning', 'English', 'General awareness', 'Economic & social issues', 'Finance & management'],
  'rbi-assistant': BANKS,
  'lic-aao': ['Quantitative aptitude', 'Reasoning', 'English', 'Insurance & financial awareness'],
  'jee-main': ['Physics', 'Chemistry', 'Mathematics'],
  'jee-advanced': ['Physics', 'Chemistry', 'Mathematics'],
  'neet-ug': ['Physics', 'Chemistry', 'Botany', 'Zoology'],
  'cuet-ug': ['Language', 'Domain subjects', 'General test'],
  'ugc-net': ['Paper 1: teaching & research aptitude', 'Paper 2: your subject'],
  'csir-net': ['General aptitude', 'Your subject'],
  gate: ['Engineering subject', 'Engineering mathematics', 'General aptitude'],
  cat: ['Quantitative aptitude', 'Data interpretation & logical reasoning', 'Verbal ability & reading comprehension'],
  clat: ['English', 'Current affairs', 'Legal reasoning', 'Logical reasoning', 'Quantitative techniques'],
  ctet: TEACHING,
  'agniveer-army': ['General knowledge', 'General science', 'Mathematics', 'Reasoning', 'Physical training'],
  afcat: ['General awareness', 'English', 'Numerical ability', 'Reasoning & military aptitude'],
  ras: ['Rajasthan history & culture', 'Indian history', 'Geography', 'Polity', 'Economy', 'Science', 'Reasoning & maths', 'Current affairs'],
  'rpsc-school-lecturer': ['Your subject', 'Rajasthan GK', 'Educational psychology'],
  'rpsc-senior-teacher': ['Your subject', 'Rajasthan GK', 'Educational psychology'],
  'raj-police-si': [...RAJASTHAN, 'Physical training'],
  'raj-police-constable': ['Reasoning & computer', 'Rajasthan GK', 'General knowledge', 'Physical training'],
  reet: TEACHING,
  'reet-mains': ['Your subject', 'Rajasthan GK', 'Educational psychology'],
  'rssb-cet': RAJASTHAN,
  'rssb-patwari': [...RAJASTHAN, 'Computer'],
  'rssb-vdo': [...RAJASTHAN, 'Computer'],
  'rssb-ldc': ['Hindi', 'English', 'General knowledge', 'Computer', 'Typing practice'],
  'rssb-fourth-grade': ['Rajasthan GK', 'General knowledge', 'Hindi', 'Maths'],
  'raj-high-court': ['General knowledge', 'Hindi', 'English', 'Computer', 'Typing practice'],
}

/** The usual sections of an exam, to study in turn. */
export function subjectsFor(examKey: string | null | undefined, lang: 'en' | 'hi' = 'en'): string[] {
  const list = SUBJECTS[examKey ?? ''] ?? GOVT
  return lang === 'hi' ? list.map((s) => SUBJECT_HI[s] ?? s) : list
}

/** The subjects in Hindi, as coaching and boards in the Hindi belt name them. */
const SUBJECT_HI: Record<string, string> = {
  'Quantitative aptitude': 'संख्यात्मक अभियोग्यता (गणित)',
  Reasoning: 'तर्कशक्ति (रीज़निंग)',
  English: 'अंग्रेज़ी',
  'General awareness': 'सामान्य जागरूकता',
  Mathematics: 'गणित',
  'General intelligence & reasoning': 'सामान्य बुद्धि और तर्कशक्ति',
  'General science': 'सामान्य विज्ञान',
  'Technical (trade)': 'तकनीकी (ट्रेड)',
  'Technical (branch)': 'तकनीकी (ब्रांच)',
  Arithmetic: 'अंकगणित',
  'Numerical aptitude': 'संख्यात्मक अभियोग्यता',
  'Elementary maths': 'प्रारंभिक गणित',
  'English or Hindi': 'अंग्रेज़ी या हिन्दी',
  'General knowledge': 'सामान्य ज्ञान',
  'Shorthand practice': 'शॉर्टहैंड अभ्यास',
  History: 'इतिहास',
  Polity: 'राजव्यवस्था',
  Geography: 'भूगोल',
  Economy: 'अर्थव्यवस्था',
  Environment: 'पर्यावरण',
  'Science & technology': 'विज्ञान और प्रौद्योगिकी',
  'Current affairs': 'समसामयिकी',
  CSAT: 'CSAT',
  'Banking & general awareness': 'बैंकिंग और सामान्य जागरूकता',
  'Computer knowledge': 'कंप्यूटर ज्ञान',
  Physics: 'भौतिकी',
  Chemistry: 'रसायन',
  Botany: 'वनस्पति विज्ञान',
  Zoology: 'प्राणी विज्ञान',
  'Rajasthan GK': 'राजस्थान सामान्य ज्ञान',
  'History & culture': 'इतिहास और संस्कृति',
  Science: 'विज्ञान',
  'Reasoning & maths': 'तर्कशक्ति और गणित',
  Hindi: 'हिन्दी',
  Computer: 'कंप्यूटर',
  'Child development & pedagogy': 'बाल विकास और शिक्षाशास्त्र',
  'Language I': 'भाषा I',
  'Language II': 'भाषा II',
  'Environmental studies': 'पर्यावरण अध्ययन',
  'Rajasthan history & culture': 'राजस्थान का इतिहास और संस्कृति',
  'Indian history': 'भारतीय इतिहास',
  'Your subject': 'आपका विषय',
  'Educational psychology': 'शैक्षिक मनोविज्ञान',
  'Physical training': 'शारीरिक अभ्यास',
  'Typing practice': 'टाइपिंग अभ्यास',
  'Reasoning & computer': 'तर्कशक्ति और कंप्यूटर',
  Maths: 'गणित',
}

export interface StudySeries {
  /** What is studied: one subject, or the weekly mock test. */
  title: string
  subject: string | null
  mock: boolean
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: number[]
  hour: number
  minute: number
  durationMinutes: number
}

/**
 * A week of study: the subjects dealt across the days chosen, in turn —
 * four subjects over six days is each once and the first two twice — each
 * subject then one weekly series on its days; and the mock test, on its
 * own day, as another.
 */
export function studyWeek(input: {
  examName: string
  subjects: string[]
  days: number[]
  at: { hour: number; minute: number }
  minutes: number
  mock?: { day: number; at: { hour: number; minute: number }; minutes: number } | null
}): StudySeries[] {
  const subjects = input.subjects.map((s) => s.trim()).filter(Boolean)
  const days = [...new Set(input.days)].filter((d) => d >= 0 && d <= 6 && d !== input.mock?.day).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  // More subjects than days: they share, so none is left out — nine subjects
  // over six days is three days of two. Otherwise each subject in turn.
  const groups =
    subjects.length > days.length && days.length > 0
      ? days.map((_, i) => subjects.filter((_, j) => j % days.length === i).join(' + '))
      : subjects
  const bySubject = new Map<string, number[]>()
  days.forEach((day, i) => {
    if (groups.length === 0) return
    const subject = groups[i % groups.length]!
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), day])
  })
  const out: StudySeries[] = [...bySubject.entries()].map(([subject, weekdays]) => ({
    title: `Study ${subject}: ${input.examName}`,
    subject,
    mock: false,
    weekdays,
    hour: input.at.hour,
    minute: input.at.minute,
    durationMinutes: input.minutes,
  }))
  if (input.mock) {
    out.push({
      title: `Mock test: ${input.examName}`,
      subject: null,
      mock: true,
      weekdays: [input.mock.day],
      hour: input.mock.at.hour,
      minute: input.mock.at.minute,
      durationMinutes: input.mock.minutes,
    })
  }
  return out
}

/** A mock test's score, said in a line: "scored 142/200 in CGL mock", "mock 61.5 out of 100". */
export function mockScoreIn(text: string): { score: number; outOf: number } | null {
  if (!/\bmock\b|\btest\s+series\b|\bpractice\s+(?:test|paper)\b/i.test(text)) return null
  // Hindi says the total first: "720 में से 520" is 520 out of 720.
  const hindi = /(\d{1,4})\s*में\s+से\s*(\d{1,4}(?:\.\d{1,2})?)/.exec(text)
  const m = hindi ? null : /(\d{1,4}(?:\.\d{1,2})?)\s*(?:\/|out\s+of|outof)\s*(\d{1,4})\b/i.exec(text)
  if (!hindi && !m) return null
  const score = Number(hindi ? hindi[2] : m![1])
  const outOf = Number(hindi ? hindi[1] : m![2])
  return outOf > 0 && score <= outOf ? { score, outOf } : null
}
