import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * An "i" beside a setting, holding the explanation instead of a paragraph
 * under it.
 *
 * Hover shows it on a desktop; a tap toggles it on a phone, where there is no
 * hover, and a tap anywhere else closes it again. The bubble is positioned
 * against the nearest `.has-infotip` ancestor, so it spans the setting's row
 * rather than hanging off a 20px icon at the edge of a narrow sheet.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])

  return (
    <span className={`infotip${open ? ' is-open' : ''}`} ref={root}>
      <button
        type="button"
        className="infotip-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      <span role="tooltip" className="infotip-bubble">
        {children}
      </span>
    </span>
  )
}
