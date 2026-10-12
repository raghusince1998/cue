import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth.tsx'
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
}

/** One line in, the thing Cue makes of it out: the hero, cycling. */
const EXAMPLES: Example[] = [
  { typed: 'call Ravi tomorrow 4pm about the quote', kind: 'Planned', result: 'Call Ravi about the quote — Tue, 4:00 pm', note: 'Linked to Ravi Kumar · reminder at 4' },
  { typed: 'rent ₹15,000 on the 1st every month', kind: 'Bill', result: 'Rent · ₹15,000 · every month', note: 'A reminder 3 days before, each time' },
  { typed: 'applied to Infosys for data analyst', kind: 'Job hunt', result: 'Infosys · Data analyst · Applied', note: 'Nudged if nothing moves in a week' },
  { typed: 'going to Goa 18 to 21 Oct', kind: 'Trip', result: 'Goa · 18 – 21 Oct', note: 'Everything saved for Goa comes with it' },
  { typed: 'Ravi owes me ₹450 for the cab', kind: 'Owed to you', result: '₹450 from Ravi · the cab', note: 'Remind on WhatsApp, with your UPI ID' },
  { typed: 'gym every mon wed fri at 7am', kind: 'Repeating', result: 'Gym · Mon, Wed, Fri at 7:00 am', note: 'On your calendar, every week' },
]

/** What arrives on its own once an inbox is connected. */
const FROM_EMAIL = [
  { mark: '🚆', title: 'Trains, flights, buses', text: 'IRCTC and airline tickets become plans with the PNR to hand, reminded hours before — and a web check-in reminder for flights.' },
  { mark: '📦', title: 'Parcels', text: 'Amazon, Flipkart, Myntra and more: what is arriving today, and the cash to keep ready for cash on delivery.' },
  { mark: '💳', title: 'Card and utility bills', text: 'This month’s card statement and electricity bill, with the amount and due date, reminded before it is late.' },
  { mark: '🛡', title: 'Insurance', text: 'Car, bike, health and life: a reminder a month before cover ends, moved on by itself when you renew.' },
  { mark: '🚗', title: 'PUC and service', text: 'Pollution certificates and service due dates for each vehicle, by its number plate.' },
  { mark: '🛣', title: 'FASTag and challans', text: 'A to-do when your FASTag runs low that closes when you recharge; traffic challans until they are paid.' },
]

/** Who it is for, and what each of them gets first. */
const PEOPLE = [
  { title: 'Home and family', points: ['Bills, rent and renewals', 'Birthdays and anniversaries', 'Money lent, and reminders to get it back'] },
  { title: 'Looking for a job', points: ['Every application and where it stands', 'Interviews linked to the right company', 'A nudge when one goes quiet'] },
  { title: 'Hiring and HR', points: ['Candidates from new to hired', 'Interviews and next steps', 'Birthdays and work anniversaries'] },
  { title: 'Sales and clients', points: ['Calls, visits and follow-ups', 'Weekly targets and a daily report', 'Deals from lead to won'] },
  { title: 'Office work', points: ['Meetings and what came out of them', 'Waiting on someone, chased politely', 'A standup written for you'] },
  { title: 'Freelance and business', points: ['Clients and payments due', 'Expenses and claims', 'Bills and renewals'] },
]

/** Everything else, in a line each. */
const FEATURES = [
  { mark: '⚡', title: 'One line is enough', text: 'Type or speak a plan in plain words — Hindi time words too. Cue works out what, when, who and where.' },
  { mark: '🔔', title: 'Reminders that follow up', text: 'On your phone at the right time, and again if it is still open. Things do not quietly slip.' },
  { mark: '☀️', title: 'Your day, at a glance', text: 'Today shows what is due, what is overdue, what is waiting on others, and what Cue noticed.' },
  { mark: '📅', title: 'Your calendar, in one step', text: 'Google or Microsoft calendar mirrored in, alongside everything else you plan here.' },
  { mark: '✈️', title: 'Trips', text: 'Save things for a city; they surface when you plan a trip there, with tickets and stays attached.' },
  { mark: '👥', title: 'People', text: 'Who you know, where they work, when you last spoke, and a nudge to keep in touch.' },
  { mark: '📋', title: 'Trackers', text: 'Job applications, candidates and deals, each with its next step and a nudge when it stalls.' },
  { mark: '🧾', title: 'Bills and renewals', text: 'Due dates, amounts and one-tap “paid” that moves each to its next date.' },
  { mark: '💸', title: 'Expenses and money owed', text: 'Log spending, claim it back from work, split with friends and remind them to pay.' },
  { mark: '📱', title: 'Works like an app', text: 'Add it to your home screen. Works offline and catches up when you are back online.' },
]

