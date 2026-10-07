# Cue

A personal planner that prompts you rather than filing things away.

Say it in one line and it is planned. From there it does the parts a list
cannot: it works out what you meant, remembers how long these things usually
take and where they happen, warns you when two places are too far apart to make
both, plans tomorrow before you ask, and — when its own chasing has failed —
says so and helps you clear the wreckage.

The domain stays deliberately generic. A client meeting, a clinic visit and a
dentist appointment are the same shape of thing: something that happens, and
something you owe afterwards. Four plain tables carry it — `Place`, `Contact`,
`Interaction`, `Commitment` — and the wording stays neutral so no entry feels
like it belongs to somebody else's job.

**Nothing requires a location.** A phone call and a video meeting have none, and
demanding one made every non-visit entry awkward.

Everything the app understands is worked out on the device or the server, with
no model in the path: the parsing, the role extraction, the memory of how you
work. That makes it instant, free to run, private, usable offline — and, the
part that matters most, able to show you exactly which words produced which
field, so a wrong reading is visible before it is saved rather than discovered
next week.

## Running it

Uses your locally installed PostgreSQL — no Docker. Tested against PostgreSQL 18
on port 5432.

```bash
npm install
```

Create the `cue` role and database. This prompts for your PostgreSQL superuser
password (the one you set when installing PostgreSQL) and writes nothing to disk:

```bash
npm run db:setup
```

```bash
npm run db:push
```

```bash
npm run seed
```

```bash
npm run dev
```

Web at http://localhost:5173, API at http://localhost:3002 — both configurable via `WEB_PORT` and `PORT` in `.env`.
The seed creates `demo@cue.local` / `demo1234` with a reminder that fires about a
minute after seeding.

`.env` is created from `.env.example` and already has VAPID keys generated. If you
ever need new ones:

```bash
npm run vapid
```

## Installing it

Cue was already a PWA — manifest, service worker, offline outbox — with no way
to install it except knowing to dig through a browser menu. On a phone that is
the difference between an app that can reach you and a tab that gets closed, and
**iOS delivers no notifications at all until the site is on the home screen**,
so for half of all users the entire reminder engine sat behind a menu item
nobody finds.

An **Install** prompt now appears on Today, above the notifications one, because
on iPhone installing is what makes notifications possible in the first place.

Two routes, because the browsers genuinely differ:

| Browser | What happens |
| --- | --- |
| Chrome, Edge, Android | `beforeinstallprompt` is captured and the button installs in one tap |
| Safari, iOS | no such API exists, so it says which two taps to make instead |

Chrome's own mini-infobar is suppressed, so the offer appears where the app
chose rather than where the browser did. Nothing is shown once it is installed —
the check covers both `display-mode: standalone` and the older iOS flag, and
iPadOS is caught by its touch points because it reports itself as a Mac.

## Turning on notifications

Open the app, hit **Enable** on the banner, accept the browser prompt, then
**Send test**. If the test lands, the whole delivery path works and real reminders
will arrive with the tab closed and the browser minimised.

- **Android / desktop Chrome, Edge, Firefox** — works as-is.
- **iPhone** — you must add the app to your home screen first (Share → Add to Home
  Screen, iOS 16.4+). Safari exposes no push API to a normal browser tab.

## Testing GPS from your phone

`vite` is bound to `0.0.0.0`, so you can open `http://<your-lan-ip>:5173` from a
phone on the same wifi. Note that browsers only grant geolocation on `https` or
`localhost` — for a phone over LAN you will need a tunnel (`cloudflared tunnel
--url http://localhost:5173` or ngrok) to get a real fix.

## What this deliberately does not do yet

**Automatic stop detection.** A browser only reports location while the page is
open and visible; it cannot notice that you parked at a clinic for 35 minutes while
your phone was in your pocket. There is no web geofencing API. So the web build
asks "where are you now" when you open it, and you confirm.

The path to the real thing is already laid: `apps/web/src/lib/geo.ts` is the single
seam. Wrapping this same codebase with [Capacitor](https://capacitorjs.com) and a
background-geolocation plugin produces an Android APK where that module is swapped
for a native one — no rewrite, and the web version keeps working unchanged.

Also deferred: writing *back* to Google Calendar (reading it is covered below),
OAuth sign-in for calendars, team invites into an existing org, contacts as
first-class records, and Postgres row-level security (every table already carries
`org_id`, which is the part that is painful to retrofit; the policies themselves are
a later migration — today isolation is enforced in the query layer via `scope(req)`).

## Layout

```
apps/api      Fastify + Drizzle + Postgres, and the reminder worker
apps/web      Vite + React PWA (desktop and mobile, Capacitor-ready)
packages/shared   zod schemas shared by both sides
```

### How the nag engine works

A commitment queues one row in `reminders` at its due time. The worker claims due
rows with `FOR UPDATE SKIP LOCKED` (so several API instances never double-send),
pushes the notification, and queues the next attempt 15 minutes out. After
`MAX_ESCALATIONS` the chain stops, but the commitment stays in the **You dropped
these** list until you close it — it is never silently forgotten.

Marking done or cancelling kills the queued chain. Snoozing kills it and starts a
fresh one from the new time.

### Double-booking

Every commitment blocks a slot — 15 minutes for a callback, an hour for a meeting,
adjustable per item. Before a new one is saved, the capture screen checks the slot
and shows anything that clashes, along with the next few free times. You can move
yours, shift the existing one (`POST /commitments/:id/reschedule`), or tick **Book
both anyway**. Nothing is written until you choose.

Slots that merely touch do not clash: a 14:00–15:00 meeting leaves 15:00 free.
Conflicts are per person, not per company — two reps can both be busy at 4pm.

**A clash with the form's opening guess informs; it does not block.** The capture
screen has to open on some time, so it opens on tomorrow 10am. If that guess
happens to land on an existing meeting, refusing to save would mean the app
blocking a decision the user has not made — they had typed nothing at all. Until
the time is actually chosen, the clash is shown as information and the save
stays enabled. The moment a preset, an exact time or a parsed phrase sets it, it
blocks as before. The server re-checks on save regardless, so nothing slips
through either way.

The server re-checks on save and returns `409 time_conflict` with the clashing
items, so a slot taken between the pre-check and the save cannot slip through.

### Editing

Everything stays editable after it is saved. **History** is the record of
everything that happened, visits included; **Today** has an Edit link on each
follow-up, and a Reopen link on anything closed today.

Editing a commitment's time re-runs the clash check (excluding itself, so moving
something by five minutes does not report a conflict with its own old slot),
cancels the queued reminder chain, and starts a fresh one — the overdue count
resets, because you are not late for a time you just changed. Setting the status to
done or cancelled stops the reminders; setting it back to pending starts them again.

Delete is available but cancelling is usually better — it keeps the record and
stops the buzzing. Deleting a **visit** keeps any follow-ups it created: a promise
you made does not stop existing because you deleted the note about the meeting.

### People and phone numbers

Contacts are real records: name, role, phone, email, notes, and the place they
belong to. Anyone you name while logging a visit is created inline in the same
transaction — a phone number captured in a car park is the most perishable thing
in the whole flow, so it never sits as free text waiting to be re-entered.

A commitment inherits the contact from its visit, which is what makes **Call**
possible: it appears on the Today card, on the person's profile, and as an action
button on the reminder notification itself. The service worker cannot dial, so the
Call action deep-links into the app, which then opens `tel:`.

Deleting a contact keeps their visits and follow-ups — removing someone from your
address book should not erase the record that you met them.

### Finding the business at a location

`POST /places/lookup` answers "what businesses are at these coordinates?" from an
external provider. Results are only suggestions: nothing is written until you pick
one and save the visit, which then stores the name, address, phone, category, and
which provider it came from.

| Provider | Setup | Coverage |
| --- | --- | --- |
| OpenStreetMap (Overpass) | none, works out of the box | good for hospitals and chains, patchy for small Indian clinics |
| Google Places | `GOOGLE_PLACES_API_KEY`, billing enabled | much better, especially for small practices |

`PLACE_LOOKUP_PROVIDER` is `auto` by default: Google when a key is present,
OpenStreetMap otherwise. Set it to `none` to turn the suggestions off.

Worth being precise about the limit: **there is no public API that maps
coordinates to a registered company.** GST and MCA registry data is not queryable
by location. What these providers return is point-of-interest data — trading name,
address, phone, category — which is what is actually useful in the field. Results
are cached for ten minutes per rounded coordinate, because Overpass asks not to be
hammered and GPS jitter would otherwise fire a request per reading.

