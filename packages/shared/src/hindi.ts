/**
 * Hindi for the labels shared tables carry in English — how often a bill
 * comes round, where a parcel is, a tracker's board and stages, what money
 * was spent on — by key, the way STAGE_HI and STEP_HI do it for exams. Same
 * words as the web app's glossary (apps/web/src/lib/hi/common.ts): bill बिल,
 * delivery डिलीवरी, expense खर्च, hiring भर्ती, deal डील.
 */
import type { Repeat } from './bills.ts'
import type { DeliveryStatus } from './deliveries.ts'
import type { ExpenseCategory } from './expenses.ts'
import type { Lang } from './examHindi.ts'
import { BOARDS, type BoardKey } from './trackers.ts'
import { EXPENSE_CATEGORIES } from './expenses.ts'
import { REPEATS } from './bills.ts'
import { STATUS_LABEL } from './deliveries.ts'

/** How often a bill comes round: REPEATS' labels. */
export const REPEAT_HI: Record<Repeat, string> = {
  none: 'एक बार',
  weekly: 'हर हफ़्ते',
  monthly: 'हर महीने',
  quarterly: 'हर 3 महीने',
  half_yearly: 'हर 6 महीने',
  yearly: 'हर साल',
}

/** Where a parcel is: STATUS_LABEL in deliveries.ts. */
export const DELIVERY_STATUS_HI: Record<DeliveryStatus, string> = {
  ordered: 'ऑर्डर हुआ',
  shipped: 'रास्ते में',
  out_for_delivery: 'डिलीवरी के लिए निकला',
  delivered: 'डिलीवर हो गया',
  cancelled: 'रद्द',
}

/** A tracker board's name: BOARDS[key].label. */
export const BOARD_HI: Record<BoardKey, string> = {
  jobs: 'नौकरी की तलाश',
  hiring: 'भर्ती',
  deals: 'डील',
}

/** A tracker's stages, by board and key. */
export const TRACKER_STAGE_HI: Record<BoardKey, Record<string, string>> = {
  jobs: {
    saved: 'आवेदन करना है',
    applied: 'आवेदन किया',
    interview: 'इंटरव्यू',
    offer: 'ऑफ़र',
    accepted: 'ऑफ़र मान लिया',
    rejected: 'इस बार नहीं',
    withdrawn: 'नाम वापस लिया',
  },
  hiring: {
    new: 'नया',
    screening: 'स्क्रीनिंग',
    interview: 'इंटरव्यू',
    offer: 'ऑफ़र दिया',
    hired: 'नियुक्ति हो गई',
    rejected: 'नहीं चुना गया',
    withdrawn: 'नाम वापस लिया',
  },
  deals: {
    lead: 'लीड',
    contacted: 'संपर्क में',
    proposal: 'प्रपोज़ल भेजा',
    negotiation: 'बातचीत चल रही है',
    won: 'जीत गए',
    lost: 'हार गए',
  },
}

/** What money was spent on: EXPENSE_CATEGORIES' labels. */
export const EXPENSE_CATEGORY_HI: Record<ExpenseCategory, string> = {
  travel: 'आना-जाना',
  fuel: 'ईंधन',
  food: 'खाना',
  stay: 'होटल',
  parking: 'पार्किंग और टोल',
  phone: 'फ़ोन और इंटरनेट',
  supplies: 'सामान और कूरियर',
  other: 'अन्य',
}

/** "Every month", or "हर महीने". */
export function repeatLabel(key: Repeat, lang: Lang = 'en'): string {
  return lang === 'hi' ? REPEAT_HI[key] : REPEATS.find((r) => r.key === key)!.label
}

/** "On the way", or "रास्ते में". */
export function deliveryStatusLabel(status: DeliveryStatus, lang: Lang = 'en'): string {
  return lang === 'hi' ? DELIVERY_STATUS_HI[status] : STATUS_LABEL[status]
}

/** "Job hunt", or "नौकरी की तलाश". */
export function boardLabel(board: BoardKey, lang: Lang = 'en'): string {
  return lang === 'hi' ? BOARD_HI[board] : BOARDS[board].label
}

/** "Interviewing", or "इंटरव्यू"; the key itself for a stage no board has. */
export function trackerStageLabel(board: BoardKey, stage: string, lang: Lang = 'en'): string {
  const label = BOARDS[board].stages.find((s) => s.key === stage)?.label ?? stage
  return lang === 'hi' ? (TRACKER_STAGE_HI[board][stage] ?? label) : label
}

/** "Parking & tolls", or "पार्किंग और टोल". */
export function expenseCategoryLabel(key: ExpenseCategory, lang: Lang = 'en'): string {
  return lang === 'hi' ? EXPENSE_CATEGORY_HI[key] : EXPENSE_CATEGORIES.find((c) => c.key === key)!.label
}
