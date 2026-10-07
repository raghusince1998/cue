import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // Stop the page behind from scrolling while the sheet is open.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

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
    <div className="modal-backdrop" onClick={onClose}>
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
            Close
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