### Voice notes

Two separate things, neither of which needs an AI service:

**Recording** (`lib/audio.ts`) uses the browser's `MediaRecorder`. The clip is
uploaded as a raw body, stored in Postgres as `bytea`, and played back through a
blob URL — an `<audio src>` cannot send an `Authorization` header, so the bytes
are fetched with one and handed to the element. Nothing leaves your server.

**Dictation** (`lib/dictation.ts`) uses the browser's own Web Speech API. No key,
no cost, no integration — but Chrome and Edge stream the audio to Google to
transcribe it, so this one is *not* local. The button hides itself where the API
does not exist (Firefox). Recording is the private option; dictation is the
convenient one.

Deliberately **not** built: server-side transcription (Whisper, Deepgram, and so
on). That is the only version that would need an API key and per-minute billing.
The `transcript` column already exists, so adding it later means one service and
one call — no schema change.

Clips upload as they are recorded, which means abandoning the capture form leaves
audio with nothing pointing at it. An hourly sweep deletes unattached clips older
than a day. Deleting a visit cascades to its clips.

Both `getUserMedia` and geolocation need a secure context, so on a LAN IP you will
need a tunnel — same caveat as GPS above.

### Working offline

Log a visit with no signal and it is saved to IndexedDB, then sent when the
connection returns — on the `online` event, on tab focus (a phone waking from
sleep often never fires `online`), and on a 60-second backstop. The banner shows
what is still waiting.

The part that matters most is **idempotency**. A phone can send a visit, lose
signal before the response arrives, and send it again on the next sync. Every
visit carries a `clientId` generated once on the device; the server keys on it
and returns the visit it already stored rather than creating a second one.
Without that, a flaky connection quietly produces duplicates.

Other decisions worth knowing:

- **Place matching runs on the device when offline.** It is distance arithmetic
  over places we already cache, so it has no business needing a connection.
- **Voice notes recorded offline** are held as blobs in the outbox entry and
  uploaded before the visit that references them.
- **A clash discovered during sync is forced through** with `allowConflict`. The
  user cannot be asked hours later, and losing the visit is far worse than a
  double-booking — the overlap shows up on Today for them to sort out.
- **`navigator.onLine` is only a hint.** It is honest about airplane mode and
  optimistic about everything else, so a captive portal still reports online. The
  outbox decides on whether a request actually succeeded, not on that flag.
- **API responses are not cached by the service worker.** A stale reminder list
  is worse than none. Only the app shell is precached, so the app boots offline;
  reference data is cached deliberately in IndexedDB.
- Entries the server *rejects* (a 4xx that will never succeed) are parked and
  shown with a Discard button rather than retried forever.

### Learning your pattern

The capture screen used to ask you to describe what happened. For any place you
have been before, it now proposes what probably happened and lets you correct it:

> **You're at Sunrise Skin Clinic** · Visit 6
> Last time you met Dr. Sharma, marked it Interested, followed up after 3 days.
> Repeating that books "Call back Dr. Sharma" for Aug 22, 4:00 PM.
> **[ Same again ] [ Something else ]**

**Same again** logs the visit and schedules the follow-up in one tap. It posts to
the ordinary `/visits` endpoint, so it inherits the conflict check, idempotency
and offline queueing — and if the usual slot is taken it shifts to the next free
one rather than dumping you back into the form.

`GET /places/:id/suggestion` derives all of it from history, with no model
involved (`services/suggestion.ts`):

- **Contact** — who you deal with here most often, not just whoever you saw last.
- **Outcome** — the most common one at this place.
- **Follow-up gap** — the **median** across past visits. A mean would let one
  "call me in six months" wreck every future suggestion; in testing, four visits
  of 3.2, 3.2, 3.2 and 90 days give a median of 3.2 where the mean is 24.9.
- **Time of day** — carried over from the last follow-up, applied in the device's
  timezone (the server never guesses at that).

Confidence is `strong` only with two or more prior visits *and* a follow-up to
copy. Below that the card stays hidden rather than guessing — but the long-hand
form is still prefilled from whatever history exists.

Location also fires automatically when the screen opens, though only once
permission has already been granted; prompting unasked on first open would be
rude, and someone logging a phone call from a desk does not want it.

### The evening nudge

Once a day, in the user's own evening (7pm by default), a notification asks
whether anything went unlogged:

> **Anyone you visited today?**
> Nothing logged yet · 2 overdue. Two taps if it was a repeat visit.

> **3 visits logged today**
> Anything you missed? · 1 still due today

This closes the hole in the middle of everything else: nothing can detect that
you visited a clinic and never logged it, because a browser cannot watch your
location in the background. Asking is the honest substitute.

Mechanics worth knowing (`services/dailyNudge.ts`):

- **Fires in local time.** Users carry an IANA timezone, set automatically from
  the browser on sign-in, so nobody picks one off a list. Postgres does the
  comparison with `now() at time zone u.timezone`.
- **Once per day, guaranteed.** `last_nudge_on` stores the *local* date, and the
  row is marked before the push is attempted — a failed notification is a much
  smaller problem than nudging someone in a loop because the send threw.
- **A four-hour window.** Without it, a worker that was down overnight would come
  back up and nudge everyone at 3am.
- Settings (top bar) turn it off, move the hour, and fire one immediately to
  check the wiring — scoped to the caller, touching no stored preferences.

### Typing it in plain words

The **Coming up** form opens on a single box. Type `dentist friday 6pm` and it
shows what it understood — title, resolved date, duration — with a **Use this**
button. Nothing is applied until you accept it, so a wrong guess is always
visible before it can do damage.

`packages/shared/src/parseWhen.ts` is a plain deterministic parser, not a model:
same answer every time, works offline, costs nothing, and is debuggable when it
gets something wrong. It handles weekdays, `tomorrow`, `today`/`tonight`,
`in 3 days`, `next week`, `25 dec`, day-first `5/9`, 12- and 24-hour clocks,
parts of the day, and `for 45 min`. It returns `null` on anything it does not
recognise rather than guessing.

Conventions it commits to, because English is ambiguous here:

- A bare hour reads the way people speak: **1–7 is afternoon, 8–12 is morning**,
  so `friday 6` is 6pm and `friday 9` is 9am.
- A bare number is only read as a time when a date anchors it or an `at`
  precedes it — `order 5 boxes` is not 5 o'clock.
- `friday` is the soonest Friday; **`next friday` always skips a week**, so the
  two never mean the same day.
- With no time given, 9am is assumed and the preview says *time assumed*.

Run the suite (29 cases, covering every convention above):

```bash
npm test
```

### Understanding a whole dictated sentence

`parseWhen` finds a date in a phrase. It cannot read a paragraph, and no amount
of extra patterns will fix that — this genuinely needs a language model:

> travelling to Mathura for 3 days training initial 2 days first and second for
> awareness session and third september for internal committee capacity building

That is four entries, with a month mentioned once that applies to all of them.
`POST /ai/extract` returns them as **proposals**; the user ticks what they want
and only then is anything written. A misread date should cost a rejected
suggestion, never a wrong entry in a real calendar.

**It is off by default and costs the operator nothing**, because each org brings
its own provider:

| Provider | Setup | Cost |
| --- | --- | --- |
| `none` (default) | nothing | free — parser only |
| `anthropic` | the org pastes its own API key | ~₹0.15 per long sentence, billed to them |
| `ollama` | an address for a local model | free, and nothing leaves the machine |

Only text `parseWhen` cannot read, and longer than 25 characters, offers the
fallback at all. `dentist friday 6pm` never costs a call.

**The stored key is encrypted at rest** (AES-256-GCM, keyed off `ENCRYPTION_KEY`
— see `src/secrets.ts`). It is the customer's key: a database dump must not hand
it over, and the API returns only a masked hint, never the value. Without
`ENCRYPTION_KEY` set the server refuses to store a key rather than falling back
to plain text.

Extracted events are saved with `allowConflict`, since sessions inside a trip are
meant to coexist. Anything the model returns that would not survive contact with
the database — an unparseable date, an empty title, an unknown kind — is dropped
before it reaches the user.

### Trips and the "while I'm there" list

The feature the rest of the app exists to support.

Months before any trip, you save a wish with **no date at all**:

> When I go to Mathura, I want to try the peda.

