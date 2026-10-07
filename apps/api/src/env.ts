import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(here, '../../../.env') })

/**
 * Which wall clock "9am" means.
 *
 * Every parser, the recurrence expander, the free-slot finder and the preview
 * text build times with local-time arithmetic, so the process timezone decides
 * what "tomorrow 9am" refers to. That was invisible in development, where the
 * server ran on a laptop in India. On EC2 the process is UTC, so every time
 * typed into the live app was stored 5h30 late — "9am" became 2:30 PM, and its
 * reminder fired at 2:30 PM too. The preview even said 9:00 AM, because it was
 * formatted in the same wrong zone it was computed in.
 *
 * Set here, before anything creates a Date, rather than in a systemd unit:
 * this file is the first thing every entry point loads — the server, the
 * migrations, the worker, the tests — so none of them can start without it.
 *
 * This is one zone for the whole server. Users elsewhere would see their
 * times shifted; doing that properly means threading each user's zone through
 * every date computation, and is a larger change than this fix.
 */
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata'
try {
  new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE })
} catch {
  // Refuse to start rather than fall back to UTC — falling back is exactly the
  // silent 5h30 shift this exists to prevent.
  throw new Error(`APP_TIMEZONE "${APP_TIMEZONE}" is not a timezone this runtime knows.`)
}
process.env.TZ = APP_TIMEZONE

function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required env var ${key}. Copy .env.example to .env.`)
  return value
}

function num(key: string, fallback: number): number {
  const raw = process.env[key]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  port: num('PORT', 3002),
  /** Applied to the process above; recorded here so it can be logged. */
  appTimezone: APP_TIMEZONE,
  /**
   * Which interfaces to listen on.
   *
   * Behind a reverse proxy on the same machine, set this to 127.0.0.1. The
   * process then cannot be reached from outside at all — not through a
   * mistakenly opened firewall port, not from another host in the VPC, not by
   * anything but the proxy sitting in front of it. The default stays
   * all-interfaces so a plain `npm start` on a laptop still works.
   */
  host: process.env.HOST ?? '0.0.0.0',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  jwtSecret: required('JWT_SECRET'),

  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:dev@example.com',

  /** 'auto' | 'osm' | 'google' | 'none' — see services/placeLookup.ts */
  placeLookupProvider: process.env.PLACE_LOOKUP_PROVIDER ?? 'auto',
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? '',

  /**
   * Google Calendar OAuth. Free to create in the Google Cloud console — these
   * are not billed API keys, they only identify the app on the consent screen.
   * Absent, the Connect button says so rather than failing at the redirect.
   */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  /**
   * Must match a redirect URI registered on the OAuth client *exactly* —
   * Google compares the whole string, and a mismatch fails at the consent
   * screen with a message that does not say which end is wrong.
   *
   * It has to point at the API, which in production is the same origin as the
   * web app and in development is not. `VITE_API_URL` is precisely that
   * distinction and is already in the same file: set in development, blank in
   * production. Using it means neither case needs a variable of its own.
   */
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ??
    `${(process.env.VITE_API_URL || process.env.WEB_ORIGIN || 'http://localhost:3002').replace(
      /\/$/,
      '',
    )}/api/oauth/google/callback`,

  /**
   * Microsoft / Outlook calendars, via Microsoft Graph. Free to register in
   * Azure (App registrations) — not a billed key either.
   */
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID ?? '',
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
  /**
   * 'common' accepts both work/school and personal accounts; 'organizations'
   * only work ones; a tenant id locks it to one organisation. Default is the
   * permissive one, because a planner is a personal thing even when the
   * calendar is not.
   */
  microsoftTenant: process.env.MICROSOFT_TENANT ?? 'common',
  microsoftRedirectUri:
    process.env.MICROSOFT_REDIRECT_URI ??
    `${(process.env.VITE_API_URL || process.env.WEB_ORIGIN || 'http://localhost:3002').replace(
      /\/$/,
      '',
    )}/api/oauth/microsoft/callback`,

  /**
   * Outgoing mail, used only for password resets.
   *
   * Any SMTP service will do — SES, Mailgun, Postmark, a Gmail app password.
   * Without SMTP_HOST and SMTP_FROM the reset route refuses rather than
   * showing "check your email" for a message nobody sent.
   */
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: num('SMTP_PORT', 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  /** The From address. Must be one the provider lets you send as. */
  smtpFrom: process.env.SMTP_FROM ?? '',

  /** Encrypts each org's stored provider key. Without it, BYOK is refused. */
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  aiDefaultModel: process.env.AI_DEFAULT_MODEL ?? 'claude-haiku-4-5-20251001',

  /** Average door-to-door speed for travel estimates. Indian roads, not motorways. */
  travelSpeedKmh: num('TRAVEL_SPEED_KMH', 45),

  reminderPollMs: num('REMINDER_POLL_MS', 20_000),
  escalationMinutes: num('ESCALATION_MINUTES', 15),
  maxEscalations: num('MAX_ESCALATIONS', 4),
}

export const pushConfigured = Boolean(env.vapidPublicKey && env.vapidPrivateKey)
