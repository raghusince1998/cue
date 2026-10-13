import { EXAM_STEPS, STAGE_HI, STEP_HI, examStage, type ExamStep, type Lang } from '@cue/shared'
import { useAuth } from './auth.tsx'

/**
 * The exam screens' words, in English or Hindi — whichever the person chose
 * in Settings. Hindi as boards write it: प्रवेश पत्र, परिणाम, अंतिम तिथि.
 */

const EN = {
  title: 'Exams',
  open: (n: number) => `${n} open`,
  done: (n: number) => `${n} done`,
  intro:
    'Every exam you have applied for, or mean to: where it stands, and each date — the last day to apply, the fee, the exam, the result — as a reminder. Cue never signs in to an exam portal; dates come from you, from your admit cards, and, with your email connected, from the boards’ own emails.',
  noExams: 'No exams yet',
  noExamsHow: 'Add one above, or type it in the box on Today:',
  doneHeading: 'Done',
  exam: 'Exam',
  addExam: 'Add an exam',
  addExamButton: 'Add exam',
  readCard: 'Read an admit card',
  readTheCard: 'Read the admit card',
  photoTool: 'Photo & signature for forms',
  examPlaceholder: 'Start typing: RRB NTPC, SSC CGL, REET, Patwari…',
  yearOptional: 'Year or notice (optional)',
  year: 'Year or notice',
  board: 'Board',
  boardOptional: 'Board (optional)',
  regionOptional: 'Region or post (optional)',
  region: 'Region or post',
  standsHeading: 'Where it stands',
  regNoOptional: 'Registration number (optional)',
  regNo: 'Registration number',
  rollNo: 'Roll number',
  lastDate: 'Last date to apply',
  examDateIfAnnounced: 'Exam date, if announced',
  officialSite: 'Official site',
  applyLogin: 'Apply / log in',
  dates: 'Dates',
  noDates: 'No dates yet. Add one as soon as it is announced.',
  whichRound: 'Which round?',
  whatIsIt: 'What is it?',
  addDate: 'Add date',
  pickDay: 'Pick the day.',
  notices: 'Official notices',
  theNotice: 'the notice',
  examDay: 'Exam day',
  examDayHow:
    'When the admit card is out, read it here: the day is planned from it — when to report, what to carry, and the journey if the centre is in another city.',
  details: 'Details',
  category: 'Category (for cut-offs)',
  notSaid: 'Not said',
  notes: 'Notes',
  notesPlaceholder: 'Post preferences, anything to remember',
  neverAsks: 'Cue never asks for a portal password, OTP or date of birth. Keep those to yourself.',
  saveDetails: 'Save details',
  deleteExam: 'Delete this exam',
  confirmDelete: 'Delete this exam? Its dates still to come go with it.',
  confirmClose: 'Its dates still to come go too. Carry on?',
  since: (stage: string, when: string) => (when === 'today' ? `${stage} today` : `${stage} ${when}`),
  next: 'Next',
  centre: 'Centre',
  daysToGo: (n: number) => (n <= 0 ? 'Exam today' : n === 1 ? 'Exam tomorrow' : `${n} days to the exam`),
  // Study and mocks
  study: 'Study plan',
  studyHow: 'Each subject on its own days, at the same time, until the day before the exam — on Today, with reminders.',
  subjects: 'Subjects, one per line',
  days: 'Days',
  at: 'At',
  forMinutes: 'For (minutes)',
  mockOn: 'Mock test on',
  noMock: 'No mock test',
  makePlan: 'Make the plan',
  remakePlan: 'Make it again',
  stopPlan: 'Stop the plan',
  planRunning: 'Running until',
  mocks: 'Mock tests',
  mocksHow: 'Each score kept, to see the trend. Or type it on Today: “scored 142/200 in CGL mock”.',
  score: 'Score',
  outOf: 'Out of',
  on: 'On',
  addScore: 'Add score',
  best: 'Best',
  average: 'Average',
  last: 'Last',
  remove: 'Remove',
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  // Results
  results: 'Results',
  resultsHow: 'Add your roll number below, and when a result list comes out Cue looks for it in the list.',
  selectedOnList: 'Selected — your number is on the list',
  inListFor: (round: string | null) => `In the list${round ? ` for ${round}` : ''}`,
  inResultList: 'Your number is in the result list',
  notFound: 'Not found in this list — lists are often split by region, category or post',
  page: (n: number) => `page ${n}`,
  cutoffs: 'Cut-offs',
  setCategory: 'Set your category in Details to see yours picked out.',
  lookThrough: 'Look through a result list (PDF)',
  looking: 'Looking…',
  foundOnPage: (page: number, pages: number) => `Found: your number is on page ${page} of ${pages}.`,
  notInList: (pages: number) => `Not in this list (${pages} page${pages === 1 ? '' : 's'} read). If it is split by region or category, check the right part.`,
  // Admit cards
  cardHow:
    'Choose the admit card’s PDF, or paste its text. It is read and not kept: only what you save below is. A scanned or password-locked PDF cannot be read; type the details instead.',
  choosePdf: 'Choose the PDF',
  pasteHere: 'Or paste the admit card’s text here',
  readText: 'Read the text',
  typeInstead: 'Type it in instead',
  reading: 'Reading…',
  checkEach: 'Check each line against the card, and put right anything read wrong.',
  newExam: 'A new exam',
  newSuffix: '(new)',
  itsName: 'Its name',
  round: 'Round',
  examDate: 'Exam date',
  reportingTime: 'Reporting time',
  gateCloses: 'Gate closes',
  examStarts: 'Exam starts',
  examEnds: 'Exam ends',
  centreCity: 'Centre city',
  centreAddress: 'Centre address',
  planDay: 'Plan the exam day',
  startAgain: 'Start again',
  dateNeeded: 'The exam date is needed.',
  plannedTrip: (city: string) =>
    `Planned, with what to carry. The centre is in ${city}: a trip there from the day before, and a reminder to book the journey.`,
  plannedNoHome:
    'Planned, with what to carry. Add your home city in Settings, and a centre in another city becomes a trip with a reminder to book the journey.',
  planned: 'Planned, with what to carry and reminders the evening before and that morning.',
  doneButton: 'Done',
  // Choosing exams, the first time
  pickTitle: 'Which exams are you preparing for?',
  pickHow: 'Tap each one. Its stages, official site and dates come with it; you can add your registration number later.',
  pickApplied: 'Already applied',
  pickToApply: 'Form still to fill',
  pickAdd: (n: number) => (n === 1 ? 'Add this exam' : `Add these ${n} exams`),
  pickOther: 'Not in the list? Add an exam',
  disclaimer:
    'Cue is not affiliated with any government body or exam board. Dates and notices come from the boards’ official websites, linked beside them — the official notice has the final word.',
}