It is deliberately *not* a reminder for tomorrow. It sits in `intentions`,
dateless, until a trip to that place exists. Plan one, and it surfaces:

> **3 things saved for Mathura** — Visit Banke Bihari Temple · Try famous peda ·
> Visit the local market

Matching is case-insensitive on the label, because "Mathura" typed in June and
"mathura" typed in October are obviously the same intent.

Decisions worth knowing:

- **A trip is a container, not a task.** It earned its own table because
  containment is a relationship, not an attribute — unlike fixed/flexible, which
  is just a column.
- **Scheduling a wish keeps it flexible by default.** "Visit the temple one
  evening" should not be pinned to 6:00 PM against your will.
- **Deleting a trip detaches its plans rather than deleting them**, enforced by
  `on delete set null`. Cancelling a journey does not cancel the dentist
  appointment you filed under it — the UI says so, and says how many survived.
- **Strictness** (`strict` / `flexible` / `tentative`) records how fixed being
  there really is, which is what a location-conflict check will weigh later.

**Trips** in the nav is the journeys dashboard: what is coming, how many days
away, what is planned, and what is still only wished for.

### Location and travel conflicts

Two independent checks, because they answer different questions.

**Against trips — needs no coordinates.** If you have said you will be in
Mathura on the 13th and something lands in Jaipur, that is worth mentioning
however far apart they are. Severity comes from the trip's own strictness:
`strict` → impractical, `flexible` → tight, `tentative` → worth a look.

**Against neighbouring plans — needs coordinates.** Two fixed things in
different towns with a gap too small to travel between:

> Only 2 hours between Conference and the other, but the journey is about
> 264 km — roughly 6.4 hours.

Deliberate decisions:

- **Estimates, not routing.** Straight-line distance × 1.35 for winding roads,
  divided by `TRAVEL_SPEED_KMH` (default 45), plus 30 minutes of overhead. The
  UI says *"estimated, not a routed journey"* rather than implying precision
  nobody has. A maps provider is the upgrade, not a prerequisite.
- **Typed place names resolve themselves** through OpenStreetMap's free
  geocoder, cached forever in `geocode_cache` — cities do not move. Misses are
  cached too, so an unresolvable label is not retried on every keystroke; a
  *network failure* is not, because that would poison the cache permanently for
  a temporary problem.
- **No double reporting.** An event that overlaps in time is reported by the
  time check and skipped by the travel check.
- **Under 25 km apart is the same town**, and not worth a travel warning.
- **Nothing is ever blocked.** Every location conflict offers *Keep both / Move
  this one / Adjust the trip / Mark tentative* and says so explicitly. The app
  notices; the user decides.

## Saying how long a trip is

A date range gets written several ways and the parser only read two of them.
The one it could not read was the commonest: **the month named on both sides**.

```
visiting agra for 3 days on 2 oct to 4 oct   ->  Trip to agra, 2 Oct - 4 Oct
2 oct to 4 oct trip to agra                  ->  the range may come first
oct 2 to oct 4 going to agra                 ->  month-first, both sides
going to Goa 30 dec to 2 jan                 ->  crosses into the next year
going to agra for 3 nights from 2 oct        ->  a length instead of an end
```

"30 to 2" is only backwards when both dates are in the same month, so a range
that crosses one is accepted and rolled into the next year where it has to be.
A range that really does run backwards — "14 oct to 12 oct" — is still refused
rather than silently swapped.

**Three days and three nights are counted differently**, because people say them
precisely: three days from the 2nd ends on the 4th, three nights ends on the
5th. And the length never ends up in the name — "Agra for 3 days" is a place and
a duration, not a place called "Agra for 3 days".

## Reading the roles out of a sentence

> create appointment for dentist who lives in sirsi regarding software application demo

That carries four separate facts — **what kind**, **who**, **where**, **what it
is about** — and until now all four went into the title as one string. The app
then knew nothing: no place to check travel against, no person to offer a call
button for, no subject to recognise next time.

`extractRoles` reads them out:

| | |
| --- | --- |
| Read as | appointment |
| About | software application demo |
| Who | dentist |
| Where | sirsi |

**Deliberately a grammar, not a model.** Role markers in English are a small
closed set — *with*, *for*, *regarding*, *about*, *who lives in*, *at*, *in* —
and a grammar is instant, free, private, works offline, and can show which words
produced which field. That last part is the one that matters: every extraction
comes back with its evidence, so a wrong reading is visible before it is saved
rather than discovered later. The optional LLM path already exists for sentences
a grammar genuinely cannot carry.

**The ambiguity is "for".** "for dentist" is a person; "for the quarterly
review" is a subject. The marker alone cannot tell them apart, so an occupation
lexicon does — weighted towards the people someone in India actually books time
with, and extended by any contact already in the app.

**It only claims roles when the sentence has structure.** "call mom" has two
findable fields and no markers; reading it as a kind and a person turned a
two-word capture that already worked into "Call with mom", which is worse.
A marker word is now required, so ordinary short sentences go to the plain
parser untouched.

### It only has to be told once

A person named in the sentence becomes a real contact, with where they are
remembered against them. Say *"the dentist who lives in Sirsi"* once, and the
next *"appointment with the dentist"* already knows:

> Where: sirsi — *You said dentist is in sirsi before.*

A place named explicitly always wins over a remembered one, because it is what
the person just said. A remembered place fills a gap; it never overwrites.

### It asks rather than invents

When everything is understood except the time, the capture box says so and
offers four one-tap answers instead of refusing or guessing an hour. That is the
only field history genuinely cannot supply — and the only one worth a question.

## Lists attached to a plan

> go shopping this evening: milk, bread, peda and eggs

Some plans carry a list — the shopping, the packing for a trip, the three
points to raise in a meeting. That used to go into the notes as a sentence,
where nothing could be ticked and the half already done looked exactly like the
half still to do.

A colon or a dash introduces the list; the items come off before any other
parser sees the sentence, so the date parser reads "go shopping this evening"
rather than something with four commas in it. Items are ticked one at a time,
flipped on screen immediately and written in the background, because a tick
that waits for the network feels broken in a shop with one bar of signal.

**The danger is entirely false positives**, so the rules are strict: a colon
alone is not enough, there must be at least two items, and a comma without a
colon is just a sentence. `standup at 9:30`, `client call: https://meet…` and
`call mum, dad and the bank` are all left alone. Turning one plan into five is a
worse failure than making somebody type the list separately.

Items are their own rows rather than a JSON column — ticking one should be a
single cheap write, not a read-modify-write of the whole list from a phone.

## Talking about your day the way you do

Nobody thinks "14:30". They think "after lunch", and "once the standup is
done". A planner that only accepts clock times makes you do that translation —
which is the work it was supposed to take off you.

Two kinds, split because they resolve differently.

**Conventions** mean the same thing to everyone and need no lookup, so they
live in `parseWhen` with the rest of the fixed vocabulary: *first thing*, *end
of day*, *before/after lunch*, *over lunch*, *after work*, *after dinner*,
*before bed*, *at dawn*. Each carries its window, so "after lunch" is an
afternoon, not a claim about 2:00 PM exactly, while "end of day" is a deadline
and stays precise.

**Anchors** depend on what is actually in your calendar, so `parseRelative`
only identifies the reference and the server resolves it against the day:
*after the standup*, *before my first meeting*, *30 minutes after sprint
planning*, *once the client review is done*. Named anchors match on the best
title in that day rather than the first, because a day holding both "standup"
and "sprint planning" should not answer "after the standup" with whichever came
earlier.

**It refuses rather than inventing.** If the anchor is not in that day you get
*"I could not find 'sprint planning' in that day to go after"* — a reminder
pinned to a meeting that does not exist is worse than one you timed yourself,
because it looks like it worked. A bare "after the meeting" is also declined:
a day with four of them cannot answer it.

## Who owns the account

The AI provider, its endpoint and its API key live on the **org**, not the
person — one credential, one bill, everyone's usage. They were on the same
Settings page as "when does my evening start", which is a question of an
entirely different kind: in a deployment with more than one person on it, that
is somebody else's key and somebody else's money.

So users have a role. Registering creates the org, so whoever did that is its
`owner`; anyone else is a `member`. Owners alone can change the provider, store
a key, list local models, or run the test that spends credit.

**A member is shown one line, not a disabled form.** "Switched on by your
account owner" is the whole of it — no provider chips, no key field, no test
button. Greying out controls somebody cannot use just invites a fight they
cannot win.

