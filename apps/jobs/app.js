// Jobs: collect job postings, judge them (interesting or not, and why),
// and track the applications that follow.
//
// Postings come in by link: shared from the job board's app or Chrome on
// the phone (the installed app is a share target), or pasted. Automated
// search comes later and will add jobs with status "found" to the same
// list, so judging works the same for both.

import { startApp } from '../../core/shell.js';
import { h, icon, ICONS, mount } from '../../core/dom.js';
import { formatDate, todayISO } from '../../core/util.js';
import * as L from './logic.js';

const JOBS = 'jobs';
const VIEW_KEY = 'jb:view';
const PROFILE_FIELDS = [
  ['roles', 'Roles and keywords', 'e.g. Senior Software Engineer, Fullstack, .NET, TypeScript'],
  ['avoid', 'Not interested in', 'e.g. SAP, pure frontend, consulting agencies'],
  ['locations', 'Locations', 'e.g. Zurich, Baden, remote'],
  ['workload', 'Workload', 'e.g. 80–100%'],
  ['salary', 'Salary range', 'e.g. CHF 120–140k'],
];

startApp({
  id: 'jobs',
  name: 'Jobs',
  schemaVersion: 1,
  migrations: {},
  collections: [JOBS],
  mount: mountApp,
  settings: settingsSection,
  about: 'Collect postings, judge them, track applications.',
});

