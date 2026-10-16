export { parseWhen, titleFrom, placeFrom, mealTime, allClockTimes, clockLabel, type ParsedWhen } from './parseWhen.ts'
export {
  addToDate,
  stepDate,
  offsetLabel,
  SCHEDULE_UNITS,
  type ScheduleUnit,
  type ScheduleOffset,
  type ScheduleStep,
} from './schedule.ts'
export {
  SCHEDULE_TEMPLATES,
  INDIA_UIP_CHILD,
  type ScheduleTemplate,
} from './scheduleTemplates.ts'
export { nameParts, shortName, type NameParts } from './names.ts'
export { fillTemplate, STARTER_TEMPLATES, TEMPLATE_FIELDS, type TemplateValues } from './templates.ts'
export { composeShared, type Shared } from './share.ts'
export { CITIES, findCity, samePlace } from './cities.ts'
export { reopenTime } from './reopen.ts'
export { parseWishList, type WishList } from './wishes.ts'
export {
  CLAIM_STATUSES,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_KEYS,
  categoryOf,
  formatRupees,
  parseExpense,
  spentWhen,
  type SpentWhen,
  type ClaimStatus,
  type ExpenseCategory,
  type ParsedExpense,
} from './expenses.ts'
import { CLAIM_STATUSES as CLAIMS, EXPENSE_CATEGORY_KEYS as EXPENSE_KEYS } from './expenses.ts'
export { owedMessage, parseOwed, splitEqually, type OwedLine, type ParsedOwed } from './owed.ts'
export { leadLabel, parseBooking, parseBookings, cityIn, sameCity, isAbroad, type BookingType, type ParsedBooking } from './bookings.ts'
export { parseDueNotice, type DueNotice } from './dueNotices.ts'
export { parseInsurance, type InsuranceNotice } from './insurance.ts'
export {
  parseChallan,
  parseFastag,
  parseVehicleNotice,
  serviceAsBooking,
  vehicleNoticeName,
  type ChallanNotice,
  type FastagNotice,
  type VehicleNotice,
} from './vehicle.ts'
export {
  DELIVERY_STATUSES,
  STATUS_LABEL as DELIVERY_STATUS_LABEL,
  STATUS_RANK as DELIVERY_STATUS_RANK,
  parseDelivery,
  type DeliveryStatus,
  type ParsedDelivery,
} from './deliveries.ts'
import { DELIVERY_STATUSES as DELIVERY_KEYS } from './deliveries.ts'
export {
  BILL_CATEGORIES,
  BILL_CATEGORY_KEYS,
  REPEATS,
  REPEAT_KEYS,
  categoryOfBill,
  daysToDue,
  dueLabel,
  nextDue,
  parseBill,
  type BillCategory,
  type ParsedBill,
  type Repeat,
} from './bills.ts'
import { BILL_CATEGORY_KEYS as BILL_KEYS, REPEAT_KEYS as REPEATS_ } from './bills.ts'
export {
  BOARDS,
  BOARD_KEYS,
  isLaterStage,
  isOpenStage,
  mentions,
  parseTrackerLine,
  quietFor,
  stageOf,
  type Board,
  type BoardKey,
  type Stage,
  type TrackerLine,
} from './trackers.ts'
import { BOARD_KEYS as TRACKER_BOARDS } from './trackers.ts'
export {
  FILLABLE,
  MAIN_TABS,
  SECTION_GROUPS,
  USES,
  USE_GROUPS,
  USE_KEYS,
  examplesFor,
  groupSections,
  hasClients,
  hasCompanies,
  hasWork,
  sectionsFor,
  tabsFor,
  type Section,
  type Use,
  type UseGroup,
} from './uses.ts'
export {
  GREETING_OCCASIONS,
  MONTH_DAY,
  OCCASION_MESSAGES,
  daysUntil,
  monthDayLabel,
  nextMonthDay,
  type OccasionKind,
} from './occasions.ts'
export {
  findMalformedTime,
  extractPlace,
  cleanTitle,
  originalIfInformative,
} from './textCleanup.ts'
export {
  parseIntention,
  parseTrip,
  type ParsedIntention,
  type ParsedTrip,
} from './parseIntent.ts'
export { diagnose, type Diagnosis } from './diagnose.ts'
export {
  expandRecurrence,
  nextOccurrence,
  occursOn,
  describeRecurrence,
  ordinal,
  FREQUENCIES,
  FREQUENCY_LABELS,
  type Frequency,
  type RecurrenceRule,
  type RecurrenceAnchor,
} from './recurrence.ts'
export {
  parseRecurrence,
  stripRecurrence,
  type ParsedRecurrence,
} from './parseRecurrence.ts'
export { parseChecklist, type ParsedChecklist } from './parseChecklist.ts'
export {
  extractRoles,
  type ExtractedRoles,
  type ExtractedKind,
  type RoleEvidence,
} from './extractRoles.ts'
export {
  parseRelative,
  stripRelative,
  type ParsedRelative,
  type RelativeAnchor,
} from './parseRelative.ts'
export {
  parseIcs,
  parseRRule,
  type IcsEvent,
  type IcsSkip,
  type IcsParseResult,
} from './ics.ts'
export { resolveZone, WINDOWS_ZONES } from './windowsZones.ts'
export { normalizeHinglish, HINDI_LEFTOVER } from './hinglish.ts'
export { stripWaitingOn } from './waiting.ts'

import { z } from 'zod'
// Re-exporting a name does not put it in scope here, so the ones used below in
// schemas and DTOs have to be imported as well.
import { FREQUENCIES, type RecurrenceRule } from './recurrence.ts'
import { SCHEDULE_UNITS } from './schedule.ts'

/**
 * The domain is deliberately generic. A "place" is anywhere you go, a
 * "contact" is anyone you meet, an "interaction" is one visit or call, and a
 * "commitment" is the thing you promised to do next. Clinics, sites, leads and
 * candidates are all just rows.
 */

export const PURPOSE = ['business', 'personal', 'unknown'] as const
export type Purpose = (typeof PURPOSE)[number]

export const COMMITMENT_KIND = ['callback', 'meeting', 'task', 'followup', 'focus'] as const
export type CommitmentKind = (typeof COMMITMENT_KIND)[number]