The role is read from the row on every request, never from the token. A role
signed into a thirty-day JWT stays true for thirty days after it stops being
true, and the one place that matters is the one place it must not: removing
someone's access has to take effect on their next request, not next month.

The column **defaults to `member`**, which is the direction that fails safely —
registration sets `owner` explicitly, so anything arriving by a path nobody has
written yet gets the lesser of the two.

## Search

One box across everything that holds words: commitments and their notes, trips,
saved intentions, contacts, places, repeating plans and logged visits. All of it
was write-only — months of data and no way back in except scrolling, so "what
did I agree with Ramesh?" was unanswerable with the answer sitting right there.

There is a real field at the top of the dashboard, and the same thing in the
top bar as a bordered control with a magnifier, opened by **Ctrl/Cmd+K** or a
bare **`/`**. The dashboard one stays quiet until it is used — no helper text,
no empty state, nothing but one line — and it does not steal focus on arrival,
because somebody opening their day came to read it, not to type. It began life as a text link next to
"Settings" and "Sign out", where it was invisible — three words of chrome in a
row and nobody read the middle one. On a phone it shrinks to the icon alone,
since the bar is tight and there is no keyboard to shortcut with.

Plain `ILIKE` rather than full-text search: no extension, no index maintenance,
no stemming surprises, and at the scale of one person's calendar the difference
is unmeasurable. Ranking happens in SQL rather than afterwards, because it has
to survive the per-table limit — ranking only what came back would mean the best
hit was sometimes cut before anyone saw it.

## People, and which one you meant

> call the plumber tomorrow at 11am regarding the leaking tap

**Two plumbers is a question, not a coin toss.** The capture box answers
*"Which one? 2 people match 'plumber'"* and offers them with their roles and
numbers. One tap rewrites the sentence to name them, and the next read resolves
to exactly one. Guessing would put the plan against a stranger and offer you
their phone number.

Three things had to be true for that to work:

- **A job is a role, not a name.** The `contacts` table always had a `role`
  column and role extraction never used it — "plumber" went in as the name, so
  nothing could ever match on it. Occupations now go where they are findable,
  and the contact is named "The plumber" until someone says which plumber.
- **Lookups match either column.** Saying "the plumber" twice used to make two
  of them, the second stored under a name nobody would search for.
- **A known name needs no marker word.** The role grammar only spots a person
  where a marker puts one — "with Ramesh", "for the dentist". But "call Ramesh
  Yadav tomorrow" has no marker and he is sitting in the contact list with a
  phone number, so the sentence is checked against the list itself. That is both
  more reliable than guessing from capitalisation and the thing that makes the
  Call button appear.

### Importing from your phone

**People → Import from my phone** opens Android's own contact chooser through
the Contacts Picker API. It is a picker, not a sync, and the difference is the
whole point: there is no background access, no standing permission, and nothing
is read that you did not tap. The button says so underneath itself rather than
implying a sync that cannot exist.

It needs all of these, so the button explains itself when one is missing:

| | |
| --- | --- |
| Browser | Chrome or Edge on **Android** — not desktop, not iOS, not Firefox |
| Connection | a secure context: https, or localhost while developing |
| Trigger | a real tap; called from a timer it silently does nothing |

Only `name`, `tel` and `email` are requested. A picker that asks for addresses
and photos in order to store a phone number is asking for trust it has not
earned.

**The valuable half is matching, not inserting.** Anyone named in a sentence
already became a contact here with no phone number — which is exactly why the
Call button never appeared. Importing the same person fills that gap in rather
than sitting a duplicate beside it, matched on name without regard to case.

**An existing number is never overwritten.** The one already here was typed
deliberately; the phone's may be an old landline nobody has removed. Importing
only ever adds detail, and says which: *"1 added, 1 filled in, 1 already
complete."*

## Moving something you missed

An overdue card used to offer **Done**, three sizes of snooze, and **Edit**.
Snoozing by fifteen minutes is precisely what has already failed — four times
over, on the item that prompted this — and Edit means filling in a form to
answer a question the app can answer itself.

An overdue card now offers **Move it** instead of the snoozes, and it proposes
three times that are genuinely free:

> Next 30 minutes you are free
> `Today 6:30 PM`  `Tomorrow 9:00 AM`  `Tomorrow 11:30 AM`
> Pick another time · Cancel

One tap reschedules it and starts a fresh reminder chain from the new time.
Snoozes stay on everything that is not yet late, where "push it an hour" is a
perfectly good answer.

**"Free" now means one thing.** Three screens were each working it out
separately — the triage panel, tomorrow's plan, and this — so it lives in
`services/freeSlots.ts` and they all ask it. The rules that took the most
thought:

- **The item being moved does not block itself.** Its own old time would
  otherwise rule out the best answer.
- **The offers are spread apart.** Three slots half an hour apart on the same
  afternoon is one choice presented three times.
- **All-day and flexible items claim nothing**, exactly as in the clash check.
- **A window asked for but unavailable does not mean no answer** — it offers
  times outside it and says that is what it has done.
- **Fewer, not worse.** Nothing free for a fortnight is a real answer and is
  returned as one.

## Admitting the nagging failed

The whole promise is "nothing gets dropped", and the mechanism is an escalating
chain of reminders. But that chain is **finite**: after `MAX_ESCALATIONS` it
stops queuing and goes quiet, and the commitment sits in the overdue list for as
long as the account exists. Something thirty-three days past is not being
chased — it is being accumulated. The app had become very good at growing a red
list and had nothing to say about it.

So there is a reckoning rather than another reminder. `GET /api/triage` finds
what has stopped moving, says why it thinks so, and offers the four things that
can actually be true:

| | |
| --- | --- |
| **Already did it** | closes it and stops the chasing |
| **Give it a real slot** | moves it to a genuinely free hour, fresh reminder chain |
| **No deadline** | still yours, stops pretending to have a date, stops buzzing |
| **Not happening** | cancelled, never deleted |

**Where the line sits is the whole design.** Something a day late with one
reminder sent is not stuck — the mechanism is still working, and calling it
dead would make the app defeatist. Something chased to the end of the chain is
stuck immediately even if it is only two days old, because the thing that was
supposed to handle it has already given up. Items that are merely late are
counted separately and said out loud, so the framing stays honest.

**The diagnosis names evidence rather than asserting a verdict:**

- *"Chased 4 times and still open. The reminders are not working for this one."*
- *"It has never had a real time, so nothing ever forced the issue."*
- *"Due on a Friday, which is where your plans reliably slip."*

**What it suggests scales with how dead the thing is.** Merely old is worth
another go. Chased out means stop pretending it has a deadline. Six weeks past
*and* chased out is not happening, and saying so is more use than a sixth
reminder.

**It does not make the mess worse while clearing it.** Proposed slots are
consumed as they are handed out — the first version offered all four stuck
items the same free hour, so accepting the lot would have booked them on top of
each other. Dropping cancels rather than deletes, because what you decided not
to do is part of the record and the pattern of what you drop is worth being
able to look at.

Nothing here scolds. The copy says plainly that this is the app's failure at
least as much as the person's, because it is.

## The evening nudge plans tomorrow

It used to ask *"Anyone you visited today?"* — a question, pointed backwards,
arriving at the moment anyone has least appetite for it.

It now arrives with the thinking done:

> **Tomorrow is 25% booked**
> 3 things have no time on them. I found slots for all of them, starting 9:55 am.

Tapping it opens the plan: every loose item placed in a real gap with its
reasoning next to it — *"Your first free afternoon stretch, 12:00 pm to 5:00
pm"* — and one button to accept, or Skip on any individual one. Nothing is
written until you say yes, because an assistant that rearranges your day
unprompted is not one.

The placement rules, all of which the tests pin:

- **The stated window is honoured.** "This afternoon" means something.
- **The awkward item goes first.** Filling the day with quick wins strands the
  three-hour one.
- **Placing something splits the gap around it** rather than truncating the
  front — an afternoon task placed at noon inside an 8am-to-9pm gap used to
  destroy the entire morning, and the next item was told there was no room in a
  day that was almost entirely empty.
- **Nothing it cannot fit is dropped silently.** "No afternoon gap long enough
  for 90 minutes" is the useful answer.
- **A flexible item that already slipped is picked up too** — a task from last
  week is exactly what wants a slot tomorrow.
- **A stale plan never overwrites a time you set by hand** between seeing the
  plan and accepting it. Your choice wins.

