import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EXAMS, EXAM_GROUPS, examGroup } from '@cue/shared'
import { SITE } from '../lib/site.ts'
import { enterExamsMode, setSignupLanguage, signupLanguage } from '../lib/appMode.ts'
import { setLanguage } from '../lib/i18n.tsx'

/**
 * Cue Exams, before anyone signs in: what it does for an aspirant, in Hindi
 * first and English a tap away; that it never asks for a portal password;
 * and that it speaks for no government body — the official notice is
 * always one tap from anything it says.
 */

const T = {
  hi: {
    eyebrow: 'परीक्षा की तैयारी करने वालों के लिए',
    title: 'हर परीक्षा,',
    titleAccent: 'फॉर्म से परिणाम तक।',
    lead: 'आवेदन की अंतिम तिथि, शुल्क, प्रवेश पत्र, परीक्षा का दिन, परिणाम — हर तारीख समय पर याद। RRB, SSC, UPSC, बैंक, NEET, JEE, RPSC, RSSB और 50 से ज़्यादा परीक्षाएँ।',
    start: 'मुफ़्त शुरू करें',
    signIn: 'साइन इन',
    small: 'कोई शुल्क नहीं। एंड्रॉइड पर ऐप की तरह, या किसी भी फोन के ब्राउज़र में।',
    featuresTitle: 'जो Cue Exams आपके लिए करता है',
    features: [
      ['📅', 'अंतिम तिथि और शुल्क', 'फॉर्म भरना है? अंतिम तिथि से 3 दिन पहले, एक शाम पहले और उसी दिन याद दिलाता है — जब तक आप भर न दें।'],
      ['🎫', 'प्रवेश पत्र से परीक्षा का दिन', 'प्रवेश पत्र का PDF दें: रिपोर्टिंग का समय, गेट बंद होने का समय, साथ ले जाने की सूची, और केंद्र दूसरे शहर में हो तो यात्रा।'],
      ['✉️', 'बोर्ड के ईमेल अपने आप', 'ईमेल जोड़ें, तो रजिस्ट्रेशन, प्रवेश पत्र और परिणाम के ईमेल आपकी परीक्षा को अपने आप आगे बढ़ाते हैं।'],
      ['📢', 'आधिकारिक सूचनाएँ, जाँचकर', 'SSC, RRB, NTA, CTET, SBI, LIC, RPSC और RSSB की नई सूचनाएँ Cue खुद पढ़ता है — एक व्यक्ति जाँचता है, फिर आपको बताया जाता है, सूचना के लिंक के साथ।'],
      ['🔎', 'परिणाम सूची में आपका रोल नंबर', 'परिणाम या शॉर्टलिस्ट आते ही Cue आपका रोल नंबर सूची में ढूँढता है, और वर्ग के अनुसार कट-ऑफ दिखाता है।'],
      ['📚', 'पढ़ाई, मॉक टेस्ट, फोटो', 'परीक्षा तक की पढ़ाई की योजना, मॉक टेस्ट के अंकों की प्रगति, और फॉर्म के माप में फोटो-हस्ताक्षर — फोन पर ही।'],
    ],
    examsTitle: 'इन परीक्षाओं के लिए तैयार',
    privacyTitle: 'आपकी जानकारी आपकी',
    privacy:
      'Cue कभी किसी पोर्टल का पासवर्ड, OTP या जन्मतिथि नहीं माँगता, और किसी पोर्टल पर लॉग इन नहीं करता। प्रवेश पत्र और परिणाम सूची पढ़कर छोड़ दी जाती हैं; केवल वही रहता है जो आप सहेजते हैं।',
    disclaimer:
      'Cue Exams किसी भी सरकारी संस्था या परीक्षा बोर्ड से जुड़ा नहीं है और उनकी ओर से नहीं बोलता। तारीखें और सूचनाएँ बोर्ड की आधिकारिक वेबसाइटों से हैं, जिनका लिंक हमेशा साथ दिया जाता है — अंतिम जानकारी के लिए हमेशा आधिकारिक सूचना देखें।',
    privacyLink: 'गोपनीयता नीति',
    terms: 'शर्तें',
    contact: 'संपर्क',
  },
  en: {
    eyebrow: 'For aspirants and students',
    title: 'Every exam,',
    titleAccent: 'from the form to the result.',
    lead: 'The last date to apply, the fee, the admit card, the exam day, the result — every date remembered on time. RRB, SSC, UPSC, banks, NEET, JEE, RPSC, RSSB and 50+ exams.',
    start: 'Start free',
    signIn: 'Sign in',
    small: 'Free. Like an app on Android, or in any phone’s browser.',
    featuresTitle: 'What Cue Exams does for you',
    features: [
      ['📅', 'Last dates and fees', 'A form to fill? Reminded 3 days before the last date, the evening before, and on the day — until it is done.'],
      ['🎫', 'Admit card to exam day', 'Hand over the admit card PDF: when to report, when the gate closes, what to carry, and the journey if the centre is in another city.'],
      ['✉️', 'Board emails, on their own', 'Connect your email, and registration, admit card and result emails move your exams along by themselves.'],
      ['📢', 'Official notices, checked', 'Cue reads the new notices of SSC, RRB, NTA, CTET, SBI, LIC, RPSC and RSSB itself — checked by a person before you are told, always with the notice’s link.'],
      ['🔎', 'Your roll number in result lists', 'When a result or shortlist is out, Cue looks for your roll number in it, and shows the cut-offs by category.'],
      ['📚', 'Study, mocks, photos', 'A study plan to the exam day, your mock scores’ trend, and your photo and signature fitted to the form — on your phone.'],
    ],
    examsTitle: 'Ready for these exams',
    privacyTitle: 'Your details stay yours',
    privacy:
      'Cue never asks for a portal password, an OTP or your date of birth, and never signs in to any portal. Admit cards and result lists are read and dropped; only what you save is kept.',
    disclaimer:
      'Cue Exams is not affiliated with, and does not speak for, any government body or exam board. Dates and notices come from the boards’ official websites, always linked beside them — check the official notice for the final word.',
    privacyLink: 'Privacy policy',
    terms: 'Terms',
    contact: 'Contact',
  },
}

