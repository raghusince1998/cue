import { t } from '../lib/i18n.tsx'

/**
 * A first load that failed: what could not be shown, and Try again — in place
 * of a spinner that would otherwise turn forever.
 */
export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="stack tight load-failed" role="alert">
      <p className="error small">{what}</p>
      <button className="ghost small-btn fit-btn" onClick={onRetry}>
        {t('Try again')}
      </button>
    </div>
  )
}
