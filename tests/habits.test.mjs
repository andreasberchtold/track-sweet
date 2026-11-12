import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  dayIndex,
  dayTotals,
  goalChosenFor,
  goalFor,
  milestonePassed,
  records,
  shade,
  startingPoint,
  suggestGoal,
  weekHistory,
  weekProgress,
  weekStart,
  weekStreak,
  weekTotal,
} from '../apps/habits/logic.js';

// 2026-11-09 is a Monday.
const log = (date, amount) => ({ date, amount });

test('weeks start on Monday, also across months and years', () => {
  assert.equal(weekStart('2026-11-09'), '2026-11-09');
  assert.equal(weekStart('2026-11-15'), '2026-11-09'); // Sunday
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(dayIndex('2026-11-12'), 3); // Thursday
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30'); // clocks change in Zurich that night
});

test('day and week totals', () => {
  const days = dayTotals([log('2026-11-09', 5), log('2026-11-09', 4), log('2026-11-15', 6), log('2026-11-16', 9)]);
  assert.equal(days.get('2026-11-09'), 9);
  assert.equal(weekTotal(days, '2026-11-09'), 15);
  assert.equal(weekTotal(days, '2026-11-16'), 9);
});

test('a goal carries over until a new one is set', () => {
  const habit = { goals: { '2026-10-26': 40, '2026-11-09': 50 } };
  assert.equal(goalFor(habit, '2026-10-19'), null);
  assert.equal(goalFor(habit, '2026-10-26'), 40);
  assert.equal(goalFor(habit, '2026-11-02'), 40);
  assert.equal(goalFor(habit, '2026-11-09'), 50);
  assert.equal(goalFor(habit, '2026-12-07'), 50);
  assert.equal(goalChosenFor(habit, '2026-11-09'), true);
  assert.equal(goalChosenFor(habit, '2026-11-16'), false);
});

test('progress: Monday morning is on track, later the pace counts', () => {
  assert.deepEqual(weekProgress({ total: 0, goal: 70, today: '2026-11-09' }), {
    state: 'ontrack', total: 0, goal: 70, remaining: 70, pace: 0, behind: 0, perDay: 10, daysLeft: 7,
  });
  const thursday = weekProgress({ total: 20, goal: 70, today: '2026-11-12' });
  assert.equal(thursday.pace, 30);
  assert.equal(thursday.state, 'behind');
  assert.equal(thursday.behind, 10);
  assert.equal(thursday.perDay, 13); // 50 left over 4 days
  assert.equal(weekProgress({ total: 30, goal: 70, today: '2026-11-12' }).state, 'ontrack');
  assert.equal(weekProgress({ total: 75, goal: 70, today: '2026-11-12' }).state, 'done');
  const sunday = weekProgress({ total: 64, goal: 70, today: '2026-11-15' });
  assert.equal(sunday.daysLeft, 1);
  assert.equal(sunday.perDay, 6);
  assert.equal(weekProgress({ total: 5, goal: null, today: '2026-11-12' }).state, 'nogoal');
});

test('goal suggestions stay reachable', () => {
  const habit = (goal) => ({ unit: 'reps', goals: goal ? { '2026-11-02': goal } : {} });
  const week = '2026-11-09';
  const days = (n) => dayTotals([log('2026-11-04', n)]);

  // reached: a small step up
  assert.equal(suggestGoal(habit(60), days(60), week).goal, 70);
  assert.equal(suggestGoal(habit(50), days(50), week).goal, 55);
  assert.equal(suggestGoal(habit(60), days(80), week).goal, 80);
  assert.equal(suggestGoal(habit(60), days(200), week).goal, 90); // capped at +50%
  // near miss: same again
  assert.equal(suggestGoal(habit(60), days(50), week).goal, 60);
  // clear miss: close to what was done
  assert.equal(suggestGoal(habit(60), days(20), week).goal, 25);
  assert.match(suggestGoal(habit(60), days(20), week).reason, /20 of 60/);
  // no goal yet
  assert.equal(suggestGoal(habit(null), days(33), week).goal, 40);
  assert.equal(suggestGoal(habit(null), new Map(), week), null);
  // seconds go in steps of 30
  assert.equal(suggestGoal({ unit: 'seconds', goals: { '2026-11-02': 300 } }, days(300), week).goal, 330);
});

test('starting point from the maximum in one go', () => {
  assert.deepEqual(startingPoint(8), { quick: [3, 4, 6], goal: 50 });
  assert.deepEqual(startingPoint(2), { quick: [1, 2], goal: 10 });
  assert.deepEqual(startingPoint(20), { quick: [7, 10, 14], goal: 120 });
});

test('week history marks reached goals and the current week', () => {
  const habit = { goals: { '2026-10-26': 30 } };
  const days = dayTotals([log('2026-10-27', 30), log('2026-11-03', 10), log('2026-11-10', 12)]);
  const weeks = weekHistory(habit, days, '2026-11-12', 4);
  assert.deepEqual(
    weeks.map((w) => [w.week, w.total, w.goal, w.met, w.current]),
    [
      ['2026-10-19', 0, null, false, false],
      ['2026-10-26', 30, 30, true, false],
      ['2026-11-02', 10, 30, false, false],
      ['2026-11-09', 12, 30, false, true],
    ],
  );
});

test('week streak counts back and includes the current week once reached', () => {
  const habit = { goals: { '2026-10-19': 20 } };
  const met = [log('2026-10-20', 20), log('2026-10-27', 25), log('2026-11-03', 20)];
  assert.equal(weekStreak(habit, dayTotals(met), '2026-11-12'), 3);
  assert.equal(weekStreak(habit, dayTotals([...met, log('2026-11-10', 20)]), '2026-11-12'), 4);
  const gap = [log('2026-10-20', 20), log('2026-11-03', 20)];
  assert.equal(weekStreak(habit, dayTotals(gap), '2026-11-12'), 1);
  assert.equal(weekStreak({ goals: {} }, dayTotals(met), '2026-11-12'), 0);
});

test('records, milestones and calendar shades', () => {
  const logs = [log('2026-11-09', 5), log('2026-11-09', 8), log('2026-11-10', 6), log('2026-11-17', 4)];
  assert.deepEqual(records(logs, dayTotals(logs)), { total: 23, bestSet: 8, bestDay: 13, bestWeek: 19 });
  assert.deepEqual(records([], new Map()), { total: 0, bestSet: 0, bestDay: 0, bestWeek: 0 });
  assert.equal(milestonePassed(95, 103), 100);
  assert.equal(milestonePassed(100, 110), null);
  assert.equal(milestonePassed(40, 260), 250);
  assert.deepEqual([0, 2, 5, 7, 10].map((n) => shade(n, 10)), [0, 1, 2, 3, 4]);
});
