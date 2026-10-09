export { parseWhen, titleFrom, placeFrom, type ParsedWhen } from './parseWhen.ts'
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
export { normalizeHinglish } from './hinglish.ts'

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
  next: { title: string; dueAt: string } | null
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
  /** The context that makes it relevant — "Mathura", "Jaipur", "near home". */
  placeLabel: z.string().min(1).max(200),
  placeId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  notes: z.string().max(4000).nullable().optional(),
  preferredWindow: z.enum(TIME_WINDOWS).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480).default(60),
  priority: z.enum(PRIORITIES).default('nice_to_have'),
})
export type CreateIntentionInput = z.infer<typeof createIntentionInput>

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
  placeLabel: string
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
}

/**
 * The statuses a person can set. The table also holds 'snoozed' (set by the
 * nag engine) and 'deleted' (set only by DELETE, never by an edit) — keeping
 * those out of here is what stops "delete" being a dropdown option.
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
  /** Someone else's to do: who it is waiting on. A check-in, not time booked. */
  waitingOn?: string | null
  /** For a meeting: follow-ups still open from earlier meetings like it. */
  prepOpen?: number
  /** How many things are attached to this; 0 means do not render a list. */
  checklistCount: number
  checklistDone: number
  notes: string | null
  createdAt: string
}

export interface ContactDTO {
  id: string
  name: string
  role: string | null
  /** Where they work — a clinic, a company. */
  organization: string | null
  keepInTouchDays: number | null
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
