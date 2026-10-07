import { useEffect, useState } from 'react'
import { CalendarFeeds } from './CalendarFeeds.tsx'
import { api } from '../lib/api.ts'

interface AiSettings {
  provider: 'none' | 'anthropic' | 'ollama'
  /** Only the account owner may change any of this. */
  canEdit: boolean
  model: string | null
  endpoint: string | null
  hasKey: boolean
  keyHint: string | null
  encryptionAvailable: boolean
}

interface Preferences {
  timezone: string
  dailyNudgeEnabled: boolean
  dailyNudgeHour: number
  lastNudgeOn: string | null
}

function label(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}${suffix}`
}

type Tab = 'you' | 'account'

export function Settings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('you')
  const [name, setName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordNote, setPasswordNote] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [ai, setAi] = useState<AiSettings | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [endpointDraft, setEndpointDraft] = useState('')
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null)

  useEffect(() => {
    void api<Preferences>('/me/preferences').then(setPrefs)
    void api<{ name: string }>('/auth/me').then((u) => setName(u.name))
    void api<AiSettings>('/ai/settings').then((r) => {
      setAi(r)
      setEndpointDraft(r.endpoint ?? 'http://127.0.0.1:11434')
      if (r.provider === 'ollama' && r.endpoint) void loadOllamaModels(r.endpoint, r.model)
    })
  }, [])

  /** Ask the Ollama instance what it has, so nobody has to guess a model name. */
  async function loadOllamaModels(endpoint: string, currentModel?: string | null) {
    setMessage(null)
    try {
      const r = await api<{ models: string[] }>('/ai/ollama-models', {
        method: 'POST',
        body: { endpoint },
      })
      setOllamaModels(r.models)

      if (r.models.length === 0) {
        setMessage('Reached Ollama, but it has no models pulled yet. Try: ollama pull llama3')
        return
      }
      // One model and nothing chosen yet — there is no decision to make.
      if (!currentModel && r.models.length === 1) {
        await saveAi({ model: r.models[0]! })
        return
      }
      setMessage(`Found ${r.models.length}: ${r.models.join(', ')}`)
    } catch {
      setOllamaModels([])
      setMessage(
        `Could not reach Ollama at ${endpoint}. Is it running? The server dials this, not your browser.`,
      )
    }
  }

  async function testAi() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api<{ ok: boolean; model: string | null; sample: { title: string } | null }>(
        '/ai/test',
        { method: 'POST' },
      )
      setMessage(
        r.ok
          ? `Working. ${r.model ?? ''} read the test sentence as “${r.sample?.title}”.`
          : 'The provider replied but found nothing — try a larger model.',
      )
    } catch (err) {
      setMessage(`Test failed: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function saveAi(patch: Partial<AiSettings> & { apiKey?: string }) {
    setBusy(true)
    setMessage(null)
    try {
      const next = await api<AiSettings>('/ai/settings', {
        method: 'PATCH',
        body: { provider: ai?.provider ?? 'none', ...patch },
      })
      setAi(next)
      setKeyDraft('')
      if (next.endpoint) setEndpointDraft(next.endpoint)

      // Switching to a local model should just find what is there rather than
      // making anyone hunt for a model name.
      if (next.provider === 'ollama' && next.endpoint) {
        await loadOllamaModels(next.endpoint, next.model)
      }
    } catch (err) {
      const codes: Record<string, string> = {
        encryption_key_not_configured:
          'The server has no ENCRYPTION_KEY set, so a key cannot be stored safely.',
      }
      const code = (err as { code?: string }).code ?? ''
      setMessage(codes[code] ?? `Could not save: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function update(patch: Partial<Preferences>) {
    setBusy(true)
    setMessage(null)
    try {
      setPrefs(await api<Preferences>('/me/preferences', { method: 'PATCH', body: patch }))
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function testNudge() {
    setBusy(true)
    try {
      const res = await api<{ delivered: number; title: string; body: string }>(
        '/me/preferences/test-nudge',
        { method: 'POST' },
      )
      setMessage(
        res.delivered > 0
          ? `Sent: “${res.title}”`
          : 'No device registered — enable notifications on the Today screen first.',
      )
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!prefs) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  async function saveName() {
    setBusy(true)
    setNameSaved(false)
    try {
      await api('/auth/profile', { method: 'PATCH', body: { name: name.trim() } })
      setNameSaved(true)
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function changePassword() {
    setBusy(true)
    setPasswordNote(null)
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, password: newPassword },
      })
      setCurrentPassword('')
      setNewPassword('')
      setPasswordNote('Password changed.')
    } catch (err) {
      const code = (err as { code?: string }).code
      setPasswordNote(
        code === 'wrong_password'
          ? 'That is not your current password.'
          : code === 'invalid_input'
            ? 'The new password must be at least 8 characters.'
            : (err as Error).message,
      )
    } finally {
      setBusy(false)
    }
  }

  // Configuring a model and storing an API key spend the account's money and
  // apply to everyone on it — a different kind of act from choosing when your
  // own evening starts. They live behind their own tab, and only the owner
  // sees that tab at all.
  const isOwner = ai?.canEdit === true

  return (
    <div className="stack tight">
      {isOwner && (
        <div className="viewswitch">
          <button
            className={tab === 'you' ? 'selected' : ''}
            onClick={() => setTab('you')}
          >
            You
          </button>
          <button
            className={tab === 'account' ? 'selected' : ''}
            onClick={() => setTab('account')}
          >
            Account
          </button>
        </div>
      )}

      {tab === 'you' && (
      <>
      <span className="label-text">Your name</span>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        <button className="ghost small-btn" onClick={() => void saveName()} disabled={busy || !name.trim()}>
          Save
        </button>
      </div>
      {nameSaved && <p className="muted small">Saved.</p>}

      <hr className="rule" />

      <span className="label-text">Change password</span>
      <input
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        placeholder="Current password"
        autoComplete="current-password"
      />
      <input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="New password, at least 8 characters"
        autoComplete="new-password"
      />
      <button
        className="ghost small-btn"
        onClick={() => void changePassword()}
        disabled={busy || !currentPassword || newPassword.length < 8}
      >
        Change it
      </button>
      {passwordNote && <p className="muted small">{passwordNote}</p>}

      <hr className="rule" />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={prefs.dailyNudgeEnabled}
          disabled={busy}
          onChange={(e) => void update({ dailyNudgeEnabled: e.target.checked })}
        />
        <span>Ask me each evening if I logged everything</span>
      </label>

      <p className="muted small">
        Nothing can tell that you visited a clinic and never logged it — a browser cannot watch
        your location in the background. This is the app asking instead.
      </p>

      {prefs.dailyNudgeEnabled && (
        <>
          <span className="label-text">What time?</span>
          <div className="chips">
            {[17, 18, 19, 20, 21].map((hour) => (
              <button
                key={hour}
                className={`chip${prefs.dailyNudgeHour === hour ? ' selected' : ''}`}
                disabled={busy}
                onClick={() => void update({ dailyNudgeHour: hour })}
              >
                {label(hour)}
              </button>
            ))}
          </div>

          <p className="muted small">
            Your time, in {prefs.timezone}
            {deviceZone && deviceZone !== prefs.timezone && (
              <>
                {' '}
                — this device says {deviceZone}.{' '}
                <button className="link" onClick={() => void update({ timezone: deviceZone })}>
                  Use that instead
                </button>
              </>
            )}
            .
          </p>

          <button className="ghost small-btn" onClick={testNudge} disabled={busy}>
            Send one now to check
          </button>
        </>
      )}

      <hr className="rule" />
      <CalendarFeeds />
      </>
      )}

      {/* Owner-only, and reachable only through its own tab. */}
      {tab === 'account' && isOwner && ai && (
        <>
          <span className="label-text">Understanding long dictated sentences</span>
          <p className="muted small">
            Simple entries like &ldquo;dentist friday 6pm&rdquo; are always handled on this
            device — instantly, offline, free. This is only for sentences too tangled for
            that, and it stays off until you set it up.
          </p>

          {/* A model endpoint and an API key are the account's, not this
              person's — one credential, one bill, everyone's usage. Someone
              who cannot change them should not be shown the controls at all;
              a disabled form invites a fight they cannot win. */}
          <div className="chips">
            {(['none', 'anthropic', 'ollama'] as const).map((p) => (
              <button
                key={p}
                className={`chip${ai.provider === p ? ' selected' : ''}`}
                disabled={busy}
                onClick={() => void saveAi({ provider: p })}
              >
                {p === 'none' ? 'Off' : p === 'anthropic' ? 'Claude (your key)' : 'Local (Ollama)'}
              </button>
            ))}
          </div>

          {ai.provider === 'anthropic' && (
            <>
              {!ai.encryptionAvailable && (
                <p className="error small">
                  ENCRYPTION_KEY is not set on the server, so a key cannot be stored safely.
                </p>
              )}
              <label>
                Your Anthropic API key
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={ai.hasKey ? (ai.keyHint ?? 'saved') : 'sk-ant-...'}
                  autoComplete="off"
                />
              </label>
              <div className="row">
                <button
                  className="primary small-btn"
                  disabled={busy || !keyDraft.trim() || !ai.encryptionAvailable}
                  onClick={() => void saveAi({ apiKey: keyDraft.trim() })}
                >
                  Save key
                </button>
                {ai.hasKey && (
                  <button
                    className="link danger-link"
                    disabled={busy}
                    onClick={() => void saveAi({ apiKey: '' })}
                  >
                    Remove key
                  </button>
                )}
              </div>
              <p className="muted small">
                Billed to your own Anthropic account, roughly 15 paise per long sentence. The
                key is encrypted before it is stored and never sent back to the browser.
              </p>
            </>
          )}

          {ai.provider === 'ollama' && (
            <>
              <label>
                Ollama address
                <input
                  value={endpointDraft}
                  onChange={(e) => setEndpointDraft(e.target.value)}
                  placeholder="http://127.0.0.1:11434"
                />
              </label>
              <div className="row">
                <button
                  className="primary small-btn"
                  disabled={busy}
                  onClick={() => void saveAi({ endpoint: endpointDraft.trim() })}
                >
                  Save address
                </button>
                <button
                  className="ghost small-btn"
                  disabled={busy}
                  onClick={() => void loadOllamaModels(endpointDraft.trim(), ai.model)}
                >
                  Find models
                </button>
              </div>

              {ollamaModels && ollamaModels.length > 0 && (
                <>
                  <span className="label-text">Which model?</span>
                  <div className="chips">
                    {ollamaModels.map((m) => (
                      <button
                        key={m}
                        className={`chip${ai.model === m ? ' selected' : ''}`}
                        disabled={busy}
                        onClick={() => void saveAi({ model: m })}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {!ai.model && (
                <p className="error small">
                  No model chosen yet — press <strong>Find models</strong> and pick one, or
                  extraction will fail.
                </p>
              )}

              <p className="muted small">
                The address is dialled by the <em>server</em>, not your browser, so it has to be
                reachable from wherever the API runs. Nothing leaves that machine and there is
                no bill. A small local model manages simple sentences but is likely to fumble
                the really tangled ones.
              </p>
            </>
          )}

          {ai.provider !== 'none' && (
            <button className="ghost small-btn" onClick={testAi} disabled={busy}>
              Test it now
            </button>
          )}
        </>
      )}

      {message && <p className="muted small">{message}</p>}

      <div className="row">
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
