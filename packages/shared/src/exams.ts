/**
 * Exams: government jobs, entrance tests, eligibility tests. Each one a
 * person has applied for, or means to, with where it stands (form to fill,
 * applied, a round, the result) and its dates — the last date to apply, the
 * fee, the admit card, the exam, the result — each an ordinary plan with
 * its reminders.
 *
 * Nothing here logs in anywhere. No board offers an outside app a way in,
 * and a portal's password, OTP or captcha is never Cue's to hold: dates come
 * from what the person types, and from the admit card they hand over.
 */
import { findCity } from './cities.ts'
import { parseWhen } from './parseWhen.ts'
import { mockScoreIn } from './study.ts'

export interface ExamRound {
  key: string
  label: string
}

export interface CatalogExam {
  key: string
  name: string
  /** Who holds it. */
  body: string
  /** The official site, where notices and results go up. */
  site: string | null
  /** Where the form is filled, when that is somewhere else. */
  applyAt?: string
  scope: 'national' | 'rajasthan'
  /** How people write it: regular-expression sources, matched as whole words. */
  aliases: string[]
  /** Short names that are everyday words in lower case ("gate", "cat"): only in capitals. */
  capitals?: string[]
  rounds: ExamRound[]
  /** For exams held region by region: the boards to choose from. */
  regions?: readonly string[]
  /** Carried on the day besides what every exam asks for. */
  carry?: string[]
}

const R = {
  cbt: { key: 'cbt', label: 'CBT' },
  cbt1: { key: 'cbt1', label: 'CBT 1' },
  cbt2: { key: 'cbt2', label: 'CBT 2' },
  tier1: { key: 'tier1', label: 'Tier 1' },
  tier2: { key: 'tier2', label: 'Tier 2' },
  paper1: { key: 'paper1', label: 'Paper 1' },
  paper2: { key: 'paper2', label: 'Paper 2' },
  prelims: { key: 'prelims', label: 'Prelims' },
  mains: { key: 'mains', label: 'Mains' },
  phase1: { key: 'phase1', label: 'Phase 1' },
  phase2: { key: 'phase2', label: 'Phase 2' },
  session1: { key: 'session1', label: 'Session 1' },
  session2: { key: 'session2', label: 'Session 2' },
  written: { key: 'written', label: 'Written exam' },
  exam: { key: 'exam', label: 'Exam' },
  interview: { key: 'interview', label: 'Interview' },
  dv: { key: 'dv', label: 'Document verification' },
  medical: { key: 'medical', label: 'Medical' },
  pet: { key: 'pet', label: 'Physical test' },
  skill: { key: 'skill', label: 'Skill test' },
  typing: { key: 'skill', label: 'Typing test' },
  ssb: { key: 'ssb', label: 'SSB interview' },
  counselling: { key: 'counselling', label: 'Counselling' },
} satisfies Record<string, ExamRound>

const as = (r: ExamRound, label: string): ExamRound => ({ key: r.key, label })

/** The railway recruitment boards, each a region of its own. */
export const RRB_REGIONS = [
  'Ahmedabad', 'Ajmer', 'Bengaluru', 'Bhopal', 'Bhubaneswar', 'Bilaspur', 'Chandigarh', 'Chennai', 'Gorakhpur',
  'Guwahati', 'Jammu-Srinagar', 'Kolkata', 'Malda', 'Mumbai', 'Muzaffarpur', 'Patna', 'Prayagraj', 'Ranchi',
  'Secunderabad', 'Siliguri', 'Thiruvananthapuram',
].map((city) => `RRB ${city}`)

const RRB = { body: 'Railway Recruitment Boards', site: 'https://www.rrbapply.gov.in', scope: 'national', regions: RRB_REGIONS } as const
const SSC = { body: 'Staff Selection Commission', site: 'https://ssc.gov.in', scope: 'national' } as const
const UPSC = { body: 'Union Public Service Commission', site: 'https://upsc.gov.in', applyAt: 'https://upsconline.gov.in', scope: 'national' } as const
const IBPS = { body: 'IBPS', site: 'https://www.ibps.in', scope: 'national' } as const
const SBI = { body: 'State Bank of India', site: 'https://sbi.bank.in/web/careers', scope: 'national' } as const
const RBI = { body: 'Reserve Bank of India', site: 'https://opportunities.rbi.org.in', scope: 'national' } as const
const NTA = { body: 'National Testing Agency', scope: 'national' } as const
const RPSC = { body: 'Rajasthan Public Service Commission', site: 'https://rpsc.rajasthan.gov.in', applyAt: 'https://sso.rajasthan.gov.in', scope: 'rajasthan' } as const
const RSSB = { body: 'Rajasthan Staff Selection Board', site: 'https://rssb.rajasthan.gov.in', applyAt: 'https://sso.rajasthan.gov.in', scope: 'rajasthan' } as const
const NTA_CARRY = ['The self-declaration (undertaking) on the admit card, filled in, with a photo pasted']

/**
 * The exams people most often apply for, nationally and in Rajasthan. The
 * rounds are the usual ones; a notification can change them, and the person
 * can always move a stage by hand.
 */
