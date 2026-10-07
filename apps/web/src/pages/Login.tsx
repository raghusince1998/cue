import { useState } from 'react'
import { useAuth } from '../lib/auth.tsx'
import { ApiError, api } from '../lib/api.ts'

export default function Login() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [sent, setSent] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'forgot') {
        await api('/auth/forgot', { method: 'POST', body: { email } })
        // Always the same answer, sent or not. The server deliberately will
        // not say whether that address has an account, and neither will this.
        setSent(true)
        return
      }
      if (mode === 'login') await login(email, password)
      else await register({ name, email, password })
    } catch (err) {
      const messages: Record<string, string> = {
        invalid_credentials: 'That email and password do not match.',
        email_taken: 'An account already exists for that email.',
        invalid_input: 'Check the fields — password must be at least 8 characters.',
        mail_not_configured:
          'This server cannot send email yet, so password resets are unavailable. Ask whoever runs it.',
      }
      // Only claim the server is unreachable when it genuinely did not answer.
      // An ApiError means it did — saying otherwise sends people to check logs
      // on a service that is running perfectly, which is exactly what happened.
      const code = err instanceof ApiError ? err.code : ''
      setError(
        messages[code] ??
          (err instanceof ApiError
            ? `Sign-in failed (${err.status}${code ? `: ${code}` : ''}).`
            : 'Could not reach the server. Is the API running?'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand big">
          <span className="brand-dot" />
          Cue
        </div>
        <p className="muted">
          Your visits, your callbacks, and every follow-up you promised — chased until they are
          actually done.
        </p>

        {mode === 'register' && (
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        {mode !== 'forgot' && (
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            required
          />
        </label>
        )}

        {error && <p className="error">{error}</p>}

        {/* Deliberately the same words whether or not that address has an
            account. Saying "no such user" turns this into a way of finding out
            who does, which is a gift to anyone working through a leaked list. */}
        {sent && (
          <p className="muted small">
            If there is an account for that address, a link is on its way. It works once and
            expires in an hour.
          </p>
        )}

        <button className="primary" disabled={busy}>
          {busy
            ? 'Working…'
            : mode === 'login'
              ? 'Sign in'
              : mode === 'register'
                ? 'Create account'
                : 'Email me a link'}
        </button>

        {mode === 'login' && (
          <button
            type="button"
            className="link center"
            onClick={() => {
              setMode('forgot')
              setError(null)
              setSent(false)
            }}
          >
            Forgot your password?
          </button>
        )}

        <button
          type="button"
          className="link center"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
            setSent(false)
          }}
        >
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