type Words = typeof EN

const HI: Words = {
  title: 'परीक्षाएँ',
  open: (n) => `${n} चालू`,
  done: (n) => `${n} पूरी`,
  intro:
    'हर परीक्षा जिसका फॉर्म भरा है या भरना है: अभी कहाँ है, और हर तारीख — आवेदन की अंतिम तिथि, शुल्क, परीक्षा, परिणाम — एक रिमाइंडर के रूप में। Cue कभी किसी परीक्षा पोर्टल पर लॉग इन नहीं करता; तारीखें आपसे, आपके प्रवेश पत्र से, और ईमेल जुड़ा हो तो बोर्ड के ईमेल से आती हैं।',
  noExams: 'अभी कोई परीक्षा नहीं',
  noExamsHow: 'ऊपर जोड़ें, या Today पर लिखें:',
  doneHeading: 'पूरी',
  exam: 'परीक्षा',
  addExam: 'परीक्षा जोड़ें',
  addExamButton: 'जोड़ें',
  readCard: 'प्रवेश पत्र पढ़ें',
  readTheCard: 'प्रवेश पत्र पढ़ें',
  photoTool: 'फॉर्म के लिए फोटो और हस्ताक्षर',
  examPlaceholder: 'लिखना शुरू करें: RRB NTPC, SSC CGL, REET, Patwari…',
  yearOptional: 'वर्ष या विज्ञप्ति (वैकल्पिक)',
  year: 'वर्ष या विज्ञप्ति',
  board: 'बोर्ड',
  boardOptional: 'बोर्ड (वैकल्पिक)',
  regionOptional: 'क्षेत्र या पद (वैकल्पिक)',
  region: 'क्षेत्र या पद',
  standsHeading: 'अभी कहाँ है',
  regNoOptional: 'रजिस्ट्रेशन नंबर (वैकल्पिक)',
  regNo: 'रजिस्ट्रेशन नंबर',
  rollNo: 'रोल नंबर',
  lastDate: 'आवेदन की अंतिम तिथि',
  examDateIfAnnounced: 'परीक्षा तिथि, अगर घोषित हो',
  officialSite: 'आधिकारिक वेबसाइट',
  applyLogin: 'आवेदन / लॉग इन',
  dates: 'तारीखें',
  noDates: 'अभी कोई तारीख नहीं। घोषित होते ही जोड़ें।',
  whichRound: 'कौन-सा चरण?',
  whatIsIt: 'क्या है?',
  addDate: 'तारीख जोड़ें',
  pickDay: 'दिन चुनें।',
  notices: 'आधिकारिक सूचनाएँ',
  theNotice: 'सूचना',
  examDay: 'परीक्षा का दिन',
  examDayHow:
    'प्रवेश पत्र आने पर यहाँ पढ़ें: पूरा दिन उसी से तय होगा — कब पहुँचना है, क्या साथ ले जाना है, और केंद्र दूसरे शहर में हो तो यात्रा।',
  details: 'विवरण',
  category: 'वर्ग (कट-ऑफ के लिए)',
  notSaid: 'नहीं बताया',
  notes: 'नोट',
  notesPlaceholder: 'पद की पसंद, कुछ भी याद रखने लायक',
  neverAsks: 'Cue कभी पोर्टल का पासवर्ड, OTP या जन्मतिथि नहीं माँगता। इन्हें किसी को न बताएँ।',
  saveDetails: 'विवरण सहेजें',
  deleteExam: 'यह परीक्षा हटाएँ',
  confirmDelete: 'यह परीक्षा हटाएँ? आगे की इसकी सारी तारीखें भी हट जाएँगी।',
  confirmClose: 'आगे की इसकी सारी तारीखें भी हट जाएँगी। आगे बढ़ें?',
  since: (stage, when) => `${stage} · ${when}`,
  next: 'अगला',
  centre: 'केंद्र',
  daysToGo: (n) => (n <= 0 ? 'आज परीक्षा है' : n === 1 ? 'कल परीक्षा है' : `परीक्षा में ${n} दिन`),
  study: 'पढ़ाई की योजना',
  studyHow: 'हर विषय अपने दिनों पर, एक ही समय, परीक्षा से एक दिन पहले तक — Today पर, रिमाइंडर के साथ।',
  subjects: 'विषय, हर पंक्ति में एक',
  days: 'दिन',
  at: 'समय',
  forMinutes: 'कितनी देर (मिनट)',
  mockOn: 'मॉक टेस्ट का दिन',
  noMock: 'मॉक टेस्ट नहीं',
  makePlan: 'योजना बनाएँ',
  remakePlan: 'फिर से बनाएँ',
  stopPlan: 'योजना रोकें',
  planRunning: 'चल रही है, इस तारीख तक:',
  mocks: 'मॉक टेस्ट',
  mocksHow: 'हर स्कोर सहेजें, ताकि प्रगति दिखे। या Today पर लिखें: “CGL mock 142/200”।',
  score: 'अंक',
  outOf: 'कुल अंक',
  on: 'तारीख',
  addScore: 'स्कोर जोड़ें',
  best: 'सबसे अच्छा',
  average: 'औसत',
  last: 'पिछला',
  remove: 'हटाएँ',
  weekdays: ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'],
  results: 'परिणाम',
  resultsHow: 'नीचे अपना रोल नंबर जोड़ें; परिणाम की सूची आने पर Cue उसमें आपका नंबर ढूँढेगा।',
  selectedOnList: 'चयनित — आपका नंबर सूची में है',
  inListFor: (round) => `सूची में है${round ? ` — ${round} के लिए` : ''}`,
  inResultList: 'आपका नंबर परिणाम सूची में है',
  notFound: 'इस सूची में नहीं मिला — सूचियाँ अक्सर क्षेत्र, वर्ग या पद के अनुसार बँटी होती हैं',
  page: (n) => `पृष्ठ ${n}`,
  cutoffs: 'कट-ऑफ',
  setCategory: 'अपना वर्ग चुनने के लिए विवरण में वर्ग भरें।',
  lookThrough: 'परिणाम सूची (PDF) में देखें',
  looking: 'देख रहे हैं…',
  foundOnPage: (page, pages) => `मिल गया: आपका नंबर ${pages} में से पृष्ठ ${page} पर है।`,
  notInList: (pages) => `इस सूची में नहीं है (${pages} पृष्ठ पढ़े)। अगर सूची क्षेत्र या वर्ग के अनुसार बँटी है, तो सही भाग देखें।`,
  cardHow:
    'प्रवेश पत्र का PDF चुनें, या उसका टेक्स्ट चिपकाएँ। इसे पढ़कर छोड़ दिया जाता है, रखा नहीं जाता: केवल वही सहेजा जाता है जो आप नीचे सहेजेंगे। स्कैन किया या पासवर्ड वाला PDF नहीं पढ़ा जा सकता; तब विवरण खुद भरें।',
  choosePdf: 'PDF चुनें',
  pasteHere: 'या प्रवेश पत्र का टेक्स्ट यहाँ चिपकाएँ',
  readText: 'टेक्स्ट पढ़ें',
  typeInstead: 'खुद भरें',
  reading: 'पढ़ रहे हैं…',
  checkEach: 'हर पंक्ति प्रवेश पत्र से मिलाएँ, और जो गलत पढ़ा गया हो उसे ठीक करें।',
  newExam: 'नई परीक्षा',
  newSuffix: '(नई)',
  itsName: 'परीक्षा का नाम',
  round: 'चरण',
  examDate: 'परीक्षा तिथि',
  reportingTime: 'रिपोर्टिंग समय',
  gateCloses: 'गेट बंद होने का समय',
  examStarts: 'परीक्षा शुरू',
  examEnds: 'परीक्षा समाप्त',
  centreCity: 'केंद्र का शहर',
  centreAddress: 'केंद्र का पता',
  planDay: 'परीक्षा का दिन तय करें',
  startAgain: 'फिर से शुरू करें',
  dateNeeded: 'परीक्षा तिथि ज़रूरी है।',
  plannedTrip: (city) => `तय हो गया, साथ ले जाने की सूची के साथ। केंद्र ${city} में है: एक दिन पहले से यात्रा, और टिकट बुक करने का रिमाइंडर।`,
  plannedNoHome: 'तय हो गया, साथ ले जाने की सूची के साथ। Settings में अपना शहर जोड़ें, तो दूसरे शहर का केंद्र यात्रा और टिकट रिमाइंडर बन जाएगा।',
  planned: 'तय हो गया, साथ ले जाने की सूची और एक शाम पहले व उसी सुबह के रिमाइंडर के साथ।',
  doneButton: 'ठीक है',
  pickTitle: 'आप किन परीक्षाओं की तैयारी कर रहे हैं?',
  pickHow: 'हर परीक्षा पर टैप करें। उसके चरण, आधिकारिक वेबसाइट और तारीखें साथ आएँगी; रजिस्ट्रेशन नंबर बाद में जोड़ सकते हैं।',
  pickApplied: 'आवेदन कर दिया',
  pickToApply: 'फॉर्म भरना बाकी',
  pickAdd: (n) => (n === 1 ? 'यह परीक्षा जोड़ें' : `ये ${n} परीक्षाएँ जोड़ें`),
  pickOther: 'सूची में नहीं है? परीक्षा जोड़ें',
  disclaimer:
    'Cue किसी भी सरकारी संस्था या परीक्षा बोर्ड से जुड़ा नहीं है। तारीखें और सूचनाएँ बोर्ड की आधिकारिक वेबसाइटों से हैं, जिनका लिंक साथ है — अंतिम जानकारी के लिए आधिकारिक सूचना देखें।',
}

