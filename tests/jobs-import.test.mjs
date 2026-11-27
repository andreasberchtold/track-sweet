// The import helper (Google Apps Script) without Google: its plain
// functions are loaded into a sandbox and run with sample answers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { DEFAULT_SOURCES, readerFor as appReaderFor } from '../apps/jobs/sources.js';

const code = readFileSync(new URL('../helpers/jobs-import/JobsImport.gs', import.meta.url), 'utf8');
const gs = vm.createContext({});
vm.runInContext(code, gs);

test('the app and the helper agree on which sources are read automatically', () => {
  const extra = [
    'https://boards.greenhouse.io/example',
    'https://acme.wd1.myworkdayjobs.com/External',
    'https://www.jobs.ch/en/vacancies/',
    'https://talendo.ch/en',
  ];
  for (const url of [...DEFAULT_SOURCES.map((s) => s.url), ...extra]) {
    const r = gs.readerFor(url);
    assert.equal(r ? r.type : null, appReaderFor(url), url);
  }
});

test('readerFor builds the API addresses', () => {
  assert.equal(gs.readerFor('https://job-boards.greenhouse.io/proton').api, 'https://boards-api.greenhouse.io/v1/boards/proton/jobs');
  assert.equal(gs.readerFor('https://job-boards.eu.greenhouse.io/proton/jobs/1').api, 'https://boards-api.eu.greenhouse.io/v1/boards/proton/jobs');
  const wd = gs.readerFor('https://swisscom.wd103.myworkdayjobs.com/en-US/SwisscomExternalCareers');
  assert.deepEqual({ ...wd }, { type: 'workday', host: 'swisscom.wd103.myworkdayjobs.com', tenant: 'swisscom', site: 'SwisscomExternalCareers' });
  assert.equal(gs.readerFor('https://zuehlke.wd3.myworkdayjobs.com/Zuhlke-Careers').site, 'Zuhlke-Careers');
});

test('parseGreenhouse and parseWorkday read the job lists', () => {
  const gh = gs.parseGreenhouse({ jobs: [{ id: 1, title: 'Backend Engineer', absolute_url: 'https://job-boards.greenhouse.io/x/jobs/1', location: { name: 'Zurich' } }] });
  assert.deepEqual(JSON.parse(JSON.stringify(gh)), [{ title: 'Backend Engineer', url: 'https://job-boards.greenhouse.io/x/jobs/1', location: 'Zurich' }]);
  const reader = { host: 'acme.wd3.myworkdayjobs.com', site: 'Careers' };
  const wd = gs.parseWorkday({ total: 1, jobPostings: [{ title: 'Software Engineer', externalPath: '/job/Zurich/Software-Engineer_R1', locationsText: 'Zürich' }] }, reader);
  assert.equal(wd[0].url, 'https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Zurich/Software-Engineer_R1');
  assert.equal(wd[0].location, 'Zürich');
  assert.equal(gs.parseWorkday({}, reader).length, 0);
});

test('parseCsb reads SuccessFactors result rows once each', () => {
  const html = `
    <tr class="data-row"><td><span class="jobTitle hidden-phone">
      <a href="/job/Zurich-Software-Engineer/123456/" class="jobTitle-link">Software Engineer &amp; Architect</a></span>
      <span class="jobLocation">Zurich, CH</span></td></tr>
    <div class="visible-phone"><a href="/job/Zurich-Software-Engineer/123456/" class="jobTitle-link">Software Engineer &amp; Architect</a></div>`;
  const jobs = gs.parseCsb(html, 'https://careers.example.com');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Software Engineer & Architect');
  assert.equal(jobs[0].url, 'https://careers.example.com/job/Zurich-Software-Engineer/123456/');
  assert.equal(jobs[0].location, 'Zurich, CH');
});

test('parseLinks keeps same-site links with a job id and a title', () => {
  const html = `<a href="/en/jobs/senior-developer-12345">Senior Developer (80-100%)</a>
    <a href="/en/jobs/senior-developer-12345">Senior Developer (80-100%)</a>
    <a href="/en/about">About us and our mission</a>
    <a href="https://other.ch/job/99999">Elsewhere Developer</a>
    <a href="/job/77777">Go</a>`;
  const jobs = gs.parseLinks(html, 'https://talendo.ch/en');
  assert.deepEqual([...jobs.map((j) => j.url)], ['https://talendo.ch/en/jobs/senior-developer-12345']);
});

