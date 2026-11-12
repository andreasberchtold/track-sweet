// Weeks, goals and statistics for the habit tracker. No screens here, so
// everything can be tested on its own.
//
// Dates are local calendar days as YYYY-MM-DD. Weeks start on Monday and
// are named by their Monday ("week key").

import { todayISO as toISODate } from '../../core/util.js';

export const UNITS = {
  reps: { label: 'Reps', step: 5, quick: [3, 5, 8] },
  seconds: { label: 'Seconds', step: 30, quick: [10, 20, 30] },
  sets: { label: 'Sets', step: 1, quick: [1, 2, 3] },
};

export const MILESTONES = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

// ---- calendar ----------------------------------------------------------------

export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const date = parseDate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** 0 = Monday ... 6 = Sunday */
export function dayIndex(iso) {
  return (parseDate(iso).getDay() + 6) % 7;
}

export function weekStart(iso) {
  return addDays(iso, -dayIndex(iso));
}

// ---- totals ------------------------------------------------------------------

/** Map of date -> summed amount. */
export function dayTotals(logs) {
  const days = new Map();
  for (const log of logs) {
    const amount = Number(log.amount) || 0;
    days.set(log.date, (days.get(log.date) ?? 0) + amount);
  }
  return days;
}

export function weekTotal(days, week) {
  let sum = 0;
  for (let i = 0; i < 7; i += 1) sum += days.get(addDays(week, i)) ?? 0;
  return sum;
}

// ---- goals -------------------------------------------------------------------

/**
 * The goal that applies in a week: the one set for that week, or else the
 * most recent one set before it. A goal carries over until it is changed.
 */
export function goalFor(habit, week) {
  let found = null;
  let foundKey = '';
  for (const [key, value] of Object.entries(habit?.goals ?? {})) {
    if (key <= week && key > foundKey && Number(value) > 0) {
      found = Number(value);
      foundKey = key;
    }
  }
  return found;
}

/** True when a goal was chosen for exactly this week. */
export function goalChosenFor(habit, week) {
  return Object.prototype.hasOwnProperty.call(habit?.goals ?? {}, week);
}

/**
 * Where the week stands. "Pace" is where an evenly spread week would be at
 * the start of today, so Monday morning is never "behind".
 */
export function weekProgress({ total, goal, today }) {
  const index = dayIndex(today);
  const daysLeft = 7 - index; // including today
  if (!goal) return { state: 'nogoal', total, daysLeft };
  const remaining = Math.max(0, goal - total);
  const pace = Math.round((goal * index) / 7);
  const perDay = remaining ? Math.ceil(remaining / daysLeft) : 0;
  let state = 'ontrack';
  if (total >= goal) state = 'done';
  else if (total < pace) state = 'behind';
  return { state, total, goal, remaining, pace, behind: Math.max(0, pace - total), perDay, daysLeft };
}

function stepFor(habit) {
  return UNITS[habit?.unit]?.step ?? 5;
}

function roundUp(n, step) {
  // The small tolerance keeps 50 * 1.1 (= 55.000000000000007) at 55.
  return Math.max(step, Math.ceil(n / step - 1e-9) * step);
}

function roundNear(n, step) {
  return Math.max(step, Math.round(n / step) * step);
}

/**
 * A goal for `week`, based on how last week went. Small steps up after a
 * reached goal, the same goal after a near miss, and a goal close to what
 * was actually done after a clear miss, so the goal stays reachable.
 * Returns { goal, reason } or null when there is nothing to go on.
 */
export function suggestGoal(habit, days, week) {
  const step = stepFor(habit);
  const lastWeek = addDays(week, -7);
  const done = weekTotal(days, lastWeek);
  const goal = goalFor(habit, lastWeek);

  if (!goal) {
    if (!done) return null;
    return { goal: roundUp(done * 1.1, step), reason: `A bit more than last week's ${done}.` };
  }
  if (done >= goal) {
    const raised = Math.min(roundUp(Math.max(goal * 1.1, done), step), roundUp(goal * 1.5, step));
    return {
      goal: Math.max(raised, goal + step),
      reason: 'Last week\'s goal is done. A small step up keeps it a challenge.',
    };
  }
  if (done >= goal * 0.8) {
    return { goal, reason: `Last week you got to ${done} of ${goal}. The same goal is within reach.` };
  }
  return {
    goal: Math.min(goal, roundNear(Math.max(done * 1.15, step), step)),
    reason: `Last week you got to ${done} of ${goal}. A goal you reach builds more momentum than one you miss.`,
  };
}

/** Quick amounts and a first weekly goal from "how many in one go, fresh?". */
export function startingPoint(maxInOneGo, unit = 'reps') {
  const max = Math.max(1, Math.round(Number(maxInOneGo) || 1));
  const step = UNITS[unit]?.step ?? 5;
  const half = Math.max(1, Math.round(max / 2));
  const quick = [...new Set([Math.max(1, Math.round(max / 3)), half, Math.max(half + 1, Math.round(max * 0.7))])]
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  // Easy sets of about half the maximum, three a day, four days a week.
  return { quick, goal: roundNear(half * 3 * 4, step) };
}

// ---- history and records -------------------------------------------------------

/** The last `count` weeks up to and including the current one, oldest first. */
export function weekHistory(habit, days, today, count = 12) {
  const current = weekStart(today);
  const weeks = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const week = addDays(current, -7 * i);
    const total = weekTotal(days, week);
    const goal = goalFor(habit, week);
    weeks.push({ week, total, goal, met: Boolean(goal) && total >= goal, current: i === 0 });
  }
  return weeks;
}

/**
 * Weeks in a row with the goal reached, counting back from last week. The
 * current week counts as soon as its goal is reached; until then it does not
 * break the run.
 */
export function weekStreak(habit, days, today) {
  const current = weekStart(today);
  const currentGoal = goalFor(habit, current);
  const currentMet = Boolean(currentGoal) && weekTotal(days, current) >= currentGoal;
  let count = currentMet ? 1 : 0;
  for (let week = addDays(current, -7); ; week = addDays(week, -7)) {
    const goal = goalFor(habit, week);
    if (!goal || weekTotal(days, week) < goal) break;
    count += 1;
  }
  return count;
}

export function records(logs, days) {
  let total = 0;
  let bestSet = 0;
  for (const log of logs) {
    const amount = Number(log.amount) || 0;
    total += amount;
    if (amount > bestSet) bestSet = amount;
  }
  let bestDay = 0;
  const weeks = new Map();
  for (const [date, amount] of days) {
    if (amount > bestDay) bestDay = amount;
    const week = weekStart(date);
    weeks.set(week, (weeks.get(week) ?? 0) + amount);
  }
  const bestWeek = Math.max(0, ...weeks.values());
  return { total, bestSet, bestDay, bestWeek };
}

/** The largest milestone passed when the lifetime total went from `before` to `after`. */
export function milestonePassed(before, after) {
  let passed = null;
  for (const m of MILESTONES) if (before < m && after >= m) passed = m;
  return passed;
}

/** Shade 0 to 4 for a day in the calendar, relative to the best day shown. */
export function shade(amount, best) {
  if (!amount || !best) return 0;
  const share = amount / best;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}
