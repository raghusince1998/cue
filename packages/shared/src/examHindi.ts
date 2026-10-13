/**
 * The exam module in Hindi: stages, dates, plan titles, reminders and what
 * to carry — in the words boards themselves use (प्रवेश पत्र, उत्तर कुंजी,
 * दस्तावेज़ सत्यापन), for the many aspirants who read Hindi first.
 */
import type { ExamStep } from './exams.ts'

export type Lang = 'en' | 'hi'

/** Stages and rounds, by key. A round with its own English label falls back to these. */
export const STAGE_HI: Record<string, string> = {
  to_apply: 'फॉर्म भरना है',
  applied: 'आवेदन किया',
  selected: 'चयनित',
  not_selected: 'इस बार नहीं',
  dropped: 'छोड़ दिया',
  cbt: 'CBT',
  cbt1: 'CBT 1',
  cbt2: 'CBT 2',
  tier1: 'टियर 1',
  tier2: 'टियर 2',
  paper1: 'पेपर 1',
  paper2: 'पेपर 2',
  prelims: 'प्रारंभिक परीक्षा',
  mains: 'मुख्य परीक्षा',
  phase1: 'चरण 1',
  phase2: 'चरण 2',
  session1: 'सत्र 1',
  session2: 'सत्र 2',
  written: 'लिखित परीक्षा',
  exam: 'परीक्षा',
  interview: 'साक्षात्कार',
  dv: 'दस्तावेज़ सत्यापन',
  medical: 'मेडिकल जाँच',
  pet: 'शारीरिक परीक्षा',
  skill: 'कौशल / टाइपिंग परीक्षा',
  ssb: 'SSB साक्षात्कार',
  counselling: 'काउंसलिंग',
  language: 'भाषा परीक्षा',
  rally: 'भर्ती रैली',
}

export const STEP_HI: Record<ExamStep, string> = {
  apply_by: 'आवेदन की अंतिम तिथि',
  fee_by: 'शुल्क की अंतिम तिथि',
  correction: 'सुधार विंडो',
  admit_card: 'प्रवेश पत्र',
  exam: 'परीक्षा',
  answer_key: 'उत्तर कुंजी',
  result: 'परिणाम',
  other: 'अन्य',
}

/** A plan's title for one of an exam's dates, in Hindi. */
export function stepTitleHi(label: string, step: ExamStep, round: string | null, note: string | null): string {
  const r = round ? STAGE_HI[round] : null
  const withRound = r && r !== 'परीक्षा' ? ` ${r}` : ''
  switch (step) {
    case 'apply_by':
      return `आवेदन की अंतिम तिथि: ${label}`
    case 'fee_by':
      return `शुल्क जमा करें: ${label}`
    case 'correction':
      return `सुधार विंडो: ${label}`
    case 'admit_card':
      return `प्रवेश पत्र डाउनलोड करें: ${label}${withRound}`
    case 'exam':
      return `परीक्षा: ${label}${withRound}`
    case 'answer_key':
      return `उत्तर कुंजी: ${label}`
    case 'result':
      return `परिणाम: ${label}${withRound}`
    default:
      return note ? `${label}: ${note}` : label
  }
}

/** What a date's plan says to do, in Hindi. */
export function stepNotesHi(step: ExamStep, site: string | null): string | null {
  const at = site ? ` · ${site}` : ''
  switch (step) {
    case 'apply_by':
      return `फॉर्म भरें और पुष्टि पृष्ठ सँभाल कर रखें${at}`
    case 'fee_by':
      return `शुल्क जमा करें और रसीद रखें${at}`
    case 'correction':
      return 'फॉर्म का हर विवरण जाँचें: नाम, फोटो, वर्ग, परीक्षा केंद्र'
    case 'admit_card':
      return `डाउनलोड करके प्रिंट कर लें${at}`
    case 'answer_key':
      return 'अपने उत्तर मिलाएँ; आपत्ति का समय कम होता है'
    case 'result':
      return site
    default:
      return null
  }
}

/** What to carry on the day, in Hindi. */
export function carryHi(ntaUndertaking: boolean, neetPostcard: boolean): string[] {
  return [
    'प्रवेश पत्र (प्रिंट)',
    'मूल फोटो पहचान पत्र: आधार, पैन, वोटर आईडी, पासपोर्ट या ड्राइविंग लाइसेंस',
    'दो पासपोर्ट साइज़ फोटो, वही जो फॉर्म में लगाई थी',
    ...(ntaUndertaking ? ['प्रवेश पत्र के साथ का स्व-घोषणा पत्र, भरकर और फोटो चिपकाकर'] : []),
    ...(neetPostcard ? ['पोस्टकार्ड साइज़ फोटो (4" × 6"), जैसा प्रवेश पत्र में कहा है'] : []),
    'नीला या काला बॉल पेन, अगर प्रवेश पत्र में अनुमति हो',
  ]
}

