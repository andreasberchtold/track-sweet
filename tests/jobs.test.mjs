import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  cleanUrl,
  dueFollowUps,
  findDuplicate,
  findUrl,
  findWorkload,
  fromShared,
  importRuns,
  moveTo,
  reasonCounts,
  runLines,
  sortForView,
  sourceOf,
  viewOf,
} from '../apps/jobs/logic.js';

test('findUrl takes the first link and drops trailing punctuation', () => {
  assert.equal(findUrl('Look at this (https://www.jobs.ch/en/vacancies/detail/abc/).'), 'https://www.jobs.ch/en/vacancies/detail/abc/');
  assert.equal(findUrl('no link here'), '');
});

test('sourceOf names known job boards and falls back to the host', () => {
  assert.equal(sourceOf('https://www.jobs.ch/en/vacancies/detail/1/'), 'jobs.ch');
  assert.equal(sourceOf('https://ch.linkedin.com/jobs/view/123'), 'LinkedIn');
  assert.equal(sourceOf('https://boards.greenhouse.io/example/jobs/1'), 'Company site');
  assert.equal(sourceOf('https://careers.example.ch/job/1'), 'careers.example.ch');
  assert.equal(sourceOf('not a url'), '');
});

test('cleanUrl removes tracking parameters and the fragment', () => {
  assert.equal(
    cleanUrl('https://www.linkedin.com/jobs/view/123/?trackingId=abc&refId=x&utm_source=share#top'),
    'https://www.linkedin.com/jobs/view/123/',
  );
  assert.equal(cleanUrl('https://example.ch/job?id=7&utm_medium=mail'), 'https://example.ch/job?id=7');
});

test('findWorkload reads ranges and single values', () => {
  assert.equal(findWorkload('Software Engineer 80-100%'), '80–100%');
  assert.equal(findWorkload('Pensum: 80 – 100 %'), '80–100%');
  assert.equal(findWorkload('Teilzeit 60%'), '60%');
  assert.equal(findWorkload('Gain 5% more'), '');
  assert.equal(findWorkload('nothing'), '');
});

test('fromShared reads a jobs.ch style share', () => {
  const job = fromShared({
    title: 'Senior Software Engineer (80-100%) - Example AG - jobs.ch',
    text: 'https://www.jobs.ch/en/vacancies/detail/abc/?source=share',
  });
  assert.equal(job.title, 'Senior Software Engineer (80-100%)');
  assert.equal(job.company, 'Example AG');
  assert.equal(job.url, 'https://www.jobs.ch/en/vacancies/detail/abc/');
  assert.equal(job.source, 'jobs.ch');
  assert.equal(job.workload, '80–100%');
});

test('fromShared reads a LinkedIn style share', () => {
  const job = fromShared({ text: 'Example Corp hiring Fullstack Developer in Zurich | LinkedIn\nhttps://www.linkedin.com/jobs/view/42' });
  assert.equal(job.company, 'Example Corp');
  assert.equal(job.title, 'Fullstack Developer');
  assert.equal(job.source, 'LinkedIn');
});

test('fromShared with only a link leaves the title empty', () => {
  const job = fromShared({ url: 'https://careers.example.ch/job/1' });
  assert.equal(job.title, '');
  assert.equal(job.url, 'https://careers.example.ch/job/1');
  assert.equal(job.source, 'careers.example.ch');
});

test('findDuplicate compares cleaned links', () => {
  const jobs = [{ id: 'a', url: 'https://www.jobs.ch/en/vacancies/detail/abc/' }];
  assert.equal(findDuplicate(jobs, 'https://www.jobs.ch/en/vacancies/detail/abc/?utm_source=mail')?.id, 'a');
  assert.equal(findDuplicate(jobs, 'https://www.jobs.ch/en/vacancies/detail/xyz/'), null);
  assert.equal(findDuplicate(jobs, ''), null);
});

test('moveTo records history, the application date and a follow-up', () => {
  const job = { status: 'saved', history: [{ status: 'found', date: '2026-11-01' }] };
  const applied = moveTo(job, 'applied', '2026-11-15');
  assert.equal(applied.appliedOn, '2026-11-15');
  assert.equal(applied.followUpOn, '2026-11-25');
  assert.deepEqual(applied.history.at(-1), { status: 'applied', date: '2026-11-15' });
  assert.equal(job.history.length, 1, 'the original is not changed');

  const rejected = moveTo(applied, 'rejected', '2026-11-20');
  assert.equal(rejected.followUpOn, '');
  assert.equal(rejected.appliedOn, '2026-11-15');
  assert.throws(() => moveTo(job, 'nope', '2026-11-15'));
});

