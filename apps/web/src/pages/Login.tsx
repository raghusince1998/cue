import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.tsx'
import { ApiError, api } from '../lib/api.ts'
import { appMode, signupLanguage } from '../lib/appMode.ts'
import { language, rich, t } from '../lib/i18n.tsx'

export default function Login({ initialMode = 'login' }: { initialMode?: 'login' | 'register' }) {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode)
  // /login and /register are two doors to the same form.
  useEffect(() => setMode(initialMode), [initialMode])
  const [sent, setSent] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Came in by Cue Exams: its name, its mark, and an account that starts with exams.
  const exams = appMode() === 'exams'
  const hindi = exams && signupLanguage() === 'hi'
  // Sent back here from the admin portal when its session ran out.
  const adminEnded = new URLSearchParams(window.location.search).get('admin') === 'ended'

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
      else await register({ name, email, password }, exams ? { uses: ['exams'], language: signupLanguage() } : undefined)
    } catch (err) {
      const messages: Record<string, string> = {
        invalid_credentials: t('That email and password do not match.'),
        too_many_attempts: t('Too many wrong passwords. Wait 15 minutes, or reset your password.'),
        account_disabled: t('This account has been turned off. Write to support to have it turned back on.'),
        email_taken: t('An account already exists for that email.'),
        invalid_input: t('Check the fields — password must be at least 8 characters.'),
        mail_not_configured: t(
          'This server cannot send email yet, so password resets are unavailable. Ask whoever runs it.',
        ),
      }
      // Only claim the server is unreachable when it genuinely did not answer.
      // An ApiError means it did — saying otherwise sends people to check logs
      // on a service that is running perfectly, which is exactly what happened.
      const code = err instanceof ApiError ? err.code : ''
      setError(
        messages[code] ??
          (err instanceof ApiError
            ? code
              ? t('Sign-in failed ({status}: {code}).', { status: err.status, code })
              : t('Sign-in failed ({status}).', { status: err.status })
            : t('Could not reach the server. Is the API running?')),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <div className="brand big">
          <img className="brand-mark" src={exams ? '/brand/cue-exams-mark.svg' : '/brand/cue-mark.svg'} alt="" />
          {exams ? 'Cue Exams' : 'Cue'}
        </div>
        <p className="muted" lang={hindi || language() === 'hi' ? 'hi' : 'en'}>
          {exams
            ? hindi
              ? mode === 'register'
                ? 'मुफ़्त। हर परीक्षा, फॉर्म से परिणाम तक — हर तारीख समय पर याद।'
                : 'फिर से स्वागत है। आपकी परीक्षाएँ और उनकी तारीखें यहीं हैं।'
              : mode === 'register'
                ? t('Free. Every exam, from the form to the result — every date on time.')
                : t('Welcome back. Your exams and their dates are waiting.')
            : mode === 'register'
              ? t('Free to use. Plans, reminders, bills and bookings — say it once, Cue remembers the rest.')
              : t('Welcome back. Your plans, reminders and everything Cue found for you are waiting.')}
        </p>
        {adminEnded && mode === 'login' && <p className="muted small">{t('Your admin session ended. Sign in again.')}</p>}

        {mode === 'register' && (
          <label>
            {t('Your name')}
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}

        <label>
          {t('Email')}
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
          {t('Password')}
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
            {t('If there is an account for that address, a link is on its way. It works once and expires in an hour.')}
          </p>
        )}

        <button className="primary" disabled={busy}>
          {busy
            ? t('Working…')
            : mode === 'login'
              ? t('Sign in')
              : mode === 'register'
                ? t('Create account')
                : t('Email me a link')}
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
            {t('Forgot your password?')}
          </button>
        )}

        <button
          type="button"
          className="link center"
          onClick={() => {
            const next = mode === 'login' ? 'register' : 'login'
            setMode(next)
            setError(null)
            setSent(false)
            navigate(next === 'register' ? '/register' : '/login', { replace: true })
          }}
        >
          {mode === 'login' ? t('New here? Create an account') : t('Already have an account? Sign in')}
        </button>
        {mode === 'register' && (
          <p className="muted small center-text">
            {rich('By creating an account you agree to the <terms>terms</terms> and the <privacy>privacy policy</privacy>.', {
              terms: (s) => <Link to="/terms">{s}</Link>,
              privacy: (s) => <Link to="/privacy">{s}</Link>,
            })}
          </p>
        )}
        <Link to="/" className="link center auth-home">
          {t('← About Cue')}
        </Link>
      </form>
    </div>
  )
}