const dayHi = (dueAt: Date, now: Date) => {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(dueAt) - startOf(now)) / 86_400_000)
  return { days, word: days <= 0 ? 'आज' : days === 1 ? 'कल' : dueAt.toLocaleDateString('hi-IN', { weekday: 'short', day: 'numeric', month: 'short' }) }
}

/** A reminder for one of an exam's dates, in Hindi. */
export function examLineHi(dueAt: Date, step: ExamStep | undefined, place: string | null, now = new Date()): string {
  const { days, word } = dayHi(dueAt, now)
  const time = dueAt.toLocaleTimeString('hi-IN', { hour: 'numeric', minute: '2-digit' })
  switch (step) {
    case 'apply_by':
      return `${days <= 0 ? 'आज आवेदन की अंतिम तिथि है' : `अंतिम तिथि ${word}`}: फॉर्म भरें और पुष्टि पृष्ठ सँभाल कर रखें।`
    case 'fee_by':
      return `${days <= 0 ? 'आज शुल्क की अंतिम तिथि है' : `शुल्क ${word} तक`}: भुगतान करें और रसीद रखें।`
    case 'correction':
      return `सुधार विंडो ${word}: फॉर्म का हर विवरण जाँच लें।`
    case 'admit_card':
      return `प्रवेश पत्र ${word}: डाउनलोड करके प्रिंट कर लें।`
    case 'exam':
      return `परीक्षा ${word} ${time}${place ? ` · ${place}` : ''} · प्रवेश पत्र, फोटो पहचान पत्र और फोटो साथ रखें।`
    case 'answer_key':
      return `उत्तर कुंजी ${word}: अपने उत्तर मिलाएँ, आपत्ति का समय कम होता है।`
    case 'result':
      return `परिणाम ${word}।`
    default:
      return `${word}।`
  }
}

/** The exam day's notes, in Hindi: the times, the roll number, the centre, and what stays at home. */
export function examDayNotesHi(input: {
  reportingAt: string | null
  gateClosesAt: string | null
  startsAt: string | null
  endsAt: string | null
  rollNo: string | null
  centre: string | null
  clock: (t: string) => string
}): string {
  const times = [
    input.reportingAt ? `रिपोर्टिंग ${input.clock(input.reportingAt)}` : null,
    input.gateClosesAt ? `गेट बंद ${input.clock(input.gateClosesAt)}` : null,
    input.startsAt ? `परीक्षा ${input.clock(input.startsAt)}${input.endsAt ? `–${input.clock(input.endsAt)}` : ''}` : null,
  ].filter(Boolean)
  return [times.join(' · ') || null, input.rollNo ? `रोल नंबर ${input.rollNo}` : null, input.centre, 'फोन, स्मार्टवॉच और बैग घर पर या बाहर छोड़ें।']
    .filter(Boolean)
    .join('\n')
}

/** What a result list's look found, in Hindi. */
export function listFoundHi(masked: string, found: boolean, means: string, round: string | null): string {
  if (!found) return `${masked} इस सूची में नहीं मिला। सूचियाँ अक्सर क्षेत्र, वर्ग या पद के अनुसार बँटी होती हैं — पक्का करने के लिए सूचना देखें।`
  if (means === 'selected') return `${masked} चयन सूची में है। बधाई हो!`
  if (means === 'shortlist') return `${masked} सूची में है${round && STAGE_HI[round] ? ` — ${STAGE_HI[round]} के लिए` : ''}। अगले चरण की तैयारी करें!`
  return `${masked} परिणाम सूची में है। अंक देखने के लिए सूचना खोलें।`
}

/** A notice in one line, in Hindi. */
export function noticeLineHi(kind: string, dates: { step: ExamStep; on: string; round: string | null }[], list: { means: string; round: string | null } | null): string {
  const day = (on: string) => {
    const [y, m, d] = on.split('-').map(Number)
    return new Date(y!, m! - 1, d!).toLocaleDateString('hi-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  }
  if (dates.length > 0) {
    return dates
      .map((d) => {
        const r = d.round ? STAGE_HI[d.round] : null
        return d.step === 'exam' ? `${r && r !== 'परीक्षा' ? r : 'परीक्षा'} ${day(d.on)} को` : `${STEP_HI[d.step]} ${day(d.on)}`
      })
      .join(', ')
  }
  if (list?.means === 'shortlist') return `${list.round && STAGE_HI[list.round] ? `${STAGE_HI[list.round]} की ` : ''}सूची जारी`
  if (list?.means === 'selected') return 'अंतिम परिणाम जारी'
  return (
    {
      notification: 'आवेदन शुरू',
      schedule: 'परीक्षा तिथियाँ घोषित',
      admit_card: 'प्रवेश पत्र जारी',
      answer_key: 'उत्तर कुंजी जारी',
      result: 'परिणाम जारी',
      dv: 'दस्तावेज़ सत्यापन का कार्यक्रम जारी',
    } as Record<string, string>
  )[kind] ?? 'नई सूचना'
}
