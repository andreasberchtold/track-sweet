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
  moveTo,
  reasonCounts,
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