/**
 * The kinds a person picks from when adding or editing a plan. Focus time is
 * not one of them: it is started from its own button, and a "type" chooser
 * offering it next to "Phone call" would read as a category of errand.
 */
export const SELECTABLE_KINDS = ['callback', 'meeting', 'task', 'followup'] as const

/**
 * How long each kind of commitment blocks out. A callback is a two-minute
 * phone call in practice, but you cannot be on two of them at once, so it
 * still occupies a slot — just a short one.
 */
export const DEFAULT_DURATION_MINUTES: Record<CommitmentKind, number> = {
  callback: 15,
  meeting: 60,
  task: 30,
  followup: 15,
  focus: 90,
}

export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120] as const

/**
 * Shared vocabulary, so every screen agrees.
 *
 * Deliberately neutral. The same entry has to read sensibly whether it is a
 * client meeting, a clinic visit or a dentist appointment — sales words like
 * "Negotiating" made it feel like somebody else's tool for anything personal.
 * Outcome is free text underneath, so a domain-specific word is always one
 * keystroke away.
 */
export const KIND_LABELS: Record<CommitmentKind, string> = {
  meeting: 'Meeting or appointment',
  callback: 'Phone call',
  task: 'Task',
  followup: 'Follow up',
  focus: 'Focus time',
}

export const OUTCOME_OPTIONS = [
  'Went well',
  'Did not happen',
  'Rescheduled',
  'Needs another visit',
  'Waiting on them',
  'All wrapped up',
] as const

/**
 * Does this occupy a slot, or merely need to happen sometime?
 *
 * The single most important distinction in the planner. A dentist appointment
 * at 6pm is fixed: it blocks time and clashes with other things. "Call the
 * plumber this afternoon" is flexible: it wants a window, and inventing 2:00 PM
 * for it would be the app pretending to know something you never said.
 */
export const FLEXIBILITY = ['fixed', 'flexible'] as const
export type Flexibility = (typeof FLEXIBILITY)[number]

export const TIME_WINDOWS = ['morning', 'afternoon', 'evening', 'night'] as const
export type TimeWindow = (typeof TIME_WINDOWS)[number]

/** Defaults; a user can override them, so never hard-code these at a call site. */
export const DEFAULT_WINDOW_HOURS: Record<TimeWindow, { from: number; to: number }> = {
  morning: { from: 6, to: 12 },
  afternoon: { from: 12, to: 17 },
  evening: { from: 17, to: 21 },
  night: { from: 21, to: 24 },
}

export const WINDOW_LABELS: Record<TimeWindow, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
}

/**
 * Ordered most to least important. Used for ranking what to schedule when time
 * is short — a low-priority item stays unscheduled rather than being dropped.
 */
export const PRIORITIES = ['critical', 'high', 'normal', 'low', 'nice_to_have'] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
  nice_to_have: 'Nice to have',
}

export const TRIP_STRICTNESS = ['strict', 'flexible', 'tentative'] as const
export type TripStrictness = (typeof TRIP_STRICTNESS)[number]

export const STRICTNESS_LABELS: Record<TripStrictness, string> = {
  strict: 'I will be there the whole time',
  flexible: 'Mostly there, day trips possible',
  tentative: 'Expect to be there, may change',
}

export const INTENTION_STATUS = ['saved', 'scheduled', 'done', 'dropped'] as const
export type IntentionStatus = (typeof INTENTION_STATUS)[number]

export const createTripInput = z.object({
  placeLabel: z.string().min(1).max(200),
  placeId: z.string().uuid().nullable().optional(),
  /** Day granularity: YYYY-MM-DD. A trip has no start time. */
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  strictness: z.enum(TRIP_STRICTNESS).default('flexible'),
  notes: z.string().max(4000).nullable().optional(),
})
export type CreateTripInput = z.infer<typeof createTripInput>

export const updateTripInput = createTripInput.partial()

export const recurrenceRuleInput = z.object({
  freq: z.enum(FREQUENCIES),
  interval: z.number().int().min(1).max(52).default(1),
  /** 0=Sunday .. 6=Saturday. */
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  byMonthDay: z.number().int().min(1).max(31).nullable().optional(),
  byMonth: z.number().int().min(0).max(11).nullable().optional(),
  /** 1-4 for first..fourth, -1 for last. */
  setPos: z.number().int().min(-1).max(4).nullable().optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  count: z.number().int().min(1).max(500).nullable().optional(),
})

export const createRecurrenceInput = z.object({
  title: z.string().min(1).max(300),
  kind: z.enum(COMMITMENT_KIND).default('task'),
  notes: z.string().max(4000).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  priority: z.enum(PRIORITIES).default('normal'),
  placeId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  placeLabel: z.string().max(200).nullable().optional(),
  /** First occurrence, and the phase for "every other week". */
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hour: z.number().int().min(0).max(23).default(9),
  minute: z.number().int().min(0).max(59).default(0),
  rule: recurrenceRuleInput,
})
export type CreateRecurrenceInput = z.infer<typeof createRecurrenceInput>

export const updateRecurrenceInput = createRecurrenceInput.partial()

