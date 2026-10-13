import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../lib/i18n.tsx'

/**
 * Open modals, oldest first. Escape closes only the newest: the Add sheet can
 * open "Is this what you meant?" over itself, and one key press used to close
 * both and throw away the half-filled form underneath.
 */
const openModals: object[] = []

export function Modal({
  title,
  onClose,
  children,
  closeOnBackdrop = true,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  /**
   * False for a sheet holding a form worth keeping, where a click that misses
   * the sheet by a few pixels should not discard it. Close and Escape still do.
   */
  closeOnBackdrop?: boolean
}) {
  // Read through a ref so the effect below runs once per modal: re-running it
  // on every render would move this modal to the top of the stack each time
  // its parent re-rendered.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const self = {}
    openModals.push(self)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === self) close.current()
    }
    window.addEventListener('keydown', onKey)
    // Stop the page behind from scrolling while the sheet is open.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      openModals.splice(openModals.indexOf(self), 1)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [])

  /*
   * Rendered at the end of <body>, not where the component is used.
   *
   * A modal opened from inside a page used to be a child of that page's layout,
   * so the page's rules applied to it. One — `.stack > * { max-width: 800px }`,
   * meant for cards — caught the backdrop, which has left: 0 and right: 0 and,
   * once given a width, ignores `right`. On a 1440px screen the edit modal was
   * pinned to the left edge with the dimming stopping at 800px and the page
   * fully lit behind it. A portal puts every modal beyond the reach of any page
   * layout, including ones nobody has written yet.
   */
  return createPortal(
    <div className="modal-backdrop" onClick={closeOnBackdrop ? onClose : undefined}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="link" onClick={onClose}>
            {t('Close')}
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
