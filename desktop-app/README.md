# RankerNode desktop app (Windows · macOS later)

A real installed app — not a browser shortcut. It opens `https://rankernode.example/app` in its own
window with its own icon, Start-menu and desktop entry, and appears in **Settings › Apps**.

## What students get
- **One-click install, no admin password** — installs for the current Windows user in a few
  seconds (`RankerNode-Setup-1.0.N.exe`, 64-bit Windows 10 / 11).
- **Screenshots, screen recording and screen sharing show a black window** (content protection),
  like the Android app.
- Remembers its window size and position.
- **Downloads work** — notes PDF/PNG, exports and materials are saved to *Downloads › RankerNode*
  with a notification (click it to open the folder).
- **Certificates / pop-ups** open in an app window; *Print → Microsoft Print to PDF* saves a PDF.
- **Payments** (Razorpay, bank pages) stay inside the app; YouTube, WhatsApp, LinkedIn and other
  sites open in the normal browser.
- **Offline screen** that reconnects by itself.
- **Automatic updates** — the app checks rankernode.example every few hours, downloads a new version in
  the background and installs it on restart.
- Keyboard: `F5` reload · `F11` full screen · `Ctrl +` / `Ctrl -` / `Ctrl 0` zoom ·
  `Alt ←` back · mouse back/forward buttons.
- The website sees `RankerNodeApp/<version> (Desktop; Windows)` in the user-agent, so its
  "Get App" buttons are hidden inside the app. Voice typing (needs Chrome) is hidden; typing,
  paste, photos and files work.

## Building (no Windows PC needed)
GitHub builds and tests it:

0. **One time:** move `desktop-app/ci/windows-app.yml` to `.github/workflows/windows-app.yml`
   (GitHub only runs workflows from there). No secrets are needed.
1. Push to `main` (any change inside `desktop-app/`), or open **GitHub → Actions →
   "Windows app (installer)" → Run workflow**.
2. After ~10 minutes a Release **windows-v1.0.N** appears with `RankerNode-Setup-1.0.N.exe` and
   `windows-test-report-1.0.N.txt` (the app installed and tested itself on a real Windows machine).
3. On the website: **Admin → Apps → Windows → Publish latest from GitHub** (or upload the `.exe`).
   From then on the Windows "Get App" button downloads it, and installed apps update themselves.

## "Windows protected your PC"
The installer is not code-signed yet, so the first time Windows SmartScreen and Edge show a
warning (*More info → Run anyway*; in Edge *… → Keep*). The website's install guide explains this
to students. To remove the warning for good, either:
- publish the app in the **Microsoft Store** (a free individual developer account; the Store signs
  it), or
- buy a **code-signing certificate** and add it to the build.

## Run it on your own computer (optional)
```
cd desktop-app
npm install
npm start            # opens the app
npm run dist:win     # builds the installer (on Windows)
```

## macOS (next)
The same code builds a Mac app (`npm run dist:mac` on a Mac). For students to open it without
warnings it must be signed and notarized with an Apple Developer account (99 USD / year).