test('dueFollowUps lists open applications whose date has come', () => {
  const jobs = [
    { id: 1, status: 'applied', followUpOn: '2026-11-10' },
    { id: 2, status: 'applied', followUpOn: '2026-11-20' },
    { id: 3, status: 'rejected', followUpOn: '2026-11-01' },
    { id: 4, status: 'interview', followUpOn: '2026-11-05' },
  ];
  assert.deepEqual(dueFollowUps(jobs, '2026-11-15').map((j) => j.id), [4, 1]);
});

test('sortForView puts offers and interviews first among applications', () => {
  const jobs = [
    { id: 'a', status: 'applied', appliedOn: '2026-11-01' },
    { id: 'o', status: 'offer' },
    { id: 'i', status: 'interview' },
  ];
  assert.deepEqual(sortForView('active', jobs).map((j) => j.id), ['o', 'i', 'a']);
});

test('viewOf, reasonCounts and addDays', () => {
  assert.equal(viewOf('interview'), 'active');
  assert.equal(viewOf('dismissed'), 'closed');
  assert.deepEqual(
    reasonCounts([
      { verdict: 'yes', reasons: ['Domain'] },
      { verdict: 'no', reasons: ['Salary', 'Domain'] },
      { verdict: 'no', reasons: ['Salary'] },
      { reasons: ['ignored'] },
    ]),
    { yes: { Domain: 1 }, no: { Salary: 2, Domain: 1 } },
  );
  assert.equal(addDays('2026-12-28', 10), '2027-01-07');
});

import { DEFAULT_SOURCES, ACCESS, newDefaults, sortSources } from '../apps/jobs/sources.js';

