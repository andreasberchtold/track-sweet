/**
 * Jobs from e-mail alerts (Google Apps Script, runs in the alerts-only
 * Gmail account).
 *
 * Job boards that forbid bots (jobs.ch, JobScout24, LinkedIn, ...) send
 * their own e-mail alerts. This script reads new alert mails in this
 * mailbox every hour, takes the job links out of them and adds the jobs to
 * jobs.json as "To judge". Each mail gets the label "jobs-imported" so it
 * is read only once.
 *
 * It runs in the separate alerts account, so it only ever sees that
 * mailbox, never my main one. jobs.json stays in my main Drive and is
 * shared with the alerts account.
 *
 * Needs JobsImport.gs in the same project (shared helpers: cleanUrl,
 * addJobs, text, ...). Setup: helpers/jobs-import/README.md, "E-mail alerts".
 *
 * The functions above the line "Apps Script only" use no Google services,
 * so tests/jobs-import.test.mjs can run them in Node.
 */

// Paste the link of jobs.json here (Drive: right-click jobs.json, "Share",
// "Copy link"). Only the file's id is used.
var JOBS_FILE = '';

var ALERTS_LABEL = 'jobs-imported';
var ALERTS_QUERY = 'in:inbox -label:' + ALERTS_LABEL + ' newer_than:30d';
var MAX_REDIRECTS_PER_RUN = 80;

