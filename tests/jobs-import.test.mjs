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
  assert.equal(gs.readerFor('https://careers.roche.com/global/en').base, 'https://careers.roche.com/global/en');
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