/** One step of a schedule: a gap after the start, or a date of its own. */
export const scheduleStepInput = z
  .object({
    title: z.string().max(200).default(''),
    offset: z
      .object({
        amount: z.number().int().min(0).max(1200),
        unit: z.enum(SCHEDULE_UNITS),
      })
      .nullable()
      .optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .refine((s) => Boolean(s.offset) !== Boolean(s.date), {
    message: 'Each step needs either a gap after the start or a date of its own.',
  })

export const createScheduleInput = z.object({
  title: z.string().min(1).max(200),
  /** What the gaps count from — a date of birth, a start of treatment. */
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hour: z.number().int().min(0).max(23).default(10),
  minute: z.number().int().min(0).max(59).default(0),
  kind: z.enum(COMMITMENT_KIND).default('meeting'),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  notes: z.string().max(4000).nullable().optional(),
  steps: z.array(scheduleStepInput).min(1).max(60),
})
export type CreateScheduleInput = z.infer<typeof createScheduleInput>

export interface ScheduleDTO {
  id: string
  title: string
  startsOn: string
  status: string
  /** Steps that were booked. */
  total: number
  done: number
  next: { id: string; title: string; dueAt: string } | null
  createdAt: string
}

export interface RecurrenceDTO {
  id: string
  title: string
  kind: CommitmentKind
  notes: string | null
  durationMinutes: number
  priority: Priority
  placeId: string | null
  placeName: string | null
  placeLabel: string | null
  contactId: string | null
  startsOn: string
  hour: number
  minute: number
  rule: RecurrenceRule
  status: string
  /** Read back in plain words: "Every other Friday". */
  summary: string
  /** When the next occurrence is due, or null once the series is finished. */
  nextAt: string | null
  /** How many occurrences are still ahead. */
  upcomingCount: number
  createdAt: string
}

export const createIntentionInput = z.object({
  /** The context that makes it relevant — "Jaipur", "Pune". Null: any time, any plan. */
  placeLabel: z.string().max(200).nullable().optional(),
  placeId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  notes: z.string().max(4000).nullable().optional(),
  preferredWindow: z.enum(TIME_WINDOWS).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480).default(60),
  priority: z.enum(PRIORITIES).default('nice_to_have'),
})
export type CreateIntentionInput = z.infer<typeof createIntentionInput>

/** Several wishes at once: "Jaipur: visit Hawa Mahal, buy lakh chudi". */
export const createWishesInput = z.object({
  placeLabel: z.string().max(200).nullable().optional(),
  titles: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
  preferredWindow: z.enum(TIME_WINDOWS).nullable().optional(),
})

/** Wishes put on a plan: as its checklist, or as one new plan of their own. */
export const attachWishesInput = z.object({
  intentionIds: z.array(z.string().uuid()).min(1).max(20),
})

export const planWishesInput = z.object({
  intentionIds: z.array(z.string().uuid()).min(1).max(20),
  dueAt: z.string().datetime(),
  title: z.string().max(300).optional(),
})

export const updateIntentionInput = createIntentionInput.partial().extend({
  status: z.enum(INTENTION_STATUS).optional(),
})

/** Turning a saved wish into a real plan. */
export const scheduleIntentionInput = z.object({
  dueAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  /** Left flexible by default — a wish rarely has an exact time. */
  flexibility: z.enum(FLEXIBILITY).default('flexible'),
  tripId: z.string().uuid().nullable().optional(),
  allowConflict: z.boolean().optional(),
})

export interface IntentionDTO {
  id: string
  /** Null for a wish with no place: it waits for a plan to attach it to. */
  placeLabel: string | null
  placeId: string | null
  title: string
  notes: string | null
  preferredWindow: TimeWindow | null
  durationMinutes: number
  priority: Priority
  status: IntentionStatus
  commitmentId: string | null
  createdAt: string
}

export interface TripDTO {
  id: string
  placeLabel: string
  placeId: string | null
  startsOn: string
  endsOn: string
  strictness: TripStrictness
  notes: string | null
  status: string
  createdAt: string
  /** Whole days from today; negative once it has started. */
  daysUntil: number
  nights: number
  /** Counts for the list view, so a card needs no extra request. */
  plannedCount?: number
  /** Saved wishes for this place that are not yet scheduled. */
  waitingCount?: number
  /** The "Pack for …" plan whose checklist is this trip's packing list. */
  packingId?: string | null
}

/** One thing on a trip's day-by-day plan. */
export interface TripItemDTO {
  id: string
  title: string
  kind: string
  dueAt: string
  durationMinutes: number
  flexibility: string
  preferredWindow: TimeWindow | null
  allDay: boolean
  endsAt: string | null
  status: string
  priority: string
  notes: string | null
  /** A journey or a stay: what it is, its reference, and when to leave for it. */
  booking: {
    type: string
    ref: string | null
    provider: string | null
    from: string | null
    city: string | null
    endsOn: string | null
    leaveAt: string | null
  } | null
  checklistCount: number
  checklistDone: number
}

/**
 * The statuses a person can set. The table also holds 'deleted' (set only by
 * DELETE, never by an edit) — keeping it out of here is what stops "delete"
 * being a dropdown option. Its enum still has 'snoozed' from early builds;
 * nothing sets it now: snoozing moves the time and keeps the plan 'pending'.
 */
export const COMMITMENT_STATUS = ['pending', 'done', 'cancelled'] as const
export type CommitmentStatus = (typeof COMMITMENT_STATUS)[number]

// ---------------------------------------------------------------- auth

/**
 * No organisation name. Registering still creates one — the multi-tenant shape
 * is load-bearing throughout — but asking a person setting up a personal
 * planner to name their company is a question with no good answer, so it is
 * derived from their own name instead and can be renamed later.
 */
export const registerInput = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
})
export type RegisterInput = z.infer<typeof registerInput>

export const forgotPasswordInput = z.object({
  email: z.string().email(),
})
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInput>

export const resetPasswordInput = z.object({
  token: z.string().min(16).max(200),
  password: z.string().min(8).max(200),
})
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>

/** Changing it while signed in, which needs the current one as proof. */
export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
})
export type ChangePasswordInput = z.infer<typeof changePasswordInput>

export const updateProfileInput = z.object({
  name: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(80).optional(),
})
export type UpdateProfileInput = z.infer<typeof updateProfileInput>

export const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type LoginInput = z.infer<typeof loginInput>

// ---------------------------------------------------------------- places

export const createPlaceInput = z.object({
  name: z.string().min(1).max(200),
  kind: z.string().max(60).optional(),
  address: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(25).max(5000).default(150),
  phone: z.string().max(40).optional(),
  category: z.string().max(80).optional(),
  /** Set when the details came from a lookup provider rather than being typed. */
  source: z.enum(['manual', 'osm', 'google']).optional(),
  externalId: z.string().max(120).optional(),
})
export type CreatePlaceInput = z.infer<typeof createPlaceInput>

export const matchPlaceInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** How far out to look when nothing is inside a place's own radius. */
  searchRadiusM: z.number().int().min(50).max(20000).default(1000),
})
export type MatchPlaceInput = z.infer<typeof matchPlaceInput>

// ---------------------------------------------------------------- capture

/**
 * The capture flow, as one payload. The UI walks the user through it as a
 * branching wizard, but it lands here in a single write so a half-finished
 * visit can never leave an orphaned commitment behind.
 */