test('fits checks title words, words to avoid and Swiss locations', () => {
  const p = {};
  assert.ok(gs.fits({ title: 'Senior Software Engineer', location: 'Zürich, Switzerland' }, p, false));
  assert.ok(!gs.fits({ title: 'Senior Software Engineer', location: 'Berlin, Germany' }, p, false));
  assert.ok(!gs.fits({ title: 'Accountant', location: 'Zürich' }, p, false));
  assert.ok(gs.fits({ title: 'Software Engineer', location: '' }, p, true), 'Swiss-only boards skip the location check');
  const profile = { roles: 'Fullstack, .NET', avoid: 'SAP', locations: 'Zurich, Baden' };
  assert.ok(gs.fits({ title: '.NET Developer', location: 'Baden' }, profile, false));
  assert.ok(!gs.fits({ title: 'SAP .NET Developer', location: 'Zurich' }, profile, false));
  assert.ok(!gs.fits({ title: 'Fullstack Engineer', location: 'Basel' }, profile, false));
});

test('addJobs adds new jobs once and remembers imported links', () => {
  const doc = { collections: { jobs: [{ id: 'a', url: 'https://x.ch/job/1' }], sources: [] }, settings: {} };
  let n = 0;
  const id = () => `id${++n}`;
  const src = { name: 'Acme', kind: 'company' };
  const now = '2026-11-16T06:00:00.000Z';
  const found = [
    { title: 'Dev', url: 'https://x.ch/job/1?utm_source=feed' },
    { title: 'Dev 2', url: 'https://x.ch/job/2', location: 'Zurich' },
    { title: 'Dev 2', url: 'https://x.ch/job/2' },
  ];
  assert.equal(gs.addJobs(doc, src, found, now, id), 1);
  const job = doc.collections.jobs[1];
  assert.equal(job.status, 'found');
  assert.equal(job.company, 'Acme');
  assert.equal(job.source, 'Acme');
  assert.equal(job.foundOn, '2026-11-16');
  assert.deepEqual(JSON.parse(JSON.stringify(job.history)), [{ status: 'found', date: '2026-11-16' }]);
  // Deleted in the app: does not come back.
  doc.collections.jobs.pop();
  assert.equal(gs.addJobs(doc, src, found, now, id), 0);
});

test('autoSources takes followed automatic sources with a reader', () => {
  const doc = {
    collections: {
      sources: [
        { name: 'A', access: 'feed', url: 'https://acme.wd3.myworkdayjobs.com/Careers' },
        { name: 'B', access: 'feed', url: 'https://acme.wd3.myworkdayjobs.com/Careers', skip: true },
        { name: 'C', access: 'alert', url: 'https://www.jobs.ch/' },
        { name: 'D', access: 'feed', url: 'https://www.sonova.com/en/careers' },
      ],
    },
  };
  assert.deepEqual([...gs.autoSources(doc).map((s) => s.name)], ['A']);
});

test('readerFor knows Phenom sites and Novartis', () => {
  assert.equal(gs.readerFor('https://careers.siemens-healthineers.com/global/en').base, 'https://careers.siemens-healthineers.com/global/en');
  assert.equal(gs.readerFor('https://careers.siemens-healthineers.com/global/en').type, 'phenom');
  assert.equal(gs.readerFor('https://www.novartis.com/careers/career-search').type, 'novartis');
  assert.equal(gs.readerFor('https://onehealthineers.wd3.myworkdayjobs.com/SHSJB').site, 'SHSJB');
});

test('parsePhenom reads the jobs embedded in the search page', () => {
  const ddo = {
    siteConfig: { note: 'a } inside a string' },
    eagerLoadRefineSearch: {
      status: 200,
      data: { jobs: [{ title: 'Senior Software Engineer (Diagnostics)', jobSeqNo: 'ROCHGLOBAL202611001EXTERNALENGLOBAL', city: 'Rotkreuz', country: 'Switzerland' }] },
    },
  };
  const html = `<html><script>var phApp = phApp || {}; phApp.ddo = ${JSON.stringify(ddo)}; phApp.other = {};</script></html>`;
  const jobs = gs.parsePhenom(html, 'https://careers.roche.com/global/en');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, 'https://careers.roche.com/global/en/job/ROCHGLOBAL202611001EXTERNALENGLOBAL/senior-software-engineer-diagnostics');
  assert.equal(jobs[0].location, 'Rotkreuz, Switzerland');
  assert.equal(gs.parsePhenom('<html>no data</html>', 'x').length, 0);
});

