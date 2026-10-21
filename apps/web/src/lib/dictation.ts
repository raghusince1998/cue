/**
 * Speech-to-text using the browser's own Web Speech API.
 *
 * No API key, no cost, no integration on our side. Worth knowing where the
 * audio goes though: Chrome and Edge stream it to Google's servers to do the
 * recognition, so this is not offline. Recording a voice note (lib/audio.ts) is
 * fully local — dictation is the convenience option, not the private one.
 *
 * Support: Chrome and Edge on Android and desktop, Safari 14.5+. Firefox has
 * none, which is why every caller checks `dictationSupported()` first.
 */

import { language, t } from './i18n.tsx'
import { addPhrase, spoken } from './transcript.ts'

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
  length: number
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function dictationSupported(): boolean {
  return getCtor() !== null
}

/**
 * Indian English, or Hindi when Cue is in Hindi. The phone's own setting is
 * often US English, which turns Indian names, places and Hinglish into
 * nonsense.
 */
export function speechLanguage(): string {
  return language() === 'hi' ? 'hi-IN' : 'en-IN'
}

const onPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

export interface DictationHandle {
  /** Stop listening; what was already heard is kept. */
  stop: () => void
  /** Stop at once; nothing more is written, not even what was mid-sentence. */
  abort: () => void
}

/**
 * `onText` receives the full text so far — committed phrases plus whatever is
 * still being said — so the caller can show it updating live.
 */
export function startDictation(options: {
  lang?: string
  onText: (text: string, isFinal: boolean) => void
  onError: (message: string) => void
  onEnd: () => void
}): DictationHandle {
  const Ctor = getCtor()
  if (!Ctor) throw new Error(t('This browser has no built-in dictation.'))

  const recognition = new Ctor()
  recognition.lang = options.lang ?? speechLanguage()
  recognition.maxAlternatives = 1
  recognition.interimResults = true
  // A phone repeats itself when asked to keep listening; there it hears one
  // sentence per tap, and stops when you do. A computer listens until Stop.
  const phone = onPhone()
  recognition.continuous = !phone

  let parts: string[] = []
  let done = false
  let stoppedByUser = false

  recognition.onresult = (event) => {
    if (done) return
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      if (!result) continue
      const text = result[0].transcript
      if (result.isFinal) parts = addPhrase(parts, text)
      else interim += text
    }
    const text = spoken(parts, interim)
    // An update with no words in it (Android sends some) must not empty the box.
    if (!text) return
    options.onText(text, interim === '')
  }

  recognition.onerror = (event) => {
    // Stopped on purpose: nothing went wrong.
    if (event.error === 'aborted') return
    // Never started again after an error: a quiet restart kept writing into
    // the box while the button said it had stopped.
    done = true
    // Silence after something was said is just the end of the sentence.
    if (event.error === 'no-speech' && parts.length > 0) return
    const messages: Record<string, string> = {
      'not-allowed': t('Microphone permission was denied.'),
      'no-speech': t('Did not catch anything — try again.'),
      network: t('Dictation needs a network connection.'),
      'service-not-allowed': t('This browser blocked the speech service.'),
      'audio-capture': t('No microphone was found.'),
    }
    options.onError(messages[event.error] ?? t('Dictation failed ({error}).', { error: event.error }))
  }

  recognition.onend = () => {
    // A computer's browser ends the session on its own after a pause; carry on
    // unless Stop was pressed, or long notes get cut off mid-sentence. A phone
    // has heard its sentence.
    if (done || stoppedByUser || phone) {
      done = true
      options.onEnd()
      return
    }
    try {
      recognition.start()
    } catch {
      done = true
      options.onEnd()
    }
  }

  recognition.start()

  return {
    stop: () => {
      stoppedByUser = true
      recognition.stop()
    },
    abort: () => {
      done = true
      stoppedByUser = true
      recognition.abort()
    },
  }
}