export const EXAMS: CatalogExam[] = [
  // Railways
  { key: 'rrb-ntpc', name: 'RRB NTPC', ...RRB, aliases: ['rrb\\s*ntpc', 'railway\\s*ntpc', 'ntpc\\s+(?:cbt|graduate|under\\s*graduate|ug)'], rounds: [R.cbt1, R.cbt2, as(R.skill, 'Typing / skill test'), R.dv, R.medical] },
  { key: 'rrb-group-d', name: 'RRB Group D', ...RRB, aliases: ['(?:rrb|rrc|railway)\\s*group[\\s-]*d', 'group[\\s-]*d\\s+(?:railway|rrb)', 'level[\\s-]*1\\s+posts'], rounds: [R.cbt, R.pet, R.dv, R.medical] },
  { key: 'rrb-alp', name: 'RRB ALP (Assistant Loco Pilot)', ...RRB, aliases: ['(?:rrb|railway)\\s*alp', 'assistant\\s+loco\\s+pilot'], rounds: [R.cbt1, R.cbt2, as(R.skill, 'CBAT (aptitude test)'), R.dv, R.medical] },
  { key: 'rrb-je', name: 'RRB JE', ...RRB, aliases: ['(?:rrb|railway)\\s*je', 'rrb\\s+junior\\s+engineer'], rounds: [R.cbt1, R.cbt2, R.dv, R.medical] },
  { key: 'rrb-technician', name: 'RRB Technician', ...RRB, aliases: ['(?:rrb|railway)\\s*technician'], rounds: [R.cbt, R.dv, R.medical] },
  { key: 'rpf', name: 'RPF Constable / SI', ...RRB, aliases: ['rpf(?:\\s+(?:constable|si|sub[\\s-]*inspector))?', 'railway\\s+protection\\s+force'], rounds: [R.cbt, as(R.pet, 'PET & PMT'), R.dv] },

  // Staff Selection Commission
  { key: 'ssc-cgl', name: 'SSC CGL', ...SSC, aliases: ['ssc\\s*cgl', 'cgl', 'combined\\s+graduate\\s+level'], rounds: [R.tier1, R.tier2, R.dv] },
  { key: 'ssc-chsl', name: 'SSC CHSL', ...SSC, aliases: ['ssc\\s*chsl', 'chsl', 'combined\\s+higher\\s+secondary'], rounds: [R.tier1, as(R.tier2, 'Tier 2 (with skill test)'), R.dv] },
  { key: 'ssc-mts', name: 'SSC MTS & Havaldar', ...SSC, aliases: ['ssc\\s*mts', 'multi[\\s-]tasking\\s+staff'], rounds: [R.cbt, as(R.pet, 'PET/PST (Havaldar)'), R.dv] },
  { key: 'ssc-gd', name: 'SSC GD Constable', ...SSC, aliases: ['ssc\\s*gd', 'gd\\s+constable'], rounds: [R.cbt, as(R.pet, 'PET/PST'), R.medical, R.dv] },
  { key: 'ssc-cpo', name: 'SSC CPO (SI in Delhi Police & CAPFs)', ...SSC, aliases: ['ssc\\s*cpo', 'delhi\\s+police\\s+si'], rounds: [R.paper1, as(R.pet, 'PET/PST'), R.paper2, R.medical] },
  { key: 'ssc-je', name: 'SSC JE', ...SSC, aliases: ['ssc\\s*je', 'ssc\\s+junior\\s+engineer'], rounds: [R.paper1, R.paper2, R.dv] },
  { key: 'ssc-steno', name: 'SSC Stenographer', ...SSC, aliases: ['ssc\\s*steno(?:grapher)?'], rounds: [R.cbt, R.skill, R.dv] },
  { key: 'ssc-selection-post', name: 'SSC Selection Post', ...SSC, aliases: ['ssc\\s+selection\\s+posts?', 'ssc\\s+phase[\\s-]*(?:[ivx]+|\\d+)'], rounds: [R.cbt, R.dv] },

  // Union Public Service Commission
  { key: 'upsc-cse', name: 'UPSC Civil Services', ...UPSC, aliases: ['upsc\\s*cse', 'upsc\\s+civil\\s+services?', 'civil\\s+services?\\s+(?:exam|prelims|mains)', 'civil\\s+services\\s*\\(\\s*(?:preliminary|main)\\s*\\)', 'civil\\s+services\\s+examination', 'ias\\s+(?:exam|prelims|mains)', 'upsc'], rounds: [R.prelims, R.mains, as(R.interview, 'Interview (personality test)')] },
  { key: 'upsc-nda', name: 'UPSC NDA & NA', ...UPSC, aliases: ['upsc\\s+nda', 'nda\\s*(?:&|and)\\s*na', 'nda\\s+(?:exam|[12]|i{1,2}|20\\d\\d)'], rounds: [R.written, R.ssb, R.medical] },
  { key: 'upsc-cds', name: 'UPSC CDS', ...UPSC, aliases: ['upsc\\s+cds', 'cds\\s+(?:exam|[12]|i{1,2}|20\\d\\d)'], rounds: [R.written, R.ssb, R.medical] },
  { key: 'upsc-capf', name: 'UPSC CAPF (Assistant Commandant)', ...UPSC, aliases: ['upsc\\s+capf', 'capf\\s*\\(?ac\\)?', 'capf\\s+assistant\\s+commandant'], rounds: [R.written, as(R.pet, 'Physical & medical tests'), R.interview] },
  { key: 'upsc-ese', name: 'UPSC Engineering Services (ESE)', ...UPSC, aliases: ['upsc\\s+ese', 'ies\\s*/\\s*ese', '(?:upsc\\s+)?engineering\\s+services(?:\\s+exam)?'], rounds: [R.prelims, R.mains, R.interview] },

  // Banks and insurers
  { key: 'ibps-po', name: 'IBPS PO', ...IBPS, aliases: ['ibps\\s*po', 'crp[\\s-]*po(?:\\s*/\\s*mt)?'], rounds: [R.prelims, R.mains, R.interview] },
  { key: 'ibps-clerk', name: 'IBPS Clerk', ...IBPS, aliases: ['ibps\\s*clerk', 'crp[\\s-]*clerks?'], rounds: [R.prelims, R.mains] },
  { key: 'ibps-rrb', name: 'IBPS RRB (Gramin Bank)', ...IBPS, aliases: ['ibps\\s*rrb', 'crp[\\s-]*rrbs?','rrb\\s*(?:po|clerk|officer\\s+scale|office\\s+assistant)', 'gramin\\s+bank'], rounds: [R.prelims, R.mains, as(R.interview, 'Interview (officers)')] },
  { key: 'ibps-so', name: 'IBPS SO', ...IBPS, aliases: ['ibps\\s*so', 'crp[\\s-]*spl'], rounds: [R.prelims, R.mains, R.interview] },
  { key: 'sbi-po', name: 'SBI PO', ...SBI, aliases: ['sbi\\s*po', 'sbi\\s+probationary\\s+officers?'], rounds: [R.prelims, R.mains, as(R.interview, 'Interview & group exercise')] },
  { key: 'sbi-clerk', name: 'SBI Clerk (Junior Associate)', ...SBI, aliases: ['sbi\\s*clerk', 'sbi\\s+junior\\s+associates?'], rounds: [R.prelims, R.mains, { key: 'language', label: 'Language test' }] },
  { key: 'rbi-grade-b', name: 'RBI Grade B', ...RBI, aliases: ['rbi\\s*grade[\\s-]*b'], rounds: [R.phase1, R.phase2, R.interview] },
  { key: 'rbi-assistant', name: 'RBI Assistant', ...RBI, aliases: ['rbi\\s*assistant'], rounds: [R.prelims, R.mains, { key: 'language', label: 'Language test (LPT)' }] },
  { key: 'lic-aao', name: 'LIC AAO', body: 'Life Insurance Corporation', site: 'https://licindia.in', scope: 'national', aliases: ['lic\\s*aao'], rounds: [R.prelims, R.mains, R.interview] },

  // Entrance and eligibility tests
  { key: 'jee-main', name: 'JEE Main', ...NTA, site: 'https://jeemain.nta.nic.in', aliases: ['jee\\s*mains?', 'jee\\s*\\(\\s*main\\s*\\)'], rounds: [R.session1, R.session2], carry: NTA_CARRY },
  { key: 'jee-advanced', name: 'JEE Advanced', body: 'IITs', site: 'https://jeeadv.ac.in', scope: 'national', aliases: ['jee\\s*adv(?:anced)?'], rounds: [R.exam] },
  { key: 'neet-ug', name: 'NEET UG', ...NTA, site: 'https://neet.nta.nic.in', aliases: ['neet(?!\\s*pg)(?:\\s*ug)?'], rounds: [R.exam, R.counselling], carry: [...NTA_CARRY, 'A postcard-size photo (4" × 6"), as the admit card asks'] },
  { key: 'cuet-ug', name: 'CUET UG', ...NTA, site: 'https://cuet.nta.nic.in', aliases: ['cuet(?:\\s*ug)?'], rounds: [R.exam], carry: NTA_CARRY },
  { key: 'ugc-net', name: 'UGC NET', ...NTA, site: 'https://ugcnet.nta.ac.in', aliases: ['ugc[\\s-]*net'], rounds: [R.exam], carry: NTA_CARRY },
  { key: 'csir-net', name: 'CSIR NET', ...NTA, site: 'https://csirnet.nta.ac.in', aliases: ['csir[\\s-]*(?:ugc[\\s-]*)?net'], rounds: [R.exam], carry: NTA_CARRY },
  { key: 'gate', name: 'GATE', body: 'IISc and the IITs (a different one each year)', site: null, scope: 'national', aliases: ['gate\\s+(?:exam|20\\d\\d)'], capitals: ['GATE'], rounds: [R.exam] },
  { key: 'cat', name: 'CAT', body: 'IIMs', site: 'https://iimcat.ac.in', scope: 'national', aliases: ['iim\\s+cat', 'cat\\s+(?:exam|20\\d\\d)'], capitals: ['CAT'], rounds: [R.exam, as(R.interview, 'WAT & interview')] },
  { key: 'clat', name: 'CLAT', body: 'Consortium of NLUs', site: 'https://consortiumofnlus.ac.in', scope: 'national', aliases: ['clat'], rounds: [R.exam, R.counselling] },
  { key: 'ctet', name: 'CTET', body: 'CBSE', site: 'https://ctet.nic.in', scope: 'national', aliases: ['ctet'], rounds: [R.exam] },

  // Defence
  { key: 'agniveer-army', name: 'Army Agniveer', body: 'Indian Army', site: 'https://joinindianarmy.nic.in', scope: 'national', aliases: ['(?:army\\s+)?agniveer', 'agnipath'], rounds: [as(R.cbt, 'Online exam (CEE)'), { key: 'rally', label: 'Recruitment rally' }, R.medical] },
  { key: 'afcat', name: 'AFCAT', body: 'Indian Air Force', site: 'https://careerindianairforce.cdac.in', scope: 'national', aliases: ['afcat'], rounds: [as(R.exam, 'Online exam'), as(R.ssb, 'AFSB interview'), R.medical] },

  // Rajasthan
  { key: 'ras', name: 'RAS/RTS', ...RPSC, capitals: ['RAS'], aliases: ['rpsc\\s+ras', 'ras(?:\\s*/\\s*rts)?\\s+(?:exam|pre(?:lims)?|mains|20\\d\\d)', 'ras\\s*/\\s*rts\\s+combined', 'raj(?:asthan|\\.)?\\s+state\\s+(?:and|&)\\s+sub(?:ordinate|\\.)?\\s+services'], rounds: [R.prelims, R.mains, R.interview] },
  { key: 'rpsc-school-lecturer', name: 'RPSC School Lecturer', ...RPSC, aliases: ['(?:rpsc\\s+)?school\\s+lecturer', '(?:1st|first)\\s+grade\\s+(?:teacher|lecturer)'], rounds: [R.written, R.dv] },
  { key: 'rpsc-senior-teacher', name: 'RPSC Senior Teacher (2nd Grade)', ...RPSC, aliases: ['(?:rpsc\\s+)?senior\\s+teacher', '(?:2nd|second)\\s+grade\\s+teacher'], rounds: [R.written, R.dv] },
  { key: 'raj-police-si', name: 'Rajasthan Police SI', ...RPSC, aliases: ['raj(?:asthan)?\\s+police\\s+si', 'rajasthan\\s+si', 'rpsc\\s+si', 'rpsc\\s+sub[\\s-]*inspector'], rounds: [R.written, as(R.pet, 'PET'), R.interview] },
  { key: 'raj-police-constable', name: 'Rajasthan Police Constable', body: 'Rajasthan Police', site: 'https://police.rajasthan.gov.in', applyAt: 'https://recruitment.rajasthan.gov.in', scope: 'rajasthan', aliases: ['raj(?:asthan)?\\s+police(?:\\s+constable)?', 'rajasthan\\s+constable'], rounds: [R.written, as(R.pet, 'PET/PST'), as(R.dv, 'DV & medical')] },
  { key: 'reet', name: 'REET', body: 'Board of Secondary Education, Rajasthan', site: 'https://rajeduboard.rajasthan.gov.in', scope: 'rajasthan', aliases: ['reet(?!\\s+mains)(?:\\s+level[\\s-]*(?:1|2|i{1,2}))?'], rounds: [R.exam] },
  { key: 'reet-mains', name: 'REET Mains (3rd Grade Teacher)', ...RSSB, aliases: ['reet\\s+mains', '(?:3rd|third)\\s+grade\\s+teacher'], rounds: [R.written, R.dv] },
  { key: 'rssb-cet', name: 'Rajasthan CET', ...RSSB, aliases: ['(?:rajasthan|rssb|rsmssb)\\s+cet', 'cet\\s+(?:graduate|senior\\s+secondary|12th)'], rounds: [R.exam] },
  { key: 'rssb-patwari', name: 'Rajasthan Patwari', ...RSSB, aliases: ['patwari'], rounds: [R.written, R.dv] },
  { key: 'rssb-vdo', name: 'Rajasthan VDO (Gram Vikas Adhikari)', ...RSSB, aliases: ['vdo', 'gram\\s+vikas\\s+adhikari', 'village\\s+development\\s+officer'], rounds: [R.written, R.dv] },
  { key: 'rssb-ldc', name: 'Rajasthan LDC / Junior Assistant', ...RSSB, aliases: ['(?:rajasthan|rssb|rsmssb)\\s+(?:ldc|junior\\s+assistant|clerk\\s+grade[\\s-]*(?:ii|2))'], rounds: [R.written, R.typing, R.dv] },
  { key: 'rssb-fourth-grade', name: 'Rajasthan Class IV (Fourth Grade)', ...RSSB, aliases: ['(?:rajasthan|rssb|rsmssb)\\s+(?:4th|fourth)\\s+grade', 'chaturth\\s+shreni', 'rajasthan\\s+class\\s+iv', '(?:4th|fourth)\\s+grade\\s+(?:exam|bharti|recruitment)'], rounds: [R.written, R.dv] },
  { key: 'raj-high-court', name: 'Rajasthan High Court (LDC / JJA)', body: 'Rajasthan High Court', site: 'https://hcraj.nic.in', scope: 'rajasthan', aliases: ['rajasthan\\s+high\\s+court\\s*\\(?\\s*(?:ldc|clerk|jja|junior\\s+judicial\\s+assistant|exam|recruitment)'], rounds: [R.written, R.typing, R.dv] },
]

