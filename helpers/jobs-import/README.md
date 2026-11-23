# Jobs import helper

A small Google Apps Script that runs once a day in my own Google account.
It reads jobs.json (Drive folder "Personal Apps"), asks every source marked
as automatic in the Jobs app for new openings, and adds the matching ones
as "To judge". Free, no server, no extra account.

## What it reads

Only sources in the "Imported automatically" group of the app's source
list, and only these kinds of sites:

| Kind | Example | How |
| --- | --- | --- |
| Greenhouse | Proton | Greenhouse's official public job board API |
| Workday | Swisscom, Temenos, Zühlke, Varian | The JSON search the careers page itself uses |
| Phenom | Roche, Siemens Healthineers | The job data embedded in the search page |
| Novartis | Novartis | The search result page, filtered to Switzerland |
| SuccessFactors career sites | Swiss Re, Schindler | The search result page |
| Boards that allow reading | talendo.ch, jobs.nzz.ch | One listing page, job links with an id |

A source whose link points to one of these (for example a new company on
Workday) is read too, once it is marked "Automatic" in the app. Boards
whose terms forbid bots (jobs.ch, jobup.ch, LinkedIn, Indeed, jobagent.ch)
are never read; use their e-mail alerts and the app's "Import from page".

Matching: the job title must contain one of the words under "Roles and
keywords" in the app's menu (or a default set of software words) and none
under "Not interested in". For company sites the location must be in
Switzerland, and in one of "Locations" if that is filled in. Locations
can be towns or cantons (name or code: "Aargau" or "AG" covers Aarau,
Baden, Brugg and the other towns listed in the script), compared without
umlauts, so "Zurich" matches "Zürich" and "Zuerich".

## Setup (once, about 5 minutes)

1. Open the Jobs app once while signed in, so jobs.json exists.
2. Go to <https://script.google.com>, "New project", name it "Jobs import".
3. Replace the contents of `Code.gs` with `JobsImport.gs` from this folder.
   Save.
4. Choose the function `setup` in the toolbar and press "Run". Google asks
   for permission: see your Drive files (to read and write jobs.json),
   connect to external services (to fetch the job pages) and run when you
   are not there (the daily trigger). Allow it. Google may warn that the
   app is not verified: it is your own script, so "Advanced", "Go to Jobs
   import".
5. `setup` runs the first import straight away and schedules one every
   morning between 6 and 7. The log (View, Executions) lists what each
   source returned; the app's source list shows it too, and "Sources",
   "Import log" keeps the last 200 runs of both scripts.

To update the script later, paste the new `JobsImport.gs` over the old one.
To stop it: Triggers (clock icon), delete the trigger.

## Good to know

- The script has access to all of my Drive (Google does not offer a
  narrower permission for scripts), but it only opens jobs.json. Its code
  is this one file.
- A job is never imported twice: links already in the list, or imported
  before and since deleted, are skipped (`settings.importSeen`).
- The readers were written against the sites' formats as of November 2026
  and tested with samples, not against the live sites. If a site changes
  its pages, the source shows "Import failed" or "0 new" in the app.

## E-mail alerts

For boards that forbid bots (jobs.ch, JobScout24, LinkedIn, ...), their
own e-mail alerts go to a separate Gmail account used only for alerts. A
second script, in that account, reads new alert mails every hour, takes
the job links out of them and adds the jobs to jobs.json as "To judge".
It runs in the alerts account, so it can only see that mailbox, never
the main one.

What it does with each new mail in the alerts inbox (last 30 days, not
yet labelled "jobs-imported"):

- Takes every link with a title-like text. Unsubscribe, settings,
  account and social media links are never touched.
- Links that point straight to a job (for example
  `jobs.ch/.../stellenangebote/detail/...`) are used as they are. Tracking
  links are followed one step at a time, without opening the job page,
  until they show the job's address.
- Skips jobs already in the list or imported before, and titles with a
  word from "Not interested in". The alerts themselves decide which jobs
  are sent, so there is no keyword or location filter here.
- Labels the mail "jobs-imported", so it is read only once.

The app's source list shows when alerts were last read and how many jobs
came in.

### Setup (once, about 5 minutes)

1. **Share jobs.json with the alerts account.** In the main account's
   Drive, open the folder "Personal Apps", right-click `jobs.json`,
   "Share", add the alerts address as **Editor**, untick "Notify". Then
   "Copy link".
2. **Sign in to the alerts account** and go to <https://script.google.com>
   (check the account in the top right). "New project", name it "Jobs
   alerts".
3. Replace `Code.gs` with `JobsImport.gs` from this folder. Add a second
   file ("+", "Script", name it `AlertsImport`) and paste
   `AlertsImport.gs`.
4. At the top of `AlertsImport.gs`, paste the link from step 1 between the
   quotes of `var JOBS_FILE = '';`. Save.
5. Choose `setupAlerts` and press "Run". Allow access (Gmail of this
   account, the shared file, external requests, running hourly). Like
   before, "Advanced", "Go to Jobs alerts".
6. It reads the mails already there and then runs every hour. The log
   (Executions) says how many mails, links and new jobs it found.

Do not run `setup` or `runImport` in this project: the daily import of
company sites stays in the main account's project.

To update later, paste the new `JobsImport.gs` and `AlertsImport.gs` over
the old ones (keep your `JOBS_FILE` line).

