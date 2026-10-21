import type { FastifyInstance } from 'fastify'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db/index.ts'
import { forgetAccountState, scope } from '../auth.ts'
import { isAdmin } from '../admins.ts'
import { env, pushConfigured } from '../env.ts'
import { audit, AUDIT_KEEP_DAYS } from '../services/audit.ts'
import { heldNow, RULES } from '../services/throttle.ts'
import { jobStates, pushStats, recentErrors, startedAt } from '../services/health.ts'
import { mailConfigured } from '../services/mail.ts'

/**
 * The admin portal: people, what happened to their accounts, security and
 * the running system — for the accounts in ADMIN_EMAILS only.
 *
 * What it shows about a person is how they use Cue, never what they wrote:
 * counts, dates, settings, connections and the account trail. No plan
 * titles, notes, contacts or email — the privacy policy promises people do
 * not read those, and Google's rules for Gmail data say the same.
 */

async function rows<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)) as unknown as T[]
}

const idParam = z.object({ id: z.string().uuid() })

/** Days as people here live them: the app's time zone, not the database's UTC. */
const dayOf = (column: SQL) => sql`(${column} at time zone ${env.appTimezone})::date`
const today = sql`(now() at time zone ${env.appTimezone})::date`

/** Deployed builds carry the commit they came from (written by the deploy). */
function release(): { sha: string | null; builtAt: string | null } {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const raw = JSON.parse(readFileSync(resolve(here, '../../release.json'), 'utf8')) as { sha?: string; at?: string }
    return { sha: raw.sha ?? null, builtAt: raw.at ?? null }
  } catch {
    return { sha: null, builtAt: null }
  }
}