export default function ExamsHome() {
  const [lang, setLang] = useState<'hi' | 'en'>(signupLanguage)
  const t = T[lang]
  useEffect(() => {
    enterExamsMode()
    // The rest of the website — signing up, the privacy policy — follows the language picked here.
    setLanguage(lang)
    document.title = lang === 'hi' ? 'Cue Exams — फॉर्म से परिणाम तक' : 'Cue Exams — from the form to the result'
    // Installed from here, it is Cue Exams.
    document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/exams.webmanifest')
    return () => {
      document.title = 'Cue'
    }
  }, [lang])
  const choose = (next: 'hi' | 'en') => {
    setLang(next)
    setSignupLanguage(next)
  }

  return (
    <div className="site exams-site" lang={lang}>
      <header className="site-header">
        <div className="site-wrap site-header-row">
          <Link to="/exams-app" className="site-brand">
            <img className="brand-mark" src="/brand/cue-exams-mark.svg" alt="" />
            Cue Exams
          </Link>
          <div className="site-header-actions">
            <div className="chips" role="group" aria-label="Language · भाषा">
              <button className={`chip${lang === 'hi' ? ' selected' : ''}`} onClick={() => choose('hi')} aria-pressed={lang === 'hi'}>
                हिन्दी
              </button>
              <button className={`chip${lang === 'en' ? ' selected' : ''}`} onClick={() => choose('en')} aria-pressed={lang === 'en'}>
                English
              </button>
            </div>
            <Link to="/login" className="site-link">
              {t.signIn}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="site-hero">
          <div className="site-wrap">
            <div className="site-hero-copy">
              <span className="site-eyebrow">{t.eyebrow}</span>
              <h1>
                {t.title}
                <br />
                <span className="site-gradient exams-gradient">{t.titleAccent}</span>
              </h1>
              <p className="site-lead">{t.lead}</p>
              <div className="site-ctas">
                <Link to="/register" className="site-btn primary-btn is-big">
                  {t.start}
                </Link>
                <Link to="/login" className="site-btn ghost-btn is-big">
                  {t.signIn}
                </Link>
              </div>
              <p className="site-small">{t.small}</p>
            </div>
          </div>
        </section>

        <section className="site-section" id="features">
          <div className="site-wrap">
            <div className="site-section-head">
              <h2>{t.featuresTitle}</h2>
            </div>
            <div className="site-cards">
              {t.features.map(([mark, title, text]) => (
                <article key={title} className="site-card">
                  <span className="site-mark" aria-hidden>
                    {mark}
                  </span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section is-tinted">
          <div className="site-wrap">
            <div className="site-section-head">
              <h2>{t.examsTitle}</h2>
            </div>
            <div className="exams-site-groups">
              {EXAM_GROUPS.map((g) => (
                <div key={g.key} className="exams-site-group">
                  <h3>{lang === 'hi' ? g.hi : g.en}</h3>
                  <p>
                    {EXAMS.filter((e) => examGroup(e) === g.key)
                      .map((e) => e.name)
                      .join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section">
          <div className="site-wrap">
            <div className="site-section-head">
              <h2>{t.privacyTitle}</h2>
              <p>{t.privacy}</p>
            </div>
            <p className="exams-site-disclaimer">{t.disclaimer}</p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-wrap site-footer-row">
          <span>© 2026 Cue</span>
          <nav aria-label="Legal">
            <Link to="/privacy">{t.privacyLink}</Link>
            <Link to="/terms">{t.terms}</Link>
            <a href={`mailto:${SITE.supportEmail}`}>{t.contact}</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
