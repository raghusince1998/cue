import { useEffect, useRef, useState } from 'react'
import { dictationSupported, startDictation, type DictationHandle } from '../lib/dictation.ts'

/**
 * Speaks into a text field using the browser's own recogniser. Renders nothing
 * where that does not exist, so Firefox users simply see the plain textarea.
 */
export function DictateButton({
  value,
  onChange,
  autoStart = false,
  label = 'Dictate',
}: {
  value: string
  onChange: (next: string) => void
  /** Start listening at once — opened from "Speak a reminder". */
  autoStart?: boolean
  label?: string
}) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handle = useRef<DictationHandle | null>(null)
  // Whatever was already typed, so dictation appends rather than overwrites.
  const base = useRef('')

  useEffect(() => () => handle.current?.stop(), [])

  // Once, when opened that way. Some browsers refuse to listen before a tap;
  // then the button is there to tap.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!autoStart || autoStarted.current || !dictationSupported()) return
    autoStarted.current = true
    toggle()
  }, [autoStart])

  if (!dictationSupported()) return null

  function toggle() {
    if (listening) {
      handle.current?.stop()
      handle.current = null
      setListening(false)
      return
    }

    setError(null)
    base.current = value ? `${value.trimEnd()} ` : ''
    try {
      handle.current = startDictation({
        onText: (text) => onChange(base.current + text),
        onError: (message) => {
          setError(message)
          setListening(false)
        },
        onEnd: () => setListening(false),
      })
      setListening(true)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <button
        type="button"
        className={listening ? 'primary small-btn' : 'ghost small-btn'}
        onClick={toggle}
      >
        {listening ? 'Stop' : label}
      </button>
      {error && <p className="error small">{error}</p>}
    </>
  )
}