export const logVisitInput = z.object({
  /**
   * Generated once on the device when the visit is captured. Sending it makes
   * the write idempotent, so a queued visit replayed after a dropped connection
   * cannot create a duplicate.
   */
  clientId: z.string().uuid().optional(),

  placeId: z.string().uuid().nullable().optional(),
  /** Used when the user is somewhere not yet saved as a place. */
  newPlace: createPlaceInput.optional(),

  purpose: z.enum(PURPOSE),
  /** An existing contact at this place. */
  contactId: z.string().uuid().nullable().optional(),
  /** Or a new one, captured inline so a phone number is never lost. */
  newContact: z
    .object({
      name: z.string().min(1).max(200),
      role: z.string().max(120).optional(),
      phone: z.string().max(40).optional(),
    })
    .optional(),
  /** Free text fallback when neither of the above is used. */
  contactName: z.string().max(200).optional(),
  outcome: z.string().max(200).optional(),
  notes: z.string().max(4000).optional(),

  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  accuracyM: z.number().nullable().optional(),
  startedAt: z.string().datetime().optional(),

  /** The whole point of the app: what did they promise you next? */
  commitment: z
    .object({
      title: z.string().min(1).max(300),
      kind: z.enum(COMMITMENT_KIND).default('followup'),
      dueAt: z.string().datetime(),
      durationMinutes: z.number().int().min(5).max(480).optional(),
    })
    .nullable()
    .optional(),

  /**
   * Clips recorded during capture. They are uploaded as they are recorded and
   * attached to the visit here, so nothing is lost if the form is abandoned
   * mid-way and resumed.
   */
  voiceNoteIds: z.array(z.string().uuid()).max(10).optional(),

  /**
   * Set only after the user has been shown the clash and chosen to
   * double-book anyway. Absent, the server refuses with 409 and returns what
   * it collided with.
   */
  allowConflict: z.boolean().optional(),
})
export type LogVisitInput = z.infer<typeof logVisitInput>

// ---------------------------------------------------------------- commitments

/** What a week's targets can be set on — each counted from what is already logged. */
export const TARGET_METRICS = [
  { key: 'calls', label: 'Calls', hint: 'Every call logged, answered or not' },
  { key: 'conversations', label: 'Conversations', hint: 'Calls where you spoke' },
  { key: 'visits', label: 'Visits', hint: 'Visits logged in person' },
  { key: 'meetings', label: 'Meetings', hint: 'Meetings that took place' },
  { key: 'done', label: 'Things done', hint: 'Tasks, call backs and follow-ups closed' },
  { key: 'people', label: 'New contacts', hint: 'People added to People' },
] as const
export type TargetMetric = (typeof TARGET_METRICS)[number]['key']
export const TARGET_KEYS = TARGET_METRICS.map((m) => m.key) as [TargetMetric, ...TargetMetric[]]

/** Each metric's weekly goal; 0 or null stops tracking it. */
export const saveTargetsInput = z.object({
  targets: z.record(z.enum(TARGET_KEYS), z.number().int().min(0).max(1000).nullable()),
})

export interface TargetProgress {
  key: TargetMetric
  label: string
  hint: string
  target: number | null
  done: number
  lastWeek: number
  /** Where you would be by now at an even pace over the working week. */
  expected: number
  status: 'done' | 'on' | 'behind' | 'untracked'
}

export const createExpenseInput = z.object({
  amountPaise: z.number().int().min(1).max(1_000_000_000),
  category: z.enum(EXPENSE_KEYS).default('other'),
  note: z.string().max(300).nullable().optional(),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tripId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  account: z.string().max(200).nullable().optional(),
})
export const updateExpenseInput = createExpenseInput.partial()

/** Claimed, reimbursed, or back to unclaimed — for several at once. */
export const setClaimInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  status: z.enum(CLAIMS),
})

export interface ExpenseDTO {
  id: string
  amountPaise: number
  category: (typeof EXPENSE_KEYS)[number]
  note: string | null
  spentOn: string
  tripId: string | null
  tripLabel: string | null
  contactId: string | null
  contactName: string | null
  account: string | null
  hasReceipt: boolean
  claimStatus: (typeof CLAIMS)[number]
  claimedAt: string | null
  /** Who is paying their part back to you. */
  shares: OwedShare[]
  /** What is left to claim from the company: the amount less those shares. */
  claimablePaise: number
}

/** Someone's part of an expense, owed to you. */
export interface OwedShare {
  id: string
  contactId: string | null
  name: string
  amountPaise: number
  status: 'owed' | 'paid'
}

const owedAmount = z.number().int().min(1).max(1_000_000_000)
/** Who: a saved contact, or just a name for someone who is not. */
const owedBy = {
  contactId: z.string().uuid().nullable().optional(),
  personName: z.string().trim().min(1).max(120).nullable().optional(),
}
const named = (v: { contactId?: string | null; personName?: string | null }) => Boolean(v.contactId || v.personName)

/** Money lent, or owed for anything else: "Ravi owes me ₹500". */
export const createOwedInput = z
  .object({ ...owedBy, amountPaise: owedAmount, note: z.string().trim().max(300).nullable().optional() })
  .refine(named, { message: 'Who owes it?' })

/** The people paying back their part of an expense; replaces what was there. */
export const setSharesInput = z.object({
  shares: z.array(z.object({ ...owedBy, amountPaise: owedAmount }).refine(named, { message: 'Who owes it?' })).max(20),
})

export const setOwedStatusInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(['owed', 'paid']),
})

export const owedIdsInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) })

const trackerFields = {
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(200).nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  valuePaise: z.number().int().min(0).max(100_000_000_000_000).nullable().optional(),
  link: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => !v || /^https?:\/\//i.test(v), { message: 'A link starts with http:// or https://' })
    .nullable()
    .optional(),
  notes: z.string().max(4000).nullable().optional(),
}

const ymdString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const createBillInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['bill', 'renewal']).default('bill'),
  category: z.enum(BILL_KEYS).optional(),
  amountPaise: z.number().int().min(1).max(10_000_000_000_000).nullable().optional(),
  dueOn: ymdString,
  repeat: z.enum(REPEATS_).default('monthly'),
  remindDays: z.number().int().min(0).max(90).optional(),
  autopay: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
})
export const updateBillInput = createBillInput.partial()

