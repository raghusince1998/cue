import { EXAM_STEPS, STAGE_HI, STEP_HI, examStage, type ExamLevel, type ExamStep, type ExamTraining, type Lang } from '@cue/shared'
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
    'Every exam you have applied for, or mean to: where it stands, and each date — the last day to apply, the fee, the exam, the result — as a reminder. Cue never signs in to an exam portal; the dates come to you — from the boards’ official notices, from your admit cards and, with your email connected, from the boards’ own emails — so there is little to type.',
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
  noDates:
    'No dates yet. They come here from the official notices as they are published, and from the board’s emails if your email is connected — nothing to type. Know one already? Add it below.',
  noDatesWatched: (board: string) =>
    `No dates yet. Cue reads ${board}’s official notices itself and puts each date here as soon as it is announced — nothing to type.`,
  officialAdded: (n: number) =>
    n === 0
      ? 'Added. Their dates come here from the official notices as they are announced — nothing to type.'
      : `Added, with ${n === 1 ? '1 date' : `${n} dates`} from the official notices already out. The rest come as they are announced.`,
  knowDate: 'Already know a date?',
  openForms: 'Forms open now',
  openFormsHow: 'From the boards’ official notices. Add one, and its dates and reminders come with it.',
  lastDateOn: (day: string) => `Last date ${day}`,
  tentative: 'tentative',
  addThis: 'Add',
  theNoticeLink: 'Notice',
  expectedTitle: 'Expected score',
  expectedHow: 'From the answer key: count your right and wrong answers.',
  right: 'Right',
  wrong: 'Wrong',
  markingKnown: (q: number, r: string, wr: string) => `${q} questions · +${r} for right · −${wr} for wrong (the board’s marking)`,
  markingOther: 'Different marking?',
  questions: 'Questions',
  perRight: 'Marks for right',
  perWrong: 'Taken off for wrong',
  workItOut: 'Work it out',
  expectedIs: (score: string, outOf: string, right: number, wrong: number) => `${score} out of ${outOf} (${right} right, ${wrong} wrong)`,
  cutoffAgainst: (title: string, category: string, marks: string) => `Last cut-off Cue has (${title}): ${category} ${marks}.`,
  aboveBy: (n: string) => `You’d be ${n} above it.`,
  belowBy: (n: string) => `You’d be ${n} below it.`,
  cutoffCaveat: 'Cut-offs move every year, and many are normalised: a guide, not a forecast.',
  tooMany: 'That is more right and wrong answers than there are questions.',
  shareDay: 'Send the exam day to family',
  reportBy: (t: string) => `Report by ${t}`,
  gateAt: (t: string) => `gate closes ${t}`,
  examAt: (from: string, to: string | null) => `exam ${from}${to ? `–${to}` : ''}`,
  centreIs: (c: string) => `Centre: ${c}`,
  mapIs: (url: string) => `Map: ${url}`,
  clashTitle: 'Dates that clash',
  clashSameDay: (a: string, b: string, day: string) =>
    `${a} and ${b} are both on ${day}. If the shifts overlap you can sit only one — check both admit cards for the time.`,
  clashShifts: (a: string, b: string, day: string) =>
    `${a} and ${b} are both on ${day}, at different times in one city: both can be sat if the centres are close.`,
  clashTravel: (a: string, b: string, day: string, from: string, to: string) =>
    `${a} on ${day} in ${from}, then ${b} the next day in ${to}: plan the journey in between.`,
  clashBadge: 'clash',
  studiesTitle: 'What have you studied?',
  studiesHow:
    'Said once, so the forms that fit you come first, and you hear when one opens for an exam like yours. Final year counts. Cue never asks for your date of birth.',
  level: (key: ExamLevel) =>
    ({ '10th': '10th pass', '12th': '12th (or in 12th)', graduate: 'Graduate (or final year)', postgraduate: 'Postgraduate (or final year)' })[key],
  training: (key: ExamTraining) => ({ iti: 'ITI', engineering: 'Engineering diploma or degree', teaching: 'Teacher training (D.El.Ed / B.Ed)' })[key],
  alsoHave: 'Also',
  formAlerts: 'Tell me when a form opens for an exam like mine',
  studiedAs: (said: string) => `You: ${said}`,
  change: 'Change',
  fitsYou: 'fits what you studied',
  usuallyNeeds: (level: ExamLevel, training: readonly ExamTraining[]) =>
    `usually needs ${({ '10th': '10th', '12th': '12th', graduate: 'graduation', postgraduate: 'a postgraduate degree' })[level]}${
      training.length
        ? ` and ${training.map((t) => ({ iti: 'ITI', engineering: 'an engineering diploma or degree', teaching: 'teacher training' })[t]).join(' or ')}`
        : ''
    }`,
  sharedNotPdf: 'Cue reads an admit card from its PDF. For a photo or screenshot, copy its text into the box below, or fill in the details yourself.',
  datesFromNotices: 'Dates come from the official notices. Add one here only if you already know it.',
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
  category: 'Category (for cut-offs, all your exams)',
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
    'हर परीक्षा जिसका फॉर्म भरा है या भरना है: अभी कहाँ है, और हर तारीख — आवेदन की अंतिम तिथि, शुल्क, परीक्षा, परिणाम — एक रिमाइंडर के रूप में। Cue कभी किसी परीक्षा पोर्टल पर लॉग इन नहीं करता; तारीखें खुद आपके पास आती हैं — बोर्ड की आधिकारिक सूचनाओं से, आपके प्रवेश पत्र से, और ईमेल जुड़ा हो तो बोर्ड के ईमेल से — लिखना बहुत कम पड़ता है।',
  noExams: 'अभी कोई परीक्षा नहीं',
  noExamsHow: 'ऊपर जोड़ें, या "आज" पर लिखें:',
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
  noDates:
    'अभी कोई तारीख नहीं। आधिकारिक सूचनाएँ आते ही तारीखें यहाँ जुड़ जाएँगी, और ईमेल जुड़ा हो तो बोर्ड के ईमेल से भी — कुछ लिखना नहीं है। कोई तारीख पहले से पता है? नीचे जोड़ें।',
  noDatesWatched: (board) => `अभी कोई तारीख नहीं। Cue ${board} की आधिकारिक सूचनाएँ खुद पढ़ता है और हर तारीख घोषित होते ही यहाँ जोड़ देगा — कुछ लिखना नहीं है।`,
  officialAdded: (n) =>
    n === 0
      ? 'जोड़ दिया। आधिकारिक सूचनाएँ आते ही उनकी तारीखें यहाँ आ जाएँगी — कुछ लिखना नहीं है।'
      : `जोड़ दिया, अब तक आई आधिकारिक सूचनाओं की ${n} तारीखों के साथ। बाकी घोषित होते ही आ जाएँगी।`,
  knowDate: 'कोई तारीख पहले से पता है?',
  openForms: 'अभी खुले फॉर्म',
  openFormsHow: 'बोर्ड की आधिकारिक सूचनाओं से। जोड़ें, तो उसकी तारीखें और रिमाइंडर साथ आएँगे।',
  lastDateOn: (day) => `अंतिम तिथि ${day}`,
  tentative: 'संभावित',
  addThis: 'जोड़ें',
  theNoticeLink: 'सूचना',
  expectedTitle: 'संभावित अंक',
  expectedHow: 'उत्तर कुंजी से: अपने सही और गलत उत्तर गिनें।',
  right: 'सही',
  wrong: 'गलत',
  markingKnown: (q, r, wr) => `${q} प्रश्न · सही पर +${r} · गलत पर −${wr} (बोर्ड का तरीका)`,
  markingOther: 'अलग अंक-योजना?',
  questions: 'प्रश्न',
  perRight: 'सही पर अंक',
  perWrong: 'गलत पर कटौती',
  workItOut: 'गिनें',
  expectedIs: (score, outOf, right, wrong) => `${outOf} में से ${score} (${right} सही, ${wrong} गलत)`,
  cutoffAgainst: (title, category, marks) => `Cue के पास पिछला कट-ऑफ (${title}): ${category} ${marks}।`,
  aboveBy: (n) => `आप इससे ${n} अंक ऊपर होंगे।`,
  belowBy: (n) => `आप इससे ${n} अंक नीचे होंगे।`,
  cutoffCaveat: 'कट-ऑफ हर साल बदलते हैं और कई सामान्यीकृत होते हैं: यह अंदाज़ा है, भविष्यवाणी नहीं।',
  tooMany: 'सही और गलत मिलाकर प्रश्नों से ज़्यादा हो गए।',
  shareDay: 'परीक्षा का दिन परिवार को भेजें',
  reportBy: (t) => `रिपोर्टिंग ${t}`,
  gateAt: (t) => `गेट बंद ${t}`,
  examAt: (from, to) => `परीक्षा ${from}${to ? `–${to}` : ''}`,
  centreIs: (c) => `केंद्र: ${c}`,
  mapIs: (url) => `नक्शा: ${url}`,
  clashTitle: 'टकराती तारीखें',
  clashSameDay: (a, b, day) => `${a} और ${b} दोनों ${day} को हैं। अगर शिफ्ट एक ही समय की है तो एक ही दे पाएँगे — दोनों प्रवेश पत्र में समय देखें।`,
  clashShifts: (a, b, day) => `${a} और ${b} दोनों ${day} को हैं, एक ही शहर में अलग-अलग समय पर: केंद्र पास हों तो दोनों दे सकते हैं।`,
  clashTravel: (a, b, day, from, to) => `${day} को ${from} में ${a}, फिर अगले दिन ${to} में ${b}: बीच की यात्रा पहले से तय करें।`,
  clashBadge: 'टकराव',
  studiesTitle: 'आपने कहाँ तक पढ़ाई की है?',
  studiesHow:
    'एक बार बताएँ, ताकि आपके लायक फॉर्म पहले दिखें, और आपकी जैसी परीक्षा का फॉर्म खुलने पर आपको बताया जाए। अंतिम वर्ष भी गिना जाता है। Cue कभी आपकी जन्मतिथि नहीं माँगता।',
  level: (key) =>
    ({ '10th': '10वीं पास', '12th': '12वीं (या 12वीं में)', graduate: 'स्नातक (या अंतिम वर्ष)', postgraduate: 'स्नातकोत्तर (या अंतिम वर्ष)' })[key],
  training: (key) => ({ iti: 'ITI', engineering: 'इंजीनियरिंग डिप्लोमा या डिग्री', teaching: 'शिक्षक प्रशिक्षण (D.El.Ed / B.Ed)' })[key],
  alsoHave: 'इसके अलावा',
  formAlerts: 'मेरी जैसी परीक्षा का फॉर्म खुले तो बताएँ',
  studiedAs: (said) => `आप: ${said}`,
  change: 'बदलें',
  fitsYou: 'आपकी पढ़ाई के लायक',
  usuallyNeeds: (level, training) =>
    `आमतौर पर चाहिए: ${({ '10th': '10वीं', '12th': '12वीं', graduate: 'स्नातक', postgraduate: 'स्नातकोत्तर' })[level]}${
      training.length
        ? ` और ${training.map((t) => ({ iti: 'ITI', engineering: 'इंजीनियरिंग डिप्लोमा/डिग्री', teaching: 'शिक्षक प्रशिक्षण' })[t]).join(' या ')}`
        : ''
    }`,
  sharedNotPdf: 'Cue प्रवेश पत्र उसके PDF से पढ़ता है। फोटो या स्क्रीनशॉट हो तो उसका टेक्स्ट नीचे चिपकाएँ, या विवरण खुद भरें।',
  datesFromNotices: 'तारीखें आधिकारिक सूचनाओं से आती हैं। पहले से पता हो तभी यहाँ जोड़ें।',
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
  category: 'वर्ग (कट-ऑफ के लिए, आपकी सभी परीक्षाएँ)',
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
  studyHow: 'हर विषय अपने दिनों पर, एक ही समय, परीक्षा से एक दिन पहले तक — "आज" पर, रिमाइंडर के साथ।',
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
  mocksHow: 'हर स्कोर सहेजें, ताकि प्रगति दिखे। या "आज" पर लिखें: “CGL mock 142/200”।',
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
  plannedNoHome: 'तय हो गया, साथ ले जाने की सूची के साथ। सेटिंग्स में अपना शहर जोड़ें, तो दूसरे शहर का केंद्र यात्रा और टिकट रिमाइंडर बन जाएगा।',
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
