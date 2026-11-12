// Starter app: a plain list of entries. Replace it with your own screens.
//
// What the core gives you:
//   store.list('entries')            all records of a collection
//   store.put('entries', { ... })    create (no id) or update (with id)
//   store.remove('entries', id)
//   store.setting(key, fallback) / store.setSetting(key, value)
//   store.subscribe(fn), store.changes   re-render when the data changes
//   shell.sheet({ title, body }), shell.toast(text), shell.confirm({ ... })
// Saving, sign-in, reconnecting and the status display are handled for you.

import { startApp } from '../../core/shell.js';
import { h, mount } from '../../core/dom.js';
import { formatDate, todayISO } from '../../core/util.js';

const ENTRIES = 'entries';

startApp({
  id: '__APP_ID__', // also the file name in Drive: __APP_ID__.json
  name: '__APP_NAME__',
  // Raise schemaVersion and add a migration when the shape of the data
  // changes, for example: migrations: { 2: (doc) => { ...; return doc; } }
  schemaVersion: 1,
  migrations: {},
  collections: [ENTRIES],
  mount: mountApp,
});

function mountApp({ root, store, shell }) {
  const input = h('input', {
    class: 'pa-input',
    placeholder: 'New entry',
    'aria-label': 'New entry',
    autocomplete: 'off',
  });
  const list = h('ul', { class: 'tp-list' });
  const form = h(
    'form',
    {
      class: 'tp-add',
      onsubmit: (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        store.put(ENTRIES, { text, date: todayISO() });
        input.value = '';
      },
    },
    input,
    h('button', { class: 'pa-btn pa-btn--primary', type: 'submit' }, 'Add entry'),
  );
  mount(root, form, list);

  let seen = -1;
  store.subscribe(() => {
    if (store.changes !== seen) render();
  });
  render();

  function render() {
    seen = store.changes;
    const entries = [...store.list(ENTRIES)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!entries.length) {
      mount(list, h('li', { class: 'pa-muted' }, 'No entries yet. Add the first one above.'));
      return;
    }
    mount(
      list,
      entries.map((entry) =>
        h(
          'li',
          { class: 'tp-item' },
          h('span', null, h('span', null, entry.text), h('span', { class: 'pa-muted' }, formatDate(entry.date))),
          h(
            'button',
            {
              class: 'pa-btn pa-btn--small',
              type: 'button',
              onclick: () => {
                store.remove(ENTRIES, entry.id);
                shell.toast('Deleted', { action: { label: 'Undo', run: () => store.put(ENTRIES, entry) } });
              },
            },
            'Delete',
          ),
        ),
      ),
    );
  }
}
