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
import * as S from './sources.js';

const JOBS = 'jobs';
const SOURCES = 'sources';
const SEEN_KEY = 'sourcesOffered';
const UPDATES_KEY = 'sourcesUpdated';
const VIEW_KEY = 'jb:view';
const PROFILE_FIELDS = [
  ['roles', 'Roles and keywords', 'e.g. Senior Software Engineer, Fullstack, .NET, TypeScript'],
  ['avoid', 'Not interested in', 'e.g. SAP, pure frontend, consulting agencies'],
  ['locations', 'Locations', 'Towns or cantons, e.g. Zurich, Aargau, Zug, remote'],
  ['workload', 'Workload', 'e.g. 80–100%'],
  ['salary', 'Salary range', 'e.g. CHF 120–140k'],
];

startApp({
  id: 'jobs',
  name: 'Jobs',
  schemaVersion: 1,
  migrations: {},
  collections: [JOBS, SOURCES],
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
  const sourcesBtn = h('button', { class: 'pa-btn jb-sources-btn', type: 'button', onclick: () => openSources() }, 'Sources');
  const importBtn = h('button', { class: 'pa-btn', type: 'button', onclick: () => openPasteImport() }, 'Import');
  mount(root, h('div', { class: 'jb-top' }, sourcesBtn, importBtn, addBtn), banner, tabs, list);
  addDefaultSources();

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

  // ---- sources ----------------------------------------------------------------

  /** Copy new entries of the built-in source list into the file, once each, and apply updates to built-in entries. */
  function addDefaultSources() {
    const seen = store.setting(SEEN_KEY, []);
    const fresh = S.newDefaults(seen);
    if (fresh.length) {
      for (const source of fresh) store.put(SOURCES, { ...source });
      store.setSetting(SEEN_KEY, [...seen, ...fresh.map((x) => x.id)]);
    }
    const applied = store.setting(UPDATES_KEY, []);
    const updates = S.pendingUpdates(applied);
    if (!updates.length) return;
    for (const u of updates) {
      const current = store.get(SOURCES, u.id);
      if (current) store.put(SOURCES, { ...current, ...u.fields });
    }
    store.setSetting(UPDATES_KEY, [...applied, ...updates.map((u) => `${u.id}@${u.v}`)]);
  }


  function openSources() {
    const body = h('div', { class: 'jb-sources' });
    let by = readPref('jb:sourcesBy', 'how');
    const draw = () => {
      const all = store.list(SOURCES);
      const today = todayISO();
      const log = store.setting('importLog', null);
      const alerts = store.setting('alertLog', null);
      const groups =
        by === 'how'
          ? S.GROUPS.map((g) => [g.title, S.sortSources(all, g.test)])
          : S.KINDS.map(([kind, title]) => [title, S.sortSources(all, kind)]);
      const seg = segmented(
        [
          ['how', 'By import'],
          ['kind', 'By type'],
        ],
        () => by,
        (v) => {
          by = v;
          writePref('jb:sourcesBy', v);
          draw();
        },
      );
      mount(
        body,
        h(
          'p',
          { class: 'pa-muted' },
          log
            ? `Last automatic import: ${formatDate(log.at.slice(0, 10))}, ${log.sources.reduce((n, x) => n + (x.added || 0), 0)} new jobs.`
            : 'Automatic import is not set up yet (see "Imported automatically" below). Manual sources: copy a results page and use "Import".',
        ),
        h(
          'p',
          { class: 'pa-muted' },
          alerts
            ? `E-mail alerts last read ${new Date(alerts.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}: ${alerts.added} new jobs from ${alerts.mails} mails.`
            : 'E-mail alerts are not imported yet.',
        ),
        h(
          'div',
          { class: 'pa-row pa-row--between' },
          seg.el,
          h('button', { class: 'pa-btn', type: 'button', onclick: () => editSource(null, draw) }, 'Add source'),
        ),
        groups.map(([title, items]) =>
          h(
            'section',
            { class: 'jb-sgroup' },
            h('h3', null, `${title} (${items.length})`),
            items.length
              ? h('ul', { class: 'jb-slist' }, items.map((src) => sourceRow(src, today, draw, log)))
              : h('p', { class: 'pa-muted' }, 'None.'),
          ),
        ),
      );
    };
    draw();
    shell.sheet({ title: 'Sources', body });
  }

  function sourceRow(src, today, redraw, log) {
    const run = S.isAuto(src) ? log?.sources?.find((x) => x.id === src.id) : null;
    const seen = sourceState(src, run, today);
    const meta = [src.field, src.system].filter(Boolean).join(' · ');
    return h(
      'li',
      { class: `jb-source${src.skip ? ' jb-source--skip' : ''}` },
      h(
        'button',
        { class: 'jb-card__main', type: 'button', onclick: () => editSource(src, redraw) },
        h('span', { class: 'jb-card__title' }, src.star ? `★ ${src.name}` : src.name),
        meta && h('span', { class: 'jb-card__meta' }, meta),
        h(
          'span',
          { class: 'jb-card__extra' },
          h('span', { class: 'jb-chip', dataset: { access: src.access } }, S.ACCESS[src.access] ?? src.access),
          h('span', { class: 'pa-muted' }, src.skip ? 'Not followed' : seen),
        ),
      ),
      src.url &&
        h(
          'a',
          {
            class: 'pa-btn pa-btn--small',
            href: src.url,
            target: '_blank',
            rel: 'noopener',
            onclick: () => {
              store.put(SOURCES, { ...src, checkedOn: todayISO() });
              setTimeout(redraw, 0);
            },
          },
          'Open',
        ),
    );
  }

  function editSource(src, redraw) {
    const isNew = !src;
    const value = src ?? { kind: 'company', access: 'check', name: '', url: '', field: '', system: '', notes: '' };
    const input = (key, opts = {}) =>
      h(opts.rows ? 'textarea' : 'input', {
        class: 'pa-input',
        type: opts.type ?? 'text',
        rows: opts.rows,
        value: value[key] ?? '',
        placeholder: opts.placeholder ?? '',
        autocomplete: 'off',
      });
    const name = input('name');
    const url = input('url', { type: 'url', placeholder: 'https://' });
    const fieldIn = input('field', { placeholder: 'e.g. Bank, Software' });
    const system = input('system', { placeholder: 'e.g. Workday' });
    const notes = input('notes', { rows: 2 });
    const kind = h('select', { class: 'pa-input' }, S.KINDS.map(([k, label]) => h('option', { value: k, selected: k === value.kind }, label.replace(/s$/, ''))));
    const access = h('select', { class: 'pa-input' }, Object.entries(S.ACCESS).map(([k, label]) => h('option', { value: k, selected: k === value.access }, label)));
    const skip = h('input', { type: 'checkbox', checked: Boolean(value.skip) });
    const star = h('input', { type: 'checkbox', checked: Boolean(value.star) });
    const panel = shell.sheet({
      title: isNew ? 'Add source' : value.name,
      body: h(
        'form',
        {
          class: 'pa-form',
          onsubmit: (event) => {
            event.preventDefault();
            if (!name.value.trim()) {
              shell.toast('Give the source a name');
              return;
            }
            store.put(SOURCES, {
              ...value,
              name: name.value.trim(),
              url: url.value.trim(),
              field: fieldIn.value.trim(),
              system: system.value.trim(),
              notes: notes.value.trim(),
              kind: kind.value,
              access: access.value,
              skip: skip.checked,
              star: star.checked,
            });
            panel.close();
            redraw();
          },
        },
        field('Name', name),
        field('Link', url),
        h('div', { class: 'jb-pair' }, field('Type', kind), field('How to follow it', access)),
        h('div', { class: 'jb-pair' }, field('Field', fieldIn), field('Job system', system)),
        field('Notes', notes),
        h('label', { class: 'jb-check' }, star, ' Favourite (listed first)'),
        h('label', { class: 'jb-check' }, skip, ' Not following this one'),
        h(
          'div',
          { class: 'pa-row pa-row--between' },
          isNew
            ? h('span')
            : h(
                'button',
                {
                  class: 'pa-btn pa-btn--danger',
                  type: 'button',
                  onclick: () => {
                    store.remove(SOURCES, value.id);
                    panel.close();
                    redraw();
                    shell.toast('Source deleted', { action: { label: 'Undo', run: () => { store.put(SOURCES, value); redraw(); } } });
                  },
                },
                'Delete',
              ),
          h('button', { class: 'pa-btn pa-btn--primary', type: 'submit' }, 'Save'),
        ),
      ),
    });
  }

  // ---- importing a copied results page ------------------------------------------

  function openPasteImport() {
    let found = [];
    const chosen = new Set();
    const area = h('textarea', {
      class: 'pa-input',
      rows: 4,
      placeholder: 'Paste here: on a job board\'s results page select all (Ctrl+A), copy (Ctrl+C), then paste',
    });
    const results = h('div', { class: 'jb-import' });
    const addBtn = h('button', { class: 'pa-btn pa-btn--primary', type: 'button', disabled: true, onclick: save }, 'Add jobs');

    area.addEventListener('paste', (event) => {
      const html = event.clipboardData?.getData('text/html') ?? '';
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!html) return; // plain text: let it land, the input handler reads it
      event.preventDefault();
      area.value = text;
      read({ html, text });
    });
    area.addEventListener('input', () => read({ text: area.value }));

    function read(pasted) {
      const existing = store.list(JOBS);
      found = L.jobsFromPaste(pasted).map((j) => ({ ...j, dup: L.findDuplicate(existing, j.url) }));
      chosen.clear();
      found.forEach((j, i) => {
        if (!j.dup) chosen.add(i);
      });
      draw();
    }

    function draw() {
      addBtn.disabled = !chosen.size;
      addBtn.textContent = chosen.size === 1 ? 'Add 1 job' : `Add ${chosen.size} jobs`;
      if (!found.length) {
        mount(results, area.value.trim() ? h('p', { class: 'pa-muted' }, 'No job links found in what was pasted.') : null);
        return;
      }
      mount(
        results,
        h('p', { class: 'pa-muted' }, `${found.length} jobs found. Untick the ones you don't want.`),
        h(
          'ul',
          { class: 'jb-slist' },
          found.map((j, i) =>
            h(
              'li',
              { class: 'jb-pick' },
              h(
                'label',
                null,
                h('input', {
                  type: 'checkbox',
                  checked: chosen.has(i),
                  disabled: Boolean(j.dup),
                  onchange: (e) => {
                    if (e.target.checked) chosen.add(i);
                    else chosen.delete(i);
                    draw();
                  },
                }),
                h(
                  'span',
                  null,
                  h('span', { class: 'jb-card__title' }, j.title || j.url),
                  h('span', { class: 'pa-muted' }, j.dup ? `Already in the list (${L.statusLabel(j.dup.status, true)})` : [j.company, j.source].filter(Boolean).join(' · ')),
                ),
              ),
            ),
          ),
        ),
      );
    }

    function save() {
      const today = todayISO();
      let n = 0;
      for (const i of chosen) {
        const j = found[i];
        store.put(JOBS, {
          title: j.title,
          company: j.company || '',
          url: j.url,
          source: j.source,
          location: '',
          workload: L.findWorkload(j.title),
          status: 'found',
          foundOn: today,
          importedBy: 'paste',
          history: [{ status: 'found', date: today }],
        });
        n += 1;
      }
      panel.close();
      setView('judge');
      shell.toast(n === 1 ? '1 job added to "To judge"' : `${n} jobs added to "To judge"`);
    }

    const panel = shell.sheet({
      title: 'Import from page',
      body: h(
        'div',
        { class: 'pa-form' },
        h(
          'p',
          { class: 'pa-muted' },
          'For boards that forbid automatic reading (jobs.ch, LinkedIn, Indeed ...): open your search there, copy the whole results page and paste it here. Each job link becomes a job to judge.',
        ),
        area,
        results,
        h('div', { class: 'pa-row pa-row--end' }, addBtn),
      ),
    });
    area.focus();
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
    h('p', { class: 'pa-muted' }, 'The automatic import picks jobs whose title has one of the roles and keywords (comma-separated), none of the words to avoid, and is in one of the locations (a canton covers its towns; empty means all of Switzerland). Saved in jobs.json in your Drive.'),
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

function sourceState(src, run, today) {
  if (run) return run.error ? `Import failed: ${run.error}` : `Last import: ${run.added} new`;
  if (S.isAuto(src)) return 'Waiting for the first import';
  if (!src.checkedOn) return 'Not opened yet';
  return src.checkedOn === today ? 'Opened today' : `Opened ${formatDate(src.checkedOn)}`;
}

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only a convenience.
  }
}