## Capture in one line

Type it, press Enter, it is planned.

The capture screen used to ask seventeen questions to save "dentist friday
6pm" — what kind of thing, how long, how important, whether the time was fixed,
where, and so on. Nearly all of them were answerable from the sentence itself or
from what this person had already done, and asking anyway meant the app cost
more time than it saved. That is not an assistant.

`POST /api/quick` takes the sentence and does the rest: reads it, fills the gaps
from history, saves it, and reports every assumption it made. The full form is
still there behind **Set it up in detail instead**, for what a sentence genuinely
cannot carry — a place from your saved list, a specific person, an all-day span.

**It remembers you.** `services/memory.ts` looks for things you have planned
before with a similar title and reuses what it finds: how long a dentist
appointment actually runs, which clinic, what time you always go to the gym.
Built on your own rows and nothing else — no model, no service, no shared
corpus — so every guess is arithmetic over things you did, and every one is
shown in plain words before it is saved.

**Knowing when not to guess is most of the work**, and most of what the tests
cover:

- Four different hours is not a routine, so no time is claimed.
- A four-hour gym session does not drag the usual duration upwards; the answer
  is the median, not the mean.
- One precedent is offered in weaker words than a habit — *"Last time this was
  at 2:30 pm"*, not *"you usually"*.
- A single occurrence still prefills quietly but says nothing out loud, because
  "You have done this 1 time before" costs attention and returns nothing.
- History older than a year is a different era of someone's life and is ignored.
- Editing something never learns from itself.

**"Buy milk" works.** A bare intention with no clock time becomes a flexible
item for the current part of the day rather than being rejected — it is the
commonest thing anyone types into a planner, and refusing it because it lacks a
time is the app serving its data model instead of the person.

Everything saved this way is one keystroke from **Undo**, which is what makes
the speed safe rather than reckless.

## The brief

The first thing on the screen, and the reason the app is not a list.

Everything the planner knows was, until recently, only visible if you already
had weeks of data and went looking for it. Conflict detection ran at the moment
of saving. Travel estimates existed only inside a warning nobody had triggered.
The fact that things slip on Fridays was in the database and nowhere else. A
tool that notices all of that and says none of it is indistinguishable from a
notes file — which is exactly how it read to someone seeing it for the first
time.

`GET /api/insights` reads the same data and reports what stands out: an
impossible journey between two bookings, the weekday your commitments actually
die on, a trip five days out with three wishes attached, how much of the day is
genuinely free and where the longest clear run is. Each insight carries the
evidence it was drawn from, because an observation a person cannot check is one
they will stop believing.

**Restraint is the hard part, and most of what the tests cover.** An empty
account is told nothing rather than reassured that nothing is wrong. Six misses
across six different weekdays is noise, not a Tuesday problem, and goes
unremarked. A trip with nothing waiting for it says nothing at all. A panel that
manufactures observations teaches the reader to skip it.

Once the day is spent the brief rolls forward to tomorrow — a 0% dial at eight
in the evening is accurate and worth nothing.

### Sample data

An empty planner cannot demonstrate a planner. **Show me with sample data** on a
new account writes a realistic week — a day partly booked, two appointments
200km apart with an hour between them, four things dropped on Fridays, a trip to
Mathura with three wishes saved for it, a weekday standup — so every judgement
the app makes has something to work on. It is placed relative to the clock
rather than at fixed hours, because a demo run at six in the evening with
meetings pinned to 10am shows an empty day and three overdue items, which is the
opposite of the point. It is marked throughout, labelled on screen as sample
data, and removed in one click.

## Three ways to look at the same day

The dashboard has a **List / Week / Month** switch. The choice is remembered, so
someone who thinks in months does not re-pick it every time.

- **List** is the working view: what is overdue, what is left today, what is
  next, and the buttons to act on any of it.
- **Week** and **Month** are for shape — where the gaps are, what a day already
  holds before you book into it. Tapping a day opens what is on it; tapping an
  item opens it for editing.

**Trips are drawn across the days they cover.** They live in their own table
and were, for a while, simply never fetched by the grid — so a planned trip was
invisible on the one screen whose job is showing what a day holds. A trip is
the strongest "that day is spoken for" the app knows about. It heads each day's
cell above the tasks, in its own colour, and is not clickable there because a
trip is edited on the Trips screen.

The window test is overlap, not "starts inside it": a trip already under way has
to show on today, or today looks free while you are away.

**One colour language across all three.** A card's left edge and its chip in the
grid always agree: red is overdue, amber critical, purple repeating, teal from a
subscribed calendar, blue an ordinary plan. Switching views never means
relearning what anything means.

**Desktop is not a tall phone.** Above 900px the tab bar comes up off the
bottom of the screen and becomes real top navigation, the container widens to
1100px, and the grid takes that room while prose and cards stay at a readable
800px. Month cells are sized so a whole month clears an 800px-tall window —
a month grid you have to scroll is no better than the list.

**The views change shape on a phone rather than shrinking.** At 375px a month
cell is 46 pixels wide — every event title clips to nothing and seven columns of
a week are unreadable. So the month grid shows coloured dots and opens the day
on tap, and the week becomes one row per day. Which layout to use is measured
from the calendar element itself with a `ResizeObserver` (plus a window-resize
fallback), not from a media query: the real question is how much room *this*
element has, and `matchMedia` change events do not always arrive when the
viewport is driven externally.

The grid fetches `GET /commitments/range`, which is separate from `/agenda` on
purpose. The agenda answers "what needs me now" and deliberately caps what is
ahead; a month grid needs every item in its range or it draws a lie.

## Repeating plans

Say it once. `standup every tuesday at 10am`, `pay the rent on the last day of
every month`, `gym on mondays and thursdays`, `book club on the second tuesday
of every month`, `physio every tuesday 6 times`, `team sync every other friday
until 15 December`.

**The rule is stored; the occurrences are real rows.** A recurrence writes
ordinary commitments into the calendar ahead of time rather than being expanded
on read. That is the whole design — the reminder worker, conflict detection,
editing and the Today screen carry on with no idea recurrence exists. The
alternative would have meant teaching every one of those about virtual
occurrences, and the nag engine in particular has nothing to queue a reminder
against unless the row is there.

A rolling 120-day window is kept topped up by an hourly sweep, so an unbounded
weekly rule does not write a thousand rows the day you create it. Generation is
idempotent — a unique index on `(recurrence_id, occurrence_on)` means running
the sweep twice, or running two API instances, cannot produce a duplicate.

**Decisions worth knowing about:**

- **A short month pulls the date back; it never skips.** "The 31st" fires on
  28 February. This diverges from RFC 5545, which skips such months entirely —
  for a personal planner that is plainly wrong, because a month with no rent
  reminder at all is a worse failure than one that lands on the 28th.
- **"Every second Tuesday" is ambiguous, and the two readings drift apart.**
  *Every other Tuesday* and *the second Tuesday of the month* agree for about a
  month and then never again. `every second tuesday of the month` is read as the
  monthly one; `every other tuesday` as the fortnightly one.
- **"Change just this one" survives changing the series.** Editing a single
  occurrence marks it detached, and regenerating from an edited rule leaves it
  alone — otherwise the next edit would silently undo it.
- **Stopping a series keeps its history.** Future untouched occurrences go;
  anything already completed stays, because eight attended classes are still
  eight attended classes.
- **One card on Today, not seventeen.** The Coming-up list collapses a series to
  its next occurrence and marks it `· repeats`. The full series lives on the
  **Repeating** screen.
- **A repeat it is not sure about is one it does not create.** `take medicine
  every 8 hours` and `every 1st and 15th of the month` are both rejected rather
  than half-understood — the rule shape holds one time of day and one month day,
  and quietly dropping the other half is the failure mode this parser exists to
  avoid.

## Reading your Google Calendar

Settings → **Calendars I read**. Three ways in, because the first one is not
always available and the second one is slow.

**Connect your Google account.** One button, Google's own consent screen, then
pick which calendars to mirror. This is the route to use.

**By secret address**, for Apple, Outlook, or any calendar that publishes an
iCal link. In Google Calendar it is **Settings** → your calendar under
**Settings for my calendars** → **Integrate calendar** → **Secret address in
iCal format**.

