import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.tsx'
import { language, msg, rich, setLanguage, t, type Lang } from '../lib/i18n.tsx'
import { SITE } from '../lib/site.ts'

/**
 * The website: what Cue is, before anyone signs in. Sign up, sign in, or try
 * a demo with a sample week in it — and see, plainly, what Cue does with a
 * connected inbox.
 */

interface Example {
  typed: string
  kind: string
  result: string
  note: string
  /** In Hindi, a line typed the way Hindi speakers type it, and what Cue makes of that. */
  hi?: { typed: string; result: string; note: string }
}

/** One line in, the thing Cue makes of it out: the hero, cycling. */
const EXAMPLES: Example[] = [
  { typed: 'call Ravi tomorrow 4pm about the quote', kind: msg('Planned'), result: msg('Call Ravi about the quote — Tue, 4:00 pm'), note: msg('Linked to Ravi Kumar · reminder at 4') },
  { typed: 'rent ₹15,000 on the 1st every month', kind: msg('Bill'), result: msg('Rent · ₹15,000 · every month'), note: msg('A reminder 3 days before, each time') },
  { typed: 'applied to Infosys for data analyst', kind: msg('Job hunt'), result: msg('Infosys · Data analyst · Applied'), note: msg('Nudged if nothing moves in a week') },
  { typed: 'going to Goa 18 to 21 Oct', kind: msg('Trip'), result: msg('Goa · 18 – 21 Oct'), note: msg('Everything saved for Goa comes with it') },
  { typed: 'Ravi owes me ₹450 for the cab', kind: msg('Owed to you'), result: msg('₹450 from Ravi · the cab'), note: msg('Remind on WhatsApp, with your UPI ID') },
  {
    typed: 'gym every mon wed fri at 7am',
    kind: msg('Repeating'),
    result: msg('Gym · Mon, Wed, Fri at 7:00 am'),
    note: msg('On your calendar, every week'),
    hi: { typed: 'roz subah 7 baje gym', result: msg('Gym · every day at 7:00 am'), note: msg('On your calendar, every day') },
  },
]

/** What arrives on its own once an inbox is connected. */
const FROM_EMAIL = [
  { mark: '🚆', title: msg('Trains, flights, buses'), text: msg('IRCTC and airline tickets become plans with the PNR to hand, reminded hours before — and a web check-in reminder for flights.') },
  { mark: '📦', title: msg('Parcels'), text: msg('Amazon, Flipkart, Myntra and more: what is arriving today, and the cash to keep ready for cash on delivery.') },
  { mark: '💳', title: msg('Card and utility bills'), text: msg('This month’s card statement and electricity bill, with the amount and due date, reminded before it is late.') },
  { mark: '🛡', title: msg('Insurance'), text: msg('Car, bike, health and life: a reminder a month before cover ends, moved on by itself when you renew.') },
  { mark: '🚗', title: msg('PUC and service'), text: msg('Pollution certificates and service due dates for each vehicle, by its number plate.') },
  { mark: '🛣', title: msg('FASTag and challans'), text: msg('A to-do when your FASTag runs low that closes when you recharge; traffic challans until they are paid.') },
]

/** Who it is for, and what each of them gets first. */
const PEOPLE = [
  { title: msg('Home and family'), points: [msg('Bills, rent and renewals'), msg('Birthdays and anniversaries'), msg('Money lent, and reminders to get it back')] },
  { title: msg('Looking for a job'), points: [msg('Every application and where it stands'), msg('Interviews linked to the right company'), msg('A nudge when one goes quiet')] },
  { title: msg('Hiring and HR'), points: [msg('Candidates from new to hired'), msg('Interviews and next steps'), msg('Birthdays and work anniversaries')] },
  { title: msg('Sales and clients'), points: [msg('Calls, visits and follow-ups'), msg('Weekly targets and a daily report'), msg('Deals from lead to won')] },
  { title: msg('Office work'), points: [msg('Meetings and what came out of them'), msg('Waiting on someone, chased politely'), msg('A standup written for you')] },
  { title: msg('Freelance and business'), points: [msg('Clients and payments due'), msg('Expenses and claims'), msg('Bills and renewals')] },
]