export function examByKey(key: string | null | undefined): CatalogExam | null {
  return EXAMS.find((e) => e.key === key) ?? null
}

/** Every alias, longest first, so "rajasthan police si" is found before "rajasthan police". */
const ALIASES = EXAMS.flatMap((exam) => [
  ...exam.aliases.map((source) => ({ exam, source, flags: 'iu' })),
  ...(exam.capitals ?? []).map((source) => ({ exam, source, flags: 'u' })),
])
  .sort((a, b) => b.source.length - a.source.length)
  .map(({ exam, source, flags }) => ({ exam, re: new RegExp(`(?<![\\p{L}\\d])(?:${source})(?![\\p{L}\\d])`, flags) }))

/** The exam a line or a document is about, if it is one in the list. */
export function findExam(text: string): { exam: CatalogExam; at: number; length: number } | null {
  let best: { exam: CatalogExam; at: number; length: number } | null = null
  for (const { exam, re } of ALIASES) {
    const m = re.exec(text)
    if (m && (!best || m[0].length > best.length)) best = { exam, at: m.index, length: m[0].length }
  }
  return best
}

// ── Stages ───────────────────────────────────────────────────────────────

export interface ExamStage {
  key: string
  label: string
  closed?: 'won' | 'lost'
}

/** Before the form, after it, each round, and how it ended. */
export function examStages(examKey: string | null | undefined): ExamStage[] {
  const rounds = examByKey(examKey)?.rounds ?? [R.exam]
  return [
    { key: 'to_apply', label: 'Form to fill' },
    { key: 'applied', label: 'Applied' },
    ...rounds,
    { key: 'selected', label: 'Selected', closed: 'won' },
    { key: 'not_selected', label: 'Not this time', closed: 'lost' },
    { key: 'dropped', label: 'Dropped', closed: 'lost' },
  ]
}

