/**
 * Jobs import helper (Google Apps Script).
 *
 * Runs in my own Google account, once a day. Reads the source list and the
 * profile from jobs.json in Drive, asks every source that allows automated
 * reading for new openings, and adds the matching ones to jobs.json as
 * "To judge". The Jobs app picks them up the next time it opens.
 *
 * Setup (once): see helpers/jobs-import/README.md. In short: new project
 * at script.google.com, paste this file, run `setup`, allow access.
 *
 * Only sources marked as automatic in the app are read, one request per
 * search and a pause between requests. Boards whose terms forbid bots are
 * never read; they stay manual (e-mail alerts, "Import from page").
 *
 * The functions above the line "Apps Script only" use no Google services,
 * so tests/jobs-import.test.mjs can run them in Node.
 */

var IMPORT_VERSION = 1;
var DRIVE_FOLDER = 'Personal Apps';
var FILE_NAME = 'jobs.json';
var DEFAULT_TERMS = ['software', 'developer', 'entwickler', 'engineer', 'ingenieur', 'fullstack', 'full stack', 'full-stack', 'backend', 'frontend', 'devops', 'cloud', 'architect', '.net', 'data'];
var SWISS_PLACES = ['switzerland', 'schweiz', 'suisse', 'svizzera', ', ch', ' ch,', 'zürich', 'zurich', 'zuerich', 'winterthur', 'baden', 'zug', 'basel', 'bern', 'luzern', 'lucerne', 'aarau', 'st. gallen', 'geneva', 'genève', 'geneve', 'lausanne', 'schlieren', 'dübendorf', 'wallisellen', 'kloten', 'rotkreuz', 'ebikon', 'thalwil', 'remote'];
var MAX_SEEN = 5000;

// ---------------------------------------------------------------------------
// Which reader fits a source's link. Must agree with readerFor in
// apps/jobs/sources.js (a test checks this).

