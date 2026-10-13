import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.tsx'

/**
 * Installing Cue to the home screen.
 *
 * It was already a PWA — manifest, service worker, offline outbox — and there
 * was no way to install it except knowing to dig through a browser menu. On a
 * phone that is the difference between an app that can reach you and a tab that
 * gets closed: **iOS delivers no notifications at all until the site is on the
 * home screen**, so for half the users the whole reminder engine was gated
 * behind a menu item nobody finds.
 *
 * Two routes, because the browsers genuinely differ. Chrome and Edge fire
 * `beforeinstallprompt`, which gives a real one-tap install. Safari fires
 * nothing and has no API, so there the honest thing is to say which two taps to
 * make rather than to show a button that cannot work.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Already installed: running from the home screen, not a browser tab. */
function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS predates the standard and exposes its own flag.
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true
}

function isIos(): boolean {
  const ua = window.navigator.userAgent
  // iPadOS reports itself as a Mac, so the touch check is what catches it.
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
}

export function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [showIosHelp, setShowIosHelp] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Chrome shows its own mini-infobar otherwise, at a moment of its
      // choosing rather than ours.
      e.preventDefault()
      setPrompt(e as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Nothing to offer someone who already did it.
  if (installed) return null

  // Safari has no install API at all. Saying which two taps to make is more
  // use than a button that would do nothing.
  if (!prompt) {
    if (!isIos()) return null
    return (
      <div className="install-row">
        <div>
          <strong>{t('Add Cue to your home screen')}</strong>
          <p className="muted small">
            {showIosHelp
              ? t(
                  'Tap the Share button, then "Add to Home Screen". On iPhone this step is what lets reminders reach you at all — Safari delivers none to a tab.',
                )
              : t('Reminders cannot reach an iPhone until Cue is on the home screen.')}
          </p>
        </div>
        {!showIosHelp && (
          <button className="ghost small-btn" onClick={() => setShowIosHelp(true)}>
            {t('How?')}
          </button>
        )}
      </div>
    )
  }

  async function install() {
    const event = prompt
    if (!event) return
    await event.prompt()
    const { outcome } = await event.userChoice
    // The event is single-use whatever they chose. Chrome will fire a fresh one
    // later if it still thinks the app is installable.
    setPrompt(null)
    if (outcome === 'accepted') setInstalled(true)
  }

  return (
    <div className="install-row">
      <div>
        <strong>{t('Install Cue')}</strong>
        <p className="muted small">
          {t('Opens from your home screen and keeps working without signal.')}
        </p>
      </div>
      <button className="primary small-btn" onClick={() => void install()}>
        {t('Install')}
      </button>
    </div>
  )
}