/** Everything else, in a line each. */
const FEATURES = [
  { mark: '⚡', title: msg('One line is enough'), text: msg('Type or speak a plan in plain words — Hindi time words too. Cue works out what, when, who and where.') },
  { mark: '🔔', title: msg('Reminders that follow up'), text: msg('On your phone at the right time, and again if it is still open. Things do not quietly slip.') },
  { mark: '☀️', title: msg('Your day, at a glance'), text: msg('Today shows what is due, what is overdue, what is waiting on others, and what Cue noticed.') },
  { mark: '📅', title: msg('Your calendar, in one step'), text: msg('Google or Microsoft calendar mirrored in, alongside everything else you plan here.') },
  { mark: '✈️', title: msg('Trips'), text: msg('Save things for a city; they surface when you plan a trip there, with tickets and stays attached.') },
  { mark: '👥', title: msg('People'), text: msg('Who you know, where they work, when you last spoke, and a nudge to keep in touch.') },
  { mark: '📋', title: msg('Trackers'), text: msg('Job applications, candidates and deals, each with its next step and a nudge when it stalls.') },
  { mark: '🧾', title: msg('Bills and renewals'), text: msg('Due dates, amounts and one-tap “paid” that moves each to its next date.') },
  { mark: '💸', title: msg('Expenses and money owed'), text: msg('Log spending, claim it back from work, split with friends and remind them to pay.') },
  { mark: '📱', title: msg('Works like an app'), text: msg('Add it to your home screen. Works offline and catches up when you are back online.') },
]

function CaptureDemo({ lang }: { lang: Lang }) {
  const [index, setIndex] = useState(0)
  // The first example arrives complete, so the first look is never a half-typed line.
  const [shown, setShown] = useState(EXAMPLES[0]!.typed.length)
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const at = EXAMPLES[index]!
  const ex = { ...at, ...(lang === 'hi' ? at.hi : undefined) }
  const done = shown >= ex.typed.length

  useEffect(() => {
    if (reduce) {
      setShown(ex.typed.length)
      const timer = setTimeout(() => setIndex((i) => (i + 1) % EXAMPLES.length), 3500)
      return () => clearTimeout(timer)
    }
    if (!done) {
      const timer = setTimeout(() => setShown((n) => n + 1), 38)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % EXAMPLES.length)
      setShown(0)
    }, 2800)
    return () => clearTimeout(timer)
  }, [done, ex.typed.length, reduce])

  return (
    <div className="site-capture" aria-label={t('An example of typing a plan into Cue')}>
      <div className="site-capture-box">
        <span className="site-capture-text">
          {ex.typed.slice(0, shown)}
          <span className="site-caret" aria-hidden />
        </span>
        <span className="site-capture-btn">{t('Plan it')}</span>
      </div>
      <div className={`site-capture-result${done ? ' is-shown' : ''}`} aria-live="polite">
        <span className="site-kind">{t(ex.kind)}</span>
        <strong>{t(ex.result)}</strong>
        <span className="site-note">{t(ex.note)}</span>
      </div>
      <div className="site-capture-dots" aria-hidden>
        {EXAMPLES.map((_, i) => (
          <span key={i} className={i === index ? 'is-on' : ''} />
        ))}
      </div>
    </div>
  )
}

