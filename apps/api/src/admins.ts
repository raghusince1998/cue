import { env } from './env.ts'

/**
 * The platform's admins: the account emails in ADMIN_EMAILS, comma-separated.
 * They open the admin portal and review official exam notices. Empty, nobody
 * can. Checked against the account's email in the database, never a claim
 * the caller sends.
 */
export function isAdmin(email: string | null | undefined): boolean {
  return Boolean(email && env.adminEmails.includes(email.toLowerCase()))
}
