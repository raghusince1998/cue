import { createTransport, type Transporter } from 'nodemailer'
import { env } from '../env.ts'

/**
 * Sending the one email this app sends.
 *
 * There was no mail channel at all before password resets needed one, and the
 * temptation with that is to log the link and call it done. That produces a
 * "check your email" screen for a message nobody sent, which is worse than
 * having no feature: the person waits, then tries again, then concludes their
 * account is broken.
 *
 * So this refuses loudly when it is not configured, and the route refuses with
 * it. SMTP rather than a specific provider's SDK because every provider speaks
 * it — SES, Mailgun, Postmark, a Gmail app password — and none of them need a
 * dependency of their own.
 */

export class MailError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'MailError'
  }
}

export function mailConfigured(): boolean {
  return Boolean(env.smtpHost && env.smtpFrom)
}

let cached: Transporter | null = null

function transport(): Transporter {
  if (cached) return cached
  if (!mailConfigured()) {
    throw new MailError('No mail server is configured on this server.', 'not_configured')
  }

  cached = createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    // Implicit TLS on 465; STARTTLS on 587 and 25, which nodemailer negotiates
    // when `secure` is false. Deriving it from the port is right far more often
    // than asking somebody to reason about it.
    secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPassword } : undefined,
  })
  return cached
}

interface Mail {
  to: string
  subject: string
  text: string
}

export async function sendMail(mail: Mail): Promise<void> {
  const t = transport()
  try {
    await t.sendMail({ from: env.smtpFrom, to: mail.to, subject: mail.subject, text: mail.text })
  } catch (err) {
    // The underlying error is usually about credentials or a blocked port and
    // belongs in the log, not on a stranger's screen.
    console.error('[mail] send failed:', (err as Error).message)
    throw new MailError('The mail server would not accept the message.', 'send_failed')
  }
}

/**
 * Plain text, deliberately.
 *
 * An HTML mail from a new domain with a single prominent button is the exact
 * shape of a phishing message, and spam filters agree. Plain text with the
 * link visible is both more likely to arrive and easier to check before
 * clicking.
 */
export function resetEmail(link: string, expiresMinutes: number): Mail {
  return {
    to: '',
    subject: 'Reset your Cue password',
    text: [
      'Someone asked to reset the password for this Cue account.',
      '',
      link,
      '',
      `The link works once and expires in ${expiresMinutes} minutes.`,
      '',
      'If this was not you, nothing has changed and you can ignore this —',
      'your current password still works.',
    ].join('\n'),
  }
}