test('parseNovartis reads result rows with their location', () => {
  const html = `<table><tbody>
    <tr><td><a href="/careers/career-search/job/details/req-10089048-forward-deployed-engineer">Forward Deployed Engineer (FDE)</a></td><td>Switzerland</td><td>Basel (City)</td></tr>
    <tr><td><a href="/careers/career-search/job/details/req-10090000-senior-ai-engineer">Senior AI Engineer</a></td><td>Czech Republic</td><td>Prague</td></tr>
  </tbody></table>`;
  const jobs = gs.parseNovartis(html, 'https://www.novartis.com');
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].url, 'https://www.novartis.com/careers/career-search/job/details/req-10089048-forward-deployed-engineer');
  assert.ok(gs.fits(jobs[0], {}, false));
  assert.ok(!gs.fits(jobs[1], {}, false), 'a job outside Switzerland is dropped');
});

test('locations: cantons cover their towns, spellings without umlauts match', () => {
  const at = (location, locations) => gs.fits({ title: 'Software Engineer', location }, { locations }, false);
  assert.ok(at('Aarau, Switzerland', 'Aargau'), 'town in the canton');
  assert.ok(at('Baden-Dättwil, AG, CH', 'Aargau'));
  assert.ok(at('Rotkreuz', 'ZG'), 'canton code');
  assert.ok(at('Zürich', 'Zurich') && at('Zuerich, ZH', 'Zurich') && at('Zurich', 'Zürich'), 'umlaut spellings');
  assert.ok(!at('Basel', 'Aargau, Zurich'));
  assert.ok(at('Basel, Switzerland', 'Switzerland'));
  assert.ok(at('Remote', 'remote'));
  assert.ok(!at('Badenweiler, Germany', ''), 'whole words only, and Swiss');
  assert.ok(!at('Munich, Germany', ''));
  assert.ok(gs.fits({ title: 'Developer', location: '' }, { locations: 'Aargau' }, true), 'Swiss board without location');
  assert.ok(!gs.fits({ title: 'Developer', location: 'Bern' }, { locations: 'Aargau' }, true), 'Swiss board with a location outside');
});

// ---- e-mail alerts (AlertsImport.gs runs in the same project as JobsImport.gs)
vm.runInContext(readFileSync(new URL('../helpers/jobs-import/AlertsImport.gs', import.meta.url), 'utf8'), gs);

test('isBoardJob knows job links on the boards that send alerts', () => {
  assert.ok(gs.isBoardJob('https://www.jobs.ch/de/stellenangebote/detail/1b2c3d4e-5f60-7a8b-9c0d-112233445566/'));
  assert.ok(!gs.isBoardJob('https://www.jobs.ch/de/stellenangebote/?term=software'));
  assert.ok(gs.isBoardJob('https://www.jobscout24.ch/de/job/1234567/'));
  assert.ok(gs.isBoardJob('https://www.jobscout24.ch/de/jobs/software-engineer-zuerich-1234567/'));
  assert.ok(!gs.isBoardJob('https://www.jobscout24.ch/de/'));
  assert.ok(gs.isBoardJob('https://www.linkedin.com/jobs/view/4242/'));
  assert.ok(!gs.isBoardJob('https://example.ch/job/12345'));
});

test('jobsFromAlert reads direct and tracked links, never unsubscribe links', () => {
  const html = `
    <a href="https://www.jobs.ch/de/stellenangebote/detail/aaa-111/?utm_source=jobmail&amp;utm_medium=email"><img src="logo.png"></a>
    <a href="https://www.jobs.ch/de/stellenangebote/detail/aaa-111/?utm_source=jobmail">Senior Software Engineer (80-100%)</a>
    <a href="https://track.example.net/c/xyz">Backend Developer .NET</a>
    <a href="https://track.example.net/c/logo"><img src="x.png"></a>
    <a href="https://track.example.net/c/unsub">Abmelden</a>
    <a href="https://www.jobs.ch/de/einstellungen/jobmail/">Jobmail-Einstellungen</a>
    <a href="https://www.jobs.ch/de/stellenangebote/?term=software">Alle Jobs ansehen</a>`;
  const followed = [];
  const resolve = (url) => {
    followed.push(url);
    return url === 'https://track.example.net/c/xyz' ? 'https://www.jobscout24.ch/de/job/7654321/?utm_campaign=alert' : '';
  };
  const jobs = gs.jobsFromAlert(html, resolve);
  assert.deepEqual(JSON.parse(JSON.stringify(jobs)), [
    { url: 'https://www.jobs.ch/de/stellenangebote/detail/aaa-111/', title: 'Senior Software Engineer (80-100%)', source: 'jobs.ch' },
    { url: 'https://www.jobscout24.ch/de/job/7654321/', title: 'Backend Developer .NET', source: 'JobScout24' },
  ]);
  assert.deepEqual([...followed], ['https://track.example.net/c/xyz'], 'only the titled tracking link is followed');
});

