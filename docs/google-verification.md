# Google verification: what to submit

Until Cue's OAuth app is verified, Google limits it to 100 users and shows
everyone an "unverified app" warning. Gmail access (`gmail.readonly`) is a
**restricted** scope, so verification also needs a yearly independent
security assessment (CASA). Calendar access (`calendar.readonly`) is
**sensitive**: it needs the justification and video, not the assessment.

## Before you submit

- [ ] Google Auth Platform → Branding: app name **Cue**, logo
      (`apps/web/public/brand/cue-logo-120.png`), support email, home page
      `https://cue.vitelio.in`, privacy policy `https://cue.vitelio.in/privacy`,
      terms `https://cue.vitelio.in/terms`.
- [ ] Authorized domain `vitelio.in`, verified in Google Search Console by the
      same Google account that owns the Cloud project.
- [ ] Data Access → scopes: `openid`, `email`, `calendar.readonly`,
      `gmail.readonly`. Nothing broader.
- [ ] The privacy policy states the Limited Use requirements — it does, in
      "Connected Google and Microsoft accounts".
- [ ] The home page explains what Cue does and is reachable without signing in — it is.

## Scope justifications (paste into the form)

**`https://www.googleapis.com/auth/gmail.readonly`**

> Cue is a personal planner. With the user's permission, it reads emails from
> the kinds of senders that send bookings and bills — railways, airlines,
> hotels, online shops and couriers, banks and card issuers, insurers,
> utilities, the transport department and FASTag issuers — and turns each
> into a reminder: a train or flight with a reminder to leave, a parcel
> arriving, a credit card or electricity bill before its due date, an
> insurance or PUC renewal. Messages are read on the server in memory; Cue
> stores only the message ID (so it is not read twice) and a one-line
> description of what it found, which the user can see in Settings. Cue never
> sends, modifies or deletes email. Narrower scopes do not work: gmail.metadata
> gives headers but not the body, and the date, amount, PNR or due date the
> reminder needs is in the body. The data is not used for advertising, not
> sold, not used to train AI models, and not read by people except with the
> user's consent for support, for security, or where the law requires.

**`https://www.googleapis.com/auth/calendar.readonly`**

> Cue shows the user's day in one place. With permission, it reads the events
> of the calendars the user chooses, so their meetings appear next to their
> plans and reminders, free time is found correctly, and a new plan is warned
> about if it clashes with a meeting. Cue never creates, changes or deletes
> calendar events.

## The demo video (unlisted on YouTube, 2–4 minutes)

Record in English, with the browser's address bar visible throughout:

1. `https://cue.vitelio.in`: the home page, then sign in.
2. Settings → Integrations → **Connect Google**: show the consent screen with
   the app name and **both scopes** on screen, and the URL bar showing the
   OAuth client ID. Approve.
3. Back in Cue: a few emails found from known senders (a booking, a parcel, a
   bill) becoming reminders, and the "found in your email" list in Settings.
4. The calendar's events appearing on Today.
5. Settings → disconnect the account: access is removed, here and at Google.

## The security assessment (CASA)

Gmail's restricted scope needs a CASA **Tier 2** assessment from an assessor
on Google's App Defense Alliance list, once a year. Google emails the
instructions after the verification request is accepted. It costs money
(paid to the assessor) and takes a few weeks. Things the assessors commonly
check, and where Cue stands:

| Check | Cue today |
|---|---|
| HTTPS everywhere, modern TLS | Yes (Caddy) |
| OAuth tokens encrypted at rest | Yes (`ENCRYPTION_KEY`) |
| No email content stored | Yes (message ID and one-line description only) |
| Account and data deletion | Yes (Settings, and by email) |
| Database not reachable from the internet | **No — port 5432 is open. Close it first.** |
| Backups | **Turn on RDS automated backups first.** |
| Secrets rotated after exposure | **Rotate the database password first.** |
| Dependency vulnerabilities | Run `npm audit` and update before the scan |

The three bold items are the same ones outstanding since the database was
wiped in October; an assessor will find the open port in minutes.