export function examStage(examKey: string | null | undefined, stage: string): ExamStage | null {
  return examStages(examKey).find((s) => s.key === stage) ?? null
}

export function isOpenExamStage(examKey: string | null | undefined, stage: string): boolean {
  return !examStage(examKey, stage)?.closed
}

/** Further along than `than`: a round comes after applying, and after the round before it. */
export function isLaterExamStage(examKey: string | null | undefined, stage: string, than: string): boolean {
  const order = examStages(examKey).map((s) => s.key)
  return order.indexOf(stage) > order.indexOf(than)
}

// ── Dates ────────────────────────────────────────────────────────────────

export const EXAM_STEPS = [
  { key: 'apply_by', label: 'Last date to apply' },
  { key: 'fee_by', label: 'Last date for the fee' },
  { key: 'correction', label: 'Correction window' },
  { key: 'admit_card', label: 'Admit card out' },
  { key: 'exam', label: 'Exam' },
  { key: 'answer_key', label: 'Answer key' },
  { key: 'result', label: 'Result' },
  { key: 'other', label: 'Something else' },
] as const
export type ExamStep = (typeof EXAM_STEPS)[number]['key']
export const EXAM_STEP_KEYS = EXAM_STEPS.map((s) => s.key) as [ExamStep, ...ExamStep[]]

/** "RRB NTPC 2026", or just its name. */
export function examLabel(e: { name: string; cycle?: string | null }): string {
  return e.cycle && !e.name.includes(e.cycle) ? `${e.name} ${e.cycle}` : e.name
}

/** What a date's plan is called. */
export function examStepTitle(
  e: { name: string; cycle?: string | null; examKey?: string | null },
  step: ExamStep,
  round?: string | null,
  note?: string | null,
): string {
  const label = examLabel(e)
  const roundLabel = round ? examStage(e.examKey, round)?.label : null
  switch (step) {
    case 'apply_by':
      return `Last date to apply: ${label}`
    case 'fee_by':
      return `Pay the fee: ${label}`
    case 'correction':
      return `Correction window: ${label}`
    case 'admit_card':
      return `Download the admit card: ${label}${roundLabel ? ` ${roundLabel}` : ''}`
    case 'exam':
      return `Exam: ${label}${roundLabel && roundLabel !== 'Exam' ? ` ${roundLabel}` : ''}`
    case 'answer_key':
      return `Answer key: ${label}`
    case 'result':
      return `Result: ${label}${roundLabel && roundLabel !== 'Exam' ? ` ${roundLabel}` : ''}`
    default:
      return note ? `${label}: ${note}` : label
  }
}

