# Play Console: Data safety answers (draft)

A draft from what the code does today. Check each against Cue as it is when
you submit — Google holds the developer to these answers. "Collected" in
Play's sense means it leaves the phone for Cue's server.

## Overview

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | Yes |
| Is all collected data encrypted in transit? | Yes (HTTPS only) |
| Can users request that their data be deleted? | Yes — in Settings, or by email; https://cue.vitelio.in/privacy#delete |
| Data shared with third parties? | No. Service providers acting for Cue (hosting on AWS; Anthropic for reading unclear lines, when that is on; push delivery) are not "sharing" under Play's definitions. |

## Data collected

| Data type (Play's name) | Collected | Required or optional | Why |
|---|---|---|---|
| Personal info → Name | Yes | Required | Account management |
| Personal info → Email address | Yes | Required | Account management |
| Personal info → User IDs | Yes (account ID) | Required | Account management |
| Photos and videos → Photos | Yes, if added (profile photo, expense receipts) | Optional | App functionality |
| Audio → Voice or sound recordings | Yes, if recorded (voice notes) | Optional | App functionality |
| Messages → Emails | Yes, if Gmail or Outlook is connected; read on the server, not stored — only a short description of what was found | Optional | App functionality |
| Calendar → Calendar events | Yes, if a calendar is connected (read-only) | Optional | App functionality |
| Contacts → Contacts | Yes, people you add or import (names, phone numbers, emails) | Optional | App functionality |
| Location → Precise location | Yes, only when you use place features (finding plans and wishes near you) | Optional | App functionality |
| Financial info → Purchase history | Yes, parcels and bookings found in email | Optional | App functionality |
| Financial info → Other financial info | Yes, bills, expenses and money owed that you add | Optional | App functionality |
| App activity → Other user-generated content | Yes, your plans, notes and lists | Required | App functionality |

Not collected: health and fitness, payment card numbers, web browsing,
installed apps, device identifiers beyond the push subscription, ads data.
Nothing is used for advertising or sold.

## Also in Play Console

- Ads: **No ads**.
- Target audience: **18 and over** (simplest; Cue is not designed for children).
- App access: reviewers need an account. Give them the demo — "Try the demo"
  on https://cue.vitelio.in needs no sign-up — or a test account you make.
- Government, financial or health features: none.
