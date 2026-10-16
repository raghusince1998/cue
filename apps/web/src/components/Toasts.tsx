import { useCallback, useState } from 'react'
import { useToasts, type ToastMessage } from '../lib/toast.ts'
import { t } from '../lib/i18n.tsx'

/** Where toast() lines appear: one or two at a time, each for a few seconds. */
export function Toasts() {
  const [shown, setShown] = useState<ToastMessage[]>([])
  const onToast = useCallback((m: ToastMessage) => {
    setShown((list) => [...list.filter((x) => x.text !== m.text).slice(-1), m])
    window.setTimeout(() => setShown((list) => list.filter((x) => x.id !== m.id)), m.kind === 'error' ? 6000 : 3500)
  }, [])
  useToasts(onToast)
  if (shown.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {shown.map((m) => (
        <div key={m.id} className={`toast is-${m.kind}`}>
          <span>{m.text}</span>
          <button className="toast-close" aria-label={t('Close')} onClick={() => setShown((list) => list.filter((x) => x.id !== m.id))}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