function mountApp({ root, store, shell }) {
  let view = readView();
  const banner = h('div', { class: 'jb-due', hidden: true });
  const tabs = h('div', { class: 'pa-seg jb-tabs', role: 'tablist', 'aria-label': 'Lists' });
  const list = h('ul', { class: 'jb-list' });
  const addBtn = h(
    'button',
    { class: 'pa-btn pa-btn--primary jb-add', type: 'button', onclick: () => openAdd() },
    icon(ICONS.plus, 18),
    'Add job',
  );
  mount(root, h('div', { class: 'jb-top' }, addBtn), banner, tabs, list);

  let seen = -1;
  store.subscribe(() => {
    if (store.changes !== seen) render();
  });
  render();
  takeShared();

  function readView() {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (L.VIEWS.some((x) => x.id === v)) return v;
    } catch {
      // Not remembered; start on the first list.
    }
    return 'judge';
  }

  function setView(v) {
    view = v;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Only a convenience.
    }
    render();
  }

  function render() {
    seen = store.changes;
    const jobs = store.list(JOBS);
    const today = todayISO();

    mount(
      tabs,
      L.VIEWS.map((v) => {
        const n = jobs.filter((j) => v.statuses.includes(j.status)).length;
        return h(
          'button',
          {
            class: 'pa-seg__option',
            type: 'button',
            role: 'tab',
            'aria-selected': String(v.id === view),
            'aria-pressed': String(v.id === view),
            onclick: () => setView(v.id),
          },
          v.label,
          n ? h('span', { class: 'jb-count' }, String(n)) : null,
        );
      }),
    );

    const due = L.dueFollowUps(jobs, today);
    banner.hidden = !due.length;
    if (due.length) {
      mount(
        banner,
        h('strong', null, due.length === 1 ? 'Follow-up due' : `${due.length} follow-ups due`),
        h(
          'ul',
          null,
          due.map((j) =>
            h(
              'li',
              null,
              h('button', { class: 'jb-link', type: 'button', onclick: () => openJob(j.id) }, jobName(j)),
              h('span', { class: 'pa-muted' }, ` · ${L.statusLabel(j.status, true)} since ${formatDate(j.appliedOn)}`),
            ),
          ),
        ),
      );
    }

    const current = L.VIEWS.find((v) => v.id === view);
    const shown = L.sortForView(
      view,
      jobs.filter((j) => current.statuses.includes(j.status)),
    );
    if (!shown.length) {
      mount(list, h('li', { class: 'jb-empty pa-muted' }, emptyText(view, jobs.length)));
      return;
    }
    mount(list, shown.map((j) => card(j, today)));
  }

  function card(job, today) {
    const meta = [job.company, job.location, job.workload].filter(Boolean).join(' · ');
    const extra = [];
    if (job.appliedOn) extra.push(`Applied ${formatDate(job.appliedOn)}`);
    if (job.followUpOn && ['applied', 'interview'].includes(job.status)) {
      extra.push(job.followUpOn <= today ? 'Follow up now' : `Follow up ${formatDate(job.followUpOn)}`);
    }
    if (!job.appliedOn && job.source) extra.push(job.source);
    return h(
      'li',
      { class: 'jb-card', dataset: { status: job.status } },
      h(
        'button',
        { class: 'jb-card__main', type: 'button', onclick: () => openJob(job.id) },
        h('span', { class: 'jb-card__title' }, job.title || 'Untitled job'),
        meta && h('span', { class: 'jb-card__meta' }, meta),
        h(
          'span',
          { class: 'jb-card__extra' },
          view !== 'judge' && h('span', { class: 'jb-chip', dataset: { status: job.status } }, L.statusLabel(job.status, true)),
          extra.length ? h('span', { class: 'pa-muted' }, extra.join(' · ')) : null,
        ),
        job.reasons?.length ? h('span', { class: 'jb-card__reasons pa-muted' }, job.reasons.join(', ')) : null,
      ),
      h(
        'div',
        { class: 'jb-card__actions' },
        job.url &&
          h('a', { class: 'pa-btn pa-btn--small pa-btn--quiet', href: job.url, target: '_blank', rel: 'noopener' }, 'Open'),
        ...quickActions(job),
      ),
    );
  }

  function quickActions(job) {
    const btn = (label, run, cls = '') =>
      h('button', { class: `pa-btn pa-btn--small ${cls}`, type: 'button', onclick: run }, label);
    switch (job.status) {
      case 'found':
        return [
          btn('Not for me', () => judge(job, 'no')),
          btn('Interesting', () => judge(job, 'yes'), 'pa-btn--primary'),
        ];
      case 'saved':
        return [btn('Applied', () => move(job, 'applied'), 'pa-btn--primary')];
      case 'applied':
        return [btn('Interview', () => move(job, 'interview'))];
      default:
        return [];
    }
  }

  // ---- judging ----------------------------------------------------------------

  function judge(job, verdict) {
    const options = verdict === 'yes' ? L.REASONS_YES : L.REASONS_NO;
    const chosen = new Set(job.verdict === verdict ? job.reasons ?? [] : []);
    const note = h('textarea', {
      class: 'pa-input',
      rows: 2,
      placeholder: verdict === 'yes' ? 'What makes it interesting? (optional)' : 'Why not? (optional)',
      value: job.verdict === verdict ? job.verdictNote ?? '' : '',
    });
    const chips = options.map((r) => {
      const b = h(
        'button',
        {
          class: 'jb-reason',
          type: 'button',
          'aria-pressed': String(chosen.has(r)),
          onclick: () => {
            if (chosen.has(r)) chosen.delete(r);
            else chosen.add(r);
            b.setAttribute('aria-pressed', String(chosen.has(r)));
          },
        },
        r,
      );
      return b;
    });
    const panel = shell.sheet({
      title: verdict === 'yes' ? 'Interesting because' : 'Not for me because',
      body: h(
        'form',
        {
          class: 'pa-form',
          onsubmit: (event) => {
            event.preventDefault();
            const next = L.moveTo(job, verdict === 'yes' ? 'saved' : 'dismissed', todayISO());
            store.put(JOBS, {
              ...next,
              verdict,
              reasons: [...chosen],
              verdictNote: note.value.trim(),
            });
            panel.close();
            shell.toast(verdict === 'yes' ? 'Saved to "Saved"' : 'Moved to "Closed"', {
              action: { label: 'Undo', run: () => store.put(JOBS, job) },
            });
          },
        },
        h('p', { class: 'pa-muted' }, jobName(job)),
        h('div', { class: 'jb-reasons' }, chips),
        note,
        h(
          'div',
          { class: 'pa-row pa-row--end' },
          h('button', { class: 'pa-btn pa-btn--primary', type: 'submit' }, 'Save'),
        ),
      ),
    });
  }

  function move(job, status) {
    store.put(JOBS, L.moveTo(job, status, todayISO()));
    shell.toast(`Moved to ${L.statusLabel(status, true)}`, {
      action: { label: 'Undo', run: () => store.put(JOBS, job) },
    });
  }

  // ---- adding -----------------------------------------------------------------

  /** Opened by Android's share sheet: ?title=…&text=…&url=… (see manifest). */
  function takeShared() {
    const params = new URLSearchParams(location.search);
    if (!['title', 'text', 'url'].some((k) => params.get(k))) return;
    const shared = {
      title: params.get('title') ?? '',
      text: params.get('text') ?? '',
      url: params.get('url') ?? '',
    };
    history.replaceState(null, '', location.pathname);
    openAdd(shared);
  }

  function openAdd(shared) {
    const paste = h('textarea', {
      class: 'pa-input',
      rows: 3,
      placeholder: 'Paste the link, or the link with the posting text',
      value: shared ? [shared.title, shared.text, shared.url].filter(Boolean).join('\n') : '',
    });
    const fields = jobFields(shared ? L.fromShared(shared) : {});
    const warn = h('p', { class: 'jb-warn', hidden: true });
    const startAs = { value: 'found' };
    const statusSeg = segmented(
      [
        ['found', 'To judge'],
        ['saved', 'Interesting'],
        ['applied', 'Applied'],
      ],
      () => startAs.value,
      (v) => {
        startAs.value = v;
        statusSeg.update();
      },
    );

    paste.addEventListener('input', () => {
      const parsed = L.fromShared({ text: paste.value });
      for (const key of ['title', 'company', 'url', 'workload', 'source']) {
        if (parsed[key] && !fields.touched.has(key)) fields.inputs[key].value = parsed[key];
      }
      checkDuplicate();
    });
    fields.inputs.url.addEventListener('input', checkDuplicate);
    checkDuplicate();

    function checkDuplicate() {
      const dup = L.findDuplicate(store.list(JOBS), fields.inputs.url.value.trim());
      warn.hidden = !dup;
      if (dup) {
        mount(
          warn,
          'Already in the list: ',
          h('button', { class: 'jb-link', type: 'button', onclick: () => { panel.close(); openJob(dup.id); } }, jobName(dup)),
          ` (${L.statusLabel(dup.status, true)})`,
        );
      }
    }

    const panel = shell.sheet({
      title: 'Add job',
      body: h(
        'form',
        {
          class: 'pa-form',
          onsubmit: (event) => {
            event.preventDefault();
            const values = fields.read();
            if (!values.title && !values.url) {
              shell.toast('Add at least a title or a link');
              return;
            }
            const today = todayISO();
            if (!values.source && values.url) values.source = L.sourceOf(values.url);
            let job = { ...values, status: 'found', foundOn: today, history: [{ status: 'found', date: today }] };
            if (startAs.value !== 'found') job = L.moveTo(job, startAs.value, today);
            if (startAs.value === 'saved') job.verdict = 'yes';
            const saved = store.put(JOBS, job);
            panel.close();
            setView(L.viewOf(job.status));
            shell.toast('Job added', saved?.id ? { action: { label: 'Open', run: () => openJob(saved.id) } } : {});
          },
        },
        field('Link or posting', paste),
        warn,
        fields.el,
        h('div', { class: 'pa-field' }, h('span', { class: 'pa-label' }, 'Add as'), statusSeg.el),
        h('div', { class: 'pa-row pa-row--end' }, h('button', { class: 'pa-btn pa-btn--primary', type: 'submit' }, 'Add')),
      ),
    });
    (shared ? fields.inputs.title : paste).focus();
  }

  // ---- details ----------------------------------------------------------------

  function openJob(id) {
    const job = store.get(JOBS, id);
    if (!job) return;
    const fields = jobFields(job, { full: true });
    const status = h(
      'select',
      { class: 'pa-input' },
      L.STATUSES.map((s) => h('option', { value: s.id, selected: s.id === job.status }, s.label)),
    );
    const history = (job.history ?? []).map((e) =>
      h('li', null, `${formatDate(e.date)}: ${L.statusLabel(e.status)}`),
    );
    const panel = shell.sheet({
      title: job.title || 'Job',
      body: h(
        'form',
        {
          class: 'pa-form jb-editor',
          onsubmit: (event) => {
            event.preventDefault();
            const today = todayISO();
            const current = store.get(JOBS, id) ?? job;
            let next = { ...current, ...fields.read() };
            if (status.value !== current.status) {
              next = L.moveTo(next, status.value, today);
              if (fields.touched.has('followUpOn')) next.followUpOn = fields.inputs.followUpOn.value;
              if (fields.touched.has('appliedOn')) next.appliedOn = fields.inputs.appliedOn.value;
            }
            store.put(JOBS, next);
            panel.close();
            shell.toast('Saved');
          },
        },
        job.url &&
          h(
            'div',
            { class: 'pa-row' },
            h('a', { class: 'pa-btn', href: job.url, target: '_blank', rel: 'noopener' }, `Open on ${job.source || 'the web'}`),
          ),
        field('Status', status),
        job.verdict &&
          h(
            'p',
            { class: 'pa-muted' },
            `${job.verdict === 'yes' ? 'Interesting' : 'Not for me'}${job.reasons?.length ? `: ${job.reasons.join(', ')}` : ''}${job.verdictNote ? `. ${job.verdictNote}` : ''}`,
          ),
        fields.el,
        history.length ? h('div', { class: 'pa-field' }, h('span', { class: 'pa-label' }, 'History'), h('ul', { class: 'jb-history' }, history)) : null,
        h(
          'div',
          { class: 'pa-row pa-row--between' },
          h(
            'button',
            {
              class: 'pa-btn pa-btn--danger',
              type: 'button',
              onclick: async () => {
                const ok = await shell.confirm({
                  title: 'Delete this job?',
                  message: 'Usually "Not interesting" or "Withdrawn" is better: it keeps the job out of new searches.',
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (!ok) return;
                store.remove(JOBS, id);
                panel.close();
                shell.toast('Deleted', { action: { label: 'Undo', run: () => store.put(JOBS, job) } });
              },
            },
            'Delete',
          ),
          h('button', { class: 'pa-btn pa-btn--primary', type: 'submit' }, 'Save'),
        ),
      ),
    });
  }
}

/** The editable fields of a job. `full` adds the application details. */
function jobFields(job, { full = false } = {}) {
  const inputs = {};
  const touched = new Set();
  const make = (key, label, { type = 'text', rows, placeholder } = {}) => {
    const el = rows
      ? h('textarea', { class: 'pa-input', rows, placeholder, value: job[key] ?? '' })
      : h('input', { class: 'pa-input', type, placeholder, value: job[key] ?? '', autocomplete: 'off' });
    el.addEventListener('input', () => touched.add(key));
    inputs[key] = el;
    return field(label, el);
  };
  const el = h(
    'div',
    { class: 'pa-form' },
    make('title', 'Job title'),
    make('company', 'Company'),
    h('div', { class: 'jb-pair' }, make('location', 'Location'), make('workload', 'Workload', { placeholder: '80–100%' })),
    make('url', 'Link', { type: 'url', placeholder: 'https://' }),
    full && make('source', 'Found on'),
    full && make('salary', 'Salary'),
    full && h('div', { class: 'jb-pair' }, make('appliedOn', 'Applied on', { type: 'date' }), make('followUpOn', 'Follow up on', { type: 'date' })),
    full && make('contact', 'Contact person', { placeholder: 'Name, e-mail or phone' }),
    full && make('cv', 'CV sent', { placeholder: 'File name or Drive link' }),
    full && make('letter', 'Cover letter sent', { placeholder: 'File name or Drive link' }),
    make('notes', 'Notes', { rows: 3 }),
    full && make('description', 'Posting text', { rows: 5, placeholder: 'Paste the posting, so it is kept when the ad goes offline' }),
  );
  if (!full) inputs.source = { value: job.source ?? '' };
  if (!full) inputs.description = { value: job.description ?? '' };
  return {
    el,
    inputs,
    touched,
    read() {
      const out = {};
      for (const [key, input] of Object.entries(inputs)) out[key] = String(input.value ?? '').trim();
      return out;
    },
  };
}

function settingsSection({ store }) {
  const profile = store.setting('profile', {});
  const inputs = {};
  const jobs = store.list(JOBS);
  const { yes, no } = L.reasonCounts(jobs);
  const top = (counts) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([r, n]) => `${r} (${n})`)
      .join(', ');
  return h(
    'div',
    { class: 'pa-form' },
    h('h3', null, 'What I am looking for'),
    h('p', { class: 'pa-muted' }, 'Used by the job search once it is added. Saved in jobs.json in your Drive.'),
    PROFILE_FIELDS.map(([key, label, placeholder]) => {
      const input = h('input', { class: 'pa-input', placeholder, value: profile[key] ?? '', autocomplete: 'off' });
      inputs[key] = input;
      return field(label, input);
    }),
    h(
      'div',
      { class: 'pa-row pa-row--end' },
      h(
        'button',
        {
          class: 'pa-btn',
          type: 'button',
          onclick: (event) => {
            const next = {};
            for (const [key, input] of Object.entries(inputs)) if (input.value.trim()) next[key] = input.value.trim();
            store.setSetting('profile', next);
            event.currentTarget.textContent = 'Saved';
          },
        },
        'Save',
      ),
    ),
    (Object.keys(yes).length || Object.keys(no).length) &&
      h(
        'div',
        { class: 'pa-field' },
        h('span', { class: 'pa-label' }, 'Your reasons so far'),
        Object.keys(yes).length ? h('p', { class: 'pa-muted' }, `Interesting: ${top(yes)}`) : null,
        Object.keys(no).length ? h('p', { class: 'pa-muted' }, `Not for me: ${top(no)}`) : null,
      ),
  );
}

// ---- small helpers ------------------------------------------------------------

function jobName(job) {
  return [job.title || 'Untitled job', job.company].filter(Boolean).join(', ');
}

function emptyText(view, total) {
  if (!total) return 'No jobs yet. Add one with "Add job", or share a posting from Chrome or a job board app to Jobs.';
  return {
    judge: 'Nothing to judge right now.',
    saved: 'No saved jobs. Jobs you mark as interesting land here until you apply.',
    active: 'No open applications.',
    closed: 'Nothing closed yet.',
  }[view];
}

function field(label, control) {
  const id = `jb-f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return h('div', { class: 'pa-field' }, h('label', { for: id }, label), control);
}

function segmented(options, get, set) {
  const buttons = options.map(([value, label]) =>
    h('button', { class: 'pa-seg__option', type: 'button', onclick: () => set(value) }, label),
  );
  const update = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === get())));
  update();
  return { el: h('div', { class: 'pa-seg' }, buttons), update };
}