test('addAlertJobs adds by board, skips words to avoid and known links', () => {
  const doc = { collections: { jobs: [] }, settings: { profile: { avoid: 'SAP' } } };
  let n = 0;
  const jobs = [
    { url: 'https://www.jobs.ch/de/stellenangebote/detail/a/', title: 'Software Engineer', source: 'jobs.ch' },
    { url: 'https://www.jobs.ch/de/stellenangebote/detail/b/', title: 'SAP Developer', source: 'jobs.ch' },
    { url: 'https://www.jobscout24.ch/de/job/1234567/', title: 'Data Engineer', source: 'JobScout24' },
  ];
  assert.equal(gs.addAlertJobs(doc, jobs, '2026-11-18T10:00:00.000Z', () => `id${++n}`), 2);
  assert.deepEqual([...doc.collections.jobs.map((j) => j.source)], ['jobs.ch', 'JobScout24']);
  assert.equal(doc.collections.jobs[0].status, 'found');
  assert.equal(gs.addAlertJobs(doc, jobs, '2026-11-18T11:00:00.000Z', () => `id${++n}`), 0);
});

test('addAlertJobs reports the new job ids and the result per board', () => {
  const doc = { collections: { jobs: [] }, settings: { profile: { avoid: 'SAP' } } };
  let n = 0;
  const jobs = [
    { url: 'https://www.jobs.ch/de/stellenangebote/detail/a/', title: 'Software Engineer', source: 'jobs.ch' },
    { url: 'https://www.jobs.ch/de/stellenangebote/detail/b/', title: 'SAP Developer', source: 'jobs.ch' },
    { url: 'https://www.jobscout24.ch/de/job/1234567/', title: 'Data Engineer', source: 'JobScout24' },
  ];
  const report = {};
  gs.addAlertJobs(doc, jobs, '2026-11-18T10:00:00.000Z', () => `id${++n}`, report);
  assert.deepEqual([...report.ids], ['id1', 'id2']);
  assert.deepEqual(JSON.parse(JSON.stringify(report.sources)), [
    { name: 'jobs.ch', found: 2, added: 1, error: '' },
    { name: 'JobScout24', found: 1, added: 1, error: '' },
  ]);
});

test('addHistory keeps the newest runs first and at most 200', () => {
  const doc = { settings: {} };
  for (let i = 0; i < 205; i++) gs.addHistory(doc, { at: `run${i}`, kind: 'sources', added: 0 });
  assert.equal(doc.settings.importHistory.length, 200);
  assert.equal(doc.settings.importHistory[0].at, 'run204');
  assert.equal(doc.settings.importHistory[199].at, 'run5');
});

test('fileIdOf takes the id from a Drive link', () => {
  assert.equal(gs.fileIdOf('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing'), '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.equal(gs.fileIdOf('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345'), '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.equal(gs.fileIdOf(''), '');
});

test('Roche is read from its Workday site', () => {
  const r = gs.readerFor('https://roche.wd3.myworkdayjobs.com/roche-ext');
  assert.deepEqual({ ...r }, { type: 'workday', host: 'roche.wd3.myworkdayjobs.com', tenant: 'roche', site: 'roche-ext' });
});

test('workdaySwissFacet finds the Switzerland filter, also inside location groups', () => {
  const flat = { facets: [{ facetParameter: 'locationCountry', values: [{ descriptor: 'Germany', id: 'de1' }, { descriptor: 'Switzerland', id: 'ch1' }] }] };
  assert.deepEqual(JSON.parse(JSON.stringify(gs.workdaySwissFacet(flat))), { locationCountry: ['ch1'] });
  const grouped = {
    facets: [
      { facetParameter: 'jobFamilyGroup', values: [{ descriptor: 'IT', id: 'it' }] },
      { facetParameter: 'locationMainGroup', values: [{ facetParameter: 'Location_Country', descriptor: 'Country', values: [{ descriptor: 'Switzerland', id: 'ch2' }] }] },
    ],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(gs.workdaySwissFacet(grouped))), { Location_Country: ['ch2'] });
  assert.equal(gs.workdaySwissFacet({ facets: [] }), null);
  assert.equal(gs.workdaySwissFacet(null), null);
});