**By uploading an exported `.ics`**, which always works. A Google Workspace
administrator can switch off external sharing, and doing so removes the secret
address from the UI entirely — on a managed work account there may be no link
to copy at all. A calendar you do not own never had one either. Exporting is
unaffected: **Settings** → **Import & export** → **Export** gives a .zip with
one .ics per calendar. The trade is that a file is a snapshot — it updates when
you upload a newer export (**Replace file**), not on a timer, and the scheduled
sweep skips file-sourced calendars rather than failing on them every half hour.

Both routes share the same parser, dedupe and reminder handling; only how the
events arrive differs. Re-uploading updates in place rather than duplicating,
because the key is the event UID, not the delivery method.

Read-only, one way. Cue mirrors the feed and never writes back, so a bad
sync can show a stale meeting but can never touch what your colleagues see.
Re-reading is an update rather than a pile of duplicates because every event
carries a stable UID, which is the dedupe key.

**Why connect rather than paste a URL?** Freshness, mostly. **Google
regenerates the iCal feed slowly** — often hours behind, occasionally a day — so
a pasted address is fine for seeing your week and useless for something booked
ten minutes ago. The API answers immediately. It also works on accounts where
the secret address is not offered at all.

### Setting it up

Free, and not a billed API key. At `console.cloud.google.com`: enable the
**Google Calendar API**, then **Credentials** → **Create credentials** → OAuth
client ID → **Web application**. Put the client id and secret in `.env`, along
with `ENCRYPTION_KEY`.

The **authorised redirect URI must match exactly**. In production that is your
own domain; in development it is the *API* port, not the web one:

```
http://localhost:3002/api/oauth/google/callback
```

Cue derives this from `VITE_API_URL`, which is already set in development and
blank in production — so the same `.env` is right both times and
`GOOGLE_REDIRECT_URI` normally stays empty.

While the consent screen is in **Testing**, only accounts listed as test users
can connect. Add your own, or the sign-in is refused with a message that does
not explain why. Publishing it for other people needs Google's verification —
privacy policy, homepage, demo video, review — which is worth knowing before
promising it to anyone.

### What it asks for, and what it does with it

**Read-only, and nothing else.** The scope requested is
`calendar.readonly`. Cue mirrors a calendar and never writes to one, and asking
for permission it will not use is how a consent screen teaches people to stop
reading consent screens. A test asserts the read-write scope is never requested.

**The tokens are credentials.** A refresh token is a standing grant to read
somebody's calendar, so both tokens are encrypted at rest with `ENCRYPTION_KEY`
and never sent back to the browser. **Disconnect** hands the grant back to
Google as well as deleting it here — otherwise Cue would sit in that person's
Google permissions forever, looking like it still had access.

**Three ways in, one set of rules.** The API path converts Google's JSON into
the same shape the `.ics` parser produces, and everything after that — the
history window, the upserts, removing what vanished, the skipped report — is
shared. A fix in one import path is a fix in all three.

Two things in that conversion are wrong in ways nobody notices, so both are
pinned by tests: an all-day end date is **exclusive** (a one-day holiday ends
the next day, and taken literally every holiday renders a day too long), and an
all-day date carries no timezone (read as UTC it lands on the previous day for
anyone west of Greenwich).

**A week cancelled in Google is a cancelled week here.** Google reports those
as separate records pointing back at the series; they are folded into the
series' exclusions rather than imported as events of their own.

**No `timeMin` is sent.** It is documented as a bound on an event's *end* time,
and the documentation does not say what that means for a series that began
years ago and still runs weekly — so it could quietly drop exactly the meetings
most worth mirroring. The window is applied afterwards, where a one-off outside
it is counted and reported rather than lost.

### Outlook, Microsoft 365 and Teams

**Connect a Microsoft account** the same way, and pick calendars from it. A
published ICS link or an exported file still work as fallbacks.

Register at `portal.azure.com` → **Microsoft Entra ID** → **App registrations**
→ New registration, platform **Web**, then add a client secret. The only
permission needed is the delegated Graph scope **Calendars.Read**. The redirect
URI, again exact:

```
http://localhost:3002/api/oauth/microsoft/callback
```

`MICROSOFT_TENANT` decides who may sign in — `common` for work *and* personal
accounts (the default), `organizations` for work only, or a tenant id to lock
it to one organisation.

**A Teams meeting is an ordinary calendar event.** Graph exposes the join link
as a field of its own, so it lands in the notes and is tappable straight from
the reminder. Nothing Teams-specific is needed to read one.

**Disconnecting Microsoft is only half a disconnect.** Microsoft publishes no
OAuth revocation endpoint, so Cue deletes its tokens and says where to finish
the job — pretending the permission had been withdrawn would be a lie.

**Microsoft writes Windows time zone names, and that was a real bug.** Outlook
stamps every timed event `TZID="India Standard Time"` rather than
`Asia/Kolkata`. `Intl` throws on those, and the parser used to fall back to the
server's own zone — so an 11:00 Pacific Teams meeting imported at 11:00 in
India. **Twelve and a half hours wrong, with no error anywhere**, which is the
worst shape a bug can take here: the screen looked completely normal.

Windows names are now mapped to IANA zones, so daylight saving is right too —
"Eastern Standard Time" in October is really EDT, and reading the name
literally would be an hour out for half the year. A zone that still cannot be
resolved makes the event **skip with a reason naming the zone**, rather than
being shown at confidently the wrong time.

### What Graph gets wrong if you let it

**Recurrence is a structured object, not an RRULE.** `relativeMonthly` with
`index: "second"` is "the second Tuesday" — read as an interval it becomes a
fortnightly rule and drifts off the real date within two months. `relativeYearly`
has no equivalent in Cue's rules at all, so it is **refused and reported**
rather than imported as something close but wrong on most of its dates.

**Timestamps carry seven fractional digits**, which `Date` will not parse. Left
alone, every single event from Microsoft fails to import.

**Times are a naive wall clock plus a separate zone name.** Cue sends
`Prefer: outlook.timezone="UTC"` so the normal case needs no conversion, and
falls back to the Windows zone lookup when a server ignores the hint.

### One connected-account table, not one per provider

Google arrived first and took the whole shape with it — `google_accounts`,
`google_account_id`, `google_calendar_id`. Adding Microsoft that way would have
meant a second table, a second near-identical token service and a second set of
routes: three copies of the same OAuth round trip, drifting apart the first time
one of them was fixed.

Nothing had connected yet, so the rename cost nothing and the flow is now
written once. What actually differs between providers — endpoints, scopes, a
couple of parameters — is a single config file, and the *only* provider-specific
code left is turning that provider's JSON into parsed events.

Two differences worth naming, because they are where a copied implementation
would have been quietly wrong: Microsoft has **no `access_type` parameter** (a
refresh token comes from the `offline_access` *scope*, and leaving it out gives
you a connection that works for an hour and then stops), and Microsoft work
accounts frequently carry **no `email` claim** at all, putting the address in
`preferred_username` or `upn`.

**The address is a credential.** Anyone holding it can read the whole calendar,
forever, with no sign-in. It is encrypted at rest with `ENCRYPTION_KEY`, the
same as an AI provider key, and never sent back to the browser — the UI shows
the host and a short fingerprint, not a slice of the URL.

**The server refuses to fetch anything internal.** The URL comes from a user and
is fetched from the server's own network position, so `https` is required,
redirects are refused, and the host is rejected if it resolves to loopback,
link-local (including cloud metadata at `169.254.169.254`), or any private
range. Without that check this feature would be a plain SSRF.

**What it does with what it finds:**

- **Repeating events reuse the recurrence engine.** An `RRULE` is translated
  into the same rule a typed "every tuesday" produces, so imported series get
  occurrences, reminders and conflict detection for free.
- **`EXDATE` is honoured.** Deleting one instance in Google removes that one
  here, and re-syncing does not bring it back.
- **An all-day `DTEND` is exclusive.** A one-day holiday is written
  `DTSTART 2 Oct / DTEND 3 Oct`; taken literally every holiday in an imported
  calendar spans two days.
- **A repeat it cannot model is skipped and counted, not approximated** —
  `FREQ=HOURLY`, several `BYMONTHDAY`s, `BYSETPOS` beyond "nth weekday". The
  count is shown so you know something was left out.
- **Mirrored all-day events are context, not tasks.** A public holiday has no
  Done button; it sits under **From your calendar** because it is why Thursday
  is a bad day to book something, not work you tick off.
- **Reminders are optional per calendar.** Off means Cue shows the events and
  counts them for clashes but leaves the buzzing to Google, which is already
  doing it.