/** Paid, or renewed: when, how much this time, and — for a renewal — until when. */
export const payBillInput = z.object({
  paidOn: ymdString.optional(),
  amountPaise: z.number().int().min(1).max(10_000_000_000_000).nullable().optional(),
  nextDueOn: ymdString.optional(),
})

export interface BillDTO {
  id: string
  name: string
  kind: 'bill' | 'renewal'
  category: (typeof BILL_KEYS)[number]
  amountPaise: number | null
  dueOn: string
  repeat: (typeof REPEATS_)[number]
  remindDays: number
  autopay: boolean
  notes: string | null
  active: boolean
  lastPaidOn: string | null
}

export interface DeliveryDTO {
  id: string
  store: string | null
  item: string | null
  status: (typeof DELIVERY_KEYS)[number]
  expectedOn: string | null
  codPaise: number | null
  orderRef: string | null
  trackingUrl: string | null
  deliveredAt: string | null
  updatedAt: string
}

export const updateDeliveryInput = z.object({
  status: z.enum(DELIVERY_KEYS).optional(),
  expectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  item: z.string().trim().max(120).nullable().optional(),
})

/** Something new to track; the stage defaults to where the board starts. */
export const createTrackerItemInput = z.object({ ...trackerFields, stage: z.string().max(40).optional() })
export const updateTrackerItemInput = z.object({ ...trackerFields, stage: z.string().max(40) }).partial()
export const trackerBoardParam = z.object({ board: z.enum(TRACKER_BOARDS) })

export interface TrackerNextStep {
  id: string
  title: string
  dueAt: string
}

export interface TrackerItemDTO {
  id: string
  board: (typeof TRACKER_BOARDS)[number]
  title: string
  detail: string | null
  stage: string
  contactId: string | null
  contactName: string | null
  valuePaise: number | null
  link: string | null
  notes: string | null
  stageChangedAt: string
  closedAt: string | null
  createdAt: string
  /** The soonest open plan linked to it. */
  next: TrackerNextStep | null
  /** Days it has sat with nothing booked, past its stage's patience. */
  quietDays: number | null
}

export const startGreetingsInput = z.object({
  occasion: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(2000),
  contactIds: z.array(z.string().uuid()).min(1).max(500),
})

export const saveTemplateInput = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(2000),
})

export interface MessageTemplateDTO {
  id: string
  title: string
  body: string
  uses: number
}

/** How a call went. Only "spoke" is contact; the rest are attempts. */
export const CALL_OUTCOMES = ['spoke', 'no_answer', 'busy', 'message'] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]
export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  spoke: 'Spoke',
  no_answer: 'No answer',
  busy: 'Busy, call back',
  message: 'Left a message',
}

export const logCallInput = z.object({
  contactId: z.string().uuid().nullable().optional(),
  /** Who, when there is no saved contact to point at. */
  name: z.string().max(200).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().max(4000).nullable().optional(),
  startedAt: z.string().datetime().optional(),
  /** The plan the call was made from, e.g. a call back: closed or moved with it. */
  commitmentId: z.string().uuid().nullable().optional(),
  markDone: z.boolean().optional(),
  next: z
    .object({
      kind: z.enum(['again', 'followup', 'waiting']),
      title: z.string().max(300).optional(),
      dueAt: z.string().datetime(),
    })
    .nullable()
    .optional(),
})
export type LogCallInput = z.infer<typeof logCallInput>

/** How far along things are with a clinic or company. */
export const ACCOUNT_STAGES = ['prospect', 'talking', 'proposal', 'customer', 'lost'] as const
export type AccountStage = (typeof ACCOUNT_STAGES)[number]
export const ACCOUNT_STAGE_LABELS: Record<AccountStage, string> = {
  prospect: 'Prospect',
  talking: 'In talks',
  proposal: 'Proposal sent',
  customer: 'Customer',
  lost: 'Lost',
}

export const saveAccountInput = z.object({
  name: z.string().min(1).max(200),
  stage: z.enum(ACCOUNT_STAGES).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
})

export const renameAccountInput = z.object({
  from: z.string().min(1).max(200),
  to: z.string().min(1).max(200),
})

/** How often you mean to hear from someone, in days. */
export const KEEP_IN_TOUCH_CHOICES: { days: number; label: string }[] = [
  { days: 7, label: 'Every week' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Every month' },
  { days: 90, label: 'Every 3 months' },
]

export const createContactInput = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(120).optional(),
  organization: z.string().max(200).optional(),
  keepInTouchDays: z.number().int().min(1).max(366).nullable().optional(),
  /** "MM-DD", no year. */
  birthday: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).nullable().optional(),
  anniversary: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).nullable().optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(200).optional().or(z.literal('')),
  notes: z.string().max(4000).optional(),
  placeId: z.string().uuid().nullable().optional(),
})
export type CreateContactInput = z.infer<typeof createContactInput>

export const updateContactInput = createContactInput.partial()
export type UpdateContactInput = z.infer<typeof updateContactInput>

export const lookupPlaceInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(25).max(2000).default(250),
})
export type LookupPlaceInput = z.infer<typeof lookupPlaceInput>

export const snoozeInput = z.object({
  minutes: z.number().int().min(1).max(60 * 24 * 30),
})
export type SnoozeInput = z.infer<typeof snoozeInput>

/** Move an existing commitment to an absolute time — "shift the other one". */
export const rescheduleInput = z.object({
  dueAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  allowConflict: z.boolean().optional(),
})
export type RescheduleInput = z.infer<typeof rescheduleInput>

/**
 * Edits. Every field is optional — the client sends only what changed, so two
 * people editing different fields of the same record do not clobber each other.
 */
export const updateCommitmentInput = z.object({
  title: z.string().min(1).max(300).optional(),
  kind: z.enum(COMMITMENT_KIND).optional(),
  dueAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  placeId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  allDay: z.boolean().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  placeLabel: z.string().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  flexibility: z.enum(FLEXIBILITY).optional(),
  preferredWindow: z.enum(TIME_WINDOWS).nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(COMMITMENT_STATUS).optional(),
  allowConflict: z.boolean().optional(),
  /** Work or personal, said by the person; null goes back to reading the words. */
  sphere: z.enum(['work', 'personal']).nullable().optional(),
})
export type UpdateCommitmentInput = z.infer<typeof updateCommitmentInput>