test('Workday jobs filtered to Switzerland fit, also with several locations', () => {
  const reader = { host: 'roche.wd3.myworkdayjobs.com', site: 'roche-ext' };
  const data = { jobPostings: [
    { title: 'Senior Software Engineer', externalPath: '/job/Rotkreuz/Senior-Software-Engineer_202511-1', locationsText: 'Rotkreuz' },
    { title: 'Software Engineer', externalPath: '/job/Basel/Software-Engineer_202511-2', locationsText: '2 Locations' },
    { title: 'Software Engineer', externalPath: '/job/Basel/Software-Engineer_202511-3', locationsText: 'Basel' },
  ] };
  const jobs = gs.parseWorkday(data, reader, true);
  assert.equal(jobs[0].url, 'https://roche.wd3.myworkdayjobs.com/en-US/roche-ext/job/Rotkreuz/Senior-Software-Engineer_202511-1');
  assert.equal(jobs[1].location, '');
  const profile = { roles: 'software', locations: 'Zug' };
  assert.deepEqual(jobs.map((j) => gs.fits(j, profile, false)), [true, true, false]);
  // Without the filter, a job at "2 Locations" is not known to be Swiss.
  assert.equal(gs.fits(gs.parseWorkday(data, reader, false)[1], profile, false), false);
});

test('an old careers.roche.com link is read from Roche\'s Workday site', () => {
  assert.equal(gs.readerFor('https://careers.roche.com/global/en').site, 'roche-ext');
  assert.equal(gs.readerFor('https://careers.siemens-healthineers.com/global/en').type, 'phenom');
});

test('whyNot says why a job was left out', () => {
  const profile = { roles: 'software', avoid: 'sap', locations: 'Zug' };
  assert.equal(gs.whyNot({ title: 'Software Engineer', location: 'Rotkreuz' }, profile, false), '');
  assert.equal(gs.whyNot({ title: 'Lab Technician', location: 'Rotkreuz' }, profile, false), 'title has none of the keywords');
  assert.equal(gs.whyNot({ title: 'SAP Software Lead', location: 'Rotkreuz' }, profile, false), 'title contains "sap"');
  assert.equal(gs.whyNot({ title: 'Software Engineer', location: 'Basel' }, profile, false), 'not in your locations');
  assert.equal(gs.whyNot({ title: 'Software Engineer', location: 'Munich, Germany' }, profile, false), 'not in Switzerland');
});

test('workdaySwissFacet takes the Swiss towns when a site has no country filter', () => {
  const data = {
    facets: [
      { facetParameter: 'jobFamilyGroup', values: [{ descriptor: 'Basel Operations', id: 'fam' }] },
      { facetParameter: 'locations', values: [
        { descriptor: 'Rotkreuz', id: 'rk' },
        { descriptor: 'Basel', id: 'bs' },
        { descriptor: 'Welwyn', id: 'uk' },
        { descriptor: 'Sant Cugat del Vallès', id: 'es' },
        { descriptor: 'Remote', id: 'rem' },
      ] },
    ],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(gs.workdaySwissFacet(data))), { locations: ['rk', 'bs'] });
  assert.deepEqual([...gs.workdayFacetNames(data)], ['jobFamilyGroup (Basel Operations)', 'locations (Rotkreuz, Basel, Welwyn, ...)']);
});

test('workdaySwissFacet prefers the towns in my locations', () => {
  const data = { facets: [{ facetParameter: 'locations', values: [
    { descriptor: 'Rotkreuz', id: 'rk' }, { descriptor: 'Basel', id: 'bs' }, { descriptor: 'Kaiseraugst', id: 'ka' },
  ] }] };
  assert.deepEqual(JSON.parse(JSON.stringify(gs.workdaySwissFacet(data, ['zug', 'zurich']))), { locations: ['rk'] });
  assert.deepEqual(JSON.parse(JSON.stringify(gs.workdaySwissFacet(data, ['bern']))), { locations: ['rk', 'bs', 'ka'] }, 'none of mine: all Swiss towns');
});
