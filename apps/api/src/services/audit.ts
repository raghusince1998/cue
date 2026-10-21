import type { FastifyRequest } from 'fastify'
import { lt } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'

/**
 * The account trail behind the admin portal's Activity and Security pages:
 * sign-ins (and failed ones), password changes and resets, connected
 * accounts, devices, deletions, and every action an admin takes.
 *
 * What happened, to whom, from where and how it went — never what anyone
 * wrote. Kept 90 days (the privacy policy says so), then purged.
 */

export const AUDIT_KEEP_DAYS = 90

export type AuditAction =
  | 'auth.register'
  | 'auth.demo'
  | 'auth.login'
  | 'auth.password_changed'
  | 'auth.reset_requested'
  | 'auth.reset'
  | 'auth.account_deleted'
  | 'oauth.connected'
  | 'oauth.disconnected'
  | 'mail.off'
  | 'device.added'
  | 'device.removed'
  | 'admin.login'
  | 'admin.logout'
  | 'admin.user_viewed'
  | 'admin.user_disabled'
  | 'admin.user_enabled'
  | 'admin.sessions_revoked'

export type AuditOutcome = 'ok' | 'failed' | 'blocked'

export interface AuditEntry {
  action: AuditAction
  userId?: string | null
  /** An admin acting on someone else's account. */
  actorId?: string | null
  /** The admin portal's sign-in email, for what an admin did. */
  actor?: string | null
  /** The address typed, for a sign-in against no account. */
  email?: string | null
  outcome?: AuditOutcome
  /** Codes and labels only: a reason, a provider — never content. */
  detail?: Record<string, string | number | boolean | null>
}

/**
 * The visitor's address. Behind Caddy the visitor is the last address it
 * appended; earlier ones can be anything the visitor sent.
 */
export function clientIp(req: FastifyRequest): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return forwarded.at(-1) ?? req.ip
}

/**
 * Record it, without ever holding up or failing the request it came from: a
 * sign-in must not break because the trail could not be written.
 */
export function audit(req: FastifyRequest | null, entry: AuditEntry): void {
  const ua = req ? String(req.headers['user-agent'] ?? '').slice(0, 300) : ''
  void db
    .insert(schema.auditEvents)
    .values({
      action: entry.action,
      userId: entry.userId ?? null,
      actorId: entry.actorId ?? null,
      actor: entry.actor ?? null,
      email: entry.email?.toLowerCase().slice(0, 254) ?? null,
      outcome: entry.outcome ?? 'ok',
      ip: req ? clientIp(req).slice(0, 64) : null,
      userAgent: ua || null,
      detail: entry.detail ?? null,
    })
    .catch((err) => console.error('[audit] could not record', entry.action, (err as Error).message))
}

/** The trail past its keeping time, gone. */
export async function purgeOldAudit(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUDIT_KEEP_DAYS * 86_400_000)
  const gone = await db
    .delete(schema.auditEvents)
    .where(lt(schema.auditEvents.at, cutoff))
    .returning({ id: schema.auditEvents.id })
  return gone.length
}