function CaptureDemo() {
  const [index, setIndex] = useState(0)
  // The first example arrives complete, so the first look is never a half-typed line.
  const [shown, setShown] = useState(EXAMPLES[0]!.typed.length)
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const ex = EXAMPLES[index]!
  const done = shown >= ex.typed.length

  useEffect(() => {
    if (reduce) {
      setShown(ex.typed.length)
      const t = setTimeout(() => setIndex((i) => (i + 1) % EXAMPLES.length), 3500)
      return () => clearTimeout(t)
    }
    if (!done) {
      const t = setTimeout(() => setShown((n) => n + 1), 38)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setIndex((i) => (i + 1) % EXAMPLES.length)
      setShown(0)
    }, 2800)
    return () => clearTimeout(t)
  }, [done, ex.typed.length, reduce])

  return (
    <div className="site-capture" aria-label="An example of typing a plan into Cue">
      <div className="site-capture-box">
        <span className="site-capture-text">
          {ex.typed.slice(0, shown)}
          <span className="site-caret" aria-hidden />
        </span>
        <span className="site-capture-btn">Plan it</span>
      </div>
      <div className={`site-capture-result${done ? ' is-shown' : ''}`} aria-live="polite">
        <span className="site-kind">{ex.kind}</span>
        <strong>{ex.result}</strong>
        <span className="site-note">{ex.note}</span>
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

  useEffect(() => {
    document.title = 'Cue — say it once, Cue remembers the rest'
    return () => {
      document.title = 'Cue'
    }
  }, [])

  async function demo() {
    setDemoBusy(true)
    setDemoError(null)
    try {
      await enterDemo()
      navigate('/', { replace: true })
    } catch {
      setDemoError('The demo could not start just now. Try again in a minute, or create a free account.')
      setDemoBusy(false)
    }
  }

  const DemoButton = ({ big = false }: { big?: boolean }) => (
    <button className={`site-btn ghost-btn${big ? ' is-big' : ''}`} onClick={() => void demo()} disabled={demoBusy}>
      {demoBusy ? 'Opening the demo…' : 'Try the demo'}
    </button>
  )

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-wrap site-header-row">
          <Link to="/" className="site-brand">
            <span className="brand-dot" />
            Cue
          </Link>
          <nav className="site-nav" aria-label="Sections">
            <a href="#from-email">From your email</a>
            <a href="#for-you">Who it is for</a>
            <a href="#features">Features</a>
            <Link to="/privacy">Privacy</Link>
          </nav>
          <div className="site-header-actions">
            <Link to="/login" className="site-link">
              Sign in
            </Link>
            <Link to="/register" className="site-btn primary-btn">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="site-hero">
          <div className="site-wrap site-hero-grid">
            <div className="site-hero-copy">
              <span className="site-eyebrow">A planner that remembers for you</span>
              <h1>
                Say it once.
                <br />
                <span className="site-gradient">Cue remembers the rest.</span>
              </h1>
              <p className="site-lead">
                Type a plan in one line — or let Cue find it in your email. Train tickets, parcels,
                bills, insurance renewals and follow-ups turn up on their own, each with a reminder
                at the right time.
              </p>
              <div className="site-ctas">
                <Link to="/register" className="site-btn primary-btn is-big">
                  Get started — it’s free
                </Link>
                <DemoButton big />
              </div>
              <p className="site-small">
                No card needed. The demo opens a sample week, ready to explore, and is deleted after a day.
              </p>
              {demoError && <p className="error small">{demoError}</p>}
            </div>
            <CaptureDemo />
          </div>
        </section>

        <section className="site-strip" aria-label="Messages Cue understands">
          <div className="site-wrap">
            <span className="site-strip-label">Understands messages from</span>
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
              <span className="site-eyebrow">Connect once</span>
              <h2>Things come in by themselves</h2>
              <p>
                Connect Google or Microsoft in one step. Your calendar comes in, and Cue reads only the
                emails that matter — from booking sites, shops, banks, insurers and the transport department.
              </p>
            </div>
            <div className="site-cards">
              {FROM_EMAIL.map((f) => (
                <article key={f.title} className="site-card">
                  <span className="site-mark" aria-hidden>
                    {f.mark}
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section is-tinted">
          <div className="site-wrap">
            <div className="site-section-head">
              <span className="site-eyebrow">How it works</span>
              <h2>Three steps, then it runs itself</h2>
            </div>
            <ol className="site-steps">
              <li>
                <span className="site-step-n">1</span>
                <h3>Create your account</h3>
                <p>Or try the demo first. Tell Cue what you use it for, and it leads with that.</p>
              </li>
              <li>
                <span className="site-step-n">2</span>
                <h3>Connect your account</h3>
                <p>Google (Calendar and Gmail) or Microsoft (Outlook and Calendar), in a single step.</p>
              </li>
              <li>
                <span className="site-step-n">3</span>
                <h3>Get reminded</h3>
                <p>On your phone, at the right time. Add Cue to your home screen and it works like an app.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="site-section" id="for-you">
          <div className="site-wrap">
            <div className="site-section-head">
              <span className="site-eyebrow">Made for your kind of day</span>
              <h2>One app, whoever you are</h2>
              <p>Pick what you use Cue for and it shapes itself around you. Everything else stays one tap away.</p>
            </div>
            <div className="site-people">
              {PEOPLE.map((p) => (
                <article key={p.title} className="site-person">
                  <h3>{p.title}</h3>
                  <ul>
                    {p.points.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section is-tinted" id="features">
          <div className="site-wrap">
            <div className="site-section-head">
              <span className="site-eyebrow">Everything in one place</span>
              <h2>Less to remember. Nothing that slips.</h2>
            </div>
            <div className="site-features">
              {FEATURES.map((f) => (
                <div key={f.title} className="site-feature">
                  <span className="site-mark small" aria-hidden>
                    {f.mark}
                  </span>
                  <div>
                    <h3>{f.title}</h3>
                    <p>{f.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section">
          <div className="site-wrap site-privacy">
            <div>
              <span className="site-eyebrow">Your email stays yours</span>
              <h2>Read-only, and only what matters</h2>
              <ul className="site-checks">
                <li>Cue can only read — it can never send, delete or change your email.</li>
                <li>It opens only messages from booking sites, shops, banks, insurers and utilities.</li>
                <li>No email is stored: only what was found in it, like a ticket or a due date.</li>
                <li>Never sold, never used for ads. Disconnect, or delete your account, at any time.</li>
              </ul>
              <Link to="/privacy" className="site-link">
                Read the privacy policy →
              </Link>
            </div>
          </div>
        </section>

        <section className="site-final">
          <div className="site-wrap">
            <h2>Start remembering less.</h2>
            <p>Free to use. Set up in a minute.</p>
            <div className="site-ctas center">
              <Link to="/register" className="site-btn primary-btn is-big">
                Create your account
              </Link>
              <DemoButton big />
            </div>
            <p className="site-small">
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-wrap site-footer-row">
          <span>© 2026 Cue</span>
          <nav aria-label="Legal">
            <Link to="/privacy">Privacy policy</Link>
            <Link to="/terms">Terms of service</Link>
            <a href={`mailto:${SITE.supportEmail}`}>Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