/** A date's step, and the round it is for, as stored with its plan ("exam:cbt1"). */
export function splitExamStep(stored: string | null): { step: ExamStep; round: string | null } | null {
  if (!stored) return null
  const [step, round] = stored.split(':')
  if (!EXAM_STEP_KEYS.includes(step as ExamStep)) return null
  return { step: step as ExamStep, round: round || null }
}

/** What to carry on the day: what every exam asks for, and this one's own. */
export function examDayCarry(examKey: string | null | undefined): string[] {
  return [
    'Admit card, printed',
    'Original photo ID: Aadhaar, PAN, voter ID, passport or driving licence',
    'Two passport-size photos, the same as in the form',
    ...(examByKey(examKey)?.carry ?? []),
    'A blue or black ball pen, if the admit card allows one',
  ]
}

// ── Reading a line ───────────────────────────────────────────────────────

/** Words for each round, as people write them. */
const ROUND_WORDS: Record<string, RegExp> = {
  cbt1: /\bcbt[\s-]*(?:1|i|one)\b|\bfirst\s+stage\s+cbt\b|\bstage[\s-]*(?:1|i)\b/i,
  cbt2: /\bcbt[\s-]*(?:2|ii|two)\b|\bsecond\s+stage\s+cbt\b|\bstage[\s-]*(?:2|ii)\b/i,
  cbt: /\bcbt\b|\bcomputer[\s-]based\s+test\b|\bcee\b/i,
  tier1: /\btier[\s-]*(?:1|i|one)\b/i,
  tier2: /\btier[\s-]*(?:2|ii|two)\b/i,
  paper1: /\bpaper[\s-]*(?:1|i)\b/i,
  paper2: /\bpaper[\s-]*(?:2|ii)\b/i,
  prelims: /\bprelims?\b|\bpreliminary\b|\bpre\b(?![\s-]*(?:board|primary|school))/i,
  mains: /\bmains\b|\bmain\s+exam(?:ination)?\b|\(\s*main\s*\)/i,
  phase1: /\bphase[\s-]*(?:1|i)\b/i,
  phase2: /\bphase[\s-]*(?:2|ii)\b/i,
  session1: /\bsession[\s-]*(?:1|i)\b|\bjanuary\s+session\b/i,
  session2: /\bsession[\s-]*(?:2|ii)\b|\bapril\s+session\b/i,
  written: /\bwritten\b/i,
  interview: /\binterview\b|\bpersonality\s+test\b|\bwat\b/i,
  dv: /\bdv\b|\bdocument\s+verification\b/i,
  medical: /\bmedical\b/i,
  pet: /\bpet\b|\bpst\b|\bpmt\b|\bphysical\s+(?:test|efficiency)\b/i,
  skill: /\bskill\s+test\b|\btyping\s+test\b|\bcbat\b|\btst\b/i,
  ssb: /\bssb\b|\bafsb\b/i,
  rally: /\brally\b/i,
  language: /\blanguage\s+(?:proficiency\s+)?test\b|\blpt\b|\bllt\b/i,
  counselling: /\bcounsell?ing\b/i,
}

/** The round of this exam a text names, if any. */
export function roundIn(examKey: string | null | undefined, text: string): string | null {
  const rounds = examByKey(examKey)?.rounds ?? [R.exam]
  return rounds.find((r) => ROUND_WORDS[r.key]?.test(text))?.key ?? null
}

/** Practice and study about an exam is a plan, not the exam. */
const PRACTICE = /\b(?:mock|practice|revise|revision|study|studying|prepare|preparing|preparation|coaching|class(?:es)?|lecture|syllabus|test\s+series|padhai)\b/i
/** Words that make a line about an exam a fact about it. */
const ABOUT_IT =
  /\b(?:applied|apply|applying|registered|registration|reg\.?\s*no|application\s*(?:no|number|id)|form|last\s+date|fee|roll\s*(?:no|number)|admit\s+card|hall\s+ticket|call\s+letter|result|answer\s+key|cut[\s-]?off|correction|exam\s+(?:date|on|is)|paper\s+(?:on|is)|cleared|qualified|selected)\b/i

/** One date said in a line: what it is for, the day, and the time if one was said. */
export interface ExamDateSaid {
  step: ExamStep
  on: string
  at: string | null
  round: string | null
}

export interface ParsedExamLine {
  examKey: string
  name: string
  cycle: string | null
  region: string | null
  registrationNo: string | null
  rollNo: string | null
  /** Where it stands now, when the line says: applied, to apply, a round cleared. */
  stage: string | null
  dates: ExamDateSaid[]
  /** A mock test's score, when that is what the line was. */
  mock?: { score: number; outOf: number } | null
}

/** Hindi month names, for dates written in Hindi. */
const HINDI_MONTH_NAMES: Record<string, string> = {
  जनवरी: 'Jan', फरवरी: 'Feb', मार्च: 'Mar', अप्रैल: 'Apr', मई: 'May', जून: 'Jun', जुलाई: 'Jul', अगस्त: 'Aug',
  सितंबर: 'Sep', सितम्बर: 'Sep', अक्टूबर: 'Oct', अक्तूबर: 'Oct', नवंबर: 'Nov', नवम्बर: 'Nov', दिसंबर: 'Dec', दिसम्बर: 'Dec',
}
const HINDI_MONTHS = /जनवरी|फ़?फरवरी|फ़रवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|अक्तूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर/g

/** The same, said in Hinglish or Hindi: "form bhar diya", "परीक्षा 15 नवंबर को", "admit card aa gaya". */
const HINGLISH_ABOUT_IT =
  /\b(?:bhar\s+(?:diya|dia|di|liya)|bharna\s+(?:hai|h)|apply\s+kar(?:na)?|aa\s+gaya|aa\s+gya|ho\s+gaya|nikal\s+gaya|pariksha|paper\s+hai)\b|फॉर्म|फार्म|आवेदन|परीक्षा|प्रवेश\s+पत्र|परिणाम|रिजल्ट|अंतिम\s+तिथि|पास\s+हो|चयन/i

const pad = (n: number) => String(n).padStart(2, '0')
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** A number with a digit in it: "registered" is not a registration number. */
const NUMBER = String.raw`((?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{4,24})\b`
const REG_NO = new RegExp(String.raw`\b(?:reg(?:istration)?\b\.?\s*(?:no\.?|number|id)?|application\s*(?:no\.?|number|id))\s*(?:is\s*)?[:#-]?\s*` + NUMBER, 'i')
const ROLL_NO = new RegExp(String.raw`\broll\s*(?:no\.?|number)\s*(?:is\s*)?[:#-]?\s*` + NUMBER, 'i')