test('default sources are well formed and unique', () => {
  const ids = new Set();
  for (const s of DEFAULT_SOURCES) {
    assert.ok(s.id.startsWith('seed:') && !ids.has(s.id), s.id);
    ids.add(s.id);
    assert.ok(['board', 'company'].includes(s.kind), s.id);
    assert.ok(s.access in ACCESS, s.id);
    assert.match(s.url, /^https:\/\//, s.id);
  }
});

test('newDefaults skips sources offered before, even if deleted since', () => {
  const all = newDefaults([]);
  assert.equal(all.length, DEFAULT_SOURCES.length);
  const rest = newDefaults(['seed:jobs-ch', 'seed:proton']);
  assert.equal(rest.length, DEFAULT_SOURCES.length - 2);
  assert.ok(!rest.some((s) => s.id === 'seed:jobs-ch'));
});

test('sortSources: followed first, longest unopened first, then by name', () => {
  const list = [
    { kind: 'board', name: 'B', checkedOn: '2026-11-10' },
    { kind: 'board', name: 'A', checkedOn: '2026-11-10' },
    { kind: 'board', name: 'C' },
    { kind: 'board', name: 'D', skip: true },
    { kind: 'company', name: 'E' },
  ];
  assert.deepEqual(sortSources(list, 'board').map((s) => s.name), ['C', 'A', 'B', 'D']);
});

test('sortSources puts favourites first among followed sources', () => {
  const list = [
    { kind: 'board', name: 'A' },
    { kind: 'board', name: 'Z', star: true, checkedOn: '2026-11-15' },
    { kind: 'board', name: 'S', star: true, skip: true },
  ];
  assert.deepEqual(sortSources(list, 'board').map((s) => s.name), ['Z', 'A', 'S']);
});

import { isJobLink, jobsFromPaste } from '../apps/jobs/logic.js';
import { GROUPS, isAuto } from '../apps/jobs/sources.js';

test('isJobLink tells postings from navigation', () => {
  assert.ok(isJobLink('https://www.jobs.ch/en/vacancies/detail/abc/'));
  assert.ok(!isJobLink('https://www.jobs.ch/en/vacancies/?term=software'));
  assert.ok(isJobLink('https://www.linkedin.com/jobs/view/123/'));
  assert.ok(!isJobLink('https://www.linkedin.com/company/example/'));
  assert.ok(isJobLink('https://ch.indeed.com/viewjob?jk=abc'));
  assert.ok(isJobLink('https://careers.example.ch/job/12345'));
  assert.ok(!isJobLink('https://example.ch/about'));
  assert.ok(!isJobLink('mailto:x@example.ch'));
});

test('jobsFromPaste reads job links from copied HTML', () => {
  const html = `<div><a href="https://www.jobs.ch/en/vacancies/detail/a1/?source=list"><h2>Software Engineer</h2></a>
    <a href="https://www.jobs.ch/en/vacancies/detail/a1/">Apply</a>
    <a href="https://www.jobs.ch/en/vacancies/?page=2">2</a>
    <a href="https://www.jobs.ch/en/vacancies/detail/b2/">Data Engineer 80-100% - Example AG</a></div>`;
  const jobs = jobsFromPaste({ html, text: 'ignored' });
  assert.deepEqual(jobs.map((j) => j.title), ['Software Engineer', 'Data Engineer 80-100%']);
  assert.equal(jobs[0].url, 'https://www.jobs.ch/en/vacancies/detail/a1/');
  assert.equal(jobs[1].company, 'Example AG');
  assert.equal(jobs[0].source, 'jobs.ch');
});

test('jobsFromPaste falls back to links in plain text', () => {
  const jobs = jobsFromPaste({ text: 'Backend Engineer\nhttps://careers.example.ch/job/12345\n\nhttps://example.ch/about' });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Backend Engineer');
});

test('every source lands in exactly one group', () => {
  const samples = [
    { access: 'feed', url: 'https://acme.wd3.myworkdayjobs.com/Careers' },
    { access: 'feed', url: 'https://www.sonova.com/en/careers' },
    { access: 'alert', url: 'https://www.jobs.ch/' },
    { access: 'manual', url: 'https://www.job-room.ch/' },
    { access: 'check', url: 'https://www.google.com/' },
  ];
  assert.deepEqual(samples.map((s) => GROUPS.filter((g) => g.test(s)).map((g) => g.id)), [['auto'], ['alert'], ['alert'], ['manual'], ['check']]);
  assert.ok(isAuto(samples[0]) && !isAuto({ ...samples[0], skip: true }));
});

import { pendingUpdates, DEFAULT_UPDATES } from '../apps/jobs/sources.js';

test('pendingUpdates applies each built-in update once', () => {
  assert.equal(pendingUpdates([]).length, DEFAULT_UPDATES.length);
  assert.equal(pendingUpdates(DEFAULT_UPDATES.map((u) => `${u.id}@${u.v}`)).length, 0);
  for (const u of DEFAULT_UPDATES) assert.ok(DEFAULT_SOURCES.some((s) => s.id === u.id), u.id);
});

test('importRuns lists helper and paste runs newest first', () => {
  const runs = importRuns({
    importHistory: [
      { at: '2026-11-20T06:00:00.000Z', kind: 'sources', added: 3 },
      { at: '2026-11-19T12:00:00.000Z', kind: 'alerts', added: 1, mails: 2 },
    ],
    pasteHistory: [{ at: '2026-11-19T18:00:00.000Z', kind: 'paste', added: 4 }],
    importLog: { at: '2026-11-20T06:00:00.000Z', sources: [] },
  });
  assert.deepEqual(runs.map((r) => r.kind), ['sources', 'paste', 'alerts']);
});

test('importRuns falls back to the last run from before the history existed', () => {
  const runs = importRuns({
    importLog: { at: '2026-11-18T06:00:00.000Z', sources: [{ name: 'Roche', found: 4, added: 2 }, { name: 'UBS', found: 0, added: 0, error: 'HTTP 403' }] },
    alertLog: { at: '2026-11-18T17:00:00.000Z', mails: 0, found: 0, added: 0 },
  });
  assert.equal(runs.length, 1, 'an alert check without mails is not a run');
  assert.equal(runs[0].added, 2);
  assert.deepEqual(runLines(runs[0]), ['Roche: 2 new of 4', 'UBS: failed (HTTP 403)']);
});

test('runLines shows how many jobs a source read when known', () => {
  assert.deepEqual(runLines({ sources: [{ name: 'Roche', read: 40, found: 2, added: 1 }] }), ['Roche: 1 new of 2 matching (40 read)']);
});
