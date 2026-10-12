import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'

/**
 * Deleting the account: everything in it, and every connected account handed
 * back first. Asks for the password, because there is no undoing it.
 */
export function DeleteAccount() {
  const { me, deleteAccount } = useAuth()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await deleteAccount(password)
      window.location.assign('/')
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'wrong_password' ? 'That password is not right.' : 'It could not be deleted just now. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="stack tight delete-account">
      <p className="muted small">
        <Link to="/privacy">Privacy policy</Link> · <Link to="/terms">Terms of service</Link>
      </p>
      {!open ? (
        <button className="link small danger-text fit-btn" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      ) : (
        <div className="card delete-confirm">
          <strong>Delete your account and everything in it?</strong>
          <p className="muted small">
            Plans, people, bills, trips, expenses and connected accounts are all removed, and Google or
            Microsoft access is withdrawn. This cannot be undone.
          </p>
          {!me?.isDemo && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password, to confirm"
              autoComplete="current-password"
            />
          )}
          <div className="row">
            <button className="primary small-btn danger-bg" onClick={() => void confirm()} disabled={busy || (!me?.isDemo && !password)}>
              {busy ? 'Deleting…' : 'Delete everything'}
            </button>
            <button className="ghost small-btn" onClick={() => setOpen(false)} disabled={busy}>
              Keep my account
            </button>
          </div>
          {error && <p className="error small">{error}</p>}
        </div>
      )}
    </div>
  )
}
