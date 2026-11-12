// Movies & Series: what you have watched, what you want to watch, and how
// you rated it. Titles can be looked up through TMDB or typed in by hand.

import { startApp } from '../../core/shell.js';
import { h, icon, ICONS, mount } from '../../core/dom.js';
import { debounce, formatDate, todayISO } from '../../core/util.js';
import { createTmdb, formatRuntime, imdbUrl, posterUrl } from './tmdb.js';
import { enrich, mapSimkl, mergeImport } from './simkl.js';
import { findAll, mergeWatchlist, parseList, tagsForNote, toEntry } from './listimport.js';

const TITLES = 'titles';

const STATUS_LABEL = {
  watchlist: 'Watchlist',
  watching: 'Watching',
  watched: 'Watched',
  notinterested: 'Not interesting',
};

/** The tab a title is listed under. */
function tabOf(status) {
  if (status === 'watchlist' || status === 'notinterested') return status;
  return 'watched';
}
const TYPE_LABEL = { movie: 'Movie', tv: 'Series' };
// Who a watchlist title is meant for. A title can carry several of these
// tags. The list can be changed in the menu; it is then saved with the data
// as the setting "watchWithTags". Entries refer to a tag by its id, so a tag
// can be renamed without touching the entries.
const DEFAULT_WITH = [
  { id: 'friends', label: 'Friends' },
  { id: 'partner', label: 'Girlfriend' },
  { id: 'solo', label: 'Alone' },
];

function withTags(store) {
  const saved = store.setting('watchWithTags');
  return Array.isArray(saved) ? saved : DEFAULT_WITH;
}
const SORTS = {
  watched: [
    ['recent', 'Newest first'],
    ['rating', 'Highest rated'],
    ['title', 'Title A to Z'],
  ],
  watchlist: [
    ['recent', 'Newest first'],
    ['shortest', 'Shortest first'],
    ['title', 'Title A to Z'],
  ],
  notinterested: [
    ['recent', 'Newest first'],
    ['title', 'Title A to Z'],
  ],
};
const LANGUAGES = [
  ['en-US', 'English'],
  ['de-DE', 'Deutsch'],
  ['fr-FR', 'Français'],
  ['it-IT', 'Italiano'],
];

startApp({
  id: 'movies',
  name: 'Movies & Series',
  schemaVersion: 1,
  collections: [TITLES],
  mount: mountApp,
  settings: settingsSection,
  about:
    'Search results and posters come from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.',
});

// While many entries are written at once (an import), the list is not
// redrawn for each of them; redraw() draws it once at the end.
let bulk = false;
let redraw = () => {};

