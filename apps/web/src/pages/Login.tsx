import { useState } from 'react'
import { useAuth } from '../lib/auth.tsx'
import { ApiError } from '../lib/api.ts'

export default function Login() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [orgName, setOrgName] = useState('')
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
      if (mode === 'login') await login(email, password)
      else await register({ orgName, name, email, password })
    } catch (err) {
      const messages: Record<string, string> = {
        invalid_credentials: 'That email and password do not match.',
        email_taken: 'An account already exists for that email.',
        invalid_input: 'Check the fields — password must be at least 8 characters.',
      }
      const code = err instanceof ApiError ? err.code : ''
      setError(messages[code] ?? 'Could not reach the server. Is the API running?')
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
          <>
            <label>
              Company / team
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Vitelio"
                required
              />
            </label>
            <label>
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
          </>
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

        {error && <p className="error">{error}</p>}

        <button className="primary" disabled={busy}>
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          className="link center"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
          }}
        >
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
