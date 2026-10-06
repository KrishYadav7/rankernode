# RankerNode Android app

A real Android app (APK) for RankerNode — not a browser shortcut. It opens
`https://altitudeacademy.example/app` full-screen, with its own icon and name, no browser
bar and no browser badge.

## What it does
- **Own app** — package `com.altitudeacademy.app`, appears in the app drawer and Settings → Apps.
- **Screenshots and screen recording are blocked** inside the app (Android `FLAG_SECURE`); the
  recent-apps preview is blank too.
- **Uploads work** — AI Doubt Solver attachments, contributions, profile photos; the **Photo**
  button opens the camera directly.
- **Payments** — Razorpay and bank pages open inside the app; UPI apps (GPay, PhonePe, Paytm…)
  open through their links.
- **YouTube / WhatsApp / social links** open in their own apps.
- **Back button** goes back through the site; an **offline screen** retries by itself.
- **Updates** — the app checks the website every few hours and offers a newer version when you
  upload one in Admin → Mobile App.
- The website can tell it is running in the app (the user-agent contains `AltitudeAcademyApp/`), so
  "Get App" buttons are hidden there.

Voice typing in the AI Doubt Solver is a browser feature that Android's in-app web view does not
provide, so that button is hidden inside the app (typing, paste, photos and files all work).

## Building (no Android Studio needed)
GitHub builds the APK for you:

0. **One time:** in VS Code create the folder `.github/workflows/` at the top of the project and
   **move** `android-app/ci/android-apk.yml` into it (GitHub only runs workflows from there).
1. **One time:** add the 4 signing secrets — see `android-signing/GITHUB-SECRETS-README.txt`
   (that folder is on your computer only and is git-ignored; back it up).
2. Push to `main` (any change inside `android-app/`), or open **GitHub → Actions →
   "Android app (APK)" → Run workflow**.
3. After ~5 minutes open the finished run → **Artifacts** (or **Releases**) → download
   `AltitudeAcademy-1.0.N.apk`.
4. On the website: **Admin → Mobile App → Upload new version** → choose that APK.
   From then on the Android "Get App" button downloads it, and installed apps offer the update.

## Settings
`app.properties` → `APP_URL` (the page the app opens). Change it only if the domain changes.

## Building on your own computer (optional)
Android Studio → Open → `android-app/`. For a signed release set the environment variables
`KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` and run `gradle assembleRelease`.

## Google Play later
The same project works for Play: build an App Bundle with `gradle bundleRelease` and upload it in
the Play Console, using the same signing key.
