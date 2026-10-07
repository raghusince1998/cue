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

export interface DictationHandle {
  stop: () => void
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
  if (!Ctor) throw new Error('This browser has no built-in dictation.')

  const recognition = new Ctor()
  recognition.lang = options.lang ?? navigator.language ?? 'en-IN'
  recognition.continuous = true
  recognition.interimResults = true

  let committed = ''
  let stoppedByUser = false

  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      if (!result) continue
      const text = result[0].transcript
      if (result.isFinal) committed += text
      else interim += text
    }
    options.onText((committed + interim).trim(), interim === '')
  }

  recognition.onerror = (event) => {
    const messages: Record<string, string> = {
      'not-allowed': 'Microphone permission was denied.',
      'no-speech': 'Did not catch anything — try again.',
      network: 'Dictation needs a network connection.',
      'service-not-allowed': 'This browser blocked the speech service.',
    }
    options.onError(messages[event.error] ?? `Dictation failed (${event.error}).`)
  }

  recognition.onend = () => {
    // Chrome ends the session on its own after a pause; restart unless the user
    // actually pressed stop, otherwise long notes get cut off mid-sentence.
    if (stoppedByUser) {
      options.onEnd()
      return
    }
    try {
      recognition.start()
    } catch {
      options.onEnd()
    }
  }

  recognition.start()

  return {
    stop: () => {
      stoppedByUser = true
      recognition.stop()
    },
  }
}
