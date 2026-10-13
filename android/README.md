# Cue on the Play Store

The Android app is Cue itself — the website — opened full-screen by a thin
Android shell called a Trusted Web Activity. There is no second codebase:
every change to the website is in the app the moment it is deployed. A new
app version is only needed when something here changes (the name, icons,
shortcuts, or the Android version number).

- `twa-manifest.json` — the app's definition: package `in.vitelio.cue`, name,
  colours, icons, shortcuts, share target. Bubblewrap generates the Android
  project from it.
- `.github/workflows/android.yml` — builds and signs the app on GitHub.
- `store/` — the Play listing text and the Data safety answers.
- `apps/web/public/store/` — the screenshots and the feature graphic.
- `/.well-known/assetlinks.json` (served by the API from `ANDROID_PACKAGE` and
  `ANDROID_CERT_SHA256`) — the site vouching for the app, which is what lets
  it open full-screen without an address bar.

## 1. Try it on a phone (no setup)

1. GitHub → Actions → **Android app** → Run workflow, leave *release* off.
2. When it finishes, download the **cue-test-build** artifact and copy
   `app-release-signed.apk` to an Android phone. Open it and allow the install.
3. It opens Cue. Until the site vouches for this key it shows a thin address
   bar at the top. That is expected for a test build; to see it full-screen,
   copy the `SHA256:` line from the job's "fingerprint" step into
   `ANDROID_CERT_SHA256` on the server (step 5) for as long as you are testing.

The test build is signed with a key made on the runner and thrown away. It can
never be uploaded to Play, and every run makes a different one.

## 2. Make the upload key (once, and keep it safe)

On your own computer, with Java installed (Android Studio includes one):

```
keytool -genkeypair -keystore cue-upload.keystore -alias cue -keyalg RSA -keysize 2048 -validity 10000
```

Keep the file and its password somewhere safe and backed up (a password
manager is right). With Play App Signing, losing it is recoverable through
Play support, but it takes days.

## 3. Give it to GitHub as secrets

Repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the keystore file, base64-encoded (below) |
| `ANDROID_KEYSTORE_PASSWORD` | its password |
| `ANDROID_KEY_PASSWORD` | the key's password, if different (otherwise leave it out) |

To encode the file in Git Bash: `base64 -w0 cue-upload.keystore`; in
PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cue-upload.keystore"))`.

## 4. Build the release and upload it

1. Actions → **Android app** → Run workflow with *release* on.
2. Download **cue-release** and upload `app-release-bundle.aab` in Play
   Console, to **Internal testing** first.

Play Console needs, once (a developer account is a one-time fee):

- App name **Cue**, category **Productivity**, free.
- Store listing: the text in `store/listing.md`; the screenshots
  `phone-1..4.png` and `feature-graphic.png` from `apps/web/public/store/`;
  the icon `apps/web/public/icon-512.png`.
- Privacy policy: `https://cue.vitelio.in/privacy`.
- Account deletion: `https://cue.vitelio.in/privacy#delete`.
- Data safety: the answers in `store/data-safety.md` (check them first).
- Content rating questionnaire and target audience (adults).

## 5. Let the site vouch for the app

Play re-signs the app with its own **app signing key**. In Play Console →
Test and release → App integrity → App signing, copy both SHA-256
fingerprints (the app signing key and the upload key) and put them on the
server, comma-separated, in `/srv/cue/.env`:

```
ANDROID_CERT_SHA256=AA:BB:…,CC:DD:…
```

Restart (`sudo systemctl restart cue`) and check that
`https://cue.vitelio.in/.well-known/assetlinks.json` lists them. Installed
from Play, the app then opens full-screen.

## Later versions

Raise `appVersionCode` by one (and `appVersionName`, e.g. `1.0.1`) in
`twa-manifest.json`, commit, run the release build, and upload. Changes to
the website itself need none of this.

# Cue Exams: the second app

Cue Exams is the same website again, for aspirants: its Android shell opens
`https://cue.vitelio.in/exams?app=exams`, which puts the site in exams mode —
its own welcome page (Hindi first), "Cue Exams" in the header, and new
accounts that start with exams and the language picked. Everything else —
accounts, data, the server — is Cue's. Someone with both apps signs in to
the same account in each.

- `exams/twa-manifest.json` — package `in.vitelio.cue.exams`, its own icon
  (`apps/web/public/exams-icon-*.png`), name and shortcuts (read an admit
  card, add an exam).
- `apps/web/public/exams.webmanifest` — its web manifest.
- `exams/store/` — its listing, in English and Hindi, and its Data safety and
  app content answers. The listing's last paragraph is the "not a
  government app" disclosure Play requires of apps with government
  information: keep it.

## Build it

GitHub → Actions → **Android app** → Run workflow, **Which app: exams**.
Without *release*: a test APK to install (artifact **cue-exams-test-build**).
With *release*: the bundle for Play (artifact **cue-exams-release**), signed
with the same upload key as Cue unless you add `ANDROID_EXAMS_KEYSTORE_BASE64`
and `ANDROID_EXAMS_KEYSTORE_PASSWORD` (and `ANDROID_EXAMS_KEY_PASSWORD`) for a
key of its own. One upload key for both is allowed; Play gives each app its
own app signing key either way.

## Publish it

1. Play Console → **Create app**: name **Cue Exams**, default language
   **Hindi – hi-IN** (or English), app, free. Category **Education**.
2. Store listing: `exams/store/listing.md` (add the English translation too),
   the icon, the feature graphic and the screenshots listed there.
3. Privacy policy `https://cue.vitelio.in/privacy`; account deletion
   `https://cue.vitelio.in/privacy#delete`; Data safety and app content from
   `exams/store/data-safety.md`.
4. Upload `app-release-bundle.aab` to **Internal testing** first.
5. App integrity → App signing: copy its SHA-256 fingerprints (app signing
   key, and upload key) into `/srv/cue/.env` — Cue Exams has its own line:

   ```
   ANDROID_EXAMS_CERT_SHA256=AA:BB:…,CC:DD:…
   ```

   Restart (`sudo systemctl restart cue`); `/.well-known/assetlinks.json`
   then lists both apps, and Cue Exams opens full-screen.