/** Job boards: how their names are shown, and what a link to one posting looks like. */
var BOARDS = [
  { host: /(^|\.)jobs\.ch$/, name: 'jobs.ch', job: /\/vacancies\/detail\/|\/stellenangebote\/detail\/|\/offres-emplois\/detail\// },
  { host: /(^|\.)jobup\.ch$/, name: 'jobup.ch', job: /\/detail\// },
  { host: /(^|\.)jobscout24\.ch$/, name: 'JobScout24', job: /\/jobs?\/[^/?#]*\d{4,}|[?&](jobid|jobId|id)=\d+|\/jobs?\/[a-z0-9-]+-\d+/ },
  { host: /(^|\.)linkedin\.com$/, name: 'LinkedIn', job: /\/jobs\/view\// },
  { host: /(^|\.)indeed\.(com|ch)$/, name: 'Indeed', job: /\/viewjob|\/rc\/clk|\/pagead\/clk|[?&]jk=/ },
  { host: /(^|\.)jobagent\.ch$/, name: 'jobagent.ch', job: /\/job\/\d|\/jobs?\/[^/?]+-\d{4,}/ },
  { host: /(^|\.)swissdevjobs\.ch$/, name: 'SwissDevJobs', job: /\/jobs\/[^/?#]+\/[^/?#]+/ },
  { host: /(^|\.)glassdoor\.(com|ch)$/, name: 'Glassdoor', job: /job-listing|\/partner\/joblisting/ },
  { host: /(^|\.)xing\.com$/, name: 'XING', job: /\/jobs\/[^/?#]+-\d+/ },
];

/** Links never followed or imported: unsubscribing, settings, accounts. */
var NEVER = /unsubscribe|abmelden|abbestellen|désabonner|desabonner|disiscriviti|opt-?out|settings|einstellungen|preferences|praeferenzen|präferenzen|profil|profile|login|signin|sign-in|account|konto|privacy|datenschutz|impressum|agb|terms|help|hilfe|support|app-store|apps\.apple|play\.google|facebook|instagram|twitter|x\.com|youtube|tiktok/i;

/** The board a link belongs to, or null. */
function boardOf(url) {
  var host = hostOf(url);
  for (var i = 0; i < BOARDS.length; i++) if (BOARDS[i].host.test(host)) return BOARDS[i];
  return null;
}

/** Is this link one job posting on a board? */
function isBoardJob(url) {
  var b = boardOf(url);
  if (!b) return false;
  var path = String(url).replace(/^https?:\/\/[^/]+/i, '');
  return b.job.test(path);
}

/**
 * The links in an alert mail that may lead to a job: anchors with a title-like
 * text, never unsubscribe or settings links. Returns { url, title } in order.
 */
function alertLinks(html) {
  var out = [];
  var seen = {};
  var re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html))) {
    var url = decodeEntities(m[1]).trim();
    if (!/^https?:\/\//i.test(url)) continue;
    var title = text(m[2]);
    if (NEVER.test(url) || NEVER.test(title)) continue;
    var known = seen[url];
    if (known) {
      if (!known.title && looksLikeTitle(title)) known.title = title;
      continue;
    }
    var link = { url: url, title: looksLikeTitle(title) ? title : '' };
    seen[url] = link;
    out.push(link);
  }
  return out;
}

function looksLikeTitle(t) {
  return t.length >= 6 && t.length <= 160 && !/^(apply|bewerben|jetzt bewerben|ansehen|view|details?|mehr|more|alle .*|all .*|show .*|zum job|zur stelle|job ansehen|stelle ansehen|see job|open)$/i.test(t);
}

/**
 * Turn the links of one mail into jobs. `resolve(url)` follows a tracking
 * link one step and returns where it points (or '' ). Links that are not a
 * job posting and cannot be resolved to one are dropped. Several links to
 * the same job (title, logo, "Apply") give one job, titled by the link
 * that had a title.
 */
function jobsFromAlert(html, resolve) {
  var byUrl = {};
  var order = [];
  alertLinks(html).forEach(function (link) {
    var url = link.url;
    // Only links with a title are followed: logos and buttons repeat a job already linked by its title.
    if (!link.title && !boardOf(url)) return;
    for (var hop = 0; hop < 3 && !isBoardJob(url) && !boardOf(url); hop++) {
      var next = resolve(url);
      if (!next || next === url) break;
      url = next;
    }
    if (!isBoardJob(url)) return;
    var clean = cleanUrl(url);
    var job = byUrl[clean];
    if (!job) {
      job = byUrl[clean] = { url: clean, title: '', source: boardOf(clean).name };
      order.push(clean);
    }
    if (!job.title && link.title) job.title = link.title;
  });
  return order.map(function (u) { return byUrl[u]; });
}

/** Add alert jobs, grouped by board, skipping titles with a word to avoid. Returns the number added. */
function addAlertJobs(doc, jobs, now, newId) {
  var avoid = splitList(doc.settings && doc.settings.profile && doc.settings.profile.avoid);
  var keep = jobs.filter(function (j) {
    var t = (j.title || '').toLowerCase();
    return !avoid.some(function (w) { return t.indexOf(w) !== -1; });
  });
  var bySource = {};
  keep.forEach(function (j) { (bySource[j.source] = bySource[j.source] || []).push(j); });
  var added = 0;
  Object.keys(bySource).forEach(function (name) {
    added += addJobs(doc, { name: name, kind: 'board' }, bySource[name], now, newId);
  });
  return added;
}

/** The Drive id in a pasted link (or the id itself). */
function fileIdOf(s) {
  var m = String(s || '').match(/\/d\/([A-Za-z0-9_-]{20,})/) || String(s || '').match(/[?&]id=([A-Za-z0-9_-]{20,})/) || String(s || '').match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : '';
}

// ===========================================================================
// Apps Script only: everything below uses Google services.

/** Run once in the alerts account: checks access to jobs.json, schedules the hourly run, runs once. */
function setupAlerts() {
  alertsFile_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runAlerts') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runAlerts').timeBased().everyHours(1).create();
  runAlerts();
}

/** Reads new alert mails and adds their jobs. Can be run by hand. */
function runAlerts() {
  var file = alertsFile_();
  var label = GmailApp.getUserLabelByName(ALERTS_LABEL) || GmailApp.createLabel(ALERTS_LABEL);
  var threads = GmailApp.search(ALERTS_QUERY, 0, 50);
  var redirects = 0;
  var resolve = function (url) {
    if (redirects >= MAX_REDIRECTS_PER_RUN) return '';
    redirects++;
    try {
      var r = UrlFetchApp.fetch(url, { followRedirects: false, muteHttpExceptions: true });
      var headers = r.getAllHeaders();
      var loc = headers.Location || headers.location || '';
      return Array.isArray(loc) ? loc[0] : loc;
    } catch (e) {
      return '';
    }
  };
  var jobs = [];
  var mails = 0;
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      mails++;
      jobs = jobs.concat(jobsFromAlert(msg.getBody(), resolve));
    });
  });

  var doc = JSON.parse(file.getBlob().getDataAsString());
  var now = new Date().toISOString();
  var added = jobs.length ? addAlertJobs(doc, jobs, now, Utilities.getUuid) : 0;
  doc.settings = doc.settings || {};
  doc.settings.alertLog = { at: now, mails: mails, found: jobs.length, added: added };
  if (mails) {
    doc.savedAt = now;
    file.setContent(JSON.stringify(doc, null, 2));
  }
  // Mark the mails only after jobs.json was written, so a failed run is retried.
  threads.forEach(function (thread) { thread.addLabel(label); });
  Logger.log(mails + ' mails, ' + jobs.length + ' job links, ' + added + ' new jobs.');
}

function alertsFile_() {
  var id = fileIdOf(JOBS_FILE);
  if (!id) throw new Error('Paste the link of jobs.json into JOBS_FILE at the top of AlertsImport.gs first.');
  return DriveApp.getFileById(id);
}