export interface ExamWords extends Words {
  lang: Lang
  /** A stage or round, in this language. */
  stage: (examKey: string | null, key: string) => string
  /** A kind of date, in this language. */
  step: (key: ExamStep) => string
  /** A date and time, as this language writes them. */
  when: (iso: string) => string
  /** A day, as this language writes it. */
  day: (iso: string) => string
  /** "today", "3 days ago". */
  ago: (iso: string) => string
}

export function examWords(lang: Lang): ExamWords {
  const base = lang === 'hi' ? HI : EN
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN'
  return {
    ...base,
    lang,
    stage: (examKey, key) => (lang === 'hi' ? STAGE_HI[key] : null) ?? examStage(examKey, key)?.label ?? key,
    step: (key) => (lang === 'hi' ? STEP_HI[key] : EXAM_STEPS.find((s) => s.key === key)?.label) ?? key,
    when: (iso) => new Date(iso).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
    day: (iso) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }),
    ago: (iso) => {
      const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      const days = Math.round((start(new Date()) - start(new Date(iso))) / 86_400_000)
      if (lang === 'hi') return days <= 0 ? 'आज' : days === 1 ? 'कल' : `${days} दिन पहले`
      return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
    },
  }
}

/** The words for the person signed in. */
export function useExamWords(): ExamWords {
  const { me } = useAuth()
  return examWords(me?.language === 'hi' ? 'hi' : 'en')
}
