import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api.ts'

/**
 * Spending a reset link.
 *
 * The token arrives in the URL and is never shown or stored — it goes straight
 * back to the server and the page forgets it. Each way a link can fail gets its
 * own wording, because "expired" and "already used" are things somebody can act
 * on while "invalid" sends them hunting for a typo that is not there.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    // Checked here rather than server-side: a mistyped confirmation is not the
    // server's business, and a round trip to say so is a round trip wasted.
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    try {
      await api('/auth/reset', { method: 'POST', body: { token, password } })
      setDone(true)
    } catch (err) {
      const messages: Record<string, string> = {
        token_used: 'That link has already been used. Ask for a new one.',
        token_expired: 'That link has expired. Ask for a new one.',
        invalid_token: 'That link is not valid. Ask for a new one.',
        invalid_input: 'The password must be at least 8 characters.',
      }
      const code = err instanceof ApiError ? err.code : ''
      setError(
        messages[code] ??
          (err instanceof ApiError
            ? `Could not reset the password (${err.status}).`
            : 'Could not reach the server.'),
      )
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <div className="auth">
        <div className="card auth-card">
          <div className="brand big">
            <img className="brand-mark" src="/brand/cue-mark.svg" alt="" />
            Cue
          </div>
          <p className="error">That link is missing its token. Ask for a new one.</p>
          <button className="ghost" onClick={() => navigate('/')}>
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="auth">
        <div className="card auth-card">
          <div className="brand big">
            <img className="brand-mark" src="/brand/cue-mark.svg" alt="" />
            Cue
          </div>
          <p>Your password is changed. Sign in with the new one.</p>
          <button className="primary" onClick={() => navigate('/')}>
            Sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand big">
          <img className="brand-mark" src="/brand/cue-mark.svg" alt="" />
          Cue
        </div>
        <p className="muted">Choose a new password.</p>

        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
          />
        </label>

        <label>
          Again, to be sure
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>

        {error && <p className="error small">{error}</p>}

        <button className="primary" type="submit" disabled={busy || password.length < 8}>
          {busy ? 'Changing…' : 'Change my password'}
        </button>

        <button type="button" className="link" onClick={() => navigate('/')}>
          Back to sign in
        </button>
      </form>
    </div>
  )
}