const VIEW_EVERY_MS = 10 * 60_000
const viewed = new Map<string, number>()

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.requireAdmin)

  // ── Overview ───────────────────────────────────────────────────────────
  app.get('/admin/overview', async () => {
    const [users] = await rows<Record<string, number>>(sql`
      select
        count(*)::int as total,
        count(*) filter (where not is_demo)::int as real,
        count(*) filter (where is_demo)::int as demos,
        count(*) filter (where disabled_at is not null)::int as disabled,
        count(*) filter (where not is_demo and created_at > now() - interval '1 day')::int as new_1d,
        count(*) filter (where not is_demo and created_at > now() - interval '7 days')::int as new_7d,
        count(*) filter (where not is_demo and created_at > now() - interval '30 days')::int as new_30d,
        count(*) filter (where not is_demo and last_seen_at > now() - interval '1 day')::int as active_1d,
        count(*) filter (where not is_demo and last_seen_at > now() - interval '7 days')::int as active_7d,
        count(*) filter (where not is_demo and last_seen_at > now() - interval '30 days')::int as active_30d
      from users`)

    const [content] = await rows<Record<string, number>>(sql`
      select
        (select count(*)::int from commitments where status <> 'deleted') as plans,
        (select count(*)::int from commitments where created_at > now() - interval '1 day') as plans_1d,
        (select count(*)::int from commitments where status = 'done' and completed_at > now() - interval '1 day') as done_1d,
        (select count(*)::int from recurrences where status = 'active') as repeating,
        (select count(*)::int from contacts) as people,
        (select count(*)::int from trips) as trips,
        (select count(*)::int from bills) as bills,
        (select count(*)::int from expenses) as expenses,
        (select count(*)::int from voice_notes) as voice_notes`)

    const [connections] = await rows<Record<string, number>>(sql`
      select
        count(*) filter (where provider = 'google')::int as google,
        count(*) filter (where provider = 'microsoft')::int as microsoft,
        count(*) filter (where mail_enabled)::int as mail_on,
        count(*) filter (where status <> 'active' or last_error is not null or mail_error is not null)::int as failing,
        (select count(*)::int from push_subscriptions) as devices,
        (select count(distinct user_id)::int from push_subscriptions) as device_users
      from oauth_accounts`)

    const [signIns] = await rows<Record<string, number>>(sql`
      select
        count(*) filter (where outcome = 'ok')::int as ok,
        count(*) filter (where outcome = 'failed')::int as failed,
        count(*) filter (where outcome = 'blocked')::int as blocked
      from audit_events
      where action = 'auth.login' and at > now() - interval '1 day'`)

    // Fourteen days, a row each: who joined, who signed in, what was planned.
    const days = await rows<{ day: string; signups: number; sign_ins: number; plans: number }>(sql`
      with days as (
        select generate_series(${today} - 13, ${today}, interval '1 day')::date as day
      )
      select
        to_char(d.day, 'YYYY-MM-DD') as day,
        (select count(*)::int from users u where not u.is_demo and ${dayOf(sql`u.created_at`)} = d.day) as signups,
        (select count(distinct a.user_id)::int from audit_events a
           where a.action = 'auth.login' and a.outcome = 'ok' and ${dayOf(sql`a.at`)} = d.day) as sign_ins,
        (select count(*)::int from commitments c where ${dayOf(sql`c.created_at`)} = d.day) as plans
      from days d
      order by d.day`)

    const uses = await rows<{ use: string; n: number }>(sql`
      select u.use, count(*)::int as n
      from users, unnest(uses) as u(use)
      where not is_demo
      group by u.use
      order by n desc`)

    return { users, content, connections, signIns, days, uses }
  })

  // ── People ─────────────────────────────────────────────────────────────
  app.get('/admin/users', async (req) => {
    const q = z
      .object({
        q: z.string().trim().max(200).optional(),
        filter: z.enum(['all', 'real', 'demo', 'disabled', 'active', 'inactive']).default('real'),
        sort: z.enum(['joined', 'active']).default('active'),
        page: z.coerce.number().int().min(0).max(1000).default(0),
      })
      .parse(req.query)
    const PAGE = 50

    const where: SQL[] = [sql`true`]
    if (q.q) where.push(sql`(u.email ilike ${'%' + q.q + '%'} or u.name ilike ${'%' + q.q + '%'})`)
    if (q.filter === 'real') where.push(sql`not u.is_demo`)
    if (q.filter === 'demo') where.push(sql`u.is_demo`)
    if (q.filter === 'disabled') where.push(sql`u.disabled_at is not null`)
    if (q.filter === 'active') where.push(sql`u.last_seen_at > now() - interval '7 days'`)
    if (q.filter === 'inactive') {
      where.push(sql`not u.is_demo and (u.last_seen_at is null or u.last_seen_at < now() - interval '30 days')`)
    }
    const filter = sql.join(where, sql` and `)
    const order = q.sort === 'joined' ? sql`u.created_at desc` : sql`u.last_seen_at desc nulls last, u.created_at desc`

    const [{ total } = { total: 0 }] = await rows<{ total: number }>(
      sql`select count(*)::int as total from users u where ${filter}`,
    )
    const list = await rows<Record<string, unknown>>(sql`
      select
        u.id, u.name, u.email, u.created_at, u.last_seen_at, u.is_demo, u.disabled_at,
        u.uses, u.language,
        (select count(*)::int from commitments c where c.user_id = u.id and c.status <> 'deleted') as plans,
        (select count(*)::int from contacts p where p.org_id = u.org_id) as people,
        (select count(*)::int from oauth_accounts o where o.user_id = u.id) as connections,
        (select count(*)::int from push_subscriptions s where s.user_id = u.id) as devices
      from users u
      where ${filter}
      order by ${order}
      limit ${PAGE} offset ${q.page * PAGE}`)

    return {
      total,
      page: q.page,
      pageSize: PAGE,
      users: list.map((u) => ({ ...u, isAdmin: isAdmin(u.email as string) })),
    }
  })

  app.get('/admin/users/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const [user] = await rows<Record<string, unknown>>(sql`
      select
        u.id, u.name, u.email, u.role, u.created_at, u.last_seen_at, u.is_demo,
        u.disabled_at, u.disabled_reason, u.sessions_from, u.uses, u.language, u.timezone,
        o.name as org_name,
        u.morning_brief_enabled, u.daily_nudge_enabled, u.weekly_review_enabled, u.report_enabled,
        u.followup_prompts, u.prep_prompts
      from users u join orgs o on o.id = u.org_id
      where u.id = ${id}`)
    if (!user) return reply.code(404).send({ error: 'not_found' })

    const [counts] = await rows<Record<string, number>>(sql`
      select
        (select count(*)::int from commitments where user_id = ${id} and status = 'pending') as plans_open,
        (select count(*)::int from commitments where user_id = ${id} and status = 'done') as plans_done,
        (select count(*)::int from commitments where user_id = ${id} and status <> 'deleted') as plans_total,
        (select count(*)::int from recurrences where user_id = ${id} and status = 'active') as repeating,
        (select count(*)::int from contacts where org_id = (select org_id from users where id = ${id})) as people,
        (select count(*)::int from places where org_id = (select org_id from users where id = ${id})) as places,
        (select count(*)::int from trips where user_id = ${id}) as trips,
        (select count(*)::int from bills where user_id = ${id}) as bills,
        (select count(*)::int from expenses where user_id = ${id}) as expenses,
        (select count(*)::int from tracker_items where user_id = ${id}) as tracked,
        (select count(*)::int from voice_notes where user_id = ${id}) as voice_notes`)

    const connections = await rows<Record<string, unknown>>(sql`
      select o.id, o.provider, o.email, o.status, o.last_error, o.mail_enabled, o.mail_checked_at,
             o.mail_error, o.created_at,
             (select count(*)::int from calendar_feeds f where f.oauth_account_id = o.id) as calendars
      from oauth_accounts o
      where o.user_id = ${id}
      order by o.created_at`)

    const devices = await rows<Record<string, unknown>>(sql`
      select id, user_agent, created_at from push_subscriptions where user_id = ${id} order by created_at desc`)

    // What they did, by day — counted, not read.
    const activity = await rows<{ day: string; plans: number; done: number }>(sql`
      with days as (
        select generate_series(${today} - 29, ${today}, interval '1 day')::date as day
      )
      select
        to_char(d.day, 'YYYY-MM-DD') as day,
        (select count(*)::int from commitments c where c.user_id = ${id} and ${dayOf(sql`c.created_at`)} = d.day) as plans,
        (select count(*)::int from commitments c
           where c.user_id = ${id} and c.status = 'done' and ${dayOf(sql`c.completed_at`)} = d.day) as done
      from days d
      order by d.day`)

    const events = await rows<Record<string, unknown>>(sql`
      select a.id, a.at, a.action, a.outcome, a.ip, a.user_agent, a.detail, actor.email as actor_email
      from audit_events a
      left join users actor on actor.id = a.actor_id
      where a.user_id = ${id}
      order by a.at desc
      limit 60`)

    // Who looked at whose account goes in the trail — once per sitting, not
    // on every refresh after a change.
    const viewKey = `${scope(req).sub}:${id}`
    if (Date.now() - (viewed.get(viewKey) ?? 0) > VIEW_EVERY_MS) {
      viewed.set(viewKey, Date.now())
      audit(req, { action: 'admin.user_viewed', userId: id, actorId: scope(req).sub })
    }
    return {
      user: { ...user, isAdmin: isAdmin(user.email as string) },
      counts,
      connections,
      devices,
      activity,
      events,
    }
  })

  /** An admin's own account, or another admin's, is not theirs to switch off from here. */
  async function target(
    adminId: string,
    id: string,
  ): Promise<{ error: 'not_found' | 'protected_account'; status: number } | { row: { id: string; email: string } }> {
    const [row] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)
    if (!row) return { error: 'not_found' as const, status: 404 }
    if (row.id === adminId || isAdmin(row.email)) return { error: 'protected_account' as const, status: 409 }
    return { row }
  }

  app.post('/admin/users/:id/disable', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {})
    const adminId = scope(req).sub
    const found = await target(adminId, id)
    if ('error' in found) return reply.code(found.status).send({ error: found.error })
    await db
      .update(schema.users)
      .set({ disabledAt: new Date(), disabledReason: reason || null })
      .where(eq(schema.users.id, id))
    forgetAccountState(id)
    audit(req, { action: 'admin.user_disabled', userId: id, actorId: adminId, detail: reason ? { reason } : undefined })
    return { ok: true }
  })

  app.post('/admin/users/:id/enable', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const adminId = scope(req).sub
    const found = await target(adminId, id)
    if ('error' in found) return reply.code(found.status).send({ error: found.error })
    await db.update(schema.users).set({ disabledAt: null, disabledReason: null }).where(eq(schema.users.id, id))
    forgetAccountState(id)
    audit(req, { action: 'admin.user_enabled', userId: id, actorId: adminId })
    return { ok: true }
  })

  /** Sign out everywhere: every token out there stops working; signing in again works. */
  app.post('/admin/users/:id/sign-out', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const adminId = scope(req).sub
    const found = await target(adminId, id)
    if ('error' in found) return reply.code(found.status).send({ error: found.error })
    await db.update(schema.users).set({ sessionsFrom: new Date() }).where(eq(schema.users.id, id))
    forgetAccountState(id)
    audit(req, { action: 'admin.sessions_revoked', userId: id, actorId: adminId })
    return { ok: true }
  })

  // ── Activity ───────────────────────────────────────────────────────────
  app.get('/admin/audit', async (req) => {
    const q = z
      .object({
        action: z.string().trim().max(60).optional(),
        outcome: z.enum(['ok', 'failed', 'blocked']).optional(),
        userId: z.string().uuid().optional(),
        q: z.string().trim().max(200).optional(),
        before: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(10).max(200).default(100),
      })
      .parse(req.query)

    const where: SQL[] = [sql`true`]
    // "auth" is every auth.* action; "auth.login" just that one.
    if (q.action) where.push(q.action.includes('.') ? sql`a.action = ${q.action}` : sql`a.action like ${q.action + '.%'}`)
    if (q.outcome) where.push(sql`a.outcome = ${q.outcome}`)
    if (q.userId) where.push(sql`a.user_id = ${q.userId}`)
    if (q.q) {
      const like = '%' + q.q + '%'
      where.push(sql`(u.email ilike ${like} or a.email ilike ${like} or a.ip ilike ${like})`)
    }
    if (q.before) where.push(sql`a.id < ${q.before}`)

    const events = await rows<Record<string, unknown>>(sql`
      select a.id, a.at, a.action, a.outcome, a.ip, a.user_agent, a.detail, a.user_id,
             coalesce(u.email, a.email) as email, actor.email as actor_email
      from audit_events a
      left join users u on u.id = a.user_id
      left join users actor on actor.id = a.actor_id
      where ${sql.join(where, sql` and `)}
      order by a.id desc
      limit ${q.limit}`)

    const last = events.at(-1)
    return { events, next: events.length === q.limit && last ? Number(last.id) : null, keepDays: AUDIT_KEEP_DAYS }
  })

  // ── Security ───────────────────────────────────────────────────────────
  app.get('/admin/security', async () => {
    const [signIns] = await rows<Record<string, number>>(sql`
      select
        count(*) filter (where outcome = 'ok' and at > now() - interval '1 day')::int as ok_1d,
        count(*) filter (where outcome = 'failed' and at > now() - interval '1 day')::int as failed_1d,
        count(*) filter (where outcome = 'blocked' and at > now() - interval '1 day')::int as blocked_1d,
        count(*) filter (where outcome = 'ok')::int as ok_7d,
        count(*) filter (where outcome = 'failed')::int as failed_7d,
        count(*) filter (where outcome = 'blocked')::int as blocked_7d
      from audit_events
      where action = 'auth.login' and at > now() - interval '7 days'`)

    const byIp = await rows<Record<string, unknown>>(sql`
      select ip, count(*)::int as failures, count(distinct coalesce(user_id::text, email))::int as accounts, max(at) as last_at
      from audit_events
      where action = 'auth.login' and outcome <> 'ok' and at > now() - interval '1 day' and ip is not null
      group by ip
      order by failures desc
      limit 10`)

    const byAccount = await rows<Record<string, unknown>>(sql`
      select coalesce(u.email, a.email) as email, bool_or(a.user_id is not null) as has_account,
             count(*)::int as failures, count(distinct a.ip)::int as addresses, max(a.at) as last_at
      from audit_events a left join users u on u.id = a.user_id
      where a.action = 'auth.login' and a.outcome <> 'ok' and a.at > now() - interval '7 days'
      group by coalesce(u.email, a.email)
      order by failures desc
      limit 10`)

    const resets = await rows<Record<string, unknown>>(sql`
      select a.id, a.at, a.action, a.outcome, a.ip, coalesce(u.email, a.email) as email, a.detail
      from audit_events a left join users u on u.id = a.user_id
      where a.action in ('auth.reset_requested', 'auth.reset', 'auth.password_changed')
      order by a.at desc
      limit 15`)

    const adminActions = await rows<Record<string, unknown>>(sql`
      select a.id, a.at, a.action, actor.email as actor_email, u.email as email, a.detail
      from audit_events a
      left join users actor on actor.id = a.actor_id
      left join users u on u.id = a.user_id
      where a.action like 'admin.%' and a.action <> 'admin.user_viewed'
      order by a.at desc
      limit 15`)

    const disabled = await rows<Record<string, unknown>>(sql`
      select id, email, disabled_at, disabled_reason from users where disabled_at is not null order by disabled_at desc`)

    const adminAccounts = await rows<{ email: string; last_seen_at: string | null }>(sql`
      select lower(email) as email, last_seen_at from users
      where lower(email) in (${sql.join(env.adminEmails.length ? env.adminEmails.map((e) => sql`${e}`) : [sql`''`], sql`, `)})`)
    const admins = env.adminEmails.map((email) => {
      const found = adminAccounts.find((a) => a.email === email)
      return { email, hasAccount: Boolean(found), lastSeenAt: found?.last_seen_at ?? null }
    })

    const dbUrl = env.databaseUrl
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)
    const checks = [
      {
        key: 'jwt',
        label: 'Sign-in tokens use a long secret',
        ok: env.jwtSecret.length >= 32,
        note: 'JWT_SECRET should be at least 32 random characters. Changing it signs everyone out.',
      },
      {
        key: 'encryption',
        label: 'Connected-account tokens are encrypted',
        ok: env.encryptionKey.length > 0,
        note: 'Set ENCRYPTION_KEY; without it Google and Microsoft cannot be connected.',
      },
      {
        key: 'https',
        label: 'The app is served over HTTPS',
        ok: env.webOrigin.startsWith('https://'),
        note: 'WEB_ORIGIN should be the https:// address.',
      },
      {
        key: 'db_tls',
        label: 'The database connection is encrypted',
        ok: local || /sslmode=(require|verify-ca|verify-full)|ssl=true/.test(dbUrl),
        note: local ? 'Local database.' : 'Add ?sslmode=require to DATABASE_URL.',
      },
      {
        key: 'admins',
        label: 'Admins are named',
        ok: env.adminEmails.length > 0,
        note: 'ADMIN_EMAILS lists who can open this portal.',
      },
      {
        key: 'mail',
        label: 'Password-reset email can be sent',
        ok: mailConfigured(),
        note: 'Set the SMTP_* settings; without them nobody can reset a forgotten password.',
      },
      {
        key: 'push',
        label: 'Reminders can be pushed',
        ok: pushConfigured,
        note: 'VAPID keys: npm run vapid.',
      },
      {
        key: 'production',
        label: 'Running in production mode',
        ok: process.env.NODE_ENV === 'production',
        note: 'NODE_ENV=production in the service file.',
      },
    ]
    // Things this server cannot see for itself, kept in front of whoever runs it.
    const manual = [
      'Automatic database backups are on (RDS: backup retention of at least 7 days).',
      'Port 5432 is not open to the internet (the database security group allows only the app server).',
      'The database password has been changed since the 9 October incident.',
      'Your own laptop’s .env does not point at the production database.',
    ]

    return {
      signIns,
      byIp,
      byAccount,
      held: heldNow(),
      rules: RULES,
      resets,
      adminActions,
      disabled,
      admins,
      checks,
      manual,
    }
  })

  // ── System ─────────────────────────────────────────────────────────────
  app.get('/admin/system', async () => {
    const mem = process.memoryUsage()
    const server = {
      ...release(),
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      platform: `${os.type()} ${os.release()}`,
      cpus: os.cpus().length,
      load: os.loadavg().map((n) => Math.round(n * 100) / 100),
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
      systemMemory: { total: os.totalmem(), free: os.freemem() },
      timezone: env.appTimezone,
      aiReading: Boolean(env.captureAiKey),
      google: Boolean(env.googleClientId && env.googleClientSecret),
      microsoft: Boolean(env.microsoftClientId && env.microsoftClientSecret),
    }

    const [database] = await rows<Record<string, unknown>>(sql`
      select
        current_setting('server_version') as version,
        pg_database_size(current_database())::bigint as size_bytes,
        (select count(*)::int from pg_stat_activity where datname = current_database()) as connections,
        to_regclass('_migrations') is not null as tracked`)
    // The migration record, where there is one (a test schema has none).
    const [migrations] = database?.tracked
      ? await rows<{ count: number; latest: string | null; at: string | null }>(sql`
          select count(*)::int as count, max(name) as latest, max(applied_at) as at from _migrations`)
      : [null]

    const tables = await rows<Record<string, unknown>>(sql`
      select relname as name, n_live_tup::bigint as rows, pg_total_relation_size(relid)::bigint as bytes
      from pg_stat_user_tables
      order by pg_total_relation_size(relid) desc
      limit 14`)

    const [queues] = await rows<Record<string, number>>(sql`
      select
        (select count(*)::int from reminders where status = 'pending') as reminders_pending,
        (select count(*)::int from reminders where status = 'pending' and fire_at < now() - interval '5 minutes') as reminders_late,
        (select count(*)::int from reminders where status = 'sending' and fire_at < now() - interval '5 minutes') as reminders_stuck,
        (select count(*)::int from reminders where status = 'sent' and sent_at > now() - interval '1 day') as reminders_sent_1d,
        (select count(*)::int from calendar_feeds) as calendars,
        (select count(*)::int from calendar_feeds where last_error is not null) as calendars_failing,
        (select count(*)::int from oauth_accounts where mail_enabled) as mail_reading,
        (select count(*)::int from oauth_accounts where mail_enabled and mail_error is not null) as mail_failing,
        (select count(*)::int from push_subscriptions) as devices`)

    return {
      server,
      database: { ...database, migrations: migrations?.count ?? null, latestMigration: migrations?.latest ?? null, migratedAt: migrations?.at ?? null },
      tables,
      queues,
      jobs: jobStates(),
      push: { ...pushStats, configured: pushConfigured },
      errors: recentErrors(),
    }
  })
}