export const registrationNoIn = (text: string): string | null => REG_NO.exec(text)?.[1] ?? null
export const rollNoIn = (text: string): string | null => ROLL_NO.exec(text)?.[1] ?? null

/**
 * Which year or notice of an exam a text means: "CEN 05/2024" anywhere, or
 * a year just after the exam's name — "RRB NTPC 2026", "Combined Graduate
 * Level Examination, 2026", "NEET (UG) – 2027".
 */
export function cycleIn(text: string, found: { at: number; length: number }): { cycle: string | null; cen: RegExpExecArray | null; year: string | null } {
  const after = text.slice(found.at + found.length)
  const cen = /\bcen\s*(?:no\.?\s*)?(\d{1,2}\s*\/\s*20\d\d)\b/i.exec(text)
  const year =
    /^[\s,(\-–)]*(?:\((?:ug|pg|main|mains|preliminary)\)\s*)?(?:(?:level\s+)?exam(?:ination)?s?)?[\s,(\-–]*(20\d\d)(?:\s*[-–/]\s*(?:20)?\d\d)?\b/i.exec(after)?.[1] ?? null
  // Or a little further on, with only words between: "RAJ. STATE AND SUB.
  // SERVICES COMB. COMP EXAM 2026". Never a date's year: "20/11/2026".
  const near = year ?? /^[^:—|\n\d]{0,40}?(?<![\d/.-])(20\d\d)\b(?![/.-]\d)/.exec(after)?.[1] ?? null
  return { cycle: cen ? `CEN ${cen[1]!.replace(/\s+/g, '')}` : near, cen, year: near }
}

/** Which date a stretch of a line is about. */
export function examStepOf(part: string): ExamStep | null {
  return stepOf(part)
}

function stepOf(part: string): ExamStep | null {
  const fee = /\bfee\b|\bfees\b|शुल्क|फीस/i.test(part)
  if (/\b(?:last\s+date|apply\s+(?:by|before|till)|form\s+(?:by|till|closes)|fill\s+(?:the\s+)?form|registration\s+(?:closes|ends)|last\s+day)\b|अंतिम\s+तिथि|आखिरी\s+तारीख/i.test(part) && !fee) return 'apply_by'
  if (fee) return 'fee_by'
  if (/\bcorrection\b|\bedit\s+window\b|सुधार/i.test(part)) return 'correction'
  if (/\badmit\s+card\b|\bhall\s+ticket\b|\bcall\s+letter\b|प्रवेश\s+पत्र/i.test(part)) return 'admit_card'
  if (/\banswer\s+key\b|उत्तर\s+कुंजी/i.test(part)) return 'answer_key'
  if (/\bresult\b|\bcut[\s-]?off\b|\bmerit\s+list\b|परिणाम|रिजल्ट/i.test(part)) return 'result'
  if (/\bexam\b|\bpaper\b|\btest\b|\bpariksha\b|परीक्षा|पेपर/i.test(part)) return 'exam'
  return null
}

/**
 * A line about an exam in the list: "applied for RRB NTPC 2026, RRB Ajmer,
 * reg no 123456", "SSC CGL tier 1 exam on 12 sep", "REET form last date 20
 * nov". Null for anything else — including studying for one, which is a plan.
 */
export function parseExamLine(raw: string, now = new Date()): ParsedExamLine | null {
  // Hindi months to English, so a date in either is read: "15 नवंबर" is 15 Nov.
  const text = raw.replace(HINDI_MONTHS, (m) => HINDI_MONTH_NAMES[m.replace('़', '')] ?? m)
  const found = findExam(text)
  if (!found) return null
  const { exam } = found
  // A mock test's score, before anything else: practice, but worth keeping.
  const mock = mockScoreIn(text)
  if (mock) {
    return { examKey: exam.key, name: exam.name, cycle: cycleIn(text, found).cycle, region: null, registrationNo: null, rollNo: null, stage: null, dates: [], mock }
  }
  const round = roundIn(exam.key, text)
  const practice = PRACTICE.test(text)
  if (!ABOUT_IT.test(text) && !HINGLISH_ABOUT_IT.test(text)) {
    // "UPSC prelims 24 may": a round and a day is the exam's date. Studying
    // for it on a day is not.
    const roundNamed = round !== null || /\bexam\b|\bpaper\b/i.test(text)
    if (practice || !roundNamed || !parseWhen(text, now)) return null
  } else if (practice && !/\b(?:applied|registered|reg\.?\s*no|roll\s*no|admit\s+card|result|last\s+date|fee)\b/i.test(text)) {
    return null
  }

  const { cycle, cen, year } = cycleIn(text, found)
  const region = exam.regions?.find((r) => new RegExp(`\\b${r.replace(/\s+/g, '\\s*').replace('-', '[\\s-]*')}\\b`, 'i').test(text)) ?? null
  const registrationNo = registrationNoIn(text)
  const rollNo = rollNoIn(text)

  // Where it stands, when the line says.
  let stage: string | null = null
  const order = examStages(exam.key)
  // In English, Hinglish or Hindi: "form bhar diya", "पास हो गया".
  if (/\b(?:not\s+selected|didn'?t\s+clear|did\s+not\s+clear|failed)\b|\b(?:nahi|nhi)\s+(?:hua|hui|nikla)\b|नहीं\s+(?:हुआ|हुई|निकला)/i.test(text)) stage = 'not_selected'
  else if (/\b(?:finally\s+)?selected\b|\bgot\s+(?:the\s+)?(?:job|posting)\b|\bselect(?:ion)?\s+ho\s+(?:gaya|gya|gayi|gyi)\b|चयन\s+हो\s+गया|सिलेक्शन\s+हो\s+गया/i.test(text)) stage = 'selected'
  else if (/\b(?:cleared|qualified|passed|cracked)\b|\b(?:clear|pass|qualify)\s+(?:ho\s+(?:gaya|gya)|kar\s+liya|kiya)\b|\bnikal\s+(?:gaya|gya|liya)\b|(?:पास|क्लियर)\s+हो\s+गया|निकल\s+गया/i.test(text) && round) {
    const i = order.findIndex((s) => s.key === round)
    stage = order[i + 1] && !order[i + 1]!.closed ? order[i + 1]!.key : 'selected'
  } else if (/\b(?:applied|registered|form\s+(?:filled|submitted|done)|submitted)\b|\b(?:form\s+)?bhar\s+(?:diya|dia|di|liya)\b|\bapply\s+kar\s+(?:diya|dia|di)\b|(?:फॉर्म|फार्म)\s+भर\s+(?:दिया|दी)|आवेदन\s+कर\s+(?:दिया|दी)/i.test(text)) stage = 'applied'
  else if (/\b(?:to\s+apply|apply(?:ing)?\s+for|fill\s+(?:the\s+)?form|form\s+(?:is\s+)?(?:out|open|released)|notification)\b|\b(?:form\s+)?bharna\s+(?:hai|h)\b|\bapply\s+karna\s+(?:hai|h)\b|(?:फॉर्म|फार्म)\s+भरना\s+है|आवेदन\s+करना\s+है/i.test(text)) stage = 'to_apply'

  // Each date in it, by the words beside it: "form last date 20 nov, exam 15
  // feb". The name and the numbers go first: "CEN 05/2026", a year and a
  // registration number all look like dates.
  let rest = text.slice(0, found.at) + ' '.repeat(found.length) + text.slice(found.at + found.length)
  for (const n of [registrationNo, rollNo, cen?.[0], year]) if (n) rest = rest.replace(n, ' '.repeat(n.length))
  // So do the rounds and shifts: the 1 of "tier 1" is not one o'clock.
  for (const re of [...Object.values(ROUND_WORDS), /\b(?:shift|level)[\s-]*(?:\d|i{1,3})\b/i]) {
    rest = rest.replace(new RegExp(re.source, 'gi'), (m) => ' '.repeat(m.length))
  }
  const dates: ExamDateSaid[] = []
  for (const part of rest.split(/[,;]|\s+and\s+|\.\s/)) {
    const when = parseWhen(part, now)
    if (!when) continue
    const step = stepOf(part) ?? (stage === 'to_apply' ? 'apply_by' : 'exam')
    const partRound = step === 'exam' || step === 'admit_card' || step === 'result' ? (roundIn(exam.key, part) ?? round) : null
    if (dates.some((d) => d.step === step && d.on === ymdOf(when.date))) continue
    dates.push({ step, on: ymdOf(when.date), at: when.timeAssumed || when.window ? null : hhmm(when.date), round: partRound })
  }
  if (stage === null && dates.some((d) => d.step === 'apply_by')) stage = 'to_apply'

  return { examKey: exam.key, name: exam.name, cycle, region, registrationNo, rollNo, stage, dates }
}

// ── Reading an admit card ────────────────────────────────────────────────

export interface AdmitCard {
  examKey: string | null
  /** The list's name for it, or the card's heading when it is not in the list. */
  examName: string | null
  round: string | null
  rollNo: string | null
  registrationNo: string | null
  /** The day, YYYY-MM-DD. */
  date: string | null
  /** Times of day, HH:MM. */
  reportingAt: string | null
  gateClosesAt: string | null
  startsAt: string | null
  endsAt: string | null
  shift: string | null
  centreName: string | null
  centreAddress: string | null
  centreCity: string | null
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

/** A date written the Indian way: 15/06/2026, 15-06-2026, 15.06.2026, 15 Jun 2026, 2026-06-15. */
export function dateIn(s: string): string | null {
  let m = /\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(20\d\d)\b/.exec(s)
  if (m) return valid(+m[3]!, +m[2]!, +m[1]!)
  m = /\b(20\d\d)-(\d{2})-(\d{2})\b/.exec(s)
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!)
  m = /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]*([A-Za-z]{3,9})[\s,.-]*(20\d\d)\b/.exec(s)
  if (m && MONTHS[m[2]!.slice(0, 3).toLowerCase()]) return valid(+m[3]!, MONTHS[m[2]!.slice(0, 3).toLowerCase()]!, +m[1]!)
  m = /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b/.exec(s)
  if (m && MONTHS[m[1]!.slice(0, 3).toLowerCase()]) return valid(+m[3]!, MONTHS[m[1]!.slice(0, 3).toLowerCase()]!, +m[2]!)
  return null
}

function valid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

/** Clock times in a value, in order: "07:30 AM", "7.30 am", "0730 hrs", "09:00 to 10:30". */
export function timesIn(s: string): string[] {
  const out: string[] = []
  const re = /\b(\d{1,2})(?:\s*[:.]\s*(\d{2})|(?=\s*[ap]\.?\s*m\b))\s*(a\.?\s*m\.?|p\.?\s*m\.?|hrs?\.?|hours)?(?![\d/])/gi
  for (const m of s.matchAll(re)) {
    let h = +m[1]!
    const min = m[2] ? +m[2] : 0
    const half = m[3]?.toLowerCase().replace(/[\s.]/g, '')
    if (h > 23 || min > 59) continue
    if (half === 'pm' && h < 12) h += 12
    if (half === 'am' && h === 12) h = 0
    out.push(`${pad(h)}:${pad(min)}`)
  }
  return out
}

/**
 * A value for a label: "Label: value" at the start of a line or a cell, or a
 * label alone with its value on the line below. The label must end there —
 * "Centre Code: 1234" is not the centre.
 */
export function valueOf(lines: string[], label: RegExp): { value: string; index: number } | null {
  // A cell starts a line, follows a "|", or follows the Hindi label it
  // translates: "रोल नंबर / Roll No.: 1050123456".
  const re = new RegExp(`(?:^|[|/]\\s*)(?:${label.source})\\.?\\s*(?:\\([^)]*\\))?\\s*(?:[:：\\-–|]\\s*(.*)|$)`, 'iu')
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]!)
    if (!m) continue
    // Only up to the next cell: "Roll No: 123 | Exam Date: …".
    let value = (m[1] ?? '').split(/\s*\|\s*/)[0]!.trim()
    const below = lines[i + 1] ?? ''
    if (!value && !/[:：]/.test(below)) value = below.split(/\s*\|\s*/)[0]!.trim()
    if (value) return { value, index: i }
  }
  return null
}

