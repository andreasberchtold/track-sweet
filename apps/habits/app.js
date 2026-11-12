// Habits: log sets of an exercise, work towards a weekly goal you can
// reach, and see the progress. Starts with one exercise (pull-ups); more
// can be added in the menu.
//
// Ideas from behaviour research built in:
// - Weekly goals instead of daily streaks: a missed day does not reset
//   anything, which avoids the "now it's ruined anyway" effect.
// - Goals that stay reachable: suggestions step up after a reached goal and
//   step back after a clear miss.
// - Pace: the progress bar shows where an evenly spread week would be, and
//   how much per day is left, so the goal feels close (goal-gradient effect).
// - A plan in "after X, I do Y" form (implementation intention), shown
//   where you log.
// - Small, easy sets (about half your maximum) through the day.
// - A fresh start every Monday, and "don't miss twice" after a missed week.
// - Celebration when the goal is reached, personal bests and milestones.

import { startApp } from '../../core/shell.js';
import { h, mount } from '../../core/dom.js';
import { formatDate, todayISO } from '../../core/util.js';
import * as L from './logic.js';
import { dayCalendar, weekChart } from './charts.js';

const HABITS = 'habits';
const LOGS = 'logs';
const PICK_KEY = 'hb:habit';
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CHEERS = ['Goal reached', 'Week done', 'That\'s the week'];

startApp({
  id: 'habits',
  name: 'Habits',
  schemaVersion: 1,
  collections: [HABITS, LOGS],
  mount: mountApp,
  settings: settingsSection,
});

// ---- wording -------------------------------------------------------------------

/** What the amounts are called: "pull-ups", "seconds", "sets". */
function unitWord(habit, n = 2) {
  if (habit.unit === 'seconds') return n === 1 ? 'second' : 'seconds';
  if (habit.unit === 'sets') return n === 1 ? 'set' : 'sets';
  return habit.name.toLowerCase();
}

function amountText(habit, n) {
  return `${n.toLocaleString()} ${unitWord(habit, n)}`;
}

// The exercise on screen, remembered per browser.
let selected = readPick();
let redraw = () => {};

function readPick() {
  try {
    return localStorage.getItem(PICK_KEY);
  } catch {
    return null;
  }
}

function select(id) {
  selected = id;
  try {
    localStorage.setItem(PICK_KEY, id);
  } catch {
    // Only a convenience.
  }
  redraw();
}