- **Deleting is narrow.** An event that vanishes from the feed is removed here
  only if it is still ahead, still pending, and you have not edited it. Nothing
  you wrote yourself is ever touched by a sync.
- **Disconnecting removes what it brought in**, and nothing else. Your Google
  Calendar is not modified at any point.

Feeds are re-read every 30 minutes, and on demand with **Read now**.

## What happened

History used to read one table — visits, the things logged as *already done*.
So finishing something made it disappear. You ticked the dentist off, it sat in
"Closed today" until midnight, and then it was gone from every screen in the
app. A planner whose entire promise is that nothing gets dropped was quietly
forgetting the whole record of what you had done.

It is now one timeline of three things that are all, in plain words, "what
happened":

| Tag | What it is |
| --- | --- |
| **Logged** | a visit you recorded after the fact |
| **Done** | a plan you finished |
| **Cancelled** | a plan you called off |
| **Let go** | a plan you took off your list |

Entries sort by **when they happened, not when the row was written**. A plan
ticked off a week late belongs at the top of the timeline, not back where it
was originally scheduled, so each terminal state records the moment it was
decided and the timeline uses that. The tag and the time both follow whatever
you decided *last*.

The one value that can be missing is a row cancelled before those columns
existed; it falls back to its due time, clamped to now — otherwise cancelling
next week's dentist filed it under "what happened", dated "in 1 week".

Only visits are editable from here. A finished plan is edited by reopening it
from Today, which is where the reminder chain and the clash check live.

### Cancelled is not deleted

These were the same thing and should not have been. Marking something cancelled
dropped it off the calendar *and* filed it as "let go", while deleting wiped the
row and left no trace at all — both wrong, in opposite directions.

**Cancelling keeps the plan.** It stays on Tuesday with a line through it,
because seeing it there is how you know the slot is free and why. It stops
reminding you, stops counting as overdue, and releases the time for anything
else you schedule.

**Deleting takes it off your lists** — calendar, search, contact and trip
screens — but the row survives, and History shows it as *let go*. That is the
one tag that means "I am not doing this", which is why triage's **Not happening**
deletes rather than cancels.

The editor spells the difference out at the moment of choosing, because it is
not guessable from two buttons.

The single hard delete left is **Undo** straight after capture — undoing a
two-second-old mistake should not leave a trail.

Nearly every query already filtered `status = 'pending'`, so cancelled items
stopped blocking slots and nagging for free. Deletion rides on the status
column rather than a separate `deleted_at` flag for exactly that reason: a
`deleted_at` column would have left every existing "give me the pending ones"
query quietly including deleted rows.

## The list screens

People, Trips, Repeating and History were four screens of identical full-width
grey boxes: nothing to aim the eye at, no weight between a title and its
details, raw `2026-10-02 → 2026-10-04` where a date should be, and a single
narrow column on a wide display.

They now share one pattern — a **leading mark**, a title, a quiet detail line,
small facts as tags, actions pushed right — so the app reads as one thing
rather than four. The mark is whatever that screen is scanned by:

| Screen | Mark |
| --- | --- |
| People | initials, tinted when there is a number to call |
| Trips | the start date as a block — month over day |
| Repeating | the repeat glyph, in the same violet the calendar uses |
| History | the date, because history is scanned by *when* |

Two columns above 900px, one below. Dates are written the way people write
them: *"2 – 4 Oct · tomorrow · 3 days"*, with the shared ends collapsed and the
year dropped when it is this one.

**Nothing is shown for a fact that is simply absent.** "No role recorded" and
"Not met yet" were two lines per card saying nothing, on every card.

**Empty screens offer the way out of being empty** rather than stating the
obvious in the middle of a void — a sentence explaining what the screen is for,
and the button that fills it.

## Tests

```bash
npm test
```

Two suites. `test:unit` covers the parsers in `packages/shared` — pure functions,
no database, fast. `test:api` covers the services in `apps/api` **against real
PostgreSQL**, because every API bug found by hand in this project lived in the
layer a mock would have faked away: a unique index that collided, a check
constraint that fired, a cascade that did or did not reach.

Each API test file builds its own throwaway schema in the database
`DATABASE_URL` points at, applies the real migrations into it, and drops it
afterwards. A schema rather than a separate database, so the tests run with the
permissions the app already has instead of requiring `CREATEDB`.

Writing them paid for itself immediately, with two bugs neither I nor any amount
of clicking had found:

- **The migrations could not build a database from scratch.** There was no
  migration creating `orgs`, `users` or `commitments` — those had been made by
  `drizzle-kit push` before it was replaced, so every migration from 0001
  assumed they existed. `npm run db:migrate` on an empty database failed at 0001
  with `relation "commitments" does not exist`, which means **the deploy steps
  in this README could not have worked on a new server.** Fixed by
  `0000_base_schema.sql`; a fresh database now builds all 14 tables and takes
  inserts.
- **A multi-day booking was invisible from its second day.** The clash query
  fetched anything *starting* within twelve hours of the proposed slot, so a
  conference running Monday to Wednesday clashed with nothing booked on the
  Tuesday. It now tests for overlap rather than start time.

## Schema changes

`drizzle-kit push` **does not work against PostgreSQL 18** — it mis-diffs and emits
`alter column id drop not null` on primary keys, which Postgres rejects with 42P16.
Use plain forward-only SQL migrations instead: add a numbered `.sql` file to
`apps/api/migrations/` and run

```bash
npm run db:migrate
```

Each file runs once inside its own transaction and is recorded in `_migrations`.
`apps/api/src/db/schema.ts` stays the source of truth for types and queries; the
migration is how the change reaches an actual database.

## Useful commands

```bash
npm run db:studio
```

```bash
npm run typecheck
```

### Being near a place

Creating a trip surfaces what you saved for somewhere. This catches the other
case — you simply turned up:

> **You are near Mathura — 2 things saved for here**
> Buy peda · Visit Banke Bihari Temple

`POST /api/intentions/nearby` takes your coordinates, geocodes each distinct
saved place once (cached), and returns anything within 40 km. A city is big, so
the radius means "you are in Mathura", not "on this street".

Two limits, both deliberate:

- **It only runs when location permission is already granted.** Opening a
  planner should not fire a permission prompt out of nowhere.
- **It only runs while the app is open.** A browser cannot watch your location
  in the background — there is no workaround, and pretending otherwise would be
  a lie. A real arrival notification needs the Capacitor Android build.

## Deploying

**No third-party API key is needed.** Cue parses dates, recurrences, roles and
checklists with hand-written parsers rather than a model, so there is no
account to open and nothing to bill. Exactly two values are required, and you
generate both yourself:

