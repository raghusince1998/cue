/**
 * Which app this is: Cue, or Cue Exams. One website behind both — the
 * Cue Exams Android app opens it at /exams?app=exams — so the mode is just
 * which door someone came in by: its welcome page, its name in the header,
 * and new accounts that start with exams and the language they picked.
 *
 * Kept for the session, not for good: the two apps share the phone's
 * browser storage, and Cue opened tomorrow must not wake up as Cue Exams.
 */

export type AppMode = 'cue' | 'exams'

const MODE = 'cue.app'
const LANG = 'cue.signupLang'
export const EXAMS_PACKAGE = 'in.vitelio.cue.exams'

function session(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function appMode(): AppMode {
  const said = new URLSearchParams(window.location.search).get('app')
  if (said === 'exams' || said === 'cue') {
    session()?.setItem(MODE, said)
    return said
  }
  const kept = session()?.getItem(MODE)
  if (kept === 'exams' || kept === 'cue') return kept
  // The Android app's own launch, when the address did not say.
  return document.referrer.startsWith(`android-app://${EXAMS_PACKAGE}`) ? 'exams' : 'cue'
}

export function enterExamsMode(): void {
  session()?.setItem(MODE, 'exams')
}

/** The language picked on the Cue Exams welcome page, for the account about to be made. */
export function signupLanguage(): 'en' | 'hi' {
  try {
    return window.localStorage.getItem(LANG) === 'en' ? 'en' : 'hi'
  } catch {
    return 'hi'
  }
}

export function setSignupLanguage(lang: 'en' | 'hi'): void {
  try {
    window.localStorage.setItem(LANG, lang)
  } catch {
    // Private mode: Hindi, the default for Cue Exams, it is.
  }
}