function activeHabits(store) {
  return store
    .list(HABITS)
    .filter((habit) => !habit.archived)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

function number(input) {
  const n = Math.round(Number(input.value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---- main screen -------------------------------------------------------------------

// Two screens: "Track" for logging, "Progress" for charts and records. The
// progress screen is #progress in the address, so the phone's back button
// returns to tracking.
const isProgress = () => location.hash === '#progress';

function mountApp({ root, store, shell }) {
  let seen = -1;
  let openedProgress = false;

  window.addEventListener('hashchange', () => {
    render();
    window.scrollTo(0, 0);
  });

  function showScreen(progress) {
    if (progress === isProgress()) return;
    if (progress) {
      openedProgress = true;
      location.hash = 'progress';
    } else if (openedProgress) {
      openedProgress = false;
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      render();
      window.scrollTo(0, 0);
    }
  }

  store.subscribe(() => {
    if (store.changes !== seen) render();
  });
  redraw = render;
  render();

  function render() {
    seen = store.changes;
    const habits = activeHabits(store);
    if (!habits.length) {
      document.body.classList.remove('hb-has-nav');
      mount(root, setupView());
      return;
    }
    document.body.classList.add('hb-has-nav');
    const habit = habits.find((x) => x.id === selected) ?? habits[0];
    selected = habit.id;

    const logs = store.list(LOGS).filter((l) => l.habitId === habit.id);
    const days = L.dayTotals(logs);
    const today = todayISO();
    const week = L.weekStart(today);
    const goal = L.goalFor(habit, week);
    const total = L.weekTotal(days, week);

    const progress = isProgress();
    mount(
      root,
      habits.length > 1 ? switcher(habits, habit) : null,
      progress
        ? [
            progressSummary(habit, total, goal),
            weeksSection(habit, days, today),
            daysSection(habit, days, today),
            statsSection(habit, logs, days, today),
            logs.length ? null : h('p', { class: 'hb-empty' }, 'Log a few sets and your progress shows up here.'),
          ]
        : [
            newWeekCard(habit, days, week),
            hero(habit, days, total, goal, today),
            logPad(habit),
            todayList(habit, logs, today),
            planCard(habit),
          ],
      nav(progress),
    );
  }

  function nav(progress) {
    const tab = (label, target) =>
      h(
        'button',
        {
          class: 'hb-nav__tab',
          type: 'button',
          'aria-current': target === progress ? 'page' : null,
          onclick: () => showScreen(target),
        },
        label,
      );
    return h('nav', { class: 'hb-nav', 'aria-label': 'Screens' }, tab('Track', false), tab('Progress', true));
  }

  function progressSummary(habit, total, goal) {
    return h(
      'p',
      { class: 'hb-summary' },
      goal
        ? `This week: ${total.toLocaleString()} of ${goal.toLocaleString()} ${unitWord(habit, goal)}`
        : `This week: ${amountText(habit, total)}`,
    );
  }

  // ---- pieces ----------------------------------------------------------------

  function switcher(habits, habit) {
    return h(
      'div',
      { class: 'pa-seg hb-switch', role: 'group', 'aria-label': 'Exercise' },
      habits.map((x) =>
        h(
          'button',
          {
            class: 'pa-seg__option',
            type: 'button',
            'aria-pressed': String(x.id === habit.id),
            onclick: () => select(x.id),
          },
          x.name,
        ),
      ),
    );
  }

  /** At the start of a week: how last week went, and this week's goal. */
  function newWeekCard(habit, days, week) {
    const previousGoal = L.goalFor(habit, L.addDays(week, -7));
    if (L.goalChosenFor(habit, week) || !previousGoal) return null;
    const lastTotal = L.weekTotal(days, L.addDays(week, -7));
    const met = lastTotal >= previousGoal;
    const suggestion = L.suggestGoal(habit, days, week);
    const streak = L.weekStreak(habit, days, L.addDays(week, -1));

    let message;
    if (met) {
      message =
        streak > 1
          ? `Last week: ${lastTotal} of ${previousGoal}. That's ${streak} weeks in a row.`
          : `Last week: ${lastTotal} of ${previousGoal}. Goal reached.`;
    } else {
      message = `Last week: ${lastTotal} of ${previousGoal}. One missed week is normal; the trick is not to miss two in a row.`;
    }

    const setGoal = (n) => store.put(HABITS, { id: habit.id, goals: { ...habit.goals, [week]: n } });
    const options = [];
    if (suggestion && suggestion.goal !== previousGoal) {
      options.push(
        h(
          'button',
          { class: 'pa-btn pa-btn--primary', type: 'button', onclick: () => setGoal(suggestion.goal) },
          `Go for ${suggestion.goal}`,
        ),
      );
    }
    options.push(
      h(
        'button',
        {
          class: `pa-btn${options.length ? '' : ' pa-btn--primary'}`,
          type: 'button',
          onclick: () => setGoal(previousGoal),
        },
        `Keep ${previousGoal}`,
      ),
      h('button', { class: 'pa-btn pa-btn--quiet', type: 'button', onclick: () => openGoalSheet(habit, days, week) }, 'Other'),
    );

    return h(
      'section',
      { class: 'hb-card hb-newweek' },
      h('h2', { class: 'hb-card__title' }, 'New week, fresh start'),
      h('p', null, message),
      suggestion && suggestion.goal !== previousGoal ? h('p', { class: 'pa-muted' }, suggestion.reason) : null,
      h('div', { class: 'pa-row' }, options),
    );
  }

  function hero(habit, days, total, goal, today) {
    const progress = L.weekProgress({ total, goal, today });
    const week = L.weekStart(today);

    if (!goal) {
      return h(
        'section',
        { class: 'hb-hero' },
        h('p', { class: 'hb-hero__label' }, 'This week'),
        h('p', { class: 'hb-hero__count' }, h('span', { class: 'hb-big' }, total.toLocaleString()), ` ${unitWord(habit, total)}`),
        h('button', { class: 'pa-btn pa-btn--primary', type: 'button', onclick: () => openGoalSheet(habit, days, week) }, 'Set a weekly goal'),
      );
    }

    const share = Math.min(1, total / goal);
    const index = L.dayIndex(today);
    let status;
    switch (progress.state) {
      case 'done':
        status = total > goal ? `Goal reached, ${total - goal} more than planned.` : 'Goal reached.';
        break;
      case 'behind':
        status =
          progress.daysLeft === 1
            ? `${progress.remaining} to go today.`
            : `${progress.behind} behind pace. About ${progress.perDay} a day for the ${progress.daysLeft} days left gets you there.`;
        break;
      default:
        status =
          progress.daysLeft === 1
            ? `${progress.remaining} to go today.`
            : `On track. ${progress.remaining} to go, about ${progress.perDay} a day.`;
    }

    return h(
      'section',
      { class: `hb-hero hb-hero--${progress.state}` },
      h('p', { class: 'hb-hero__label' }, 'This week'),
      h(
        'p',
        { class: 'hb-hero__count' },
        h('span', { class: 'hb-big' }, total.toLocaleString()),
        h(
          'button',
          {
            class: 'hb-goal',
            type: 'button',
            'aria-label': `Weekly goal ${goal}. Change goal`,
            onclick: () => openGoalSheet(habit, days, week),
          },
          `of ${goal.toLocaleString()} ${unitWord(habit, goal)}`,
        ),
      ),
      h(
        'div',
        {
          class: 'hb-track',
          role: 'progressbar',
          'aria-valuemin': 0,
          'aria-valuemax': goal,
          'aria-valuenow': Math.min(total, goal),
          'aria-label': 'Progress towards the weekly goal',
        },
        h('div', { class: 'hb-track__fill', style: { width: `${share * 100}%` } }),
        progress.state !== 'done' && index > 0
          ? h('div', { class: 'hb-track__pace', style: { left: `${(progress.pace / goal) * 100}%` }, title: `Pace: ${progress.pace}` })
          : null,
      ),
      h(
        'div',
        { class: 'hb-days', 'aria-hidden': 'true' },
        DAY_LETTERS.map((letter, i) =>
          h('span', { class: i === index ? 'is-today' : i < index ? 'is-past' : null }, letter),
        ),
      ),
      h('p', { class: 'hb-status' }, status),
    );
  }

  function logPad(habit) {
    const quick = habit.quick?.length ? habit.quick : L.UNITS[habit.unit]?.quick ?? [5];
    return h(
      'section',
      { class: 'hb-pad', 'aria-label': 'Log a set' },
      quick.map((n) =>
        h(
          'button',
          {
            class: 'hb-pad__btn',
            type: 'button',
            'aria-label': `Log ${amountText(habit, n)}`,
            onclick: (event) => {
              pulse(event.currentTarget);
              log(habit, n);
            },
          },
          h('span', { class: 'hb-pad__plus' }, '+'),
          h('span', { class: 'hb-pad__n' }, String(n)),
        ),
      ),
      h('button', { class: 'hb-pad__btn hb-pad__btn--other', type: 'button', onclick: () => openLogSheet(habit) }, 'Other'),
    );
  }

  function todayList(habit, logs, today) {
    const sets = logs.filter((l) => l.date === today).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
    const sum = sets.reduce((acc, l) => acc + l.amount, 0);
    return h(
      'section',
      { class: 'hb-today' },
      h(
        'h2',
        { class: 'hb-section__title' },
        sets.length
          ? `Today: ${amountText(habit, sum)} in ${sets.length} ${sets.length === 1 ? 'set' : 'sets'}`
          : 'Today: nothing logged yet',
      ),
      sets.length
        ? h(
            'ul',
            { class: 'hb-sets' },
            sets.map((set) => {
              const time = set.at ? new Date(set.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
              return h(
                'li',
                null,
                h(
                  'button',
                  {
                    class: 'hb-set',
                    type: 'button',
                    'aria-label': `Set of ${amountText(habit, set.amount)}${time ? ` at ${time}` : ''}`,
                    onclick: () => openSetSheet(habit, set, time),
                  },
                  h('strong', null, String(set.amount)),
                  time ? h('span', null, time) : null,
                ),
              );
            }),
          )
        : null,
    );
  }

  function planCard(habit) {
    if (habit.plan) {
      return h(
        'section',
        { class: 'hb-plan' },
        h('h2', { class: 'hb-section__title' }, 'Your plan'),
        h('p', { class: 'hb-plan__text' }, habit.plan),
        h('button', { class: 'pa-btn pa-btn--small pa-btn--quiet', type: 'button', onclick: () => openPlanSheet(habit) }, 'Edit plan'),
      );
    }
    return h(
      'section',
      { class: 'hb-plan hb-plan--empty' },
      h('h2', { class: 'hb-section__title' }, 'Make a plan'),
      h(
        'p',
        { class: 'pa-muted' },
        'Decide when and where, in the form "after X, I do Y". Tying a new habit to something you already do makes it far more likely to happen.',
      ),
      h('button', { class: 'pa-btn pa-btn--small', type: 'button', onclick: () => openPlanSheet(habit) }, 'Write a plan'),
    );
  }

  function weeksSection(habit, days, today) {
    const weeks = L.weekHistory(habit, days, today, 12);
    if (!weeks.some((w) => w.total > 0)) return null;
    const describe = (w) => {
      const when = w.current ? 'This week' : `Week of ${formatDate(w.week, { day: 'numeric', month: 'short' })}`;
      if (!w.goal) return `${when}: ${amountText(habit, w.total)}`;
      return `${when}: ${w.total.toLocaleString()} of ${w.goal.toLocaleString()}${w.met ? ', goal reached' : w.current ? ' so far' : ''}`;
    };
    const detail = h('p', { class: 'hb-detail', 'aria-live': 'polite' }, describe(weeks.at(-1)));
    return h(
      'section',
      { class: 'hb-section' },
      h('h2', { class: 'hb-section__title' }, 'Last 12 weeks'),
      weekChart(weeks, { describe, onPick: (text) => (detail.textContent = text) }),
      h(
        'div',
        { class: 'hb-key', 'aria-hidden': 'true' },
        h('span', null, h('i', { class: 'hb-key__met' }), 'Goal reached'),
        h('span', null, h('i', { class: 'hb-key__missed' }), 'Not reached'),
        h('span', null, h('i', { class: 'hb-key__goal' }), 'Goal'),
      ),
      detail,
    );
  }

  function daysSection(habit, days, today) {
    if (!days.size) return null;
    const describe = (date, amount) =>
      `${formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}: ${amount ? amountText(habit, amount) : 'nothing logged'}`;
    const detail = h('p', { class: 'hb-detail', 'aria-live': 'polite' }, describe(today, days.get(today) ?? 0));
    return h(
      'section',
      { class: 'hb-section' },
      h('h2', { class: 'hb-section__title' }, 'Days'),
      dayCalendar(days, today, { describe, onPick: (text) => (detail.textContent = text) }),
      h(
        'div',
        { class: 'hb-key hb-key--scale', 'aria-hidden': 'true' },
        'Less',
        [0, 1, 2, 3, 4].map((n) => h('i', { class: `hb-key__day hb-day--${n}` })),
        'More',
      ),
      detail,
    );
  }

  function statsSection(habit, logs, days, today) {
    if (!logs.length) return null;
    const rec = L.records(logs, days);
    const streak = L.weekStreak(habit, days, today);
    const tile = (label, value, note) =>
      h('div', { class: 'hb-tile' }, h('p', { class: 'hb-tile__label' }, label), h('p', { class: 'hb-tile__value' }, value), note && h('p', { class: 'hb-tile__note' }, note));
    return h(
      'section',
      { class: 'hb-section' },
      h('h2', { class: 'hb-section__title' }, 'Records'),
      h(
        'div',
        { class: 'hb-tiles' },
        tile('Week streak', String(streak), streak === 1 ? 'week with the goal reached' : 'weeks in a row with the goal reached'),
        tile('Best set', rec.bestSet.toLocaleString(), unitWord(habit, rec.bestSet)),
        tile('Best week', rec.bestWeek.toLocaleString(), unitWord(habit, rec.bestWeek)),
        tile('All time', rec.total.toLocaleString(), unitWord(habit, rec.total)),
      ),
    );
  }

  // ---- actions -------------------------------------------------------------------

  function log(habit, amount, date = todayISO()) {
    const before = store.list(LOGS).filter((l) => l.habitId === habit.id);
    const daysBefore = L.dayTotals(before);
    const week = L.weekStart(todayISO());
    const goal = L.goalFor(habit, week);
    const weekBefore = L.weekTotal(daysBefore, week);
    const totalBefore = before.reduce((acc, l) => acc + l.amount, 0);
    const bestBefore = before.reduce((acc, l) => Math.max(acc, l.amount), 0);

    const record = store.put(LOGS, { habitId: habit.id, amount, date, at: new Date().toISOString() });
    try {
      navigator.vibrate?.(12);
    } catch {
      // not supported
    }

    const inThisWeek = L.weekStart(date) === week;
    if (inThisWeek && goal && weekBefore < goal && weekBefore + amount >= goal) {
      celebrate(habit, weekBefore + amount);
    }
    const milestone = L.milestonePassed(totalBefore, totalBefore + amount);
    let message = `Logged ${amountText(habit, amount)}`;
    if (milestone) message = `${amountText(habit, milestone)} in total. Logged ${amount}`;
    else if (before.length >= 3 && amount > bestBefore) message = `New best set: ${amount}`;
    shell.toast(message, { key: 'log', action: { label: 'Undo', run: () => store.remove(LOGS, record.id) } });
  }

  function celebrate(habit, total) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dust = reduce
      ? []
      : Array.from({ length: 28 }, (_, i) => {
          const angle = (i / 28) * Math.PI * 2 + Math.random() * 0.3;
          const distance = 90 + Math.random() * 110;
          return h('i', {
            class: 'hb-dust',
            style: {
              '--dx': `${Math.cos(angle) * distance}px`,
              '--dy': `${Math.sin(angle) * distance}px`,
              '--delay': `${Math.random() * 120}ms`,
            },
          });
        });
    const overlay = h(
      'div',
      { class: 'hb-cheer', role: 'status', onclick: () => overlay.remove() },
      h(
        'div',
        { class: 'hb-cheer__inner' },
        dust,
        h('p', { class: 'hb-cheer__title' }, CHEERS[Math.floor(Math.random() * CHEERS.length)]),
        h('p', { class: 'hb-cheer__text' }, `${amountText(habit, total)} this week`),
      ),
    );
    document.body.append(overlay);
    setTimeout(() => overlay.remove(), 2600);
  }

  function pulse(el) {
    el.classList.remove('is-pulsing');
    void el.offsetWidth;
    el.classList.add('is-pulsing');
  }

  // ---- sheets ----------------------------------------------------------------------

  function openGoalSheet(habit, days, week) {
    const current = L.goalFor(habit, week);
    const suggestion = L.suggestGoal(habit, days, week);
    const input = h('input', {
      class: 'pa-input',
      id: 'hb-goal',
      type: 'number',
      inputMode: 'numeric',
      min: 1,
      value: current ?? suggestion?.goal ?? '',
      placeholder: `${unitWord(habit)} per week`,
    });
    const panel = shell.sheet({
      title: 'Weekly goal',
      body: h(
        'form',
        {
          class: 'pa-form',
          onsubmit: (event) => {
            event.preventDefault();
            const n = number(input);
            if (!n) return;
            store.put(HABITS, { id: habit.id, goals: { ...habit.goals, [week]: n } });
            panel.close();
            shell.toast(`Goal for this week: ${amountText(habit, n)}`);
          },
        },
        h(
          'p',
          { class: 'pa-muted' },
          'Pick a number you can reach this week, even on a busy one. Reaching it is what keeps the habit going; you can raise it next week.',
        ),
        h('div', { class: 'pa-field' }, h('label', { for: 'hb-goal' }, `${habit.name} this week`), input),
        suggestion
          ? h(
              'div',
              { class: 'hb-suggest' },
              h('p', null, `Suggested: ${suggestion.goal}. ${suggestion.reason}`),
              h(
                'button',
                { class: 'pa-btn pa-btn--small', type: 'button', onclick: () => (input.value = suggestion.goal) },
                `Use ${suggestion.goal}`,
              ),
            )
          : null,
        h('div', { class: 'pa-row pa-row--end' }, h('button', { class: 'pa-btn pa-btn--primary', type: 'submit' }, 'Save goal')),
      ),
    });
    input.focus();
    input.select();
  }

  function openLogSheet(habit) {
    const amount = h('input', { class: 'pa-input', id: 'hb-amount', type: 'number', inputMode: 'numeric', min: 1, required: true });
    const date = h('input', { class: 'pa-input', id: 'hb-date', type: 'date', value: todayISO(), max: todayISO(), required: true });
    const panel = shell.sheet({
      title: 'Log a set',
      body: h(
        'form',
        {
          class: 'pa-form',
          onsubmit: (event) => {
            event.preventDefault();
            const n = number(amount);
            if (!n || !date.value) return;
            panel.close();
            log(habit, n, date.value);
          },
        },
        h('div', { class: 'pa-field' }, h('label', { for: 'hb-amount' }, habit.unit === 'reps' ? habit.name : L.UNITS[habit.unit].label), amount),
        h('div', { class: 'pa-field' }, h('label', { for: 'hb-date' }, 'Day'), date),
        h('div', { class: 'pa-row pa-row--end' }, h('button', { class: 'pa-btn pa-btn--primary', type: 'submit' }, 'Log set')),
      ),
    });
    amount.focus();
  }

  function openSetSheet(habit, set, time) {
    const panel = shell.sheet({
      title: `Set of ${amountText(habit, set.amount)}`,
      body: h(
        'div',
        { class: 'pa-form' },
        h('p', { class: 'pa-muted' }, `Logged ${formatDate(set.date)}${time ? ` at ${time}` : ''}.`),
        h(
          'div',
          { class: 'pa-row pa-row--end' },
          h(
            'button',
            {
              class: 'pa-btn pa-btn--danger',
              type: 'button',
              onclick: () => {
                store.remove(LOGS, set.id);
                panel.close();
                shell.toast('Set deleted', { action: { label: 'Undo', run: () => store.put(LOGS, set) } });
              },
            },
            'Delete set',
          ),
        ),
      ),
    });
  }

  function openPlanSheet(habit) {
    const text = h('textarea', {
      class: 'pa-input',
      id: 'hb-plan',
      maxLength: 200,
      value: habit.plan ?? '',
      placeholder: 'After my run, I do two easy sets at the doorway bar.',
    });
    const panel = shell.sheet({
      title: 'Your plan',
      body: h(
        'form',
        {
          class: 'pa-form',
          onsubmit: (event) => {
            event.preventDefault();
            store.put(HABITS, { id: habit.id, plan: text.value.trim() });
            panel.close();
          },
        },
        h('p', { class: 'pa-muted' }, 'Name the moment and the place: "After I ..., I do ... at ...". Something you already do every day works best as the trigger.'),
        h('div', { class: 'pa-field' }, h('label', { for: 'hb-plan' }, 'Plan'), text),
        h('div', { class: 'pa-row pa-row--end' }, h('button', { class: 'pa-btn pa-btn--primary', type: 'submit' }, 'Save plan')),
      ),
    });
    text.focus();
  }

  // ---- first start -------------------------------------------------------------------

  function setupView() {
    return h(
      'section',
      { class: 'hb-setup' },
      h('h2', { class: 'hb-setup__title' }, 'Start a habit'),
      h(
        'p',
        { class: 'pa-muted' },
        'Pick one exercise to do more of. Small, easy sets spread over the day add up fast, and a weekly goal you can reach keeps you coming back.',
      ),
      habitForm(store, {
        onSave: (habit) => select(habit.id),
      }),
    );
  }
}

// ---- exercise form (first start and menu) ------------------------------------------------

function habitForm(store, { habit = null, onSave }) {
  const isNew = !habit;
  const draft = { name: habit?.name ?? (activeHabits(store).length ? '' : 'Pull-ups'), unit: habit?.unit ?? 'reps' };
  const quickStart = habit?.quick ?? L.UNITS[draft.unit].quick;

  const name = h('input', { class: 'pa-input', id: 'hb-f-name', required: true, maxLength: 30, value: draft.name, placeholder: 'For example Push-ups' });
  const unitButtons = Object.entries(L.UNITS).map(([key, info]) =>
    h(
      'button',
      {
        class: 'pa-seg__option',
        type: 'button',
        'aria-pressed': String(key === draft.unit),
        onclick: () => {
          draft.unit = key;
          unitButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(Object.keys(L.UNITS)[i] === key)));
          if (isNew) applyStart();
        },
      },
      info.label,
    ),
  );
  const max = h('input', { class: 'pa-input', id: 'hb-f-max', type: 'number', inputMode: 'numeric', min: 1, placeholder: 'For example 8' });
  const quick = [0, 1, 2].map((i) =>
    h('input', {
      class: 'pa-input hb-quick',
      type: 'number',
      inputMode: 'numeric',
      min: 1,
      'aria-label': `Quick amount ${i + 1}`,
      value: quickStart[i] ?? '',
    }),
  );
  const goal = h('input', { class: 'pa-input', id: 'hb-f-goal', type: 'number', inputMode: 'numeric', min: 1, required: isNew });

  function applyStart() {
    const n = number(max);
    const start = n ? L.startingPoint(n, draft.unit) : { quick: L.UNITS[draft.unit].quick, goal: '' };
    quick.forEach((input, i) => (input.value = start.quick[i] ?? ''));
    goal.value = start.goal;
  }
  max.addEventListener('input', applyStart);

  return h(
    'form',
    {
      class: 'pa-form hb-form',
      onsubmit: (event) => {
        event.preventDefault();
        const label = name.value.trim();
        if (!label) return;
        const amounts = [...new Set(quick.map(number).filter(Boolean))].sort((a, b) => a - b);
        const fields = { name: label, unit: draft.unit, quick: amounts.length ? amounts : L.UNITS[draft.unit].quick };
        let saved;
        if (isNew) {
          const n = number(goal);
          if (!n) return;
          saved = store.put(HABITS, { ...fields, goals: { [L.weekStart(todayISO())]: n }, plan: '', archived: false });
        } else {
          saved = store.put(HABITS, { id: habit.id, ...fields });
        }
        onSave?.(saved);
      },
    },
    h('div', { class: 'pa-field' }, h('label', { for: 'hb-f-name' }, 'Exercise'), name),
    h('div', { class: 'pa-field' }, h('span', { class: 'pa-label' }, 'Counted in'), h('div', { class: 'pa-seg hb-unit', role: 'group', 'aria-label': 'Counted in' }, unitButtons)),
    isNew
      ? h(
          'div',
          { class: 'pa-field' },
          h('label', { for: 'hb-f-max' }, 'How many can you do in one go, when fresh?'),
          max,
          h('p', { class: 'pa-muted' }, 'Used to suggest easy set sizes (about half of that) and a first weekly goal.'),
        )
      : null,
    h('div', { class: 'pa-field' }, h('span', { class: 'pa-label' }, 'Quick buttons'), h('div', { class: 'hb-quickrow' }, quick)),
    isNew ? h('div', { class: 'pa-field' }, h('label', { for: 'hb-f-goal' }, 'Weekly goal'), goal) : null,
    h('div', { class: 'pa-row pa-row--end' }, h('button', { class: 'pa-btn pa-btn--primary', type: 'submit' }, isNew ? 'Start' : 'Save changes')),
  );
}

// ---- menu ---------------------------------------------------------------------------------

function settingsSection({ store, shell, close }) {
  const habits = activeHabits(store);
  const archived = store.list(HABITS).filter((x) => x.archived);

  const editSheet = (habit) => {
    const panel = shell.sheet({
      title: habit ? `Edit ${habit.name}` : 'Add exercise',
      body: h(
        'div',
        { class: 'pa-form' },
        habitForm(store, {
          habit,
          onSave: (saved) => {
            panel.close();
            if (!habit) select(saved.id);
            shell.toast(habit ? 'Changes saved' : `${saved.name} added`);
          },
        }),
        habit
          ? h(
              'button',
              {
                class: 'pa-btn pa-btn--danger',
                type: 'button',
                onclick: async () => {
                  const sure = await shell.confirm({
                    title: `Archive ${habit.name}?`,
                    message: 'It disappears from the main screen. Its history stays and it can be restored from the menu.',
                    confirmLabel: 'Archive',
                  });
                  if (!sure) return;
                  store.put(HABITS, { id: habit.id, archived: true });
                  panel.close();
                },
              },
              'Archive',
            )
          : null,
      ),
    });
  };

  return h(
    'div',
    { class: 'pa-form' },
    h('h3', null, 'Exercises'),
    h(
      'ul',
      { class: 'hb-habitlist' },
      habits.map((habit) =>
        h(
          'li',
          null,
          h('span', null, habit.name),
          h('button', { class: 'pa-btn pa-btn--small', type: 'button', onclick: () => { close(); editSheet(habit); } }, 'Edit'),
        ),
      ),
      archived.map((habit) =>
        h(
          'li',
          null,
          h('span', { class: 'pa-muted' }, `${habit.name} (archived)`),
          h(
            'button',
            {
              class: 'pa-btn pa-btn--small',
              type: 'button',
              onclick: () => {
                store.put(HABITS, { id: habit.id, archived: false });
                close();
              },
            },
            'Restore',
          ),
        ),
      ),
    ),
    h('div', { class: 'pa-row' }, h('button', { class: 'pa-btn', type: 'button', onclick: () => { close(); editSheet(null); } }, 'Add exercise')),
  );
}
