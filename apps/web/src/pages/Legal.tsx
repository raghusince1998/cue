import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.tsx'
import { SITE } from '../lib/site.ts'

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const { me } = useAuth()
  useEffect(() => {
    document.title = `${title} — Cue`
    window.scrollTo(0, 0)
    return () => {
      document.title = 'Cue'
    }
  }, [title])
  return (
    <div className="site legal">
      <header className="site-header">
        <div className="site-wrap site-header-row">
          <Link to="/" className="site-brand">
            <img className="brand-mark" src="/brand/cue-mark.svg" alt="" />
            Cue
          </Link>
          <div className="site-header-actions">
            {me ? (
              <Link to="/" className="site-btn primary-btn">
                Back to Cue
              </Link>
            ) : (
              <>
                <Link to="/login" className="site-link">
                  Sign in
                </Link>
                <Link to="/register" className="site-btn primary-btn">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="site-wrap legal-body">
        <h1>{title}</h1>
        <p className="legal-updated">Last updated {SITE.updated}</p>
        {children}
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

/**
 * The privacy policy: what Cue keeps, what it reads from connected accounts,
 * who else touches any of it, and how to make it all go away. Written to
 * what the code does, so it can be checked against it.
 */
export function PrivacyPage() {
  const mail = <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
  return (
    <LegalPage title="Privacy policy">
      <p>
        Cue ({SITE.url}) is a personal planner: plans and reminders, people, trips, bills, expenses and
        parcels, and — if you connect an account — what your calendar and email already say about them.
        This policy explains what Cue collects, what it does with it, and the choices you have.
      </p>

      <h2>What Cue keeps</h2>
      <ul>
        <li><strong>Your account:</strong> your name, email address and a one-way hash of your password (never the password itself), and a profile photo if you add one.</li>
        <li><strong>What you add:</strong> plans, reminders, notes, people and their details, places, trips, bills, expenses (and receipt photos), money owed, job applications and other trackers, and voice notes if you record them.</li>
        <li><strong>Location, only when you ask:</strong> when you log a visit or look for things nearby, your device’s position at that moment. Cue does not track your location in the background.</li>
        <li><strong>To send reminders:</strong> your device’s push subscription and your time zone.</li>
      </ul>

      <h2>Connected Google and Microsoft accounts</h2>
      <p>
        You can connect a Google account (Calendar and Gmail) or a Microsoft account (Outlook and Calendar).
        Cue asks only for <strong>read-only</strong> access: it can never send, delete, change or move an email
        or a calendar event.
      </p>
      <ul>
        <li><strong>Calendar</strong> (<code>calendar.readonly</code>, <code>Calendars.Read</code>): the events of the calendars you choose are copied into Cue so your day shows in one place, and refreshed regularly.</li>
        <li><strong>Email</strong> (<code>gmail.readonly</code>, <code>Mail.Read</code>): Cue looks only at messages from the kinds of senders that send bookings, deliveries and bills — railways and airlines, booking sites, shops and couriers, banks and card issuers, insurers, utilities, the transport department and FASTag issuers. From each, it reads what it needs to make a plan, a parcel, a bill or a renewal reminder: dates, amounts, reference numbers, vehicle numbers.</li>
        <li><strong>No email is stored.</strong> Messages are read in memory. Cue keeps only the message’s identifier, so it is not read twice, and the short description of what it found (for example “Train 12951 · Mumbai Central → New Delhi, Sat 17 Oct”), which you can see in Settings.</li>
        <li>Email is read by Cue’s own code. It is <strong>not</strong> sent to any AI service, never shown to advertisers, never sold, and not used to train any model.</li>
        <li>People do not read your email. The only exceptions are if you ask us to look at a specific problem and agree to it, for security reasons such as investigating abuse, or where the law requires it.</li>
        <li>Access tokens are stored encrypted. Disconnecting an account in Settings deletes them and, for Google, withdraws Cue’s access at Google too. You can also remove Cue at myaccount.google.com/permissions or myapps.microsoft.com at any time.</li>
      </ul>
      <p className="legal-callout">
        Cue’s use and transfer to any other app of information received from Google APIs will adhere to
        the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>How Cue uses your information</h2>
      <p>Only to run Cue for you: showing your plans, sending your reminders, and turning connected calendars and emails into plans, parcels, bills and reminders. Cue does not sell personal information, does not use it for advertising, and does not build profiles of you for anyone else.</p>

      <h2>Who else handles it</h2>
      <ul>
        <li><strong>Hosting:</strong> Cue runs on Amazon Web Services, where its database and servers are.</li>
        <li><strong>Notifications:</strong> reminders are delivered through your browser’s push service (Google, Apple or Mozilla), which carries the reminder text to your device.</li>
        <li><strong>Place lookups:</strong> when you look up a place by name, that name is sent to OpenStreetMap or Google Places to find it.</li>
        <li><strong>Password reset emails</strong> are sent through an email delivery provider.</li>
        <li><strong>Reading unclear lines (Anthropic):</strong> Cue reads what you type with its own rules first. When they cannot read a line with confidence — a vague one like “doctor”, or Hindi they do not know — Cue may send that one line, with today’s date, to Anthropic’s Claude API to understand it, and shows you the result before anything is saved. Nothing else goes with it: not your name, email address, contacts or other plans. Anthropic’s commercial terms do not allow it to train its models on what is sent. Email is never sent.</li>
        <li><strong>AI with your own key:</strong> if you add your own AI key in Settings, text you ask Cue to read with it is sent to the AI provider you chose. This is off unless you set it up, and never applies to email.</li>
      </ul>
      <p>Cue may disclose information if required by law, or to protect its users and service from fraud or abuse.</p>

      <h2 id="delete">How long it is kept, and deleting it</h2>
      <ul>
        <li>What you add stays until you delete it. Deleting a plan, a person or a bill removes it.</li>
        <li><strong>Delete your account</strong> in Settings: your account and everything in it are deleted, and connected accounts are disconnected first. This works the same in the app from the Play Store and on the website: sign in at {SITE.url.replace('https://', '')}, open Settings, then Delete my account.</li>
        <li>Can&rsquo;t sign in? Email <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a> from the address on your account, and it will be deleted, with everything in it, within 7 days.</li>
        <li>Demo accounts made from the homepage hold only sample data and are deleted automatically after a day.</li>
        <li>Backups of the database, if kept, are overwritten within weeks.</li>
      </ul>

      <h2>Security</h2>
      <p>Connections use HTTPS. Passwords are hashed; connected-account tokens are encrypted; each account’s data is kept apart from every other account’s.</p>

      <h2>Children</h2>
      <p>Cue is not meant for children under 13, and does not knowingly collect their information.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the date at the top changes too, and anything that affects how your data is used will be shown in the app before it applies.</p>

      <h2>Contact</h2>
      <p>Questions, requests to see or delete your data, or concerns: {mail}.</p>
    </LegalPage>
  )
}

export function TermsPage() {
  const mail = <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
  return (
    <LegalPage title="Terms of service">
      <p>These terms apply when you use Cue at {SITE.url}. By creating an account or using Cue, you agree to them.</p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your password safe; you are responsible for what is done with your account.</li>
        <li>Give a real email address, so password resets reach you.</li>
        <li>You may delete your account at any time in Settings.</li>
      </ul>

      <h2>Your content</h2>
      <p>What you put into Cue stays yours. You let Cue store and process it only to run the service for you, as described in the <Link to="/privacy">privacy policy</Link>.</p>

      <h2>Using Cue properly</h2>
      <ul>
        <li>Do not use Cue to break the law, to harm others, or to store anything you do not have the right to.</li>
        <li>Do not try to get into other people’s accounts, overload the service, or get around its limits.</li>
        <li>Connect only accounts that are yours, or that you are allowed to connect.</li>
      </ul>

      <h2>Reminders are a help, not a guarantee</h2>
      <p>
        Cue tries hard to remind you on time and to read bookings, bills and due dates correctly, but
        notifications can be delayed or blocked by your device, and messages can be read wrongly. Check
        anything important — a train time, an amount due, a policy’s expiry — against the original. Cue is
        not responsible for missed payments, journeys, renewals or fines.
      </p>

      <h2>The service</h2>
      <p>Cue is offered as it is. Features may change, and the service may occasionally be unavailable. If Cue ever closes, you will be told in advance and given a chance to take your data with you.</p>

      <h2>Ending</h2>
      <p>You can stop using Cue and delete your account whenever you like. Accounts used to abuse the service may be suspended.</p>

      <h2>Contact</h2>
      <p>{mail}</p>
    </LegalPage>
  )
}
