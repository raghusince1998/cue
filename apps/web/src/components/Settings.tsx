import { useEffect, useState } from 'react'
import { Connections } from './Connections.tsx'
import { Fold } from './Fold.tsx'
import { ProfilePhoto } from './ProfilePhoto.tsx'
import { InfoTip } from './InfoTip.tsx'
import { UsesPicker } from './UsesPicker.tsx'
import { DeleteAccount } from './DeleteAccount.tsx'
import { Modal } from './Modal.tsx'
import { TemplateManager } from './QuickMessage.tsx'
import { api } from '../lib/api.ts'
import { locale, msg, rich, t } from '../lib/i18n.tsx'
import { useAuth } from '../lib/auth.tsx'
import { USES, describeWorkHours, hasWork } from '@cue/shared'
import { errorText } from '../lib/errors.ts'
import { LoadFailed } from './LoadFailed.tsx'

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
  examWeekEnabled: boolean
  morningBriefEnabled: boolean
  morningBriefHour: number
  reportEnabled: boolean
  reportHour: number
  reportToName: string | null
  dailyNudgeEnabled: boolean
  dailyNudgeHour: number
  lastNudgeOn: string | null
  keepApart: boolean
  /** 0 is Sunday. */
  workDays: number[]
  workStartHour: number
  workEndHour: number
}

/** Monday first, the way a working week is read. */
const WEEK = [
  { day: 1, label: msg('Mon') },
  { day: 2, label: msg('Tue') },
  { day: 3, label: msg('Wed') },
  { day: 4, label: msg('Thu') },
  { day: 5, label: msg('Fri') },
  { day: 6, label: msg('Sat') },
  { day: 0, label: msg('Sun') },
]

