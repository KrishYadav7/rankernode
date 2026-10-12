# RankerNode

Chapter-wise preparation for **JEE Main, JEE Advanced, NEET, Class 11, Class 12 and Foundation**.
This project was copied from the AeroGyan portal (2026-10-05). The two run separately, and nothing in the AeroGyan folder was changed.

## What is new compared with AeroGyan

### 1. Category selection first
- Students choose what they are preparing for before they see courses:
  **Class 11 · Class 12 · JEE Main & Advanced · NEET · Foundation**.
- New students go straight to this screen after they log in. Their choice is saved to their account, and they can change it any time from the bar at the top of Courses.
- The landing page has the same category cards. Clicking one opens the app on that category (`/app#/courses/jee` etc.).
- Admins manage categories in **Admin → Categories**: add, rename, recolour, reorder, hide or delete them, and pick each one's subjects.
  The five categories above are created automatically the first time the server starts with an empty database.

### 2. Subject courses per category
- After choosing a category, students see its subjects (Physics, Chemistry, Mathematics and/or Biology). Each subject has its own section and tab, with that category's courses inside it.
- In the course form (Admin → Courses → New Course / Edit → Details), every course has a **Subject** and one or more **Categories**.
  One course can be listed under several categories. For example, "Physics — Class 11" can sit under both Class 11 and JEE.

### 3. Chapter-by-chapter courses
- A course page always shows its content grouped by chapter. Chapters are numbered and in order. Each one shows its videos, notes and DPPs, plus the student's progress.
- The type tabs (Videos, Notes, DPP, PYQs…) filter within the chapters.
- Anything not yet placed in a chapter appears under "Other materials".

### 4. Uploading content to chapters (admin)
Open a course in **Admin → Courses → Edit**, then go to the **Chapters** tab. From there you can:
- **Add chapters** one at a time, or paste many at once (one title per line).
- **Rename, reorder (↑ ↓) or delete** a chapter. Deleting a chapter keeps its materials; they move to "Other materials".
- Use **Upload content** on a chapter to:
  - pick or drag in several files at once: videos (MP4, WebM, MOV), PDFs, PPT/PPTX, Word, images, audio or ZIP, up to 500 MB each. The type is guessed from the file name (DPP, PYQ, notes, slides, video…) and you can change it before uploading.
  - or add a **link**, such as a YouTube lecture.
  - tick **PRO** to make the upload premium.
- **Move a material** to another chapter from the list under each chapter.
- The Materials tab and the material editor also have a **Chapter** selector, and the quiz/paper editor works as before.

Material types are now aimed at exam preparation: Video Lecture, Chapter Notes, Slides, DPP, Assignment, PYQs, Solutions, Formula Sheet, NCERT, Chapter Test, Books, Audio, Diagram and Other.

## Separate from AeroGyan
- **Database:** `.env` points at a new database called `rankernode` on the same MongoDB cluster, so courses and students are not shared.
- **Login secret:** `JWT_SECRET` is a new random value, so AeroGyan logins don't work here.
- **Port:** `PORT=5002`, so it can run on the same server next to AeroGyan (which uses 5001).
- **Cloudinary:** uploads go to the `rankernode/` folder.
- **Android:**
  - The package is `com.rankernode.app`, with its own icon and name.
  - It uses its own signing key in `android-signing/`. That folder is git-ignored, so back it up.
- **Uploads:** the site starts with no uploaded files.

Still shared, because the same keys were copied. Change them in `.env` if you want them separate:
- the email sender account (`EMAIL_*` / `BREVO_*`)
- Razorpay
- Cloudinary
- the AI keys
- the admin login (`ADMIN_*`)

## Before going live
1. **Domain.** Replace `rankernode.example` with the real domain in:
   - `android-app/app.properties` (`APP_URL` and `START_URL`)
   - `desktop-app/src/main.js` (`APP_URL`, `START_URL` and `isOwnHost`)
   - `landing.html` (the email link in the "About" section)
   - `android-app/play-store/PLAY-STORE-LISTING.md` (website, privacy and delete-account links)
2. **Git.** This folder is **not** connected to AeroGyan's GitHub repository. Create a new repository and push there. Never add AeroGyan's remote.
   ```
   git init && git add -A && git commit -m "RankerNode"
   git remote add origin https://github.com/<you>/rankernode.git
   git push -u origin main
   ```
3. **Android and Windows builds.** The workflows are already in `.github/workflows/` (`android-apk.yml`, `windows-app.yml`). Add the 4 secrets listed in `android-signing/GITHUB-SECRETS-README.txt` to the new repository. The website offers app downloads from this repository's releases (`APP_GITHUB_REPO`, default `KrishYadav7/rankernode`).
4. **On the server:**
   ```
   npm install
   node server.js        # or: pm2 start server.js --name rankernode
   ```
   Point the new domain (nginx) at port 5002.
5. **First setup.** Log in as admin, open **Categories** to check the five categories, then:
   - create a course for each subject in **Courses → New Course**
   - add its chapters in the **Chapters** tab
   - upload content to each chapter

## Features brought over from AeroGyan (2026-10-12)
Everything AeroGyan gained after the copy (2026-10-05 → 2026-10-12) now runs here too, on top of the
categories, subjects and chapters above:
- **My Notes** — handwritten notebooks (7 pen types, shapes, lasso, text, PDF export) that work on every device.
- **Learning** — question bank, test series, report cards; **LaTeX** in questions and answers.
- **AI Doubt Solver** upgrades, **help & support tickets**, **Privacy** and **Delete account** pages.
- **OTP sign-in** for admins and professors; an admin can stay signed in on several devices.
- **Professors** — register, get approved, request courses, add and edit content (never delete or price);
  here they can also add, rename and reorder chapters (deleting a chapter stays with the admin).
- **Course and material order** — drag to reorder; materials are reordered inside each chapter.
- **Guest catalog** — visitors can browse courses and are asked to sign up to open a lesson.
- **Faster PDFs** — packed fast-view copies, range loading, instant posters (needs `qpdf` on the server;
  PowerPoint/Word/Excel viewing needs LibreOffice).
- **Apps** — Android Google Play build (`.aab`), in-app downloads and printing, and a Windows desktop app (`desktop-app/`).

To check after deploying:
- **Founder section** on the landing page now shows only what the admin saves (Admin → Organization & Owner). Until it is
  filled in, the section is hidden.