export default function Home() {
  const { enterDemo } = useAuth()
  const navigate = useNavigate()
  const [demoBusy, setDemoBusy] = useState(false)
  const [demoError, setDemoError] = useState<string | null>(null)
  // Before anyone signs in, the visitor picks: the device's language to begin
  // with, and an account made from here starts in the one picked.
  const [lang, setLang] = useState<Lang>(language)

  useEffect(() => {
    document.title = t('Cue — say it once, Cue remembers the rest')
    return () => {
      document.title = 'Cue'
    }
  }, [lang])

  function choose(next: Lang) {
    setLanguage(next)
    setLang(next)
  }

  async function demo() {
    setDemoBusy(true)
    setDemoError(null)
    try {
      await enterDemo()
      navigate('/', { replace: true })
    } catch {
      setDemoError(t('The demo could not start just now. Try again in a minute, or create a free account.'))
      setDemoBusy(false)
    }
  }

  const DemoButton = ({ big = false }: { big?: boolean }) => (
    <button className={`site-btn ghost-btn${big ? ' is-big' : ''}`} onClick={() => void demo()} disabled={demoBusy}>
      {demoBusy ? t('Opening the demo…') : t('Try the demo')}
    </button>
  )

  return (
    <div className="site" lang={lang}>
      <header className="site-header">
        <div className="site-wrap site-header-row">
          <Link to="/" className="site-brand">
            <img className="brand-mark" src="/brand/cue-mark.svg" alt="" />
            Cue
          </Link>
          <nav className="site-nav" aria-label={t('Sections')}>
            <a href="#from-email">{t('From your email')}</a>
            <a href="#for-you">{t('Who it is for')}</a>
            <a href="#features">{t('Features')}</a>
            <Link to="/privacy">{t('Privacy')}</Link>
          </nav>
          <div className="site-header-actions">
            {/* Each language named in itself, so whoever needs it can find it. */}
            <button
              className="site-lang"
              onClick={() => choose(lang === 'hi' ? 'en' : 'hi')}
              lang={lang === 'hi' ? 'en' : 'hi'}
              aria-label={lang === 'hi' ? 'Read in English' : 'हिन्दी में पढ़ें'}
            >
              {lang === 'hi' ? 'English' : 'हिन्दी'}
            </button>
            <Link to="/login" className="site-link">
              {t('Sign in')}
            </Link>
            <Link to="/register" className="site-btn primary-btn">
              {t('Get started')}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="site-hero">
          <div className="site-wrap site-hero-grid">
            <div className="site-hero-copy">
              <span className="site-eyebrow">{t('A planner that remembers for you')}</span>
              <h1>
                {t('Say it once.')}
                <br />
                <span className="site-gradient">{t('Cue remembers the rest.')}</span>
              </h1>
              <p className="site-lead">
                {t(
                  'Type a plan in one line — or let Cue find it in your email. Train tickets, parcels, bills, insurance renewals and follow-ups turn up on their own, each with a reminder at the right time.',
                )}
              </p>
              <div className="site-ctas">
                <Link to="/register" className="site-btn primary-btn is-big">
                  {t('Get started — it’s free')}
                </Link>
                <DemoButton big />
              </div>
              <p className="site-small">
                {t('No card needed. The demo opens a sample week, ready to explore, and is deleted after a day.')}
              </p>
              {demoError && <p className="error small">{demoError}</p>}
            </div>
            <CaptureDemo lang={lang} />
          </div>
        </section>

        <section className="site-strip" aria-label={t('Messages Cue understands')}>
          <div className="site-wrap">
            <span className="site-strip-label">{t('Understands messages from')}</span>
            <div className="site-strip-names">
              {['IRCTC', 'IndiGo', 'Air India', 'Amazon', 'Flipkart', 'Myntra', 'BookMyShow', 'HDFC', 'ICICI', 'ACKO', 'LIC', 'Parivahan', 'redBus', 'Paytm FASTag'].map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section" id="from-email">
          <div className="site-wrap">
            <div className="site-section-head">
              <span className="site-eyebrow">{t('Connect once')}</span>
              <h2>{t('Things come in by themselves')}</h2>
              <p>
                {t(
                  'Connect Google or Microsoft in one step. Your calendar comes in, and Cue reads only the emails that matter — from booking sites, shops, banks, insurers and the transport department.',
                )}
              </p>
            </div>
            <div className="site-cards">
              {FROM_EMAIL.map((f) => (
                <article key={f.title} className="site-card">
                  <span className="site-mark" aria-hidden>
                    {f.mark}
                  </span>
                  <h3>{t(f.title)}</h3>
                  <p>{t(f.text)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section is-tinted">
          <div className="site-wrap">
            <div className="site-section-head">
              <span className="site-eyebrow">{t('How it works')}</span>
              <h2>{t('Three steps, then it runs itself')}</h2>
            </div>
            <ol className="site-steps">
              <li>
                <span className="site-step-n">1</span>
                <h3>{t('Create your account')}</h3>
                <p>{t('Or try the demo first. Tell Cue what you use it for, and it leads with that.')}</p>
              </li>
              <li>
                <span className="site-step-n">2</span>
                <h3>{t('Connect your account')}</h3>
                <p>{t('Google (Calendar and Gmail) or Microsoft (Outlook and Calendar), in a single step.')}</p>
              </li>
              <li>
                <span className="site-step-n">3</span>
                <h3>{t('Get reminded')}</h3>
                <p>{t('On your phone, at the right time. Add Cue to your home screen and it works like an app.')}</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="site-section" id="for-you">
          <div className="site-wrap">
            <div className="site-section-head">
              <span className="site-eyebrow">{t('Made for your kind of day')}</span>
              <h2>{t('One app, whoever you are')}</h2>
              <p>{t('Pick what you use Cue for and it shapes itself around you. Everything else stays one tap away.')}</p>
            </div>
            <div className="site-people">
              {PEOPLE.map((p) => (
                <article key={p.title} className="site-person">
                  <h3>{t(p.title)}</h3>
                  <ul>
                    {p.points.map((x) => (
                      <li key={x}>{t(x)}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            {/* Its own app, for aspirants: the same Cue, exams first, Hindi first. */}
            <Link to="/exams-app" className="site-card exams-callout">
              <img src="/brand/cue-exams-mark.svg" alt="" width={44} height={44} />
              <span>
                <strong>{t('Preparing for an exam? Try Cue Exams.')}</strong>
                <span className="muted"> {t('Every exam from the form to the result — last dates, admit cards, results — in Hindi too. परीक्षा की हर तारीख याद।')}</span>
              </span>
            </Link>
          </div>
        </section>

        <section className="site-section is-tinted" id="features">
          <div className="site-wrap">
            <div className="site-section-head">
              <span className="site-eyebrow">{t('Everything in one place')}</span>
              <h2>{t('Less to remember. Nothing that slips.')}</h2>
            </div>
            <div className="site-features">
              {FEATURES.map((f) => (
                <div key={f.title} className="site-feature">
                  <span className="site-mark small" aria-hidden>
                    {f.mark}
                  </span>
                  <div>
                    <h3>{t(f.title)}</h3>
                    <p>{t(f.text)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section">
          <div className="site-wrap site-privacy">
            <div>
              <span className="site-eyebrow">{t('Your email stays yours')}</span>
              <h2>{t('Read-only, and only what matters')}</h2>
              <ul className="site-checks">
                <li>{t('Cue can only read — it can never send, delete or change your email.')}</li>
                <li>{t('It opens only messages from booking sites, shops, banks, insurers and utilities.')}</li>
                <li>{t('No email is stored: only what was found in it, like a ticket or a due date.')}</li>
                <li>{t('Never sold, never used for ads. Disconnect, or delete your account, at any time.')}</li>
              </ul>
              <Link to="/privacy" className="site-link">
                {t('Read the privacy policy →')}
              </Link>
            </div>
          </div>
        </section>

        <section className="site-final">
          <div className="site-wrap">
            <h2>{t('Start remembering less.')}</h2>
            <p>{t('Free to use. Set up in a minute.')}</p>
            <div className="site-ctas center">
              <Link to="/register" className="site-btn primary-btn is-big">
                {t('Create your account')}
              </Link>
              <DemoButton big />
            </div>
            <p className="site-small">
              {rich('Already have an account? <link>Sign in</link>', { link: (s) => <Link to="/login">{s}</Link> })}
            </p>
          </div>
        </section>
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