const L = {
  roll: /roll\s*(?:no\.?|number)|रोल\s*(?:नंबर|नं\.?)|अनुक्रमांक/,
  registration: /(?:registration|application|regn\.?|reg\.?)\s*(?:no\.?|number|id)|आवेदन\s*(?:संख्या|क्रमांक)/,
  date: /date\s+of\s+(?:the\s+)?(?:exam(?:ination)?|test|cbt)|(?:exam(?:ination)?|test|cbt)\s+date|परीक्षा\s+(?:की\s+)?(?:तिथि|दिनांक)/,
  reporting:
    /(?:reporting\s*\/\s*entry|reporting|entry)\s+time(?:\s+(?:at|of)\s+(?:the\s+)?(?:exam\s+|test\s+)?(?:centre|center|venue))?|reporting\s+at\s+(?:the\s+)?(?:centre|center|venue)|time\s+of\s+reporting|रिपोर्टिंग\s+समय/,
  gate: /(?:gate|entry)\s+clos(?:ing|ure|es)(?:\s+time)?(?:\s+(?:of|at)\s+(?:the\s+)?(?:centre|center|venue))?|last\s+entry(?:\s+time)?|प्रवेश\s+बंद(?:\s+होने\s+का\s+समय)?/,
  timing: /(?:exam(?:ination)?|test|cbt)\s+(?:time|timings?)|timings?\s+of\s+(?:the\s+)?(?:exam(?:ination)?|test)|(?:exam\s+)?shift\s+timings?|परीक्षा\s+(?:का\s+)?समय/,
  shift: /shift(?:\s+no\.?)?/,
  centre: /(?:(?:exam(?:ination)?|test)\s+)?(?:centre|center|venue)(?:\s+name)?|name\s+of\s+(?:the\s+)?(?:exam(?:ination)?\s+|test\s+)?(?:centre|center|venue)|परीक्षा\s+केन्?द्र/,
  address: /(?:(?:exam(?:ination)?|test)\s+)?(?:centre|center|venue)\s+address|address\s+of\s+(?:the\s+)?(?:exam(?:ination)?\s+|test\s+)?(?:centre|center|venue)|venue\s+details|केन्?द्र\s+का\s+पता/,
}

