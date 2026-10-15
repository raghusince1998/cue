import { useState, type ReactNode } from 'react'

/**
 * A section that folds away: its title and a one-line summary of where it
 * stands when closed, everything else a tap away. Keeps a long page — the
 * profile — readable at a glance.
 */
export function Fold({
  title,
  summary,
  defaultOpen = false,
  onToggle,
  children,
}: {
  title: string
  summary?: ReactNode
  defaultOpen?: boolean
  onToggle?: (open: boolean) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      className="fold"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open
        setOpen(now)
        onToggle?.(now)
      }}
    >
      <summary className="fold-head">
        <span className="fold-text">
          <span className="fold-title">{title}</span>
          {summary && <span className="fold-summary">{summary}</span>}
        </span>
        <span className="fold-chevron" aria-hidden>
          ›
        </span>
      </summary>
      <div className="fold-body stack tight">{children}</div>
    </details>
  )
}
