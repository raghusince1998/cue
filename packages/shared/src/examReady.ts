import { EXAM_LEVELS, examByKey, type ExamLevel, type ExamTraining } from './exams.ts'
import { financialYearStart, isRenewedCategory } from './examGlance.ts'
import type { Lang } from './examHindi.ts'

/**
 * Getting ready for a step: what a form asks for before its last date, and
 * what to carry to document verification, the medical and the interview.
 * Attached to that date's plan as its list, fitted to the person — their
 * category, what they studied, and what the exam asks for — so nobody types
 * it out, and nothing is found missing at the counter. What every board
 * asks for, plainly; the notice has the last word, and each list says so.
 */

export type ReadyKind = 'form' | 'dv' | 'medical' | 'interview'

/** Which list a date's plan carries, if any. */
export function readyFor(step: string, round: string | null | undefined): ReadyKind | null {
  if (step === 'apply_by') return 'form'
  if (step !== 'exam' || !round) return null
  if (round === 'dv') return 'dv'
  if (round === 'medical') return 'medical'
  if (round === 'interview' || round === 'ssb') return 'interview'
  return null
}

export interface ReadyPerson {
  category: string | null
  level: ExamLevel | null
  training: readonly string[]
}

type Words = {
  photoSize: string
  tenthForm: string
  tenthProof: string
  level: Record<Exclude<ExamLevel, '10th'>, string>
  finalYear: string
  training: Record<ExamTraining, string>
  trainingEither: (names: string) => string
  or: string
  renewed: (category: string, from: string) => string
  category: (category: string) => string
  idForm: string
  fee: string
  savePdf: string
  callLetterDv: string
  originals: string
  idDv: string
  photosDv: string
  noc: string
  callLetter: string
  glasses: string
  reports: string
  photos: string
  originalsCopies: string
  forms: string
  readForm: string
  notice: string
}

const EN: Words = {
  photoSize: 'Photo and signature at the sizes the notice gives (Cue’s photo tool fits them)',
  tenthForm: '10th marksheet: your name and date of birth in the form must match it exactly',
  tenthProof: '10th marksheet (proof of date of birth)',
  level: {
    '12th': '12th marksheet',
    graduate: 'Graduation marksheets or degree',
    postgraduate: 'Post-graduation marksheets or degree',
  },
  finalYear: ' (in the final year? check the date the notice wants the result by)',
  training: {
    iti: 'ITI certificate (NCVT or SCVT)',
    engineering: 'Engineering diploma or degree',
    teaching: 'Teacher training: B.Ed. or D.El.Ed.',
  },
  trainingEither: (names) => `${names}, as the notice asks`,
  or: ' or ',
  renewed: (category, from) => `${category} certificate issued on or after ${from}, in the format the notice gives`,
  category: (category) => `${category} certificate, in the format the notice gives`,
  idForm: 'Aadhaar or another photo ID: the same one you will carry on the exam day',
  fee: 'Pay the fee, and keep the receipt',
  savePdf: 'Save the filled form as a PDF, and add its registration number to Cue',
  callLetterDv: 'The call letter for document verification, and every admit card so far',
  originals: 'The original of every certificate you gave in the form, with two self-attested copies of each',
  idDv: 'Photo ID: the one you gave in the form',
  photosDv: 'Four to six passport-size photos, the same as in the form',
  noc: 'Working for the government? A no-objection certificate from your office',
  callLetter: 'The call letter, and your photo ID',
  glasses: 'Your glasses or lenses, and their prescription, if you use them',
  reports: 'Reports of any past illness or operation',
  photos: 'Passport-size photos, the same as in the form',
  originalsCopies: 'Originals of your certificates, with self-attested copies',
  forms: 'Any forms the call letter asks for (such as attestation forms), filled in',
  readForm: 'Read your own form again: questions come from what you wrote',
  notice: 'Check the notice for anything more it asks for',
}

