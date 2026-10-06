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
- **Database:** `.env` points at a new database called `altitude-academy` on the same MongoDB cluster, so courses and students are not shared.
- **Login secret:** `JWT_SECRET` is a new random value, so AeroGyan logins don't work here.
- **Port:** `PORT=5002`, so it can run on the same server next to AeroGyan (which uses 5001).
- **Cloudinary:** uploads go to the `altitude-academy/` folder.
- **Android:**
  - The package is `com.altitudeacademy.app`, with its own icon and name.
  - It uses its own signing key in `android-signing/`. That folder is git-ignored, so back it up.
- **Uploads:** the site starts with no uploaded files.

Still shared, because the same keys were copied. Change them in `.env` if you want them separate:
- the email sender account (`EMAIL_*` / `BREVO_*`)
- Razorpay
- Cloudinary
- the AI keys
- the admin login (`ADMIN_*`)

## Before going live
1. **Domain.** Replace `altitudeacademy.example` with the real domain in:
   - `android-app/app.properties` (`APP_URL`)
   - `landing.html` (the email link in the "About" section)
2. **Git.** This folder is **not** connected to AeroGyan's GitHub repository. Create a new repository and push there. Never add AeroGyan's remote.
   ```
   git init && git add -A && git commit -m "RankerNode"
   git remote add origin https://github.com/<you>/altitude-academy.git
   git push -u origin main
   ```
3. **Android builds.** Move `android-app/ci/android-apk.yml` to `.github/workflows/android-apk.yml`. Then add the 4 secrets listed in `android-signing/GITHUB-SECRETS-README.txt` to the new repository.
4. **On the server:**
   ```
   npm install
   node server.js        # or: pm2 start server.js --name altitude-academy
   ```
   Point the new domain (nginx) at port 5002.
5. **First setup.** Log in as admin, open **Categories** to check the five categories, then:
   - create a course for each subject in **Courses → New Course**
   - add its chapters in the **Chapters** tab
   - upload content to each chapter