function label(hour: number): string {
  // Hindi says the part of the day rather than am and pm: सुबह 7, शाम 6.
  const lang = locale()
  if (lang) return new Date(2000, 0, 1, hour).toLocaleTimeString(lang, { hour: 'numeric', dayPeriod: 'short' })
  const suffix = hour < 12 ? 'am' : 'pm'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}${suffix}`
}

type Tab = 'profile' | 'settings'

export function Settings({ onClose }: { onClose: () => void }) {
  // Email and calendars live on Profile, together: back from Google or
  // Microsoft's sign-in, that is where the result is, already open.
  const [tab, setTab] = useState<Tab>('profile')
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
  // Work hours only mean something to someone with a working life.
  const { me: account, saveLanguage } = useAuth()
  const working = hasWork(account?.uses ?? [])
  // The Sunday prep report is for whoever chose Competitive exams.
  const aspirant = Boolean(account?.uses.includes('exams'))

  const [prefsFailed, setPrefsFailed] = useState(false)
  const loadPrefs = () => {
    setPrefsFailed(false)
    api<Preferences>('/me/preferences')
      .then(setPrefs)
      .catch(() => setPrefsFailed(true))
  }
  useEffect(() => {
    loadPrefs()
    void loadMe()
  }, [])

  async function update(patch: Partial<Preferences>) {
    setBusy(true)
    setMessage(null)
    try {
      setPrefs(await api<Preferences>('/me/preferences', { method: 'PATCH', body: patch }))
    } catch (err) {
      setMessage(errorText(err))
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
          ? t('Nothing booked today and nothing outstanding, so there is nothing to brief — it stays quiet on days like this.')
          : res.delivered > 0
            ? t('Sent: “{title}”', { title: res.title ?? '' })
            : t('No device registered — enable notifications on the Today screen first.'),
      )
    } catch (err) {
      setMessage(errorText(err))
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
          ? t('Nothing happened this week and nothing is booked next, so there is nothing to review yet.')
          : res.delivered > 0
            ? t('Sent: “{title}”', { title: res.title ?? '' })
            : t('No device registered — enable notifications on the Today screen first.'),
      )
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function testExamWeek() {
    setBusy(true)
    try {
      const res = await api<{ delivered: number; title: string | null; empty?: boolean }>('/me/preferences/test-exam-week', { method: 'POST' })
      setMessage(
        res.empty
          ? t('No study sessions, mock tests or exam dates this week yet, so there is nothing to report.')
          : res.delivered > 0
            ? t('Sent: “{title}”', { title: res.title ?? '' })
            : t('No device registered — enable notifications on the Today screen first.'),
      )
    } catch (err) {
      setMessage(errorText(err))
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
          ? t('Nothing has happened today yet, so there is no report to send.')
          : res.delivered > 0
            ? t('Sent: “{title}”', { title: res.title ?? '' })
            : t('No device registered — enable notifications on the Today screen first.'),
      )
    } catch (err) {
      setMessage(errorText(err))
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
          ? t('Sent: “{title}”', { title: res.title })
          : t('No device registered — enable notifications on the Today screen first.'),
      )
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!prefs && prefsFailed) {
    return <LoadFailed what={t('Could not load your settings just now.')} onRetry={loadPrefs} />
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
      setMessage(errorText(err))
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
      setPasswordNote(t('Password changed.'))
    } catch (err) {
      const code = (err as { code?: string }).code
      setPasswordNote(
        code === 'wrong_password'
          ? t('That is not your current password.')
          : code === 'invalid_input'
            ? t('The new password must be at least 8 characters.')
            : errorText(err),
      )
    } finally {
      setBusy(false)
    }
  }


  return (
    <div className="stack tight">
      <div className="viewswitch">
        <button className={tab === 'profile' ? 'selected' : ''} onClick={() => setTab('profile')}>
          {t('Profile')}
        </button>
        <button className={tab === 'settings' ? 'selected' : ''} onClick={() => setTab('settings')}>
          {t('Settings')}
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
      <span className="label-text">{t('Your name')}</span>
      <div className="row inline-field-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Your name')} />
        <button className="ghost small-btn" onClick={() => void saveName()} disabled={busy || !name.trim()}>
          {t('Save')}
        </button>
      </div>
      {nameSaved && <p className="muted small">{t('Saved.')}</p>}

      <div className="folds">
      {/* Gmail or Outlook, and every calendar Cue reads, in one place. */}
      <Connections />

      <Fold
        title={t('What you use Cue for')}
        summary={
          (account?.uses ?? [])
            .map((k) => USES.find((u) => u.key === k))
            .filter((u) => u !== undefined)
            .map((u) => t(u.label))
            .join(', ') || t('Not chosen yet')
        }
      >
        <UsesPicker compact />
      </Fold>

      {/* Every screen, and what Cue sends: reminders, the morning brief, what quick add understood. */}
      <Fold title="Language · भाषा" summary={(account?.language ?? 'en') === 'hi' ? 'हिन्दी' : 'English'}>
      <div className="chips" role="group" aria-label={t('Language')}>
        {(
          [
            ['en', 'English'],
            ['hi', 'हिन्दी'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`chip${(account?.language ?? 'en') === key ? ' selected' : ''}`}
            aria-pressed={(account?.language ?? 'en') === key}
            onClick={() => void saveLanguage(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {t('Every screen, and the reminders and notices Cue sends you. What you type stays as you typed it.')}
      </p>
      </Fold>

      <Fold title={t('Change password')}>
      <input
        type="password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        placeholder={t('Current password')}
        autoComplete="current-password"
      />
      <input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder={t('New password, at least 8 characters')}
        autoComplete="new-password"
      />
      <button
        className="ghost small-btn"
        onClick={() => void changePassword()}
        disabled={busy || !currentPassword || newPassword.length < 8}
      >
        {t('Change it')}
      </button>
      {passwordNote && <p className="muted small">{passwordNote}</p>}
      </Fold>
      </div>
      </>
      )}

      {/* How the app behaves: when it nudges. Calendars are with email, on Profile. */}
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
          <span>{t('Send me a brief of the day each morning')}</span>
        </label>
        <InfoTip label={t('What is in it?')}>
          {t(
            'Your day in one place: work and personal, each with its first thing; a train or flight and when to leave for it; parcels arriving; bills due; who is due a check-in; your longest free stretch; and anything left over. Tapping it opens your day hour by hour. On a day with nothing in it, it stays quiet.',
          )}
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
            {t('Send today’s brief now')}
          </button>
        </>
      )}

      {/* Work and personal on one day: each waits for its own time. */}
      {working && (
        <>
          <hr className="rule" />
          <div className="setting-row has-infotip">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={prefs.keepApart}
                disabled={busy}
                onChange={(e) => void update({ keepApart: e.target.checked })}
              />
              <span>{t('Keep work and personal apart')}</span>
            </label>
            <InfoTip label={t('What does it do?')}>
              {t(
                'During your working hours, personal reminders that only nag (a second “still open”, or something with no set time) wait until the evening. After hours, work ones wait for the morning. Anything at a time you chose still rings on time, and critical things always do.',
              )}
            </InfoTip>
          </div>
          <p className="muted small">{t('Your working week: {hours}', { hours: describeWorkHours({ days: prefs.workDays, start: prefs.workStartHour, end: prefs.workEndHour }) })}</p>
          <div className="chips" role="group" aria-label={t('Working days')}>
            {WEEK.map(({ day, label: name }) => {
              const on = prefs.workDays.includes(day)
              return (
                <button
                  key={day}
                  className={`chip${on ? ' selected' : ''}`}
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() =>
                    void update({ workDays: on ? prefs.workDays.filter((d) => d !== day) : [...prefs.workDays, day] })
                  }
                >
                  {t(name)}
                </button>
              )
            })}
          </div>
          <div className="row work-hours">
            <label>
              {t('Starts')}{' '}
              <select
                value={prefs.workStartHour}
                disabled={busy}
                onChange={(e) => void update({ workStartHour: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, h) => h)
                  .filter((h) => h < prefs.workEndHour)
                  .map((h) => (
                    <option key={h} value={h}>
                      {label(h)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t('Ends')}{' '}
              <select
                value={prefs.workEndHour}
                disabled={busy}
                onChange={(e) => void update({ workEndHour: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, h) => h + 1)
                  .filter((h) => h > prefs.workStartHour)
                  .map((h) => (
                    <option key={h} value={h}>
                      {h === 24 ? t('midnight') : label(h)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </>
      )}

      <hr className="rule" />

      {/* Quick messages: written once, filled in for whoever they go to. */}
      <div className="setting-row has-infotip">
        <span>{t('Quick messages')}</span>
        <InfoTip label={t('What are quick messages?')}>
          {t(
            'The things you send over and over (thanks for meeting, missed your call, a gentle reminder) written once. On anyone’s page, tap Message and pick one: their name, where they work and yours are filled in, ready for WhatsApp, a text or email.',
          )}
        </InfoTip>
      </div>
      <button className="ghost small-btn" onClick={() => setEditingMessages(true)}>
        {t('Edit quick messages')}
      </button>
      {editingMessages && (
        <Modal title={t('Quick messages')} onClose={() => setEditingMessages(false)}>
          <TemplateManager onClose={() => setEditingMessages(false)} />
        </Modal>
      )}

      <hr className="rule" />

      {/* Evening: the day written up for whoever you report to — for work only. */}
      {(working || prefs.reportEnabled) && (
      <>
      <div className="setting-row has-infotip">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={prefs.reportEnabled}
            disabled={busy}
            onChange={(e) => void update({ reportEnabled: e.target.checked })}
          />
          <span>
            {prefs.reportToName
              ? t('Remind me to send my daily report to {name}', { name: prefs.reportToName })
              : t('Remind me to send my daily report')}
          </span>
        </label>
        <InfoTip label={t('What is the daily report?')}>
          {t(
            'Your meetings with who and what came of them, visits, what got done, next steps agreed, what you are waiting on, and tomorrow — written up from what is already in Cue, ready to send by WhatsApp or email. Open it any time from “Send today’s report” on Today. A day with nothing in it sends no reminder.',
          )}
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
            {t('Send today’s reminder now')}
          </button>
        </>
      )}

      <hr className="rule" />
      </>
      )}

      {/* Friday: the week behind and the one ahead. */}
      <div className="setting-row has-infotip">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={prefs.weeklyReviewEnabled}
            disabled={busy}
            onChange={(e) => void update({ weeklyReviewEnabled: e.target.checked })}
          />
          <span>{t('Every Friday, ask me to review the week')}</span>
        </label>
        <InfoTip label={t('What is the review?')}>
          {t(
            'What got done, what slipped, who still owes you something, and how next week is already filling up — two minutes, each part with the one thing to do about it. It stays quiet on a week with nothing in it.',
          )}
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
                {t('Fri {time}', { time: label(hour) })}
              </button>
            ))}
          </div>
          <button className="ghost small-btn" onClick={testReview} disabled={busy}>
            {t('Send this week’s now')}
          </button>
        </>
      )}

      <hr className="rule" />

      {/* Sunday evening: the week's preparation, for whoever has exams. */}
      {aspirant && (
        <>
          <div className="setting-row has-infotip">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={prefs.examWeekEnabled}
                disabled={busy}
                onChange={(e) => void update({ examWeekEnabled: e.target.checked })}
              />
              <span>{t('Every Sunday evening, my exam prep report')}</span>
            </label>
            <InfoTip label={t('What is the prep report?')}>
              {t(
                'The study sessions you did this week against those planned, your mock test scores against the week before, the exam dates coming next week, and how far off your next exam is. Nothing on a week with nothing in it.',
              )}
            </InfoTip>
          </div>
          {prefs.examWeekEnabled && (
            <button className="ghost small-btn" onClick={testExamWeek} disabled={busy}>
              {t('Send this week’s now')}
            </button>
          )}

          <hr className="rule" />
        </>
      )}

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
          <span>{t('Ask me each evening if I logged everything')}</span>
        </label>
        <InfoTip label={t('Why ask each evening?')}>
          {t(
            'Nothing can tell that you went somewhere and never logged it — a browser cannot watch your location in the background. This is the app asking instead.',
          )}
        </InfoTip>
      </div>

      {prefs.dailyNudgeEnabled && (
        <>
          <span className="label-text">{t('What time?')}</span>
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
            {deviceZone && deviceZone !== prefs.timezone
              ? rich('Your time, in {zone} — this device says {device}. <use>Use that instead</use>.', {
                  zone: prefs.timezone,
                  device: deviceZone,
                  use: (s) => (
                    <button className="link" onClick={() => void update({ timezone: deviceZone })}>
                      {s}
                    </button>
                  ),
                })
              : t('Your time, in {zone}.', { zone: prefs.timezone })}
          </p>

          <button className="ghost small-btn" onClick={testNudge} disabled={busy}>
            {t('Send one now to check')}
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
          <span>{t('When a meeting ends, ask me what to follow up on')}</span>
        </label>
        <InfoTip label={t('What does this do?')}>
          {t(
            'A notification as each one-off meeting ends — from Cue or a connected calendar — so you can note what was agreed while it is fresh. Each follow-up becomes a reminder of its own. Meetings also wait under “Just finished” on Today either way.',
          )}
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
          <span>{t('Before a meeting, remind me what is still open from last time')}</span>
        </label>
        <InfoTip label={t('How does it know?')}>
          {t(
            'Follow-ups remember the meeting they came from. About 15 minutes before a meeting with the same title, in the same series, or with the same person, you get a note of what is still open from the earlier ones — only when there is something.',
          )}
        </InfoTip>
      </div>

      </>
      )}

      {message && <p className="muted small">{message}</p>}

      <hr className="rule" />
      <DeleteAccount />
    </div>
  )
}