export const updateVisitInput = z.object({
  placeId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  purpose: z.enum(PURPOSE).optional(),
  contactName: z.string().max(200).nullable().optional(),
  outcome: z.string().max(200).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  startedAt: z.string().datetime().optional(),
})
export type UpdateVisitInput = z.infer<typeof updateVisitInput>

export const conflictCheckInput = z.object({
  dueAt: z.string().datetime(),
  placeLabel: z.string().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480),
  endsAt: z.string().datetime().nullable().optional(),
  allDay: z.boolean().optional(),
  /** Ignore this commitment when checking — used when rescheduling it. */
  excludeId: z.string().uuid().optional(),
})
export type ConflictCheckInput = z.infer<typeof conflictCheckInput>

export const pushSubscribeInput = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  userAgent: z.string().max(500).optional(),
})
export type PushSubscribeInput = z.infer<typeof pushSubscribeInput>

// ---------------------------------------------------------------- read models

export interface PlaceDTO {
  id: string
  name: string
  kind: string | null
  address: string | null
  lat: number
  lng: number
  radiusM: number
  phone?: string | null
  category?: string | null
  source?: string
  externalId?: string | null
  /** Present only on /places/match responses. */
  distanceM?: number
  withinRadius?: boolean
}

export interface CommitmentDTO {
  id: string
  title: string
  kind: CommitmentKind
  dueAt: string
  durationMinutes: number
  /** Time of day is meaningless — render "Mon–Wed", not "09:00". */
  allDay: boolean
  flexibility: Flexibility
  /** Roughly when it should happen, when no exact time was given. */
  preferredWindow: TimeWindow | null
  /** Must be done by this moment, even with the exact time undecided. */
  deadline: string | null
  priority: Priority
  /** Set for anything spanning more than one day. */
  endsAt: string | null
  status: CommitmentStatus
  escalationCount: number
  placeId: string | null
  placeName: string | null
  /** Where, in words — "BKC, Mumbai". Typed, or a calendar event's location. */
  placeLabel?: string | null
  contactId: string | null
  contactName: string | null
  /** Lets the reminder offer a Call button instead of just a nag. */
  contactPhone: string | null
  /** Set when this is one occurrence of a repeating plan. */
  recurrenceId: string | null
  /** Set when this was mirrored from a subscribed calendar, not created here. */
  feedId: string | null
  /**
   * Mirrored from a calendar and dated before Cue started reading it. Cue was
   * not there, so it is neither done nor overdue — it has no status.
   */
  history?: boolean
  /** The schedule this is one step of, when it is part of one. */
  scheduleTitle?: string | null
  /** The meeting this follow-up came out of. */
  fromTitle?: string | null
  fromId?: string | null
  /** Someone else's to do: who it is waiting on. A check-in, not time booked. */
  waitingOn?: string | null
  /** For a meeting: follow-ups still open from earlier meetings like it. */
  prepOpen?: number
  /** How many things are attached to this; 0 means do not render a list. */
  checklistCount: number
  checklistDone: number
  notes: string | null
  createdAt: string
  /** Work or personal: the person's own say, or read from the words; null when neither. */
  sphere?: 'work' | 'personal' | null
  /** True when the person sorted it themselves, rather than its words. */
  sphereSaid?: boolean
}

export interface ContactDTO {
  id: string
  name: string
  role: string | null
  /** Where they work — a clinic, a company. */
  organization: string | null
  keepInTouchDays: number | null
  /** "MM-DD". */
  birthday?: string | null
  anniversary?: string | null
  phone: string | null
  email: string | null
  notes: string | null
  placeId: string | null
  placeName: string | null
  createdAt: string
  /** Present on the single-contact fetch only. */
  visitCount?: number
  lastSeenAt?: string | null
  openCommitments?: CommitmentDTO[]
}

export interface VoiceNoteDTO {
  id: string
  mimeType: string
  durationMs: number | null
  sizeBytes: number
  transcript?: string | null
  createdAt: string
}

/**
 * What the app thinks this visit will look like, derived entirely from what
 * happened at this place before. No model involved — it is the median of your
 * own history.
 */
export interface PlaceSuggestionDTO {
  placeId: string
  placeName: string
  visitCount: number
  lastVisitAt: string | null
  daysSinceLast: number | null
  contact: { id: string; name: string; role: string | null; phone: string | null } | null
  outcome: string | null
  /** Median gap between a visit here and the follow-up it produced. */
  typicalIntervalDays: number | null
  lastCommitment: {
    title: string
    kind: CommitmentKind
    durationMinutes: number
    /** Used to carry the usual time of day over to the new suggestion. */
    dueAt: string
  } | null
  /** 'strong' once there is enough history to offer a one-tap repeat. */
  confidence: 'strong' | 'weak' | 'none'
}

/** One business found at a location by the lookup provider. */
export interface PlaceCandidateDTO {
  source: 'osm' | 'google'
  externalId: string
  name: string
  category: string | null
  address: string | null
  phone: string | null
  lat: number
  lng: number
  distanceM: number
}

/** A free gap the scheduler is offering, with the reason it was chosen. */
export interface SlotSuggestion {
  startsAt: string
  endsAt: string
  /** Plain-language justification — the user should never wonder why. */
  reason: string
}

export type LocationSeverity = 'impossible' | 'tight' | 'review' | 'none'

/** Something worth a look, never something that blocks a save. */
export interface LocationConflictDTO {
  severity: LocationSeverity
  kind: 'trip_elsewhere' | 'travel_between'
  reason: string
  travel?: { distanceKm: number; minutes: number; basis: string }
  availableMinutes?: number
  trip?: {
    id: string
    placeLabel: string
    startsOn: string
    endsOn: string
    strictness: string
  }
  other?: { id: string; title: string; placeLabel: string | null; dueAt: string }
  suggestedActions: string[]
}

export interface ConflictReport {
  /** Pending commitments whose slot overlaps the proposed one. */
  conflicts: CommitmentDTO[]
  /** Where-based problems: a trip elsewhere, or not enough time to travel. */
  locationConflicts?: LocationConflictDTO[]
  /**
   * The earliest times with no clash, so the UI can offer "shift it to 4:30"
   * instead of making the user hunt for a gap.
   */
  suggestions: string[]
}

