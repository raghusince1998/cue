import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.tsx'
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
    demo: 'डेमो देखें',
    opening: 'डेमो खुल रहा है…',
    demoFailed: 'डेमो अभी शुरू नहीं हो सका। एक मिनट बाद फिर कोशिश करें।',
    small: 'कोई शुल्क नहीं। एंड्रॉइड पर ऐप की तरह, या किसी भी फोन के ब्राउज़र में। डेमो में परीक्षाओं, तारीखों और सूचियों से भरा एक खाता खुलता है, जो एक दिन बाद हट जाता है।',
    featuresTitle: 'जो Cue Exams आपके लिए करता है',
    features: [
      ['📅', 'अंतिम तिथि और शुल्क', 'फॉर्म भरना है? अंतिम तिथि से 3 दिन पहले, एक शाम पहले और उसी दिन याद दिलाता है — जब तक आप भर न दें।'],
      ['🎫', 'प्रवेश पत्र से परीक्षा का दिन', 'प्रवेश पत्र का PDF दें: रिपोर्टिंग का समय, गेट बंद होने का समय, साथ ले जाने की सूची, और केंद्र दूसरे शहर में हो तो यात्रा।'],
      ['✉️', 'बोर्ड के ईमेल अपने आप', 'ईमेल जोड़ें, तो रजिस्ट्रेशन, प्रवेश पत्र और परिणाम के ईमेल आपकी परीक्षा को अपने आप आगे बढ़ाते हैं।'],
      ['📢', 'आधिकारिक सूचनाएँ, जाँचकर', 'SSC, RRB, NTA, CTET, SBI, LIC, RPSC और RSSB की नई सूचनाएँ Cue खुद पढ़ता है — एक व्यक्ति जाँचता है, फिर आपको बताया जाता है, सूचना के लिंक के साथ।'],
      ['🔎', 'परिणाम सूची में आपका रोल नंबर', 'परिणाम या शॉर्टलिस्ट आते ही Cue आपका रोल नंबर सूची में ढूँढता है, और वर्ग के अनुसार कट-ऑफ दिखाता है।'],
      ['📚', 'पढ़ाई, मॉक टेस्ट, फोटो', 'परीक्षा तक की पढ़ाई की योजना, मॉक टेस्ट के अंकों की प्रगति, और फॉर्म के माप में फोटो-हस्ताक्षर — फोन पर ही।'],
      ['📝', 'हर चरण की सूची', 'फॉर्म में क्या लगेगा — फोटो का माप, अंकतालिकाएँ, आपका वर्ग प्रमाण पत्र — और दस्तावेज़ सत्यापन, मेडिकल और इंटरव्यू में क्या ले जाना है।'],
      ['⚠️', 'टकराती तारीखें', 'एक दिन दो परीक्षाएँ, या लगातार दिनों में दो शहरों में — तारीख आते ही बताया जाता है।'],
      ['🧮', 'संभावित अंक', 'उत्तर कुंजी से सही और गलत गिनें: बोर्ड के तरीके से अंक, पिछले कट-ऑफ के सामने।'],
      ['🗓', 'रविवार की रिपोर्ट', 'हर रविवार शाम: पढ़ाई के पूरे सत्र, पिछले हफ़्ते के मुकाबले मॉक टेस्ट, और आगे की तारीखें।'],
      ['👨‍👩‍👧', 'परीक्षा का दिन, परिवार को', 'एक टैप में दिन, रिपोर्टिंग का समय और केंद्र, नक्शे के लिंक के साथ, WhatsApp पर — रोल नंबर कभी नहीं।'],
      ['🪪', 'प्रमाण पत्र समय पर', 'EWS, OBC या MBC: हर 1 अप्रैल को उस साल का प्रमाण पत्र बनवाने का रिमाइंडर।'],
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
    demo: 'Try the demo',
    opening: 'Opening the demo…',
    demoFailed: 'The demo could not start just now. Try again in a minute.',
    small: 'Free. Like an app on Android, or in any phone’s browser. The demo opens an account full of exams, dates and lists, deleted after a day.',
    featuresTitle: 'What Cue Exams does for you',
    features: [
      ['📅', 'Last dates and fees', 'A form to fill? Reminded 3 days before the last date, the evening before, and on the day — until it is done.'],
      ['🎫', 'Admit card to exam day', 'Hand over the admit card PDF: when to report, when the gate closes, what to carry, and the journey if the centre is in another city.'],
      ['✉️', 'Board emails, on their own', 'Connect your email, and registration, admit card and result emails move your exams along by themselves.'],
      ['📢', 'Official notices, checked', 'Cue reads the new notices of SSC, RRB, NTA, CTET, SBI, LIC, RPSC and RSSB itself — checked by a person before you are told, always with the notice’s link.'],
      ['🔎', 'Your roll number in result lists', 'When a result or shortlist is out, Cue looks for your roll number in it, and shows the cut-offs by category.'],
      ['📚', 'Study, mocks, photos', 'A study plan to the exam day, your mock scores’ trend, and your photo and signature fitted to the form — on your phone.'],
      ['📝', 'A list for every step', 'What the form asks for — photo sizes, marksheets, your category certificate — and what to carry to document verification, the medical and the interview.'],
      ['⚠️', 'Clashing dates', 'Two exams on one day, or following days in two cities — pointed out as soon as a date lands.'],
      ['🧮', 'Expected score', 'Count right and wrong from the answer key: the score by the board’s marking, against the last cut-off.'],
      ['🗓', 'A Sunday report', 'Every Sunday evening: study sessions done, mock scores against last week, and the dates coming up.'],
      ['👨‍👩‍👧', 'The exam day, to family', 'One tap sends the day, the reporting time and the centre with a map link on WhatsApp — never the roll number.'],
      ['🪪', 'Certificates on time', 'EWS, OBC or MBC: a reminder every 1 April to get that year’s certificate.'],
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
  const { enterDemo } = useAuth()
  const navigate = useNavigate()
  const [demoBusy, setDemoBusy] = useState(false)
  const [demoFailed, setDemoFailed] = useState(false)

  // An aspirant's account, already full: exams at every stage, in the language picked here.
  async function demo() {
    setDemoBusy(true)
    setDemoFailed(false)
    try {
      await enterDemo('exams')
      navigate('/exams', { replace: true })
    } catch {
      setDemoFailed(true)
      setDemoBusy(false)
    }
  }
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
                <button className="site-btn ghost-btn is-big" onClick={() => void demo()} disabled={demoBusy}>
                  {demoBusy ? t.opening : t.demo}
                </button>
              </div>
              <p className="site-small">{t.small}</p>
              {demoFailed && <p className="error small">{t.demoFailed}</p>}
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