function mountApp({ root, store, shell }) {
  const tmdb = createTmdb({
    getKey: () => store.setting('tmdbKey', ''),
    getLanguage: () => store.setting('tmdbLanguage', 'en-US'),
  });
  const view = { tab: 'watched', type: 'all', sort: 'recent', with: 'all' };

  const tabs = segmented(
    [
      ['watched', 'Watched'],
      ['watchlist', 'Watchlist'],
      ['notinterested', 'Not interesting'],
    ],
    () => view.tab,
    (value) => {
      view.tab = value;
      render();
    },
  );
  const types = segmented(
    [
      ['all', 'All'],
      ['movie', 'Movies'],
      ['tv', 'Series'],
    ],
    () => view.type,
    (value) => {
      view.type = value;
      render();
    },
  );
  const sortSelect = h(
    'select',
    {
      class: 'pa-input mv-sort',
      'aria-label': 'Sort by',
      onchange: (event) => {
        view.sort = event.target.value;
        render();
      },
    },
  );
  const withFilter = h('div', { class: 'pa-seg mv-with', role: 'group', 'aria-label': 'Watch with' });
  tabs.el.classList.add('mv-tabs');
  const list = h('div', { class: 'mv-list' });
  const addBtn = h(
    'button',
    { class: 'pa-btn pa-btn--primary mv-add', type: 'button', onclick: () => openAdd() },
    icon(ICONS.plus),
    'Add title',
  );

  mount(
    root,
    h('div', { class: 'mv-tools' }, tabs.el, h('div', { class: 'mv-tools__filters' }, types.el, sortSelect), withFilter),
    list,
    addBtn,
  );

  let seen = -1;
  store.subscribe(() => {
    if (!bulk && store.changes !== seen) render();
  });
  redraw = render;
  render();

  // ---- the list ----------------------------------------------------------

  function render() {
    seen = store.changes;
    const onWatchlist = view.tab === 'watchlist';
    const sorts = SORTS[view.tab];
    if (!sorts.some(([value]) => value === view.sort)) view.sort = 'recent';
    mount(sortSelect, sorts.map(([value, label]) => h('option', { value, selected: value === view.sort }, label)));
    tabs.update();
    types.update();
    const tags = withTags(store);
    if (view.with !== 'all' && !tags.some((tag) => tag.id === view.with)) view.with = 'all';
    mount(
      withFilter,
      [{ id: 'all', label: 'Anyone' }, ...tags].map((tag) =>
        h(
          'button',
          {
            class: 'pa-seg__option',
            type: 'button',
            'aria-pressed': String(view.with === tag.id),
            onclick: () => {
              view.with = tag.id;
              render();
            },
          },
          tag.label,
        ),
      ),
    );
    withFilter.hidden = !onWatchlist || !tags.length;
    const all = store.list(TITLES);
    const inTab = all.filter((t) => tabOf(t.status) === view.tab);
    const shown = inTab
      .filter((t) => view.type === 'all' || t.mediaType === view.type)
      .filter((t) => !onWatchlist || view.with === 'all' || (t.watchWith ?? []).includes(view.with))
      .sort(sorter(view.sort));

    if (!shown.length) {
      mount(list, emptyState(inTab.length > 0));
      return;
    }
    if (view.tab === 'watchlist') {
      mount(list, section(`${shown.length} to watch`, shown));
      return;
    }
    if (view.tab === 'notinterested') {
      mount(list, section(`${shown.length} not interesting`, shown));
      return;
    }
    const watching = shown.filter((t) => t.status === 'watching');
    const watched = shown.filter((t) => t.status === 'watched');
    mount(
      list,
      watching.length ? section('Watching now', watching) : null,
      watched.length ? section(`${watched.length} watched`, watched) : null,
    );
  }

  function section(heading, titles) {
    return h(
      'section',
      { class: 'mv-section' },
      h('h2', { class: 'mv-section__heading' }, heading),
      h('ul', { class: 'mv-rows' }, titles.map(row)),
    );
  }

  function row(title) {
    const marks =
      title.status === 'watchlist' ? withTags(store).filter((tag) => (title.watchWith ?? []).includes(tag.id)) : [];
    return h(
      'li',
      { class: 'mv-item' },
      h(
        'button',
        { class: 'mv-row', type: 'button', onclick: () => openEditor(title) },
        poster(title),
        h(
          'span',
          { class: 'mv-row__text' },
          h('span', { class: 'mv-row__title' }, title.title),
          h('span', { class: 'mv-row__meta' }, metaLine(title)),
          marks.length
            ? h('span', { class: 'mv-tags' }, marks.map((tag) => h('span', { class: 'mv-tag' }, tag.label)))
            : null,
          title.notes ? h('span', { class: 'mv-row__notes' }, title.notes) : null,
        ),
        title.rating
          ? h(
              'span',
              { class: 'mv-score', 'aria-label': `Rated ${title.rating} of 10` },
              h('span', { class: 'mv-score__bulb' }),
              String(title.rating),
            )
          : null,
      ),
      imdbLink(title),
    );
  }

  function emptyState(filtered) {
    const text = filtered
      ? 'Nothing matches this filter.'
      : view.tab === 'watchlist'
        ? 'Your watchlist is empty. Add something you want to see.'
        : view.tab === 'notinterested'
          ? 'Nothing marked as not interesting. Titles you do not want to watch go here.'
          : 'Nothing here yet. Add the last thing you watched.';
    return h(
      'div',
      { class: 'mv-empty' },
      h('p', null, text),
      !filtered && h('button', { class: 'pa-btn', type: 'button', onclick: () => openAdd() }, 'Add title'),
    );
  }

  // ---- adding --------------------------------------------------------------

  function openAdd() {
    const results = h('div', { class: 'mv-results' });
    const input = h('input', {
      class: 'pa-input',
      type: 'search',
      placeholder: tmdb.hasKey() ? 'Search movies and series' : 'Title',
      'aria-label': 'Title',
      autocomplete: 'off',
      enterkeyhint: 'search',
    });
    let controller = null;

    const panel = shell.sheet({
      title: 'Add title',
      body: h('div', { class: 'pa-form' }, input, results),
      onClose: () => controller?.abort(),
    });

    const manualRow = (text) =>
      h(
        'button',
        {
          class: 'pa-btn mv-manual',
          type: 'button',
          onclick: () => choose({ tmdbId: null, mediaType: 'movie', title: text, year: null, posterPath: null }),
        },
        `Add "${text}" without search`,
      );

    function choose(found) {
      panel.close();
      const existing =
        found.tmdbId &&
        store.list(TITLES).find((t) => t.tmdbId === found.tmdbId && t.mediaType === found.mediaType);
      if (existing) {
        openEditor(existing);
        return;
      }
      const watched = view.tab === 'watched';
      openEditor(
        {
          ...found,
          status: watched ? 'watched' : view.tab,
          rating: null,
          watchedOn: watched ? todayISO() : null,
          seasonsWatched: null,
          seasonsTotal: null,
          watchWith: view.tab === 'watchlist' && view.with !== 'all' ? [view.with] : [],
          runtime: null,
          imdbId: null,
          notes: '',
        },
        { isNew: true },
      );
    }

    async function search() {
      const text = input.value.trim();
      controller?.abort();
      if (!text) {
        showHint();
        return;
      }
      if (!tmdb.hasKey()) {
        mount(results, manualRow(text), keyHint());
        return;
      }
      controller = new AbortController();
      mount(results, h('p', { class: 'pa-muted' }, 'Searching'));
      try {
        const found = await tmdb.search(text, controller.signal);
        const mine = store.list(TITLES);
        mount(
          results,
          found.length
            ? h(
                'ul',
                { class: 'mv-rows' },
                found.map((r) => {
                  const have = mine.some((t) => t.tmdbId === r.tmdbId && t.mediaType === r.mediaType);
                  return h(
                    'li',
                    null,
                    h(
                      'button',
                      { class: 'mv-row', type: 'button', onclick: () => choose(r) },
                      poster(r),
                      h(
                        'span',
                        { class: 'mv-row__text' },
                        h('span', { class: 'mv-row__title' }, r.title),
                        h('span', { class: 'mv-row__meta' }, [TYPE_LABEL[r.mediaType], r.year].filter(Boolean).join(', ')),
                      ),
                      have ? h('span', { class: 'mv-tag' }, 'In your list') : null,
                    ),
                  );
                }),
              )
            : h('p', { class: 'pa-muted' }, `No results for "${text}".`),
          manualRow(text),
        );
      } catch (err) {
        if (err?.name === 'AbortError') return;
        mount(results, h('p', { class: 'mv-error' }, err.message), manualRow(text));
      }
    }

    function keyHint() {
      return h(
        'p',
        { class: 'pa-muted' },
        'To search with posters and release years, add a free TMDB key in the menu.',
      );
    }

    function showHint() {
      mount(results, tmdb.hasKey() ? null : keyHint());
    }

    input.addEventListener('input', debounce(search, 300));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        search();
      }
    });
    showHint();
    input.focus();
  }

  // ---- editing -------------------------------------------------------------

  function openEditor(title, { isNew = false } = {}) {
    const draft = { ...title };
    const manual = !draft.tmdbId;
    const form = h('form', { class: 'pa-form mv-editor', onsubmit: save });
    const panel = shell.sheet({ title: isNew ? 'Add title' : 'Edit title', body: form });

    // Look up IMDb id, running time and season count once per title.
    if (draft.tmdbId && !draft.tmdbDetails && tmdb.hasKey()) {
      tmdb
        .details(draft.mediaType, draft.tmdbId)
        .then((found) => {
          const extra = { imdbId: found.imdbId, runtime: found.runtime, tmdbDetails: true };
          if (found.seasonsTotal) extra.seasonsTotal = found.seasonsTotal;
          if (found.posterPath && !draft.posterPath) extra.posterPath = found.posterPath;
          Object.assign(draft, extra);
          if (!isNew && store.get(TITLES, title.id)) store.put(TITLES, { id: title.id, ...extra });
          const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
          if (panel.dialog.isConnected && !typing) draw();
        })
        .catch(() => {});
    }

    draw();

    function draw() {
      const isSeries = draft.mediaType === 'tv';
      if (!isSeries && draft.status === 'watching') draft.status = 'watched';
      const statuses = isSeries
        ? ['watchlist', 'watching', 'watched', 'notinterested']
        : ['watchlist', 'watched', 'notinterested'];
      const seen = draft.status === 'watched' || draft.status === 'watching';

      mount(
        form,
        manual
          ? h(
              'div',
              { class: 'pa-form' },
              field(
                'Title',
                h('input', {
                  class: 'pa-input',
                  required: true,
                  value: draft.title ?? '',
                  oninput: (e) => (draft.title = e.target.value),
                }),
              ),
              h(
                'div',
                { class: 'pa-row' },
                choice(
                  [
                    ['movie', 'Movie'],
                    ['tv', 'Series'],
                  ],
                  draft.mediaType,
                  (value) => {
                    draft.mediaType = value;
                    draw();
                  },
                ),
                h('input', {
                  class: 'pa-input mv-year',
                  type: 'number',
                  inputMode: 'numeric',
                  min: 1880,
                  max: 2100,
                  placeholder: 'Year',
                  'aria-label': 'Year',
                  value: draft.year ?? '',
                  oninput: (e) => (draft.year = e.target.value ? Number(e.target.value) : null),
                }),
                !isSeries &&
                  h('input', {
                    class: 'pa-input mv-year',
                    type: 'number',
                    inputMode: 'numeric',
                    min: 1,
                    max: 999,
                    placeholder: 'Minutes',
                    'aria-label': 'Running time in minutes',
                    value: draft.runtime ?? '',
                    oninput: (e) => (draft.runtime = e.target.value ? Number(e.target.value) : null),
                  }),
              ),
              imdbLink(draft, 'Look up on IMDb'),
            )
          : h(
              'div',
              { class: 'mv-head' },
              poster(draft, 'w185'),
              h(
                'div',
                null,
                h('p', { class: 'mv-head__title' }, draft.title),
                h(
                  'p',
                  { class: 'pa-muted' },
                  [TYPE_LABEL[draft.mediaType], draft.year, runtimeText(draft)].filter(Boolean).join(', '),
                ),
                imdbLink(draft, 'Open on IMDb'),
              ),
            ),

        choice(
          statuses.map((s) => [s, STATUS_LABEL[s]]),
          draft.status,
          (value) => {
            draft.status = value;
            if (value === 'watched' && !draft.watchedOn) draft.watchedOn = todayISO();
            draw();
          },
        ),

        draft.status === 'watchlist' ? withControl() : null,

        seen ? ratingControl() : null,

        draft.status === 'watched'
          ? field(
              'Watched on',
              h('input', {
                class: 'pa-input',
                type: 'date',
                max: todayISO(),
                value: draft.watchedOn ?? '',
                oninput: (e) => (draft.watchedOn = e.target.value || null),
              }),
            )
          : null,

        isSeries && seen ? seasonsControl() : null,

        field(
          'Notes',
          h('textarea', {
            class: 'pa-input',
            placeholder: 'Anything you want to remember',
            value: draft.notes ?? '',
            oninput: (e) => (draft.notes = e.target.value),
          }),
        ),

        h(
          'div',
          { class: 'pa-row pa-row--between' },
          isNew
            ? h('span')
            : h('button', { class: 'pa-btn pa-btn--danger', type: 'button', onclick: remove }, 'Delete'),
          h('button', { class: 'pa-btn pa-btn--primary', type: 'submit' }, isNew ? 'Add to list' : 'Save changes'),
        ),
      );
    }

    function withControl() {
      const tags = withTags(store);
      if (!tags.length) return null;
      const picked = new Set(draft.watchWith ?? []);
      return h(
        'div',
        { class: 'pa-field' },
        h('span', { class: 'pa-label' }, 'Watch with'),
        h(
          'div',
          { class: 'mv-chips', role: 'group', 'aria-label': 'Watch with' },
          tags.map(({ id: value, label }) => {
            const chip = h(
              'button',
              {
                class: 'mv-chip',
                type: 'button',
                'aria-pressed': String(picked.has(value)),
                onclick: () => {
                  if (picked.has(value)) picked.delete(value);
                  else picked.add(value);
                  draft.watchWith = tags.map((tag) => tag.id).filter((id) => picked.has(id));
                  chip.setAttribute('aria-pressed', String(picked.has(value)));
                },
              },
              label,
            );
            return chip;
          }),
        ),
      );
    }

    function ratingControl() {
      const readout = h('span', { class: 'mv-marquee__readout' });
      const bulbs = [];
      const paint = () => {
        bulbs.forEach((bulb, index) => {
          const lit = draft.rating !== null && index < draft.rating;
          bulb.dataset.lit = lit ? 'true' : 'false';
          bulb.setAttribute('aria-pressed', String(draft.rating === index + 1));
        });
        readout.textContent = draft.rating ? `${draft.rating} of 10` : 'Not rated';
      };
      for (let n = 1; n <= 10; n += 1) {
        const bulb = h('button', {
          class: 'mv-bulb',
          type: 'button',
          'aria-label': `Rate ${n} of 10`,
          onclick: () => {
            draft.rating = draft.rating === n ? null : n;
            paint();
          },
        });
        bulb.style.setProperty('--i', n - 1);
        bulbs.push(bulb);
      }
      paint();
      return h(
        'div',
        { class: 'mv-marquee', role: 'group', 'aria-label': 'Your rating' },
        h('div', { class: 'mv-marquee__bulbs' }, bulbs),
        readout,
      );
    }

    function seasonsControl() {
      const total = draft.seasonsTotal;
      const value = h('span', { class: 'mv-stepper__value' });
      const paint = () => {
        const n = draft.seasonsWatched ?? 0;
        value.textContent = total ? `${n} of ${total}` : String(n);
      };
      const step = (delta) => {
        const next = Math.max(0, (draft.seasonsWatched ?? 0) + delta);
        draft.seasonsWatched = total ? Math.min(total, next) : next;
        paint();
      };
      paint();
      return h(
        'div',
        { class: 'pa-row pa-row--between' },
        h('span', { class: 'pa-label' }, 'Seasons watched'),
        h(
          'div',
          { class: 'mv-stepper' },
          h('button', { class: 'pa-icon-btn', type: 'button', 'aria-label': 'One season fewer', onclick: () => step(-1) }, icon(ICONS.minus)),
          value,
          h('button', { class: 'pa-icon-btn', type: 'button', 'aria-label': 'One season more', onclick: () => step(1) }, icon(ICONS.plus)),
        ),
      );
    }

    function save(event) {
      event.preventDefault();
      const titleText = (draft.title ?? '').trim();
      if (!titleText) return;
      if (draft.status === 'watchlist') draft.rating = null;
      // A rating on a "not interesting" title (for example from an import) is kept.
      if (draft.status === 'watchlist' || draft.status === 'notinterested') draft.watchedOn = null;
      if (draft.status === 'watching') draft.watchedOn = null;
      if (draft.mediaType !== 'tv') {
        draft.seasonsWatched = null;
        draft.seasonsTotal = null;
      }
      store.put(TITLES, { ...draft, title: titleText, notes: (draft.notes ?? '').trim() });
      panel.close();
      view.tab = tabOf(draft.status);
      render();
      shell.toast(isNew ? `Added to ${STATUS_LABEL[draft.status].toLowerCase()}` : 'Changes saved');
    }

    async function remove() {
      const sure = await shell.confirm({
        title: `Delete "${title.title}"?`,
        message: 'This removes the entry with its rating and notes.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!sure) return;
      store.remove(TITLES, title.id);
      panel.close();
      shell.toast('Deleted', { action: { label: 'Undo', run: () => store.put(TITLES, title) } });
    }
  }
}

// ---- menu section -----------------------------------------------------------

function settingsSection({ store, shell, close }) {
  const key = h('input', {
    class: 'pa-input',
    id: 'mv-tmdb-key',
    autocomplete: 'off',
    spellcheck: false,
    placeholder: 'Paste your key',
    value: store.setting('tmdbKey', ''),
  });
  const language = h(
    'select',
    { class: 'pa-input', id: 'mv-tmdb-language' },
    LANGUAGES.map(([code, label]) =>
      h('option', { value: code, selected: store.setting('tmdbLanguage', 'en-US') === code }, label),
    ),
  );
  // ---- "watch with" tags ----
  const rows = h('div', { class: 'mv-tagrows' });
  const tagRow = (tag) => {
    const row = h(
      'div',
      { class: 'mv-tagrow', dataset: { id: tag.id ?? '' } },
      h('input', {
        class: 'pa-input',
        value: tag.label ?? '',
        placeholder: 'Tag name',
        'aria-label': 'Tag name',
        maxLength: 24,
        autocomplete: 'off',
      }),
      h(
        'button',
        {
          class: 'pa-icon-btn',
          type: 'button',
          'aria-label': `Remove ${tag.label || 'tag'}`,
          onclick: () => row.remove(),
        },
        icon(ICONS.close),
      ),
    );
    return row;
  };
  mount(rows, withTags(store).map(tagRow));

  function saveTags() {
    const next = [];
    for (const row of rows.children) {
      const label = row.querySelector('input').value.trim();
      if (!label) continue;
      next.push({ id: row.dataset.id || `tag-${Math.random().toString(36).slice(2, 8)}`, label });
    }
    const kept = new Set(next.map((tag) => tag.id));
    store.setSetting('watchWithTags', next);
    // Take removed tags off the entries that carried them.
    for (const title of store.list(TITLES)) {
      const current = title.watchWith ?? [];
      const cleaned = current.filter((id) => kept.has(id));
      if (cleaned.length !== current.length) store.put(TITLES, { id: title.id, watchWith: cleaned });
    }
    close();
    shell.toast('Tags saved');
  }

  const tagEditor = h(
    'div',
    { class: 'pa-form mv-tagedit' },
    h('h3', null, 'Watch with'),
    h(
      'p',
      { class: 'pa-muted' },
      'Tags for watchlist titles. Renaming a tag keeps it on its titles; removing a tag takes it off them.',
    ),
    rows,
    h(
      'div',
      { class: 'pa-row' },
      h(
        'button',
        {
          class: 'pa-btn',
          type: 'button',
          onclick: () => {
            const row = tagRow({});
            rows.append(row);
            row.querySelector('input').focus();
          },
        },
        'Add tag',
      ),
      h('button', { class: 'pa-btn pa-btn--primary', type: 'button', onclick: saveTags }, 'Save tags'),
    ),
  );

  // ---- import from SIMKL ----
  const tmdb = createTmdb({
    getKey: () => store.setting('tmdbKey', ''),
    getLanguage: () => store.setting('tmdbLanguage', 'en-US'),
  });
  const importInfo = h('div', { class: 'pa-form', 'aria-live': 'polite' });
  const fileInput = h('input', {
    class: 'pa-input',
    type: 'file',
    id: 'mv-import-file',
    accept: '.json,application/json',
    onchange: readImportFile,
  });
  let importAbort = null;

  async function readImportFile() {
    const file = fileInput.files?.[0];
    if (!file) return;
    let mapped;
    try {
      mapped = mapSimkl(JSON.parse(await file.text()));
    } catch (err) {
      const text = err instanceof SyntaxError ? 'This file is not valid JSON.' : err.message;
      mount(importInfo, h('p', { class: 'mv-error' }, text));
      return;
    }
    const { entries, counts } = mapped;
    const parts = [
      `${counts.watched} watched`,
      counts.watching ? `${counts.watching} watching` : null,
      `${counts.watchlist} on the watchlist`,
      counts.notinterested ? `${counts.notinterested} not interesting` : null,
    ].filter(Boolean);
    mount(
      importInfo,
      h(
        'p',
        null,
        `Found ${parts.join(', ')}.`,
      ),
      !tmdb.hasKey() &&
        h(
          'p',
          { class: 'pa-muted' },
          'No TMDB key is saved, so titles are imported without posters. Save a key first, or run the import again later to add them.',
        ),
      entries.length
        ? h(
            'button',
            { class: 'pa-btn pa-btn--primary', type: 'button', onclick: () => runImport(entries) },
            `Import ${entries.length} ${entries.length === 1 ? 'title' : 'titles'}`,
          )
        : null,
    );
  }

  async function runImport(entries) {
    importAbort = new AbortController();
    if (tmdb.hasKey()) {
      const progress = h('p', null, 'Looking up posters');
      mount(importInfo, progress);
      await enrich(entries, tmdb, {
        signal: importAbort.signal,
        onProgress: (done, total) => (progress.textContent = `Looking up posters: ${done} of ${total}`),
      });
      if (importAbort.signal.aborted) return;
    }
    bulk = true;
    let result;
    try {
      result = mergeImport(store, TITLES, entries);
    } finally {
      bulk = false;
      redraw();
    }
    close();
    shell.toast(
      `Imported ${result.added} ${result.added === 1 ? 'title' : 'titles'}` +
        (result.completed + result.unchanged ? `, ${result.completed + result.unchanged} were already in your list` : ''),
      { ms: 8000 },
    );
  }

  const importer = h(
    'div',
    { class: 'pa-form mv-tagedit' },
    h('h3', null, 'Import from SIMKL'),
    h(
      'p',
      { class: 'pa-muted' },
      'Choose the JSON file from your SIMKL backup. Titles already in your list are kept as they are, so the import can be repeated.',
    ),
    h('div', { class: 'pa-field' }, h('label', { for: 'mv-import-file' }, 'SIMKL export file'), fileInput),
    importInfo,
    h('h3', { class: 'mv-import-list-title' }, 'Import a list'),
    h(
      'p',
      { class: 'pa-muted' },
      'Paste titles from another list, for example a to-do app. You can check every match before anything is added to the watchlist.',
    ),
    h(
      'div',
      { class: 'pa-row' },
      h(
        'button',
        {
          class: 'pa-btn',
          type: 'button',
          onclick: () => {
            close();
            openListImport(store, shell, tmdb);
          },
        },
        'Paste a list',
      ),
    ),
  );

  return h(
    'div',
    { class: 'pa-form' },
    tagEditor,
    h('h3', null, 'Title search'),
    h(
      'p',
      { class: 'pa-muted' },
      'Searching uses a free TMDB key. Create one at themoviedb.org under Settings, API. ' +
        `The key is saved with your data (${shell.storageName}), not in the app's code.`,
    ),
    h('div', { class: 'pa-field' }, h('label', { for: 'mv-tmdb-key' }, 'TMDB key'), key),
    h('div', { class: 'pa-field' }, h('label', { for: 'mv-tmdb-language' }, 'Language for titles'), language),
    h(
      'div',
      { class: 'pa-row' },
      h(
        'button',
        {
          class: 'pa-btn pa-btn--primary',
          type: 'button',
          onclick: () => {
            store.setSetting('tmdbKey', key.value.trim() || null);
            store.setSetting('tmdbLanguage', language.value);
            close();
            shell.toast('Search settings saved');
          },
        },
        'Save search settings',
      ),
    ),
    h('div', { class: 'mv-importer' }, importer),
  );
}

// ---- import a pasted list ------------------------------------------------------

function openListImport(store, shell, tmdb) {
  const tags = withTags(store);
  const body = h('div', { class: 'pa-form mv-listimport' });
  let abort = null;
  const panel = shell.sheet({ title: 'Import a list', body, onClose: () => abort?.abort() });
  let pastedText = '';
  let defaultTag = tags[0]?.id ?? null;

  stepPaste();

  function stepPaste() {
    const text = h('textarea', {
      class: 'pa-input mv-paste',
      id: 'mv-paste',
      rows: 10,
      value: pastedText,
      placeholder: 'One title per line, for example\nBugonia (2025)\nSaltburn (2023) -> alleine\nThe Curse https://www.imdb.com/title/tt13623608/',
    });
    const chips = h('div', { class: 'mv-chips', role: 'group', 'aria-label': 'Watch with by default' });
    const drawChips = () =>
      mount(
        chips,
        [...tags, { id: null, label: 'None' }].map((tag) =>
          h(
            'button',
            {
              class: 'mv-chip',
              type: 'button',
              'aria-pressed': String(defaultTag === tag.id),
              onclick: () => {
                defaultTag = tag.id;
                drawChips();
              },
            },
            tag.label,
          ),
        ),
      );
    drawChips();
    const problem = h('p', { class: 'mv-error', 'aria-live': 'polite' });

    mount(
      body,
      h(
        'p',
        { class: 'pa-muted' },
        'Recognised on each line: the year in brackets, an IMDb link, a note after "->" or in brackets before the title, and a "?" for titles you are unsure about.',
      ),
      h('div', { class: 'pa-field' }, h('label', { for: 'mv-paste' }, 'Your list'), text),
      h(
        'div',
        { class: 'pa-field' },
        h('span', { class: 'pa-label' }, 'Watch with, unless the note says otherwise'),
        chips,
        h(
          'p',
          { class: 'pa-muted' },
          'A note naming a tag (or saying "alleine" or "alone") gets that tag instead.',
        ),
      ),
      !tmdb.hasKey() && h('p', { class: 'pa-muted' }, 'No TMDB key is saved, so titles are added as typed, without posters or matches.'),
      problem,
      h(
        'div',
        { class: 'pa-row pa-row--end' },
        h(
          'button',
          {
            class: 'pa-btn pa-btn--primary',
            type: 'button',
            onclick: () => {
              pastedText = text.value;
              const lines = parseList(pastedText);
              if (!lines.length) {
                problem.textContent = 'No titles found. Paste one title per line.';
                return;
              }
              for (const line of lines) Object.assign(line, tagsForNote(line.note, tags, defaultTag), { include: true });
              stepFind(lines);
            },
          },
          tmdb.hasKey() ? 'Find titles' : 'Continue',
        ),
      ),
    );
    text.focus();
  }

  async function stepFind(lines) {
    if (tmdb.hasKey()) {
      const progress = h('p', { 'aria-live': 'polite' }, `Looking up ${lines.length} titles`);
      mount(body, progress, h('div', { class: 'pa-spinner' }));
      abort = new AbortController();
      await findAll(lines, tmdb, {
        signal: abort.signal,
        onProgress: (done, total) => (progress.textContent = `Looking up titles: ${done} of ${total}`),
      });
      if (abort.signal.aborted) return;
    } else {
      for (const line of lines) Object.assign(line, { candidates: [], match: null, sure: false });
    }
    stepReview(lines);
  }

  function stepReview(lines) {
    const addBtn = h('button', { class: 'pa-btn pa-btn--primary', type: 'button', onclick: () => add(lines) });
    const count = () => {
      const n = lines.filter((l) => l.include).length;
      addBtn.textContent = `Add ${n} to watchlist`;
      addBtn.disabled = n === 0;
    };
    const unsure = lines.filter((l) => l.include && !l.sure).length;

    mount(
      body,
      h(
        'p',
        null,
        `${lines.length} ${lines.length === 1 ? 'title' : 'titles'} found.` +
          (unsure && tmdb.hasKey() ? ` ${unsure} marked "Check" may have the wrong match.` : ''),
      ),
      h('ul', { class: 'mv-li' }, lines.map((line) => reviewRow(line, count))),
      h(
        'div',
        { class: 'pa-row pa-row--between mv-li__foot' },
        h('button', { class: 'pa-btn pa-btn--quiet', type: 'button', onclick: stepPaste }, 'Back'),
        addBtn,
      ),
    );
    count();
  }

  function reviewRow(line, onChange) {
    const row = h('li', { class: 'mv-li__row' });
    const draw = () => {
      const m = line.match;
      const shown = m ?? { title: line.title, year: line.year, mediaType: line.mediaHint ?? 'movie', posterPath: null };
      const include = h('input', {
        type: 'checkbox',
        checked: line.include,
        'aria-label': `Add ${shown.title}`,
        onchange: (event) => {
          line.include = event.target.checked;
          row.classList.toggle('is-skipped', !line.include);
          onChange();
        },
      });
      const options = [
        ...(line.candidates ?? []).map((c, i) =>
          h('option', { value: String(i), selected: c === m }, [c.title, [TYPE_LABEL[c.mediaType], c.year].filter(Boolean).join(', ')].join(' – ')),
        ),
        h('option', { value: 'typed', selected: !m }, `As typed: ${line.title}`),
      ];
      const select = h(
        'select',
        {
          class: 'pa-input mv-li__select',
          'aria-label': `Match for ${line.title}`,
          onchange: (event) => {
            const v = event.target.value;
            line.match = v === 'typed' ? null : line.candidates[Number(v)];
            line.sure = true;
            draw();
          },
        },
        options,
      );
      const chips = h(
        'div',
        { class: 'mv-chips mv-chips--small', role: 'group', 'aria-label': `Watch ${shown.title} with` },
        tags.map((tag) =>
          h(
            'button',
            {
              class: 'mv-chip',
              type: 'button',
              'aria-pressed': String(line.watchWith.includes(tag.id)),
              onclick: (event) => {
                const set = new Set(line.watchWith);
                if (set.has(tag.id)) set.delete(tag.id);
                else set.add(tag.id);
                line.watchWith = tags.map((t) => t.id).filter((id) => set.has(id));
                event.currentTarget.setAttribute('aria-pressed', String(set.has(tag.id)));
              },
            },
            tag.label,
          ),
        ),
      );
      const note = h('input', {
        class: 'pa-input mv-li__note',
        value: line.note ?? '',
        placeholder: 'Note',
        'aria-label': `Note for ${shown.title}`,
        oninput: (event) => (line.note = event.target.value),
      });
      row.classList.toggle('is-skipped', !line.include);
      mount(
        row,
        h(
          'div',
          { class: 'mv-li__head' },
          include,
          poster(shown),
          h(
            'div',
            { class: 'mv-li__text' },
            h('span', { class: 'mv-row__title' }, shown.title),
            h('span', { class: 'mv-row__meta' }, [TYPE_LABEL[shown.mediaType], shown.year].filter(Boolean).join(', ') || 'No match'),
            h('span', { class: 'mv-li__raw' }, line.raw),
          ),
          !line.sure && tmdb.hasKey() ? h('span', { class: 'mv-tag mv-tag--check' }, 'Check') : null,
        ),
        (line.candidates?.length ?? 0) > 0 ? select : null,
        chips,
        note,
      );
    };
    draw();
    return row;
  }

  async function add(lines) {
    const chosen = lines.filter((l) => l.include);
    const now = Date.now();
    const entries = chosen.map((line, i) => toEntry({ ...line, note: (line.note ?? '').trim() }, i, now));
    if (tmdb.hasKey()) {
      const progress = h('p', { 'aria-live': 'polite' }, 'Adding running times and IMDb links');
      mount(body, progress, h('div', { class: 'pa-spinner' }));
      abort = new AbortController();
      await enrich(entries, tmdb, {
        signal: abort.signal,
        onProgress: (done, total) => (progress.textContent = `Adding running times and IMDb links: ${done} of ${total}`),
      });
      if (abort.signal.aborted) return;
    }
    bulk = true;
    let result;
    try {
      result = mergeWatchlist(store, TITLES, entries);
    } finally {
      bulk = false;
      redraw();
    }
    panel.close();
    const parts = [`Added ${result.added} to your watchlist`];
    if (result.updated) parts.push(`${result.updated} already there got tags or notes`);
    if (result.skipped) parts.push(`${result.skipped} already in your lists`);
    shell.toast(parts.join(', '), { ms: 9000 });
  }
}

// ---- small pieces -------------------------------------------------------------

function poster(title, size = 'w92') {
  const url = posterUrl(title.posterPath, size);
  if (url) return h('img', { class: 'mv-poster', src: url, alt: '', loading: 'lazy', width: 46, height: 69 });
  return h('span', { class: 'mv-poster mv-poster--blank', 'aria-hidden': 'true' }, (title.title || '?').trim().charAt(0).toUpperCase());
}

/** A link to the title on IMDb. It opens in a new tab and never opens the editor. */
function imdbLink(title, label = 'IMDb') {
  return h(
    'a',
    {
      class: 'mv-imdb',
      href: imdbUrl(title),
      target: '_blank',
      rel: 'noopener noreferrer',
      'aria-label': label === 'IMDb' ? `${title.title} on IMDb` : null,
      // The title of a hand-typed entry can change while the editor is open.
      onclick: (event) => (event.currentTarget.href = imdbUrl(title)),
    },
    label,
  );
}

function runtimeText(title) {
  const text = formatRuntime(title.runtime);
  if (!text) return '';
  return title.mediaType === 'tv' ? `${text} per episode` : text;
}

function metaLine(title) {
  const parts = [TYPE_LABEL[title.mediaType], title.year];
  if (title.status === 'watchlist') parts.push(runtimeText(title));
  if (title.mediaType === 'tv' && title.seasonsWatched) {
    parts.push(
      title.seasonsTotal
        ? `${title.seasonsWatched} of ${title.seasonsTotal} seasons`
        : `${title.seasonsWatched} ${title.seasonsWatched === 1 ? 'season' : 'seasons'}`,
    );
  }
  if (title.status === 'watched' && title.watchedOn) parts.push(`watched ${formatDate(title.watchedOn)}`);
  return parts.filter(Boolean).join(', ');
}

function sorter(mode) {
  const recent = (t) => t.watchedOn || (t.createdAt ?? '').slice(0, 10);
  if (mode === 'title') return (a, b) => a.title.localeCompare(b.title);
  if (mode === 'shortest') {
    // Titles without a known running time go last.
    return (a, b) => (a.runtime || Infinity) - (b.runtime || Infinity) || a.title.localeCompare(b.title);
  }
  if (mode === 'rating') {
    return (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || recent(b).localeCompare(recent(a));
  }
  return (a, b) => recent(b).localeCompare(recent(a)) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
}

function field(label, control) {
  const id = `mv-f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return h('div', { class: 'pa-field' }, h('label', { for: id }, label), control);
}

/** A segmented choice that redraws itself through update(). */
function segmented(options, get, set) {
  const buttons = options.map(([value, label]) =>
    h('button', { class: 'pa-seg__option', type: 'button', onclick: () => set(value) }, label),
  );
  const update = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === get())));
  update();
  return { el: h('div', { class: 'pa-seg' }, buttons), update };
}

/** A one-off segmented choice for forms that redraw completely. */
function choice(options, current, onPick) {
  return segmented(options, () => current, onPick).el;
}