/** Body of the 409 returned when a write would double-book. */
export interface ConflictError extends ConflictReport {
  error: 'time_conflict'
}

export interface VisitDTO {
  id: string
  placeId: string | null
  placeName: string | null
  purpose: Purpose
  contactId: string | null
  contactName: string | null
  contactPhone: string | null
  outcome: string | null
  notes: string | null
  lat: number | null
  lng: number | null
  startedAt: string
  createdAt: string
  /** Present on the single-visit fetch, omitted from list responses. */
  commitments?: CommitmentDTO[]
}
export { sphereOf, isWorkTime, nextWorkBoundary, describeWorkHours, DEFAULT_WORK_HOURS, SPHERES, type Sphere, type SphereHints, type WorkHours } from './sphere.ts'
export { packingList, packingItems, type PackingInput, type PackingSection, type TripPurpose, type TravelMode } from './packing.ts'
export {
  EXAMS,
  EXAM_GROUPS,
  examGroup,
  type ExamGroup,
  EXAM_STEPS,
  RRB_REGIONS,
  dateIn,
  examByKey,
  examDayCarry,
  examLabel,
  examStage,
  examStages,
  examStepTitle,
  findExam,
  isLaterExamStage,
  isOpenExamStage,
  parseExamLine,
  readAdmitCard,
  roundIn,
  splitExamStep,
  timesIn,
  WATCHED_BOARDS,
  watchedBoard,
  EXAM_LEVELS,
  EXAM_TRAINING,
  examFit,
  type ExamLevel,
  type ExamTraining,
  type AdmitCard,
  type CatalogExam,
  type ExamDateSaid,
  type ExamRound,
  type ExamStage,
  type ExamStep,
  type ParsedExamLine,
} from './exams.ts'
import { EXAM_STEP_KEYS } from './exams.ts'

const ymdField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const hhmmField = z.string().regex(/^\d{2}:\d{2}$/)
const shortText = (max: number) => z.string().trim().max(max)

/** One date of an exam's, to become a plan with its reminders. */
export const examDateInput = z.object({
  step: z.enum(EXAM_STEP_KEYS),
  on: ymdField,
  at: hhmmField.nullable().optional(),
  round: shortText(40).nullable().optional(),
  /** What it is, for "something else". */
  note: shortText(120).nullable().optional(),
})
export type ExamDateInput = z.infer<typeof examDateInput>

const examFields = {
  name: shortText(120).min(1),
  cycle: shortText(40).nullable().optional(),
  region: shortText(80).nullable().optional(),
  registrationNo: shortText(40).nullable().optional(),
  rollNo: shortText(40).nullable().optional(),
  notes: shortText(2000).nullable().optional(),
}

/** An exam to track: one from the list (examKey), or one of the person's own (name only). */
export const createExamInput = z.object({
  ...examFields,
  examKey: shortText(60).nullable().optional(),
  stage: shortText(40).optional(),
  dates: z.array(examDateInput).max(8).optional(),
})
export const updateExamInput = z
  .object({
    ...examFields,
    stage: shortText(40),
    category: z.enum(['UR', 'EWS', 'OBC', 'MBC', 'SC', 'ST']).nullable(),
    centreName: shortText(200).nullable(),
    centreAddress: shortText(400).nullable(),
    centreCity: shortText(80).nullable(),
  })
  .partial()

/** The day itself, from an admit card as read and checked by the person. */
export const examDayInput = z.object({
  /** The exam it is for; or, read from a card for an exam not yet tracked, which one. */
  examId: z.string().uuid().nullable().optional(),
  examKey: shortText(60).nullable().optional(),
  examName: shortText(120).nullable().optional(),
  round: shortText(40).nullable().optional(),
  date: ymdField,
  reportingAt: hhmmField.nullable().optional(),
  gateClosesAt: hhmmField.nullable().optional(),
  startsAt: hhmmField.nullable().optional(),
  endsAt: hhmmField.nullable().optional(),
  rollNo: shortText(40).nullable().optional(),
  registrationNo: shortText(40).nullable().optional(),
  centreName: shortText(200).nullable().optional(),
  centreAddress: shortText(400).nullable().optional(),
  centreCity: shortText(80).nullable().optional(),
})
export type ExamDayInput = z.infer<typeof examDayInput>

/** One of an exam's dates, as its plan. */
export interface ExamDateDTO {
  id: string
  step: string
  round: string | null
  title: string
  dueAt: string
  allDay: boolean
  status: string
  /** Its list — what the form asks for, what to carry — and how much is ticked. */
  ready: { done: number; total: number } | null
}

