import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  date,
  doublePrecision,
  integer,
  index,
  uniqueIndex,
  pgEnum,
  customType,
  jsonb,
} from 'drizzle-orm/pg-core'

/** Drizzle has no first-class bytea, so map it to a Node Buffer explicitly. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

/**
 * Every tenant-owned row carries `orgId`. Adding that column later is the
 * genuinely painful migration, so it is here from the first commit even though
 * isolation is currently enforced in the query layer (see src/db/scope.ts)
 * rather than by Postgres row-level security.
 */

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** 'none' | 'anthropic' | 'ollama' — bring-your-own-key, off by default. */
  aiProvider: text('ai_provider').notNull().default('none'),
  /** Encrypted at rest; it is the customer's key, not ours. */
  aiApiKeyEncrypted: text('ai_api_key_encrypted'),
  aiModel: text('ai_model'),
  /** Only used by the self-hosted provider. */
  aiEndpoint: text('ai_endpoint'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Who may change settings that affect the whole account.
 *
 * The AI provider and its key live on the org — one credential, one bill,
 * everyone's usage — so changing them is not the same kind of act as choosing
 * when your own evening starts.
 */
export const userRole = pgEnum('user_role', ['owner', 'member'])

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** Drives when the evening nudge fires; set from the browser on sign-in. */
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    /** Whoever registered owns the org; invited people are members. */
    role: userRole('role').notNull().default('member'),
    /**
     * Kept in the database rather than on disk: a deploy replaces the
     * application directory and the instance itself is replaceable, either of
     * which would quietly take uploaded files with it.
     */
    avatar: bytea('avatar'),
    avatarMime: text('avatar_mime'),
    /** Also the cache key — the URL carries it, so a new photo is a new URL. */
    avatarUpdatedAt: timestamp('avatar_updated_at', { withTimezone: true }),
    dailyNudgeEnabled: boolean('daily_nudge_enabled').notNull().default(true),
    /** Ask "any follow-ups?" by notification when a meeting ends. */
    followupPrompts: boolean('followup_prompts').notNull().default(true),
    /** Before a meeting, say what is still open from last time. */
    prepPrompts: boolean('prep_prompts').notNull().default(true),
    /** Every Friday, a review of the week behind and the one ahead. */
    weeklyReviewEnabled: boolean('weekly_review_enabled').notNull().default(true),
    /** Local hour on Friday, 0-23. */
    weeklyReviewHour: integer('weekly_review_hour').notNull().default(17),
    /** Local date of the last Friday prompt, so a restart cannot double-send. */
    lastReviewPromptOn: date('last_review_prompt_on'),
    /** When the person last finished a review. */
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    /** The day's shape, by notification, each morning. */
    morningBriefEnabled: boolean('morning_brief_enabled').notNull().default(true),
    /** Local hour, 0-23. */
    morningBriefHour: integer('morning_brief_hour').notNull().default(8),
    /** Local date of the last brief, so a restart cannot double-send. */
    lastBriefOn: date('last_brief_on'),
    /** An evening reminder to send the daily report. */
    reportEnabled: boolean('report_enabled').notNull().default(false),
    /** Local hour, 0-23. */
    reportHour: integer('report_hour').notNull().default(18),
    /** Local date of the last reminder, so a restart cannot double-send. */
    lastReportPromptOn: date('last_report_prompt_on'),
    /** Who the report goes to: a name to greet, and where to send it. */
    reportToName: text('report_to_name'),
    reportToEmail: text('report_to_email'),
    reportToPhone: text('report_to_phone'),
    /** Local hour, 0-23. */
    dailyNudgeHour: integer('daily_nudge_hour').notNull().default(19),
    /** Local date of the last nudge, so a restart cannot double-send. */
    lastNudgeOn: date('last_nudge_on'),
    /** Personal definitions of "evening"; null means the shared defaults. */
    timeWindows: jsonb('time_windows'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
)

/**
 * A pending password reset.
 *
 * Only the hash of the token lives here. The token itself exists in the email
 * and the link and nowhere else, so a copy of this table is not a stack of
 * working resets.
 */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Kept rather than deleted, so a second click can say "already used". */
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedIp: text('requested_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('password_resets_user_idx').on(t.userId, t.createdAt)],
)

export const places = pgTable(
  'places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Free text on purpose: "clinic", "site", "office" — the app stays generic. */
    kind: text('kind'),
    address: text('address'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    radiusM: integer('radius_m').notNull().default(150),
    phone: text('phone'),
    category: text('category'),
    /** Where the details came from: 'manual', 'osm' or 'google'. */
    source: text('source').notNull().default('manual'),
    /** Provider's id, so re-importing the same POI updates rather than duplicates. */
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('places_org_idx').on(t.orgId),
    index('places_external_idx').on(t.orgId, t.source, t.externalId),
  ],
)

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    placeId: uuid('place_id').references(() => places.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    role: text('role'),
    /** Where they work: a clinic, a company. Free text, not a saved place. */
    organization: text('organization'),
    phone: text('phone'),
    email: text('email'),
    notes: text('notes'),
    /** How many days you are happy to go without contact. Null: not tracked. */
    keepInTouchDays: integer('keep_in_touch_days'),
    /** When that rhythm was set — the starting point while nothing has happened yet. */
    keepInTouchSince: timestamp('keep_in_touch_since', { withTimezone: true }),
    /** "Talked today", for contact that never became a plan here. */
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    touchSnoozedUntil: timestamp('touch_snoozed_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('contacts_org_idx').on(t.orgId), index('contacts_place_idx').on(t.orgId, t.placeId)],
)

/**
 * What is said about a clinic or company itself: how far along things are,
 * and notes. The account exists anyway, as soon as a contact's organization
 * names it; this row is matched to them by name, without case.
 */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  stage: text('stage'),
  stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** One visit, call or meeting. */
export const interactions = pgTable(
  'interactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    placeId: uuid('place_id').references(() => places.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    /**
     * Generated by the client at capture time. Makes replaying a visit that was
     * queued offline idempotent — a retry lands on the same row.
     */
    clientId: uuid('client_id'),
    /** Fallback for anything logged before contacts became real records. */
    contactName: text('contact_name'),
    purpose: text('purpose').notNull().default('unknown'),
    outcome: text('outcome'),
    notes: text('notes'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    accuracyM: doublePrecision('accuracy_m'),
    /** 'visit' or 'call'. */
    channel: text('channel').notNull().default('visit'),
    /** Whether you actually spoke. An unanswered call is not contact. */
    connected: boolean('connected').notNull().default(true),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('interactions_org_started_idx').on(t.orgId, t.startedAt)],
)

/** The thing you promised to do next. This is what the app exists to protect. */
export const commitments = pgTable(
  'commitments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    interactionId: uuid('interaction_id').references(() => interactions.id, {
      onDelete: 'set null',
    }),
    placeId: uuid('place_id').references(() => places.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    kind: text('kind').notNull().default('followup'),
    /** For items added directly, which have no visit to inherit notes from. */
    notes: text('notes'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    /** How long this blocks out, so two things cannot claim the same slot. */
    durationMinutes: integer('duration_minutes').notNull().default(15),
    /** Time of day is meaningless — a trip, not a 15-minute slot. */
    allDay: boolean('all_day').notNull().default(false),
    /** Set for anything spanning more than one day; overrides durationMinutes. */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /** Which trip this belongs to, if any. Set null on trip delete, never cascade. */
    tripId: uuid('trip_id'),
    /** The series this came from. Cascades: an occurrence has no life of its own. */
    recurrenceId: uuid('recurrence_id'),
    /** The schedule this is one step of — see `schedules`. */
    scheduleId: uuid('schedule_id'),
    /** When the "before your meeting" notification went. */
    prepPromptedAt: timestamp('prep_prompted_at', { withTimezone: true }),
    /** When the "any follow-ups?" notification went, for a meeting. */
    wrapupPromptedAt: timestamp('wrapup_prompted_at', { withTimezone: true }),
    /** The meeting this follow-up came out of. */
    fromCommitmentId: uuid('from_commitment_id'),
    /**
     * Who this is waiting on. Set, it is a check-in date rather than time on
     * the calendar: it claims no slot and is never overdue — see overdue.ts.
     */
    waitingOn: text('waiting_on'),
    /** Local date this occurrence stands for — safer to compare than dueAt. */
    occurrenceOn: date('occurrence_on'),
    /** Edited on its own, so regenerating the series must leave it alone. */
    detached: boolean('detached').notNull().default(false),
    /** Set when this row mirrors an event from a subscribed calendar. */
    feedId: uuid('feed_id'),
    externalUid: text('external_uid'),
    /** Free-text location, for somewhere that is not a saved Place. */
    placeLabel: text('place_label'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    /** 'fixed' occupies a slot and can clash; 'flexible' only wants a window. */
    flexibility: text('flexibility').notNull().default('fixed'),
    /** morning | afternoon | evening | night — when no exact time was given. */
    preferredWindow: text('preferred_window'),
    /** Must happen by then, even with the exact time still undecided. */
    deadline: timestamp('deadline', { withTimezone: true }),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('pending'),
    /** How many times the nag engine has already chased this one. */
    escalationCount: integer('escalation_count').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /**
     * When you decided not to do it. Separate from `completedAt` because the
     * timeline needs the moment you decided, and a cancelled thing never had a
     * completion. Cleared if the item is reopened.
     */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /**
     * Soft delete. Deleting means "off my lists", not "never happened" — the
     * row stays so History can show what you let go of. Set together with
     * `status = 'deleted'`, which is what every list query filters on.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('commitments_org_status_due_idx').on(t.orgId, t.status, t.dueAt)],
)

/**
 * A single scheduled buzz. One commitment produces a chain of these: the first
 * at `dueAt`, then one per escalation until the commitment is closed out.
 */
export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    commitmentId: uuid('commitment_id')
      .notNull()
      .references(() => commitments.id, { onDelete: 'cascade' }),
    fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    attempt: integer('attempt').notNull().default(0),
    /** Held back until a focus block ends; see services/focus.ts. */
    held: boolean('held').notNull().default(false),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reminders_due_idx').on(t.status, t.fireAt)],
)

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('push_endpoint_unique').on(t.endpoint)],
)

/**
 * A spoken note attached to a visit. Recorded entirely in the browser — no
 * transcription service is involved. `transcript` is only populated when the
 * user chose the browser's own dictation, and the audio stands alone without it.
 */
export const voiceNotes = pgTable(
  'voice_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Null while recording; set when the visit it belongs to is saved. */
    interactionId: uuid('interaction_id').references(() => interactions.id, {
      onDelete: 'cascade',
    }),
    mimeType: text('mime_type').notNull(),
    durationMs: integer('duration_ms'),
    sizeBytes: integer('size_bytes').notNull(),
    audio: bytea('audio').notNull(),
    transcript: text('transcript'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('voice_notes_interaction_idx').on(t.interactionId)],
)

/**
 * A period with a place attached, that other plans belong to.
 *
 * Not a thing to do — a context. "I am in Mathura 12-14 October" changes what
 * is feasible for three days and makes a pile of saved intentions suddenly
 * relevant.
 */
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Free text: you plan a trip to "Mathura" before it is a saved place. */
    placeLabel: text('place_label').notNull(),
    placeId: uuid('place_id').references(() => places.id, { onDelete: 'set null' }),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    /** 'strict' | 'flexible' | 'tentative' — drives how loud a clash is. */
    strictness: text('strictness').notNull().default('flexible'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    notes: text('notes'),
    status: text('status').notNull().default('planned'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('trips_user_dates_idx').on(t.userId, t.startsOn, t.endsOn)],
)

/**
 * "When I go to Mathura, remind me to buy peda."
 *
 * A standing wish with no date. It waits, invisibly, until a trip to that place
 * exists — which is the whole point: a reminder for tomorrow would be wrong.
 */
export const intentions = pgTable(
  'intentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    placeLabel: text('place_label').notNull(),
    placeId: uuid('place_id').references(() => places.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    notes: text('notes'),
    preferredWindow: text('preferred_window'),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    priority: text('priority').notNull().default('nice_to_have'),
    /** 'saved' | 'scheduled' | 'done' | 'dropped' */
    status: text('status').notNull().default('saved'),
    commitmentId: uuid('commitment_id').references(() => commitments.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('intentions_user_idx').on(t.userId, t.status)],
)

/**
 * A subscription to someone else's calendar, read over its iCal URL.
 *
 * One-way by design: Cue mirrors the feed and never writes back, so a bad
 * sync can show a stale meeting but can never damage the source calendar.
 */
export const calendarFeeds = pgTable(
  'calendar_feeds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** 'url' re-reads on a timer; 'file' changes only on a fresh upload. */
    source: text('source').notNull().default('url'),
    /** A bearer credential — anyone holding it can read the calendar. */
    urlEncrypted: text('url_encrypted'),
    /** Enough to tell two feeds apart, and nothing more. */
    urlHint: text('url_hint'),
    /** For a file-sourced feed: what the uploaded file was called. */
    fileName: text('file_name'),
    /** False leaves the nagging to the source calendar. */
    remind: boolean('remind').notNull().default(true),
    /**
     * How far back to mirror, in days. Null means everything the feed holds.
     * Per calendar because the right answer differs: a holiday feed has no
     * history worth keeping, a work calendar's history is the point.
     */
    historyDays: integer('history_days').default(365),
    status: text('status').notNull().default('active'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastEventCount: integer('last_event_count'),
    lastSkippedCount: integer('last_skipped_count'),
    calendarName: text('calendar_name'),
    /** Which connected account this reads through, when source is a provider. */
    oauthAccountId: uuid('oauth_account_id'),
    /** The provider's own id for the calendar. Opaque; shape differs per provider. */
    externalCalendarId: text('external_calendar_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('calendar_feeds_user_idx').on(t.userId, t.status)],
)

/**
 * A connected account at some provider.
 *
 * One table rather than one per provider: the OAuth round trip is the same
 * shape everywhere, and three copies of it would drift apart the first time one
 * was fixed. Tokens live here rather than on each feed because one account can
 * supply several calendars, and a refresh should rotate one row rather than five.
 */
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'google' | 'microsoft'. */
    provider: text('provider').notNull(),
    email: text('email').notNull(),
    /** Short-lived; refreshed on demand. */
    accessTokenEncrypted: text('access_token_encrypted'),
    /** The standing grant. Often returned only on first consent. */
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** What was granted, which can be less than what was asked for. */
    scope: text('scope'),
    status: text('status').notNull().default('active'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('oauth_accounts_user_idx').on(t.userId, t.status)],
)

/**
 * One in-flight OAuth round trip.
 *
 * The callback is a bare browser redirect with no auth header, so this row is
 * the only thing tying it back to whoever started it. Single-use and
 * short-lived by design.
 */
export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  provider: text('provider').notNull().default('google'),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  codeVerifier: text('code_verifier').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

/**
 * A repeating plan.
 *
 * Holds only the rule. Every occurrence it produces is an ordinary row in
 * `commitments`, which is what lets the reminder worker, conflict detection
 * and the whole UI stay ignorant that recurrence exists at all.
 */
export const recurrences = pgTable(
  'recurrences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Copied onto each occurrence, so editing the series shapes future ones. */
    title: text('title').notNull(),
    kind: text('kind').notNull().default('task'),
    notes: text('notes'),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    priority: text('priority').notNull().default('normal'),
    placeId: uuid('place_id').references(() => places.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    placeLabel: text('place_label'),

    /** daily | weekly | monthly | yearly */
    freq: text('freq').notNull(),
    interval: integer('interval').notNull().default(1),
    /** 0=Sunday .. 6=Saturday. Null means the same weekday as startsOn. */
    byWeekday: integer('by_weekday').array(),
    byMonthDay: integer('by_month_day'),
    byMonth: integer('by_month'),
    /** 1-4, or -1 for last: "the second Tuesday of the month". */
    setPos: integer('set_pos'),

    startsOn: date('starts_on').notNull(),
    hour: integer('hour').notNull().default(9),
    minute: integer('minute').notNull().default(0),
    untilOn: date('until_on'),
    count: integer('count'),

    /** Dates the series skips — "delete just this one" in a source calendar. */
    exdates: date('exdates').array(),

    /** Set when this series mirrors an event from a subscribed calendar. */
    feedId: uuid('feed_id'),
    /** The source VEVENT UID, which is what makes re-syncing an update. */
    externalUid: text('external_uid'),

    status: text('status').notNull().default('active'),
    /** How far ahead occurrences exist, so generation resumes rather than redoes. */
    materialisedTo: date('materialised_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recurrences_user_idx').on(t.userId, t.status)],
)

/**
 * Things attached to a plan — the shopping, the packing, the points to raise.
 *
 * A row per item rather than a JSON column, because these get ticked one at a
 * time by someone standing in a shop: that should be one cheap write, not a
 * read-modify-write of the whole list from a phone on a bad connection.
 */
export const checklistItems = pgTable(
  'checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    commitmentId: uuid('commitment_id')
      .notNull()
      .references(() => commitments.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('checklist_commitment_idx').on(t.commitmentId, t.position)],
)

/** City coordinates, resolved once. Cities do not move. */
export const geocodeCache = pgTable('geocode_cache', {
  label: text('label').primaryKey(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  displayName: text('display_name'),
  /** False means "nobody could resolve this", cached so it is not retried. */
  resolved: boolean('resolved').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * A schedule: steps at set distances from one date, each its own commitment.
 *
 * For what no repeating rule describes — vaccinations at birth, 6 weeks,
 * 10 weeks, 9 months. The steps are ordinary commitments carrying
 * `schedule_id`; this row groups them for progress and for stopping.
 */
export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    startsOn: date('starts_on').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('schedules_user_idx').on(t.userId, t.status)],
)

