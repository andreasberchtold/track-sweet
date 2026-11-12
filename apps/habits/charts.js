// The two charts of the habit tracker, drawn as plain SVG:
//   weekChart: weekly totals against the goal, one column per week
//   dayCalendar: one square per day, darker for more
// Both report the item under the finger or pointer through onPick, which
// the app shows in a line of text under the chart.

import { addDays, shade, weekStart } from './logic.js';

const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined && value !== false) el.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** A column with 4px rounded top corners and a square foot on the baseline. */
function columnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(value) {
  if (value <= 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * magnitude >= value) return f * magnitude;
  return value;
}

const shortDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * weeks: [{ week, total, goal, met, current }], oldest first.
 * describe(week) -> text for the detail line.
 */
export function weekChart(weeks, { describe, onPick }) {
  const W = 340;
  const H = 168;
  const top = 22;
  const bottom = 26;
  const left = 30;
  const right = 4;
  const plotH = H - top - bottom;
  const band = (W - left - right) / weeks.length;
  const barW = Math.min(20, band - 6);
  const max = niceMax(Math.max(1, ...weeks.map((w) => Math.max(w.total, w.goal ?? 0))));
  const y = (v) => top + plotH * (1 - v / max);

  const svg = s('svg', {
    class: 'hb-chart',
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `Weekly totals for the last ${weeks.length} weeks`,
  });

  // Gridlines: baseline, half and top, labelled on the left.
  for (const v of [0, max / 2, max]) {
    svg.append(
      s('line', { class: v ? 'hb-grid' : 'hb-axis', x1: left, x2: W - right, y1: y(v), y2: y(v) }),
      s('text', { class: 'hb-tick', x: left - 6, y: y(v) + 3.5, 'text-anchor': 'end' }, Math.round(v).toLocaleString()),
    );
  }

  const best = weeks.reduce((a, b) => (b.total > a.total ? b : a), weeks[0]);
  const groups = [];

  weeks.forEach((w, i) => {
    const cx = left + band * i + band / 2;
    const x = cx - barW / 2;
    const g = s('g', { class: 'hb-col', tabindex: 0, 'aria-label': describe(w) });
    g.append(s('rect', { class: 'hb-col__hit', x: left + band * i, y: top - 16, width: band, height: plotH + 16 + bottom }));
    if (w.total > 0) {
      const kind = w.met ? 'met' : w.current ? 'current' : 'missed';
      g.append(s('path', { class: `hb-bar hb-bar--${kind}`, d: columnPath(x, y(w.total), barW, y(0) - y(w.total)) }));
    }
    if (w.goal) {
      g.append(s('line', { class: 'hb-goalmark', x1: x - 3, x2: x + barW + 3, y1: y(w.goal), y2: y(w.goal) }));
    }
    // Only the current and the best week carry a number; the rest is in the detail line.
    if ((w.current || w === best) && w.total > 0) {
      const labelY = Math.min(y(w.total), w.goal ? y(w.goal) : Infinity) - 6;
      g.append(s('text', { class: 'hb-value', x: cx, y: labelY, 'text-anchor': 'middle' }, w.total.toLocaleString()));
    }
    if (i === 0 || i === Math.floor(weeks.length / 2) || w.current) {
      g.append(
        s('text', { class: 'hb-tick', x: cx, y: H - 8, 'text-anchor': 'middle' }, w.current ? 'This week' : shortDate(w.week)),
      );
    }
    const pick = () => {
      groups.forEach((other) => other.classList.toggle('is-picked', other === g));
      onPick(describe(w));
    };
    g.addEventListener('pointerenter', pick);
    g.addEventListener('click', pick);
    g.addEventListener('focus', pick);
    groups.push(g);
    svg.append(g);
  });

  return svg;
}

/**
 * The last `weeksShown` weeks as a grid: one column per week, Monday at
 * the top. days: Map date -> amount.
 */
export function dayCalendar(days, today, { weeksShown = 16, describe, onPick }) {
  const cell = 16;
  const gap = 3;
  const stepPx = cell + gap;
  const left = 26;
  const top = 16;
  const W = left + weeksShown * stepPx - gap;
  const H = top + 7 * stepPx - gap;
  const first = addDays(weekStart(today), -7 * (weeksShown - 1));

  let best = 0;
  for (let i = 0; i < weeksShown * 7; i += 1) {
    const date = addDays(first, i);
    if (date > today) break;
    best = Math.max(best, days.get(date) ?? 0);
  }

  const svg = s('svg', {
    class: 'hb-cal',
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `Days with training in the last ${weeksShown} weeks`,
  });

  ['Mon', 'Wed', 'Fri'].forEach((label, i) => {
    svg.append(s('text', { class: 'hb-tick', x: 0, y: top + i * 2 * stepPx + cell - 4 }, label));
  });

  let lastMonth = null;
  const cells = [];
  for (let c = 0; c < weeksShown; c += 1) {
    const monday = addDays(first, c * 7);
    const month = monday.slice(0, 7);
    if (month !== lastMonth && c < weeksShown - 1) {
      const [y, m] = month.split('-').map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' });
      if (lastMonth !== null || Number(monday.slice(8)) <= 7) {
        svg.append(s('text', { class: 'hb-tick', x: left + c * stepPx, y: 10 }, label));
      }
      lastMonth = month;
    }
    for (let r = 0; r < 7; r += 1) {
      const date = addDays(monday, r);
      if (date > today) continue;
      const amount = days.get(date) ?? 0;
      const rect = s('rect', {
        class: `hb-day hb-day--${shade(amount, best)}${date === today ? ' hb-day--today' : ''}`,
        x: left + c * stepPx,
        y: top + r * stepPx,
        width: cell,
        height: cell,
        rx: 3,
      });
      const pick = () => {
        cells.forEach((other) => other.classList.toggle('is-picked', other === rect));
        onPick(describe(date, amount));
      };
      rect.addEventListener('pointerenter', pick);
      rect.addEventListener('click', pick);
      cells.push(rect);
      svg.append(rect);
    }
  }
  return svg;
}
