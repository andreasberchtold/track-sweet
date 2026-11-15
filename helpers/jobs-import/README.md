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
| Workday | Swisscom, Temenos, Zühlke | The JSON search the careers page itself uses |
| SuccessFactors career sites | Swiss Re, Schindler | The search result page |
| Boards that allow reading | talendo.ch, jobs.nzz.ch | One listing page, job links with an id |

A source whose link points to one of these (for example a new company on
Workday) is read too, once it is marked "Automatic" in the app. Boards
whose terms forbid bots (jobs.ch, jobup.ch, LinkedIn, Indeed, jobagent.ch)
are never read; use their e-mail alerts and the app's "Import from page".

Matching: the job title must contain one of the words under "Roles and
keywords" in the app's menu (or a default set of software words) and none
under "Not interested in". For company sites the location must be in
Switzerland, and in one of "Locations" if that is filled in.

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
   source returned; the app's source list shows it too.

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
