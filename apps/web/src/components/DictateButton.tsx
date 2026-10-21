import { useEffect, useRef, useState } from 'react'
import { dictationSupported, startDictation, type DictationHandle } from '../lib/dictation.ts'
import { t } from '../lib/i18n.tsx'
import { errorText } from '../lib/errors.ts'

/**
 * Speaks into a text field using the browser's own recogniser. Renders nothing
 * where that does not exist, so Firefox users simply see the plain textarea.
 *
 * Typing into the field, or clearing it, while it listens stops it — nothing
 * heard afterwards writes over what you did.
 */
export function DictateButton({
  value,
  onChange,
  autoStart = false,
  label,
  redo = false,
}: {
  value: string
  onChange: (next: string) => void
  /** Start listening at once — opened from "Speak a reminder". */
  autoStart?: boolean
  /** The button's word; Dictate when not given. */
  label?: string
  /**
   * Speaking again says it again: what the last go wrote is replaced, not
   * added to. For a one-line box; notes keep adding.
   */
  redo?: boolean
}) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handle = useRef<DictationHandle | null>(null)
  // Whatever was there before speaking, so dictation adds rather than overwrites.
  const base = useRef('')
  // The field as speaking began, and everything written since: anything else
  // in the field was typed (or cleared) by the person.
  const startedWith = useRef('')
  const wrote = useRef(new Set<string>())
  // What the last go left in the field, so speaking again can replace it.
  const lastHeard = useRef<string | null>(null)

  useEffect(() => () => handle.current?.abort(), [])

  // Typed into or cleared while listening: stop at once.
  useEffect(() => {
    if (!listening) return
    const ours = value === startedWith.current || wrote.current.has(value)
    const cleared = value === '' && wrote.current.size > 0
    if (!ours || cleared) {
      handle.current?.abort()
      handle.current = null
      lastHeard.current = null
      setListening(false)
    }
  }, [value, listening])

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
      return
    }

    setError(null)
    // Speaking again over what the last go wrote: start that over.
    const keep = redo && lastHeard.current !== null && value === lastHeard.current ? '' : value
    if (keep !== value) onChange(keep)
    base.current = keep ? `${keep.trimEnd()} ` : ''
    startedWith.current = keep
    wrote.current = new Set()
    try {
      handle.current = startDictation({
        onText: (text) => {
          const next = base.current + text
          wrote.current.add(next)
          lastHeard.current = next
          onChange(next)
        },
        onError: (message) => {
          setError(message)
          handle.current = null
          setListening(false)
        },
        onEnd: () => {
          handle.current = null
          setListening(false)
        },
      })
      setListening(true)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <>
      <button
        type="button"
        className={listening ? 'primary small-btn is-listening' : 'ghost small-btn'}
        onClick={toggle}
        aria-pressed={listening}
      >
        {listening ? t('Stop') : (label ?? t('Dictate'))}
      </button>
      {error && <p className="error small">{error}</p>}
    </>
  )
}