| Value | Where it comes from | Without it |
| --- | --- | --- |
| `DATABASE_URL` | your own PostgreSQL | refuses to start |
| `JWT_SECRET` | `openssl rand -hex 32` | refuses to start |
| `VAPID_*` | `npm run vapid` — self-signed, free, no account | reminders fire, no push arrives |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` | AI paragraph import unavailable |
| `GOOGLE_CLIENT_ID`/`SECRET` | optional, free OAuth client | Connect Google says it is unavailable |
| `GOOGLE_PLACES_API_KEY` | optional | falls back to OpenStreetMap, free |
| AI provider key | optional, per-account, entered in Settings | long-paragraph import unavailable |

The optional ones stay optional. Place lookup defaults to OpenStreetMap, and
the model is only ever a fallback for a paragraph the parsers cannot read —
"dentist friday 6pm" never reaches it. The Google OAuth client is free to
create and is not a billed API key; without it the other two ways of importing
a calendar still work.

### It has to stay awake

**This is the one hosting decision that matters.** The reminder worker polls
every 20 seconds, and that loop is the entire product: a planner that does not
chase you is a list. Any host that sleeps the process when nobody is browsing —
free tiers on several platforms do exactly this — will serve the site perfectly
and silently never remind you of anything.

Pick a plan that keeps one process running continuously. If you want to be
certain, book something five minutes out, close the tab and wait.

### HTTPS is not optional

The app needs a real certificate, not just for tidiness — four things silently
stop working on plain `http`:

| Feature | Why |
| --- | --- |
| Install as an app | service workers only register on a secure origin |
| Push reminders | same |
| Location / nearby wishes | geolocation needs a secure origin |
| Voice notes | `getUserMedia` needs a secure origin |

`localhost` is exempt, which is why development works. A bare IP address is not.
Get a domain and a free Let's Encrypt certificate.

### One process, one port, one URL

In production the API also serves the built web app, so there is no second
service, no CORS, and nothing to configure about where the frontend finds the
backend. The browser calls a relative `/api`. It binds `0.0.0.0` and reads
`PORT`, so a platform that assigns a port works without changes.

### The fastest way to a live URL

A managed platform (Railway, Fly.io, a paid Render instance) with a Postgres
add-on. No server to patch, HTTPS included.

Build settings:

| Setting | Value |
| --- | --- |
| Install | `npm ci --include=dev` |
| Build | `npm run build` |
| Start | `npm start -w @cue/api` |

**`--include=dev` is not optional.** These platforms set
`NODE_ENV=production`, which makes a plain `npm ci` skip devDependencies — and
`vite` lives there, so the build would fail before it started.

Then set the environment variables from the table above, point the platform at
a Postgres add-on for `DATABASE_URL`, set `WEB_ORIGIN` to your real URL, leave
`VITE_API_URL` **blank**, and run the migrations once from the platform's
shell:

```bash
npm run db:migrate
```

### Or your own server

**1. Node 22+ and PostgreSQL 14+.**

```bash
sudo apt install -y postgresql nginx certbot python3-certbot-nginx
```

**2. Create the database.**

```bash
sudo -u postgres psql -c "create role cue login password 'pick-a-real-password'" -c "create database cue owner cue"
```

**3. Get the code and install.**

```bash
git clone <your-repo> /srv/cue && cd /srv/cue && npm ci --include=dev
```

**4. Generate the push keys.**

```bash
npm run vapid
```

That prints a public and a private key. They are self-signed — there is no
service to register with and nothing to pay. Changing them later invalidates
every existing subscription, so generate them once and keep them.

**5. Write `.env` at the repo root.** Copy `.env.example` and change:

```bash
DATABASE_URL=postgres://cue:pick-a-real-password@localhost:5432/cue
JWT_SECRET=<64 random characters>
ENCRYPTION_KEY=<64 hex characters>
VAPID_PUBLIC_KEY=<from step 4>
VAPID_PRIVATE_KEY=<from step 4>
VAPID_SUBJECT=mailto:you@your-domain
WEB_ORIGIN=https://your-domain
VITE_API_URL=
PORT=3002
```

**Reaching a private database from your laptop.** Keep the database off the
public internet — "publicly accessible" plus a security group pinned to your
home IP sounds fine until the ISP rotates it, and the tempting fix for that is
opening it to everyone. Tunnel through the app server instead:

```bash
ssh -i your-key.pem -N -L 5432:your-db.ap-south-1.rds.amazonaws.com:5432 ubuntu@your-server
```

Then point pgAdmin, DBeaver, `psql` or `npm run db:studio` at `localhost:5432`.
Use SSL mode **require**, not `verify-full`: through a tunnel the client thinks
it is talking to `localhost` while the certificate says otherwise, so hostname
verification fails even though the connection is perfectly encrypted.

**On a managed database — RDS, Neon, Supabase — the URL must ask for TLS:**

```bash
DATABASE_URL=postgres://cue:password@your-db.ap-south-1.rds.amazonaws.com:5432/cue?sslmode=require
```

Without `?sslmode=require` the driver connects in the clear, RDS refuses
(`rds.force_ssl` is on by default), and the error says nothing about TLS. Use
`require` rather than `verify-full` unless you have also installed the
provider's CA bundle — `verify-full` checks the certificate chain and fails
without it.

`VITE_API_URL` must be **blank** in production — that is what makes the browser
call the same origin. Generate the two secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**6. Apply migrations.**

```bash
npm run db:migrate
```

**7. Build and start.**

```bash
npm start
```

That builds the web app and runs the single server on `PORT`. Check it — the
response reports whether push is actually configured:

```bash
curl -s localhost:3002/health
```

`{"ok":true,"push":true}`. If `push` is `false`, step 4 did not take.

**8. Run it as a service** so it survives a reboot — `/etc/systemd/system/cue.service`:

```ini
[Unit]
After=network.target postgresql.service

[Service]
WorkingDirectory=/srv/cue
ExecStart=/usr/bin/npm start -w @cue/api
Restart=always
User=cue

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now cue`. Note `ExecStart` runs the API only —
build once at deploy time with `npm run build`, not on every restart.

**9a. If the server already runs Caddy**, this is the whole step. Caddy
obtains and renews the certificate itself, so there is no certbot and no cron
job — add a block to `/etc/caddy/Caddyfile`:

```
cue.vitelio.in {
    reverse_proxy 127.0.0.1:3002
}
```

Then `sudo systemctl reload caddy`. Caddy has no default request body limit, so
the 5 MB voice-note uploads need nothing extra. It needs ports 80 and 443 open
and the DNS record already resolving — the certificate is issued by answering a
challenge on the name itself, so a subdomain that does not resolve yet will
fail and keep retrying.

**9b. Otherwise, put nginx in front and get the certificate.**

```bash
sudo certbot --nginx -d your-domain
```

The nginx site needs one location block proxying everything to the app:

```nginx
location / {
    proxy_pass http://127.0.0.1:3002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 6M;
}
```

`client_max_body_size` matters: voice notes can reach 5 MB and nginx rejects
larger bodies at 1 MB by default, which would fail uploads with a confusing 413.

**10. Install it on your phone.** Open the site in Chrome, then **Add to Home
Screen**. On iPhone that step is mandatory before notifications work at all.

### Updating

```bash
cd /srv/cue && git pull && npm ci --include=dev && npm run db:migrate && npm run build && sudo systemctl restart cue
```

Migrations are forward-only and each runs once, so re-running is safe.

## Deploying from GitHub

`.github/workflows/deploy.yml` runs the typecheck and the whole test suite on
every push and pull request, against a real PostgreSQL service container. Only
`main` deploys, and only after those pass.

### Two key pairs, which is the part that trips people

They point in opposite directions and mixing them up produces a "permission
denied" that looks identical either way.

| Direction | Private key lives | Public key lives |
| --- | --- | --- |
| GitHub Actions → your server | GitHub secret `DEPLOY_SSH_KEY` | server's `~/.ssh/authorized_keys` |
| Your server → GitHub (to `git fetch`) | server's `~/.ssh/id_ed25519` | repo → Settings → **Deploy keys**, read-only |

The second one is only needed for a private repository, and it is the one
people forget — the deploy reaches the server fine and then fails at `git
fetch` with an error about the *repository* rather than the server.

### What to create in GitHub

Repository → Settings → Secrets and variables → Actions.

**Secrets** — encrypted, never shown again:

| Name | Value |
| --- | --- |
| `DEPLOY_SSH_KEY` | the **private** key, whole file including the `BEGIN`/`END` lines |

**Variables** — plain text, visible in logs:

| Name | Example |
| --- | --- |
| `DEPLOY_HOST` | `cue.vitelio.in` or the Elastic IP |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_PATH` | `/srv/cue` (optional; this is the default) |

Host and user are variables rather than secrets deliberately. They are not
secret, and a masked hostname makes a failing deploy unreadable.

### On the server, once

Generate a key **for this purpose only** — reusing your personal key means
anyone with repository admin can act as you:

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/cue_deploy -N ""
cat ~/.ssh/cue_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/cue_deploy          # this half goes into DEPLOY_SSH_KEY
```

Then let the deploy user restart the service without a password. Edit with
`sudo visudo -f /etc/sudoers.d/cue` — a syntax error written any other way can
lock you out of sudo entirely:

```
ubuntu ALL=(ALL) NOPASSWD: /bin/systemctl restart cue, /bin/journalctl -u cue *
```

Narrow on purpose. The deploy needs to restart one service and read its logs,
not to become root.

### What a deploy does

Fetch, hard reset to the pushed commit, install, build, migrate, restart, then
**poll `/health` for fifteen seconds**. That last step is the one worth having:
without it a service that crash-loops on startup reports a green tick, and the
first you hear of it is that reminders stopped. If it never comes up, the job
fails and prints the last fifty lines of `journalctl`.

It resets rather than merges, because a deploy that depends on the server's
working tree is a deploy nobody can reproduce. `reset --hard` leaves untracked
files alone, so the server's `.env` survives — it is in `.gitignore` and must
never be committed.

Deploys are serialised with a concurrency group. Two overlapping runs would
race on the reset, the install and the migration, and the loser would leave the
server in a state neither commit describes.