const HI: Words = {
  photoSize: 'नोटिस में दिए माप की फोटो और हस्ताक्षर (Cue का फोटो टूल उन्हें ठीक कर देता है)',
  tenthForm: '10वीं की अंकतालिका: फॉर्म में नाम और जन्मतिथि ठीक इसी के अनुसार भरें',
  tenthProof: '10वीं की अंकतालिका (जन्मतिथि का प्रमाण)',
  level: {
    '12th': '12वीं की अंकतालिका',
    graduate: 'स्नातक की अंकतालिकाएँ या डिग्री',
    postgraduate: 'स्नातकोत्तर की अंकतालिकाएँ या डिग्री',
  },
  finalYear: ' (अंतिम वर्ष में हैं? नोटिस में परिणाम की अंतिम तारीख देखें)',
  training: {
    iti: 'ITI प्रमाण पत्र (NCVT या SCVT)',
    engineering: 'इंजीनियरिंग डिप्लोमा या डिग्री',
    teaching: 'शिक्षक प्रशिक्षण: बी.एड. या डी.एल.एड.',
  },
  trainingEither: (names) => `${names}, जैसा नोटिस में माँगा है`,
  or: ' या ',
  renewed: (category, from) => `${from} या उसके बाद बना ${category} प्रमाण पत्र, नोटिस में दिए प्रारूप में`,
  category: (category) => `नोटिस में दिए प्रारूप में ${category} प्रमाण पत्र`,
  idForm: 'आधार या कोई और फोटो पहचान पत्र: वही जो परीक्षा के दिन ले जाएँगे',
  fee: 'शुल्क भरें और रसीद सँभालकर रखें',
  savePdf: 'भरा हुआ फॉर्म PDF में सहेजें, और उसका रजिस्ट्रेशन नंबर Cue में जोड़ें',
  callLetterDv: 'दस्तावेज़ सत्यापन का बुलावा पत्र, और अब तक के सभी प्रवेश पत्र',
  originals: 'फॉर्म में दिए हर प्रमाण पत्र का मूल, और हर एक की दो स्व-सत्यापित प्रतियाँ',
  idDv: 'फोटो पहचान पत्र: वही जो फॉर्म में दिया था',
  photosDv: 'फॉर्म वाली चार से छह पासपोर्ट साइज़ फोटो',
  noc: 'सरकारी नौकरी में हैं? अपने कार्यालय से अनापत्ति प्रमाण पत्र (NOC)',
  callLetter: 'बुलावा पत्र, और फोटो पहचान पत्र',
  glasses: 'चश्मा या लेंस और उसका पर्चा, अगर इस्तेमाल करते हैं',
  reports: 'पहले की किसी बीमारी या ऑपरेशन की रिपोर्ट',
  photos: 'फॉर्म वाली पासपोर्ट साइज़ फोटो',
  originalsCopies: 'प्रमाण पत्रों के मूल, स्व-सत्यापित प्रतियों के साथ',
  forms: 'बुलावा पत्र में माँगे गए फॉर्म (जैसे सत्यापन फॉर्म), भरकर',
  readForm: 'अपना भरा फॉर्म एक बार फिर पढ़ लें: सवाल उसी से पूछे जाते हैं',
  notice: 'नोटिस में और क्या माँगा है, एक बार देख लें',
}

/** The qualifications a form or a verification asks to see: the exam's, and the person's training among those it takes. */
function qualifications(examKey: string | null | undefined, person: ReadyPerson, w: Words, form: boolean): string[] {
  const needs = examByKey(examKey)?.needs
  // Not in the catalog: what the person said they studied is what they will show.
  const level = needs?.level ?? (person.level && person.level !== '10th' ? person.level : null)
  const out: string[] = []
  if (level && level !== '10th') {
    // Not said to have it yet: perhaps in the final year, which many forms allow.
    const has = person.level !== null && EXAM_LEVELS.indexOf(person.level) >= EXAM_LEVELS.indexOf(level)
    out.push(w.level[level] + (form && !has ? w.finalYear : ''))
  }
  const asked = needs?.training ?? []
  if (asked.length > 0) {
    const has = asked.filter((t) => person.training.includes(t))
    out.push(has.length > 0 ? has.map((t) => w.training[t]).join('; ') : w.trainingEither(asked.map((t) => w.training[t]).join(w.or)))
  }
  return out
}

/** The category certificate, for anyone not in the open category. Renewed ones must be this financial year's. */
function categoryLine(person: ReadyPerson, on: Date, lang: Lang, w: Words): string[] {
  const category = person.category
  if (!category || category === 'UR') return []
  if (!isRenewedCategory(category)) return [w.category(category)]
  const from = new Date(`${financialYearStart(on)}T00:00:00`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return [w.renewed(category, from)]
}

/** The list for one step, in the person's language. `on` is the date it is for. */
export function readyList(kind: ReadyKind, examKey: string | null | undefined, person: ReadyPerson, on: Date, lang: Lang = 'en'): string[] {
  const w = lang === 'hi' ? HI : EN
  switch (kind) {
    case 'form':
      return [
        w.photoSize,
        w.tenthForm,
        ...qualifications(examKey, person, w, true),
        ...categoryLine(person, on, lang, w),
        w.idForm,
        w.fee,
        w.savePdf,
      ]
    case 'dv':
      return [
        w.callLetterDv,
        w.originals,
        w.tenthProof,
        ...qualifications(examKey, person, w, false),
        ...categoryLine(person, on, lang, w),
        w.idDv,
        w.photosDv,
        w.noc,
        w.notice,
      ]
    case 'medical':
      return [w.callLetter, w.glasses, w.reports, w.photos, w.notice]
    case 'interview':
      return [w.callLetter, w.originalsCopies, w.forms, w.photos, w.readForm]
  }
}
