import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.tsx'
import { language, setLanguage, t, type Lang } from '../lib/i18n.tsx'
import { SITE } from '../lib/site.ts'
import { PrivacyEn, PrivacyHi, TermsEn, TermsHi } from './LegalText.tsx'

/** When the policies last changed, as each language writes a date. */
function updatedOn(lang: Lang): string {
  const day = new Date(`${SITE.updated}T00:00:00`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return lang === 'hi' ? `अंतिम बदलाव: ${day}` : `Last updated ${day}`
}

interface Doc {
  title: Record<Lang, string>
  /** Said above the Hindi: it is a translation, and the English counts. */
  translated: string
}

function LegalPage({ doc, children }: { doc: Doc; children: (lang: Lang) => ReactNode }) {
  const { title } = doc
  const { me } = useAuth()
  const [lang, setLang] = useState<Lang>(language)
  useEffect(() => {
    document.title = `${title[lang]} — Cue`
    return () => {
      document.title = 'Cue'
    }
  }, [title, lang])
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  // Signed in, the app speaks the account's language, so the switch only
  // changes which text is read here; signed out, it is the website's switch.
  function choose(next: Lang) {
    if (!me) setLanguage(next)
    setLang(next)
  }

  return (
    <div className="site legal" lang={lang}>
      <header className="site-header">
        <div className="site-wrap site-header-row">
          <Link to="/" className="site-brand">
            <img className="brand-mark" src="/brand/cue-mark.svg" alt="" />
            Cue
          </Link>
          <div className="site-header-actions">
            <button
              className="site-lang"
              onClick={() => choose(lang === 'hi' ? 'en' : 'hi')}
              lang={lang === 'hi' ? 'en' : 'hi'}
              aria-label={lang === 'hi' ? 'Read in English' : 'हिन्दी में पढ़ें'}
            >
              {lang === 'hi' ? 'English' : 'हिन्दी'}
            </button>
            {me ? (
              <Link to="/" className="site-btn primary-btn">
                {t('Back to Cue')}
              </Link>
            ) : (
              <>
                <Link to="/login" className="site-link">
                  {t('Sign in')}
                </Link>
                <Link to="/register" className="site-btn primary-btn">
                  {t('Get started')}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="site-wrap legal-body">
        <h1>{title[lang]}</h1>
        <p className="legal-updated">{updatedOn(lang)}</p>
        {lang === 'hi' && (
          <p className="legal-callout">
            {doc.translated}{' '}
            <button className="link" onClick={() => choose('en')} lang="en">
              Read in English
            </button>
          </p>
        )}
        {children(lang)}
      </main>
      <footer className="site-footer">
        <div className="site-wrap site-footer-row">
          <span>© 2026 Cue</span>
          <nav aria-label={t('Legal')}>
            <Link to="/privacy">{t('Privacy policy')}</Link>
            <Link to="/terms">{t('Terms of service')}</Link>
            <a href={`mailto:${SITE.supportEmail}`}>{t('Contact')}</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}

const PRIVACY: Doc = {
  title: { en: 'Privacy policy', hi: 'गोपनीयता नीति' },
  translated: 'यह अंग्रेज़ी में लिखी नीति का हिन्दी अनुवाद है। दोनों में कोई अंतर हो, तो अंग्रेज़ी वाली ही मान्य होगी।',
}
const TERMS: Doc = {
  title: { en: 'Terms of service', hi: 'सेवा की शर्तें' },
  translated: 'यह अंग्रेज़ी में लिखी शर्तों का हिन्दी अनुवाद है। दोनों में कोई अंतर हो, तो अंग्रेज़ी वाली ही मान्य होंगी।',
}

/**
 * The privacy policy: what Cue keeps, what it reads from connected accounts,
 * who else touches any of it, and how to make it all go away. The words are
 * in LegalText.tsx, in English and Hindi.
 */
export function PrivacyPage() {
  return <LegalPage doc={PRIVACY}>{(lang) => (lang === 'hi' ? <PrivacyHi /> : <PrivacyEn />)}</LegalPage>
}

export function TermsPage() {
  return <LegalPage doc={TERMS}>{(lang) => (lang === 'hi' ? <TermsHi /> : <TermsEn />)}</LegalPage>
}