/** A centre's city: a known one in the address, else the place before its PIN code. */
function cityOf(...parts: (string | null)[]): string | null {
  const text = parts.filter(Boolean).join(', ')
  if (!text) return null
  const known = findCity(text)
  if (known) return known
  const m = /([A-Za-z][A-Za-z ]{2,30}?)\s*[-,(]?\s*\d{3}\s?\d{3}\b/.exec(text)
  const place = m?.[1]?.replace(/\b(?:rajasthan|india|dist(?:rict)?|pin(?:code)?)\b/gi, '').trim()
  return place && place.length >= 3 ? place.replace(/\b\w/g, (c) => c.toUpperCase()) : null
}

/**
 * What an admit card says about the day: which exam and round, the roll
 * number, the date, when to report and when the gate closes, the exam's
 * hours, and the centre. From the card's text — a PDF read into lines of
 * "Label: value", or text pasted from an email. Null when it does not read
 * as an admit card at all.
 */
export function readAdmitCard(text: string): AdmitCard | null {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const found = findExam(text)
  const roll = valueOf(lines, L.roll)
  const date = valueOf(lines, L.date)
  const day = (date ? dateIn(date.value) : null) ?? null
  const isCard = /admit\s*card|hall\s*ticket|call\s*letter|e-?admit|प्रवेश\s*पत्र/i.test(text)
  if (!roll && !day) return null
  if (!isCard && !(roll && day)) return null

  const timing = valueOf(lines, L.timing)
  const span = timing ? timesIn(timing.value) : []
  const reporting = valueOf(lines, L.reporting)
  const gate = valueOf(lines, L.gate)
  const shift = valueOf(lines, L.shift)

  const address = valueOf(lines, L.address)
  let centreAddress: string | null = null
  if (address) {
    const addressy = (s: string | undefined): s is string =>
      Boolean(s) &&
      !/[:：|]/.test(s!) &&
      s!.length <= 120 &&
      /\d|,|\b(?:road|marg|nagar|sector|colony|near|opp|district|dist|tehsil|rajasthan|pin)\b/i.test(s!)
    const parts: string[] = []
    const inline = new RegExp(`(?:${L.address.source})[^:：|]*[:：|]\\s*\\S`, 'iu').test(lines[address.index]!)
    if (inline) parts.push(address.value)
    // A tall cell prints its label halfway down: the address starts above it.
    else if (addressy(lines[address.index - 1])) parts.push(lines[address.index - 1]!)
    // And runs on over the lines below, while they read as one.
    for (let i = address.index + 1; i <= address.index + 3 && addressy(lines[i]) && !parts.includes(lines[i]!); i++) {
      parts.push(lines[i]!)
    }
    centreAddress =
      parts.reduce((acc, p) => (!acc ? p : /[-,]\s*$/.test(acc) ? `${acc.trimEnd()} ${p}` : `${acc}, ${p}`), '') || null
  }
  const centre = valueOf(lines, L.centre)
  const centreName = centre && centre.value !== centreAddress && !/^\d+$/.test(centre.value) ? centre.value : null

  const examKey = found?.exam.key ?? null
  const heading = lines.find((l) => /exam|recruitment|test/i.test(l) && !/[:：]/.test(l) && l.length < 120) ?? null
  return {
    examKey,
    examName: found?.exam.name ?? heading,
    round: examKey ? roundIn(examKey, text) : null,
    rollNo: roll?.value.match(/[A-Z0-9][A-Z0-9/-]{3,24}/i)?.[0] ?? null,
    registrationNo: valueOf(lines, L.registration)?.value.match(/[A-Z0-9][A-Z0-9/-]{3,24}/i)?.[0] ?? null,
    date: day,
    reportingAt: reporting ? (timesIn(reporting.value)[0] ?? null) : null,
    gateClosesAt: gate ? (timesIn(gate.value)[0] ?? null) : null,
    startsAt: span[0] ?? null,
    endsAt: span[1] ?? null,
    shift: shift?.value.match(/^(?:\d|first|second|third|morning|afternoon|evening|[ivx]+)\b/i)?.[0] ?? null,
    centreName,
    centreAddress,
    centreCity: cityOf(centreAddress, centreName),
  }
}
