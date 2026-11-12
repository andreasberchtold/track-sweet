# Personal apps

Small web apps for my own everyday use. They run in the browser on the phone
and the PC, and keep their data as plain JSON files in my Google Drive.

- No server and no database. GitHub Pages delivers the code; the browser
  talks directly to Google Drive.
- No build step and no dependencies. Pushing to `main` runs the tests and
  publishes the apps (`.github/workflows/deploy.yml`).
- One shared core (`core/`) and one folder per app (`apps/`). A change to
  the core reaches every app with the same push.

## What is in here

```
site.config.js       Google client ID and Drive folder name (edit once)
index.html           start page listing the apps (from apps.json)
core/                shared by all apps
  shell.js             sign-in, loading, save status, menu, sheets, toasts
  store.js             the document store (changes, saving, merging)
  auth.js              Google sign-in (access token for drive.file only)
  backend-drive.js     reads and writes the file in Google Drive
  backend-local.js     keeps data in the browser (demo mode, tests)
  updates.js           version display and "newer version available"
  version.js           the running version (filled in by the deploy)
  dom.js, util.js      small helpers
  core.css             shared look; apps override the accent colour
apps/
  movies/              Movies & Series tracker (TMDB search, ratings)
  habits/              Habits: sets, weekly goals, progress (pull-ups first)
  _template/           starting point for a new app
scripts/
  serve.mjs            local web server for trying things out
  new-app.mjs          creates a new app from the template
  simkl-export.mjs     downloads my SIMKL lists for the import
  make-icons.py        draws home-screen icons (optional, needs Pillow)
tests/                 automated checks (see "Testing")
```

## How data is stored

Each app has one file in the Drive folder named in `site.config.js`
(default `Personal Apps`): `movies.json`, later `health.json`, and so on.
The files are readable JSON and can be opened, copied or backed up like any
other file.

The apps ask Google only for the `drive.file` permission. With it an app
can see the files it created itself and nothing else in the Drive.

Every change is saved about half a second after it is made. Before saving,
the app checks whether the file changed since it was loaded (for example on
the other device). If so, it loads the newer file and applies the waiting
change on top, so an old copy never overwrites newer data.

Until a Google client ID is entered in `site.config.js`, the apps run in
**demo mode**: everything works, but data stays in that one browser.

## One-time setup

### 1. GitHub

1. Create a **public** repository (free GitHub Pages needs a public one),
   for example `apps`. Push this folder to it.
2. In the repository: Settings, Pages, Source: **GitHub Actions**. From
   then on every push to `main` runs the tests and, if they pass,
   publishes the site with the commit stamped in (see "Versions").
3. After a minute the site is at `https://<username>.github.io/<repo>/`
   and the movie tracker at `.../apps/movies/` (in demo mode for now).
4. Turn on two-factor sign-in for the GitHub account. Whoever can push to
   this repository controls the code that reads the Drive files.

### 2. Google

1. Open <https://console.cloud.google.com>, create a project (any name).
2. "APIs & Services", Library: enable the **Google Drive API**.
3. Configure the sign-in screen ("Google Auth Platform" or "OAuth consent
   screen"): app name and your email address, audience **External**.
   If asked for scopes, add `https://www.googleapis.com/auth/drive.file`.
4. Audience: while the status is "Testing", add your own Google account as
   a test user. Setting the status to "In production" is recommended: with
   only `drive.file` it should not require a review by Google, and it
   avoids sign-ins lapsing during testing status.
5. Clients, "Create client", type **Web application**. Under "Authorized
   JavaScript origins" add:
   - `https://<username>.github.io`
   - `http://localhost:8080`

   No redirect URIs are needed.
6. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) into
   `site.config.js`, commit and push. The client ID is not a secret.

### 3. TMDB (movie tracker only)

1. Create a free account at <https://www.themoviedb.org>, then Settings,
   API, and request a key (type "Developer", personal use).
2. In the movie tracker open the menu, paste the key under "Title search"
   and save. The key is stored in `movies.json` in Drive, never in this
   repository.

### 4. On the phone

Open the app's address in Chrome, then "Add to Home screen" / "Install
app" from Chrome's menu.

Sign-in opens a small Google window. If Chrome blocks it when the app
starts, the app shows a "Continue as ..." button instead. To skip that tap,
allow pop-ups for the site (Chrome, Site settings, Pop-ups and redirects).
Google's access lasts about an hour; after that the app reconnects when it
is opened again, or shows "Tap to reconnect" if a change is waiting.

## Moving over from SIMKL

The movie tracker can import SIMKL's export: Menu, "Import from SIMKL",
choose the JSON file. Watched, watching and watchlist titles come over with
ratings, last-watched dates, running times and notes. Save the TMDB key
first, then posters are looked up during the import. Titles already in the
list are never overwritten, so the import can be repeated.

