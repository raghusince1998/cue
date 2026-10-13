# Play Console: Data safety and app content — Cue Exams (draft)

The same server and account as Cue, so the same data practices; this is
what Cue Exams' own listing should say. Check each line against the app as it
is when you submit — Google holds the developer to these answers.
"Collected" in Play's sense means it leaves the phone for Cue's server.

## Overview

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | Yes |
| Is all collected data encrypted in transit? | Yes (HTTPS only) |
| Can users request that their data be deleted? | Yes — in Settings, or by email; https://cue.vitelio.in/privacy#delete |
| Data shared with third parties? | No. Service providers acting for Cue (hosting on AWS; push delivery; Anthropic for reading unclear lines, when that is on) are not "sharing" under Play's definitions. |

## Data collected

| Data type (Play's name) | Collected | Required or optional | Why |
|---|---|---|---|
| Personal info → Name | Yes | Required | Account management |
| Personal info → Email address | Yes | Required | Account management |
| Personal info → User IDs | Yes (account ID) | Required | Account management |
| Personal info → Other info | Yes: exam registration and roll numbers, reservation category, exam centre — only as entered or confirmed | Optional | App functionality |
| Messages → Emails | Yes, if Gmail or Outlook is connected; read on the server, not stored — only a short description of what was found | Optional | App functionality |
| Calendar → Calendar events | Yes, if a calendar is connected (read-only) | Optional | App functionality |
| Files and docs | Admit card and result list PDFs you choose to read are processed on the server and **not stored** — declare as collected, processed ephemerally | Optional | App functionality |
| App activity → Other user-generated content | Yes: your exams, their dates, study plans, mock scores, notes | Required | App functionality |

Not collected: photos (the photo and signature tool works on the device; the
image is never uploaded), location, contacts unless you add people in Cue,
health, payment details, web browsing, device identifiers beyond the push
subscription, ads data. Nothing is used for advertising or sold.

## App content declarations

- **Ads:** No ads.
- **Government apps:** the app is **not** developed by or on behalf of a
  government. It provides information about government exams, with the
  disclosure and sources in the description (see `listing.md`) and inside the
  app (the welcome page and the foot of the Exams page).
- **Target audience:** 16–17 and 18 and over (entrance-exam students are
  often 17). Not designed for children; no ads, so the Families rules for
  under-13s do not apply.
- **App access:** reviewers need an account. Give them a test account you
  make, with an exam or two added, and say so in the access instructions.
- **Financial, health features:** none.