export interface ExamDTO {
  id: string
  examKey: string | null
  name: string
  cycle: string | null
  region: string | null
  registrationNo: string | null
  rollNo: string | null
  stage: string
  stageChangedAt: string
  centreName: string | null
  centreAddress: string | null
  centreCity: string | null
  notes: string | null
  closedAt: string | null
  createdAt: string
  /** Its dates' plans, soonest first. */
  dates: ExamDateDTO[]
  /** Reservation category, for reading cut-offs. */
  category: string | null
  /** Official notices about it, checked and approved; on the single-exam fetch. */
  notices?: { id: string; title: string; url: string; summary: string; reviewedAt: string; cutoffs: { category: string; marks: number }[] }[]
  /** Its study plan: the series running for it. On the single-exam fetch. */
  study?: StudySeriesDTO[]
  /** Mock test scores, oldest first. On the single-exam fetch. */
  mocks?: MockScoreDTO[]
  /** Result lists their roll number was looked for in, and whether it was there. */
  checks?: { noticeId: string; title: string; url: string; found: boolean; page: number | null; means: string; round: string | null; checkedAt: string }[]
  /** Scores worked out from the answer key, by round ('' for an exam of one). */
  expected?: Record<string, ExpectedScoreDTO>
  /** The exam day as the admit card gave it, for saying it to family. */
  examDay?: { date: string; reportingAt: string | null; gateClosesAt: string | null; startsAt: string | null; endsAt: string | null } | null
  /** The newest cut-offs Cue holds for this exam, of any year: what a score is held against. On the single-exam fetch. */
  lastCutoffs?: { title: string; url: string; cycle: string | null; round: string | null; cutoffs: { category: string; marks: number }[] } | null
  /** A yearly 1 April reminder to renew their category certificate is set. On the single-exam fetch. */
  certificateReminder?: boolean
}
/** Right and wrong answers from the answer key; the marking only for a paper Cue does not know. */
export const expectedScoreInput = z.object({
  round: z.string().max(40).nullable(),
  right: z.number().int().min(0).max(1000),
  wrong: z.number().int().min(0).max(1000),
  questions: z.number().int().min(1).max(1000).optional(),
  perRight: z.number().min(0).max(100).optional(),
  perWrong: z.number().min(0).max(100).optional(),
})
export interface ExpectedScoreDTO {
  right: number
  wrong: number
  questions: number
  perRight: number
  perWrong: number
  score: number
  outOf: number
  savedAt: string
}
/** An exam whose form is open now, from an approved official notice: offered to add, its dates with it. */
export interface OpenFormDTO {
  examKey: string
  name: string
  cycle: string | null
  /** YYYY-MM-DD, the last day to apply. */
  applyBy: string
  /** From a board's calendar, not yet its notification. */
  tentative: boolean
  url: string
  title: string
  /** Against what the person has studied: null when either is not known. */
  fit: 'fits' | 'needs' | null
}
export { isExamBody, parseExamEmail, type ExamMail, type ExamMailKind } from './examMail.ts'
export { examClashes, type ExamClash, type ExamDayItem } from './examClash.ts'
export { MARKING, expectedScore, markingFor, type Marking } from './marking.ts'
export {
  GLANCE_DAYS,
  RENEWED_CATEGORIES,
  daysAway,
  examGlance,
  financialYearStart,
  isRenewedCategory,
  nextFirstApril,
  type ExamGlance,
  type ExamGlanceItem,
  type GlanceExam,
  type RenewedCategory,
} from './examGlance.ts'
export { readyFor, readyList, type ReadyKind, type ReadyPerson } from './examReady.ts'
export {
  NOTICE_KINDS,
  datesInNotice,
  datesMentioned,
  listIn,
  noticeKind,
  noticeSummary,
  proposeFromNotice,
  type NoticeDate,
  type NoticeKind,
  type NoticeProposal,
} from './notices.ts'
import { NOTICE_KIND_KEYS } from './notices.ts'
import { CATEGORY_KEYS } from './results.ts'
export {
  CATEGORIES,
  cutOffsIn,
  findNumber,
  normalizeNumber,
  numbersIn,
  type Category,
  type CutOff,
  type ListMeaning,
} from './results.ts'

/** One exam's part of a notice, as the reviewer leaves it. */
export const noticeProposalInput = z.object({
  examKey: shortText(60).min(1),
  cycle: shortText(40).nullable(),
  kind: z.enum(NOTICE_KIND_KEYS),
  list: z
    .object({
      means: z.enum(['shortlist', 'selected', 'result']),
      round: shortText(40).nullable(),
      pdfUrl: z.string().trim().url().max(600).nullable(),
    })
    .nullable()
    .optional(),
  cutoffs: z
    .array(z.object({ category: z.enum(CATEGORY_KEYS), marks: z.number().min(0).max(1000) }))
    .max(12)
    .optional(),
  dates: z
    .array(
      z.object({
        step: z.enum(EXAM_STEP_KEYS),
        on: ymdField,
        at: hhmmField.nullable(),
        round: shortText(40).nullable(),
        note: shortText(120).nullable(),
      }),
    )
    .max(12),
})
export const reviewNoticeInput = z.object({ proposals: z.array(noticeProposalInput).max(10) })

/** A notice seen somewhere the watcher does not reach, added by hand. */
export const addNoticeInput = z.object({
  url: z.string().trim().url().max(600),
  title: shortText(300).min(5),
  board: shortText(40).nullable().optional(),
  text: z.string().max(20_000).nullable().optional(),
})

export type NoticeStatus = 'baseline' | 'pending' | 'unmatched' | 'approved' | 'dismissed'

export interface NoticeDTO {
  id: string
  source: string
  sourceName: string
  url: string
  title: string
  status: NoticeStatus
  proposals: import('./notices.ts').NoticeProposal[]
  /** Dates seen in the notice's PDF: for the reviewer to check, not proposals. */
  hints: string[]
  foundAt: string
  reviewedAt: string | null
  /** How many people tracking the exam were told. */
  told: number
}

/** An approved notice, as an exam's page lists it. */
export interface ExamNoticeDTO {
  id: string
  title: string
  url: string
  summary: string
  reviewedAt: string
}
export { mockScoreIn, studyWeek, subjectsFor, type StudySeries } from './study.ts'
export {
  STAGE_HI,
  STEP_HI,
  carryHi,
  examDayNotesHi,
  examLineHi,
  listFoundHi,
  noticeLineHi,
  stepNotesHi,
  stepTitleHi,
  type Lang,
} from './examHindi.ts'
export {
  BOARD_HI,
  DELIVERY_STATUS_HI,
  EXPENSE_CATEGORY_HI,
  REPEAT_HI,
  TRACKER_STAGE_HI,
  boardLabel,
  deliveryStatusLabel,
  expenseCategoryLabel,
  repeatLabel,
  trackerStageLabel,
} from './hindi.ts'

/** A study plan for an exam: subjects dealt across the days chosen, and a weekly mock test. */
export const studyPlanInput = z.object({
  subjects: z.array(shortText(60).min(1)).min(1).max(12),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  at: hhmmField,
  minutes: z.number().int().min(15).max(480),
  mock: z.object({ day: z.number().int().min(0).max(6), at: hhmmField, minutes: z.number().int().min(15).max(300) }).nullable(),
  /** The last day; by default the day before the exam, or twelve weeks. */
  until: ymdField.nullable().optional(),
})

export const mockScoreInput = z.object({
  takenOn: ymdField,
  score: z.number().min(0).max(10_000),
  outOf: z.number().positive().max(10_000),
  note: shortText(200).nullable().optional(),
})

export interface StudySeriesDTO {
  id: string
  title: string
  weekdays: number[]
  hour: number
  minute: number
  durationMinutes: number
  untilOn: string | null
}

export interface MockScoreDTO {
  id: string
  takenOn: string
  score: number
  outOf: number
  note: string | null
}