Two ways to get the file:

1. **SIMKL backup page** (<https://simkl.com/apps/backup/>): download the
   JSON backup and import the JSON file inside the ZIP. SIMKL lists this
   download as a Pro feature.
2. **`scripts/simkl-export.mjs`** (free, uses SIMKL's API): create an app
   in your SIMKL account (Settings, Developer) to get a client ID, then run

   ```
   node scripts/simkl-export.mjs <client-id>
   ```

   Enter the code it shows at <https://simkl.com/pin>. The result is
   `simkl-export.json`, which `.gitignore` keeps out of the repository.

How SIMKL's lists are translated: completed becomes Watched, watching and
on hold become Watching (on hold gets a note), plan to watch becomes
Watchlist, and dropped (SIMKL's "Not Interesting") becomes Not interesting.

## Working on it

Try it locally (needs Node.js 20 or newer):

```
node scripts/serve.mjs
```

and open <http://localhost:8080/>.

Create a new app:

```
node scripts/new-app.mjs health "Headache journal"
```

This copies `apps/_template` to `apps/health`, fills in the name and adds
the app to the start page. Nothing has to be registered with Google for a
new app; it gets its own file (`health.json`) in the same Drive folder.

If an app calls another web service, add that address to `connect-src`
(and `img-src` for images) in the app's `index.html`. Everything not listed
there is blocked by the browser.

When the shape of an app's data changes, raise `schemaVersion` in its
`app.js` and add a migration for that version. Old files are upgraded when
they are next opened. An app that finds a file from a newer version of
itself refuses to write to it.

## Habits

Log sets of an exercise with one tap, work towards a weekly goal and see
the progress. It starts with one exercise (set up on first start from "how
many can you do in one go?"); more can be added in the menu, counted in
reps, seconds (for example hangboarding) or sets.

What it borrows from behaviour research:

- **Weekly goals, no daily streaks.** A missed day resets nothing, which
  avoids the "it's ruined anyway" effect of broken streaks.
- **Goals that stay reachable.** At the start of a week the app shows last
  week's result and suggests a goal: a small step up after a reached goal,
  the same again after a near miss, closer to what was done after a clear
  miss.
- **Pace.** The progress bar shows where an evenly spread week would be
  today and how much per day is left, so the goal stays in sight.
- **A plan in "after X, I do Y" form** (implementation intention), shown
  next to the buttons.
- **Small, easy sets.** Quick buttons default to about half of your
  maximum, spread over the day.
- **Fresh start and "don't miss twice".** Every Monday starts clean; after a
  missed week the message is about not missing a second one.
- **Rewards.** A celebration when the goal is reached, personal best sets,
  milestones (50, 100, 250, ... in total) and the week streak.

## Versions

Every app shows its version and deploy time at the bottom of the menu, with
a link to the commit; the start page shows it too. When a newer version has
been deployed since the app was opened, a bar offers "Update now", which
reloads the app with fresh files. A copy served straight from the folder
(for example with `scripts/serve.mjs`) says "Development version".

## Testing

```
npm test                          core, Drive backend, sign-in, versions, TMDB, SIMKL import, habits (Node only)
python3 tests/e2e_movies.py       movie tracker in Chrome, demo mode
python3 tests/e2e_habits.py       habit tracker in Chrome, demo mode
python3 tests/e2e_drive_flow.py   sign-in and Drive flow in Chrome
```

`npm test` also runs on every push before the deploy. The browser checks
need Python with Playwright and Chrome. They use
stand-ins for Google and TMDB, so they prove the app's own behaviour, not
that the real services answer the same way.

## Rules that keep the data safe

1. Never commit secrets or personal data: no TMDB key, no downloaded
   copies of the data, no real entries as test data.
2. Keep two-factor sign-in on for GitHub and Google.
3. No third-party libraries loaded at runtime. The one exception is
   Google's own sign-in script, which Google requires to be loaded from
   `accounts.google.com`.
4. The Google access token is kept in memory only. The only thing stored on
   the device is the account's email address (to skip the account chooser)
   and the ID of the data file.

## Good to know

- GitHub Pages may serve the previous version of a file for up to about ten
  minutes after a push; "Update now" fetches everything fresh.
- All apps share one web address, so they are not isolated from each other
  in the browser. That is fine while all the code is my own.
- Storage sits behind a three-function interface (`load`, `getRev`, `save`
  in `core/backend-*.js`). Moving to another storage service later means
  writing one new backend file.
- Titles and posters come from TMDB. This product uses the TMDB API but is
  not endorsed or certified by TMDB.