function readerFor(url) {
  var m;
  var u = String(url || '');
  if ((m = u.match(/^https:\/\/(?:job-boards|boards)(\.eu)?\.greenhouse\.io\/([A-Za-z0-9_-]+)/))) {
    return { type: 'greenhouse', api: 'https://boards-api' + (m[1] || '') + '.greenhouse.io/v1/boards/' + m[2] + '/jobs' };
  }
  if ((m = u.match(/^https:\/\/(([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/))) {
    return { type: 'workday', host: m[1], tenant: m[2], site: m[3] };
  }
  if ((m = u.match(/^https:\/\/(careers\.swissre\.com|job\.schindler\.com)/))) {
    return { type: 'csb', base: 'https://' + m[1] };
  }
  if ((m = u.match(/^https:\/\/(careers\.roche\.com|careers\.siemens-healthineers\.com)\//))) {
    return { type: 'phenom', base: 'https://' + m[1] + '/global/en' };
  }
  if (/^https:\/\/www\.novartis\.com\/careers/.test(u)) return { type: 'novartis', base: 'https://www.novartis.com' };
  if (/^https:\/\/(www\.)?talendo\.ch\//.test(u)) return { type: 'links', page: 'https://talendo.ch/en', swiss: true };
  if (/^https:\/\/jobs\.nzz\.ch\//.test(u)) return { type: 'links', page: 'https://jobs.nzz.ch/job/alle-jobs-im-kanton-Z%C3%BCrich', swiss: true };
  return null;
}

// ---- parsing the answers ---------------------------------------------------

function parseGreenhouse(data) {
  return ((data && data.jobs) || []).map(function (j) {
    return { title: j.title || '', url: j.absolute_url || '', location: (j.location && j.location.name) || '' };
  });
}

function workdayBody(term, offset) {
  return { appliedFacets: {}, limit: 20, offset: offset || 0, searchText: term };
}

function parseWorkday(data, reader) {
  return ((data && data.jobPostings) || []).map(function (p) {
    return {
      title: p.title || '',
      url: 'https://' + reader.host + '/en-US/' + reader.site + (p.externalPath || ''),
      location: p.locationsText || '',
    };
  });
}

/** SAP SuccessFactors career sites ("Career Site Builder"): search result rows. */
function parseCsb(html, base) {
  var out = [];
  var seen = {};
  var re = /<a[^>]*class="[^"]*jobTitle-link[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
  var m;
  while ((m = re.exec(html))) {
    var tag = m[0];
    var href = (tag.match(/href="([^"]+)"/i) || [])[1];
    if (!href) continue;
    var url = absolute(href, base);
    if (seen[url]) continue;
    seen[url] = true;
    var rest = html.slice(re.lastIndex, re.lastIndex + 2000);
    var loc = (rest.match(/class="[^"]*jobLocation[^"]*"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '';
    out.push({ title: text(tag), url: url, location: text(loc) });
  }
  return out;
}

/**
 * Phenom career sites (Roche, Siemens Healthineers): the search page embeds
 * its results as JSON ("phApp.ddo"), under eagerLoadRefineSearch.data.jobs.
 */
function parsePhenom(html, base) {
  var start = html.indexOf('phApp.ddo');
  if (start === -1) return [];
  var open = html.indexOf('{', start);
  var data;
  try {
    data = JSON.parse(balanced(html, open));
  } catch (e) {
    return [];
  }
  var jobs = (data && data.eagerLoadRefineSearch && data.eagerLoadRefineSearch.data && data.eagerLoadRefineSearch.data.jobs) || [];
  return jobs.map(function (j) {
    var id = j.jobSeqNo || j.jobId || j.reqId || '';
    var slug = String(j.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var where = [j.city, j.state, j.country].filter(Boolean).join(', ') || j.location || '';
    return { title: j.title || '', url: id ? base + '/job/' + id + '/' + slug : '', location: where };
  }).filter(function (j) { return j.url; });
}

/** Novartis: search result rows link to /careers/career-search/job/details/req-<id>-<slug>. */
function parseNovartis(html, base) {
  var out = [];
  var seen = {};
  var rows = html.split(/<tr\b/i);
  rows.forEach(function (row) {
    var m = row.match(/<a\b[^>]*href="([^"]*\/careers\/career-search\/job\/details\/req-[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!m) return;
    var url = absolute(decodeEntities(m[1]), base);
    if (seen[url]) return;
    seen[url] = true;
    var rowText = text(row.replace(/^[^>]*>/, ''));
    var title = text(m[2]);
    out.push({ title: title, url: url, location: rowText.replace(title, '').trim() });
  });
  return out;
}

/** The JSON object starting at `open` (a "{"), with strings and nesting respected. */
function balanced(s, open) {
  var depth = 0;
  var inStr = false;
  for (var i = open; i < s.length; i++) {
    var c = s.charAt(i);
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced JSON');
}

/**
 * Any listing page: links whose address carries a job id (5 or more digits)
 * and whose text looks like a title. Used for boards that allow reading but
 * have no feed.
 */
function parseLinks(html, base) {
  var out = [];
  var seen = {};
  var host = hostOf(base);
  var re = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html))) {
    var url = absolute(decodeEntities(m[1]), base);
    if (hostOf(url) !== host || seen[url]) continue;
    if (!/\d{5,}/.test(url.split('?')[0])) continue;
    var title = text(m[2]);
    if (title.length < 8 || title.length > 160) continue;
    seen[url] = true;
    out.push({ title: title, url: url, location: '' });
  }
  return out;
}

// ---- choosing what to add --------------------------------------------------

function splitList(s) {
  return String(s || '')
    .split(/[,;\n]/)
    .map(function (x) { return x.trim().toLowerCase(); })
    .filter(Boolean);
}

/** The search words: from the profile's roles, or a default set for software jobs. */
function searchTerms(profile) {
  var roles = splitList(profile && profile.roles);
  return roles.length ? roles : DEFAULT_TERMS;
}

/** Does a found job fit the profile? `swiss` is true for Swiss-only boards. */
function fits(job, profile, swiss) {
  var title = (job.title || '').toLowerCase();
  if (!title) return false;
  var terms = searchTerms(profile);
  if (!terms.some(function (t) { return title.indexOf(t) !== -1; })) return false;
  var avoid = splitList(profile && profile.avoid);
  if (avoid.some(function (t) { return title.indexOf(t) !== -1; })) return false;
  if (swiss) return true;
  var loc = ' ' + (job.location || '').toLowerCase() + ' ';
  if (!SWISS_PLACES.some(function (p) { return loc.indexOf(p) !== -1; })) return false;
  var wanted = splitList(profile && profile.locations);
  if (!wanted.length) return true;
  return wanted.some(function (p) { return loc.indexOf(p) !== -1; });
}

function cleanUrl(url) {
  var s = String(url || '').trim().replace(/#.*$/, '');
  var parts = s.split('?');
  if (parts.length < 2) return s;
  var kept = parts[1].split('&').filter(function (kv) {
    return kv && !/^(utm_|ref|refid|trk|trackingid|src|source|campaign|mc_|fbclid|gclid)/i.test(kv);
  });
  return parts[0] + (kept.length ? '?' + kept.join('&') : '');
}

/**
 * Add new jobs to the document. A job counts as known when its link is in
 * the list or was imported before (so a job I deleted does not come back).
 * Returns the number added.
 */
function addJobs(doc, source, jobs, now, newId) {
  doc.collections = doc.collections || {};
  var list = (doc.collections.jobs = doc.collections.jobs || []);
  doc.settings = doc.settings || {};
  var seenList = doc.settings.importSeen || [];
  var known = {};
  list.forEach(function (j) { if (j.url) known[cleanUrl(j.url)] = true; });
  seenList.forEach(function (u) { known[u] = true; });
  var today = now.slice(0, 10);
  var added = 0;
  jobs.forEach(function (job) {
    var url = cleanUrl(job.url);
    if (!url || known[url]) return;
    known[url] = true;
    seenList.push(url);
    list.push({
      id: newId(),
      title: job.title,
      company: source.kind === 'company' ? source.name : job.company || '',
      location: job.location || '',
      url: url,
      source: source.name,
      status: 'found',
      foundOn: today,
      importedBy: 'helper',
      history: [{ status: 'found', date: today }],
      createdAt: now,
      updatedAt: now,
    });
    added += 1;
  });
  doc.settings.importSeen = seenList.slice(-MAX_SEEN);
  return added;
}

/** The sources to read: marked automatic, followed, with a reader. */
function autoSources(doc) {
  return ((doc.collections && doc.collections.sources) || []).filter(function (s) {
    return !s.skip && (s.access === 'feed' || s.access === 'read') && readerFor(s.url);
  });
}

// ---- small helpers ---------------------------------------------------------

function absolute(href, base) {
  if (/^https?:\/\//i.test(href)) return href;
  var origin = base.match(/^https?:\/\/[^/]+/)[0];
  if (href.charAt(0) === '/') return origin + href;
  return base.replace(/[^/]*$/, '') + href;
}

function hostOf(url) {
  var m = String(url).match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); });
}

function text(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// ===========================================================================
// Apps Script only: everything below uses Google services.

/** Run once: checks access to jobs.json and schedules the daily import. */
function setup() {
  findFile_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runImport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runImport').timeBased().everyDays(1).atHour(6).create();
  runImport();
}

/** The daily import. Can also be run by hand from the editor. */
function runImport() {
  var file = findFile_();
  var doc = JSON.parse(file.getBlob().getDataAsString());
  var profile = (doc.settings && doc.settings.profile) || {};
  var results = [];
  var found = {};
  autoSources(doc).forEach(function (source) {
    var result = { id: source.id, name: source.name, found: 0, added: 0, error: '' };
    try {
      var jobs = fetchSource_(source, profile).filter(function (j) {
        return fits(j, profile, readerFor(source.url).swiss);
      });
      result.found = jobs.length;
      found[source.id] = jobs;
    } catch (err) {
      result.error = String((err && err.message) || err).slice(0, 200);
    }
    results.push(result);
  });

  // Read the file again just before writing, so changes made in the app
  // during the run are kept.
  var fresh = JSON.parse(file.getBlob().getDataAsString());
  var now = new Date().toISOString();
  autoSources(fresh).forEach(function (source) {
    var r = results.filter(function (x) { return x.id === source.id; })[0];
    if (r && found[source.id]) r.added = addJobs(fresh, source, found[source.id], now, Utilities.getUuid);
  });
  fresh.settings = fresh.settings || {};
  fresh.settings.importLog = { at: now, version: IMPORT_VERSION, sources: results };
  fresh.savedAt = now;
  file.setContent(JSON.stringify(fresh, null, 2));
  Logger.log(results.map(function (r) { return r.name + ': ' + (r.error ? 'error ' + r.error : r.added + ' new of ' + r.found); }).join('\n'));
}

function fetchSource_(source, profile) {
  var reader = readerFor(source.url);
  var terms = searchTerms(profile).slice(0, 4);
  var jobs = [];
  if (reader.type === 'greenhouse') {
    jobs = parseGreenhouse(getJson_(reader.api));
  } else if (reader.type === 'workday') {
    var api = 'https://' + reader.host + '/wday/cxs/' + reader.tenant + '/' + reader.site + '/jobs';
    terms.forEach(function (term) {
      jobs = jobs.concat(parseWorkday(postJson_(api, workdayBody(term, 0)), reader));
      Utilities.sleep(1500);
    });
  } else if (reader.type === 'csb') {
    terms.forEach(function (term) {
      var url = reader.base + '/search/?q=' + encodeURIComponent(term) + '&sortColumn=referencedate&sortDirection=desc';
      jobs = jobs.concat(parseCsb(getText_(url), reader.base));
      Utilities.sleep(1500);
    });
  } else if (reader.type === 'phenom') {
    terms.forEach(function (term) {
      var url = reader.base + '/search-results?keywords=' + encodeURIComponent(term) + '&location=Switzerland';
      jobs = jobs.concat(parsePhenom(getText_(url), reader.base));
      Utilities.sleep(2000);
    });
  } else if (reader.type === 'novartis') {
    terms.forEach(function (term) {
      var url = reader.base + '/careers/career-search?search_api_fulltext=' + encodeURIComponent(term) + '&country%5B0%5D=LOC_CH';
      jobs = jobs.concat(parseNovartis(getText_(url), reader.base));
      Utilities.sleep(2000);
    });
  } else if (reader.type === 'links') {
    var page = reader.page.replace('SEARCH', encodeURIComponent(terms[0]));
    jobs = parseLinks(getText_(page), page);
  }
  var seen = {};
  return jobs.filter(function (j) {
    if (seen[j.url]) return false;
    seen[j.url] = true;
    return true;
  });
}

function fetch_(url, options) {
  var response = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true, followRedirects: true }, options || {}));
  var code = response.getResponseCode();
  if (code >= 400) throw new Error('HTTP ' + code + ' from ' + hostOf(url));
  return response.getContentText();
}

function getText_(url) {
  return fetch_(url, { headers: { Accept: 'text/html' } });
}

function getJson_(url) {
  return JSON.parse(fetch_(url, { headers: { Accept: 'application/json' } }));
}

function postJson_(url, body) {
  return JSON.parse(
    fetch_(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(body), headers: { Accept: 'application/json' } }),
  );
}

function findFile_() {
  var best = null;
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER);
  while (folders.hasNext()) {
    var files = folders.next().getFilesByName(FILE_NAME);
    while (files.hasNext()) {
      var f = files.next();
      if (!f.isTrashed() && (!best || f.getLastUpdated() > best.getLastUpdated())) best = f;
    }
  }
  if (!best) throw new Error('No ' + FILE_NAME + ' in the Drive folder "' + DRIVE_FOLDER + '". Open the Jobs app once first.');
  return best;
}
