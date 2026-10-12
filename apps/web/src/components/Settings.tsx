import { useEffect, useState } from 'react'
import { CalendarFeeds } from './CalendarFeeds.tsx'
import { ProfilePhoto } from './ProfilePhoto.tsx'
import { InfoTip } from './InfoTip.tsx'
import { UsesPicker } from './UsesPicker.tsx'
import { MailReading } from './MailReading.tsx'
import { Modal } from './Modal.tsx'
import { TemplateManager } from './QuickMessage.tsx'
import { api } from '../lib/api.ts'

interface Me {
  id: string
  name: string
  email: string
  avatarUpdatedAt: string | null
}

interface Preferences {
  timezone: string
  followupPrompts: boolean
  prepPrompts: boolean
  weeklyReviewEnabled: boolean
  weeklyReviewHour: number
  morningBriefEnabled: boolean
  morningBriefHour: number
  reportEnabled: boolean
  reportHour: number
  reportToName: string | null
  dailyNudgeEnabled: boolean
  dailyNudgeHour: number
  lastNudgeOn: string | null
}

function label(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}${suffix}`
}

type Tab = 'profile' | 'settings'

export function Settings({ onClose }: { onClose: () => void }) {
  // Back from Google or Microsoft's sign-in, the result and the calendars to
  // choose are on the Settings tab. Opening on Profile showed a name and a
  // password box instead, and a connection that had worked looked like one
  // that had not.
  const [tab, setTab] = useState<Tab>(() =>
    new URLSearchParams(window.location.search).has('connected') ? 'settings' : 'profile',
  )
  const [me, setMe] = useState<Me | null>(null)
  const [name, setName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordNote, setPasswordNote] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingMessages, setEditingMessages] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void api<Preferences>('/me/preferences').then(setPrefs)
    void loadMe()
  }, [])

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

  async function testBrief() {
    setBusy(true)
    try {
      const res = await api<{ delivered: number; title: string | null; empty?: boolean }>(
        '/me/preferences/test-brief',
        { method: 'POST' },
      )
      setMessage(
        res.empty
          ? 'Nothing booked today and nothing outstanding, so there is nothing to brief — it stays quiet on days like this.'
          : res.delivered > 0
            ? `Sent: “${res.title}”`
            : 'No device registered — enable notifications on the Today screen first.',
      )
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function testReview() {
    setBusy(true)
    try {
      const res = await api<{ delivered: number; title: string | null; empty?: boolean }>(
        '/review/week/test',
        { method: 'POST' },
      )
      setMessage(
        res.empty
          ? 'Nothing happened this week and nothing is booked next, so there is nothing to review yet.'
          : res.delivered > 0
            ? `Sent: “${res.title}”`
            : 'No device registered — enable notifications on the Today screen first.',
      )
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function testReport() {
    setBusy(true)
    try {
      const res = await api<{ delivered: number; title: string | null; empty?: boolean }>(
        '/me/preferences/test-report',
        { method: 'POST' },
      )
      setMessage(
        res.empty
          ? 'Nothing has happened today yet, so there is no report to send.'
          : res.delivered > 0
            ? `Sent: “${res.title}”`
            : 'No device registered — enable notifications on the Today screen first.',
      )
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

  async function loadMe() {
    const u = await api<Me>('/auth/me')
    setMe(u)
    setName(u.name)
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


  return (
    <div className="stack tight">
      <div className="viewswitch">
        <button className={tab === 'profile' ? 'selected' : ''} onClick={() => setTab('profile')}>
          Profile
        </button>
        <button className={tab === 'settings' ? 'selected' : ''} onClick={() => setTab('settings')}>
          Settings
        </button>
      </div>

      {/* Who you are: the photo, the name, the password. Nothing here changes
          how the app behaves, which is exactly why it is not in Settings. */}
      {tab === 'profile' && (
      <>
      {me && (
        <ProfilePhoto
          userId={me.id}
          name={me.name}
          avatarKey={me.avatarUpdatedAt}
          onChanged={() => void loadMe()}
        />
      )}

      <p className="account-email">{me?.email}</p>

      <hr className="rule" />
      <span className="label-text">Your name</span>
      <div className="row inline-field-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        <button className="ghost small-btn" onClick={() => void saveName()} disabled={busy || !name.trim()}>
          Save
        </button>
      </div>
      {nameSaved && <p className="muted small">Saved.</p>}

      <hr className="rule" />
      <span className="label-text">What you use Cue for</span>
      <UsesPicker compact />

      <hr className="rule" />
      <span className="label-text">Bookings, parcels &amp; bills from your email</span>
      <MailReading />

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
      </>
      )}

      {/* How the app behaves: when it nudges, and which calendars it reads. */}
      {tab === 'settings' && (
      <>
      {/* The morning: what is coming, before it arrives. */}
      <div className="setting-row has-infotip">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={prefs.morningBriefEnabled}
            disabled={busy}
            onChange={(e) => void update({ morningBriefEnabled: e.target.checked })}
          />
          <span>Send me a brief of the day each morning</span>
        </label>
        <InfoTip label="What is in it?">
          How many meetings and things to do, the first one, your longest free stretch for
          focused work, who is due a check-in, and anything left over. Tapping it opens your
          day hour by hour. On a day with nothing in it, it stays quiet.
        </InfoTip>
      </div>
      {prefs.morningBriefEnabled && (
        <>
          <div className="chips">
            {[7, 8, 9, 10].map((hour) => (
              <button
                key={hour}
                className={`chip${prefs.morningBriefHour === hour ? ' selected' : ''}`}
                disabled={busy}
                onClick={() => void update({ morningBriefHour: hour })}
              >
                {label(hour)}
              </button>
            ))}
          </div>
          <button className="ghost small-btn" onClick={testBrief} disabled={busy}>
            Send today&rsquo;s brief now
          </button>
        </>
      )}

      <hr className="rule" />

      {/* Quick messages: written once, filled in for whoever they go to. */}
      <div className="setting-row has-infotip">
        <span>Quick messages</span>
        <InfoTip label="What are quick messages?">
          The things you send over and over (thanks for meeting, missed your call, a gentle
          reminder) written once. On anyone&rsquo;s page, tap Message and pick one: their name,
          where they work and yours are filled in, ready for WhatsApp, a text or email.
        </InfoTip>
      </div>
      <button className="ghost small-btn" onClick={() => setEditingMessages(true)}>
        Edit quick messages
      </button>
      {editingMessages && (
        <Modal title="Quick messages" onClose={() => setEditingMessages(false)}>
          <TemplateManager onClose={() => setEditingMessages(false)} />
        </Modal>
      )}

      <hr className="rule" />

      {/* Evening: the day written up for whoever you report to. */}
      <div className="setting-row has-infotip">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={prefs.reportEnabled}
            disabled={busy}
            onChange={(e) => void update({ reportEnabled: e.target.checked })}
          />
          <span>
            Remind me to send my daily report
            {prefs.reportToName ? ` to ${prefs.reportToName}` : ''}
          </span>
        </label>
        <InfoTip label="What is the daily report?">
          Your meetings with who and what came of them, visits, what got done, next steps agreed,
          what you are waiting on, and tomorrow — written up from what is already in Cue, ready
          to send by WhatsApp or email. Open it any time from &ldquo;Send today&rsquo;s report&rdquo;
          on Today. A day with nothing in it sends no reminder.
        </InfoTip>
      </div>
      {prefs.reportEnabled && (
        <>
          <div className="chips">
            {[17, 18, 19, 20].map((hour) => (
              <button
                key={hour}
                className={`chip${prefs.reportHour === hour ? ' selected' : ''}`}
                disabled={busy}
                onClick={() => void update({ reportHour: hour })}
              >
                {label(hour)}
              </button>
            ))}
          </div>
          <button className="ghost small-btn" onClick={testReport} disabled={busy}>
            Send today&rsquo;s reminder now
          </button>
        </>
      )}

      <hr className="rule" />

      {/* Friday: the week behind and the one ahead. */}
      <div className="setting-row has-infotip">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={prefs.weeklyReviewEnabled}
            disabled={busy}
            onChange={(e) => void update({ weeklyReviewEnabled: e.target.checked })}
          />
          <span>Every Friday, ask me to review the week</span>
        </label>
        <InfoTip label="What is the review?">
          What got done, what slipped, who still owes you something, and how next week is
          already filling up — two minutes, each part with the one thing to do about it. It
          stays quiet on a week with nothing in it.
        </InfoTip>
      </div>
      {prefs.weeklyReviewEnabled && (
        <>
          <div className="chips">
            {[16, 17, 18].map((hour) => (
              <button
                key={hour}
                className={`chip${prefs.weeklyReviewHour === hour ? ' selected' : ''}`}
                disabled={busy}
                onClick={() => void update({ weeklyReviewHour: hour })}
              >
                Fri {label(hour)}
              </button>
            ))}
          </div>
          <button className="ghost small-btn" onClick={testReview} disabled={busy}>
            Send this week&rsquo;s now
          </button>
        </>
      )}

      <hr className="rule" />

      {/* The why sits behind the icon: worth reading once, not every time
          Settings opens. Outside the label, so tapping it never ticks the box. */}
      <div className="setting-row has-infotip">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={prefs.dailyNudgeEnabled}
            disabled={busy}
            onChange={(e) => void update({ dailyNudgeEnabled: e.target.checked })}
          />
          <span>Ask me each evening if I logged everything</span>
        </label>
        <InfoTip label="Why ask each evening?">
          Nothing can tell that you went somewhere and never logged it — a browser cannot watch
          your location in the background. This is the app asking instead.
        </InfoTip>
      </div>

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
      <div className="setting-row has-infotip">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={prefs.followupPrompts}
            disabled={busy}
            onChange={(e) => void update({ followupPrompts: e.target.checked })}
          />
          <span>When a meeting ends, ask me what to follow up on</span>
        </label>
        <InfoTip label="What does this do?">
          A notification as each one-off meeting ends — from Cue or a connected calendar — so
          you can note what was agreed while it is fresh. Each follow-up becomes a reminder of
          its own. Meetings also wait under &ldquo;Just finished&rdquo; on Today either way.
        </InfoTip>
      </div>

      <div className="setting-row has-infotip">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={prefs.prepPrompts}
            disabled={busy}
            onChange={(e) => void update({ prepPrompts: e.target.checked })}
          />
          <span>Before a meeting, remind me what is still open from last time</span>
        </label>
        <InfoTip label="How does it know?">
          Follow-ups remember the meeting they came from. About 15 minutes before a meeting
          with the same title, in the same series, or with the same person, you get a note of
          what is still open from the earlier ones — only when there is something.
        </InfoTip>
      </div>

      <hr className="rule" />
      <CalendarFeeds />
      </>
      )}

      {message && <p className="muted small">{message}</p>}

    </div>
  )
}
