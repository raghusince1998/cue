import { useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api.ts'
import { errorText } from '../lib/errors.ts'
import { adminApi, setAdminSession, type AdminSession } from './api.ts'

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password do not match the admin sign-in.',
  too_many_attempts: 'Too many wrong tries. Wait 15 minutes and try again.',
  admin_not_configured:
    'The admin portal is not set up on this server yet. Add ADMIN_EMAIL and ADMIN_PASSWORD to the server’s .env, then restart Cue.',
  admin_password_too_short:
    'ADMIN_PASSWORD on the server is too short to be safe. Make it at least 12 characters, then restart Cue.',
}

/** The portal's own sign-in: the email and password from the server's .env, not a Cue account. */
export function AdminLogin({ onSignedIn, ended }: { onSignedIn: (s: AdminSession) => void; ended: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await adminApi<AdminSession>('/admin/login', { method: 'POST', body: { email, password } })
      setAdminSession(session)
      setPassword('')
      onSignedIn(session)
    } catch (err) {
      setError((err instanceof ApiError && MESSAGES[err.code]) || errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-login">
      <form className="admin-login-card" onSubmit={(e) => void submit(e)}>
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden>
            C
          </span>
          <span>
            Cue <strong>Admin</strong>
          </span>
        </div>
        <p className="muted small">Sign in with the admin email and password set on the server.</p>
        {ended && !error && <p className="muted small">Your admin session ended. Sign in again.</p>}
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error small">{error}</p>}
        <button className="primary" type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small admin-login-note">
          Forgot it? It is ADMIN_PASSWORD in the server’s .env — change it there and restart Cue. That also signs out every
          admin session.
        </p>
      </form>
    </div>
  )
}
