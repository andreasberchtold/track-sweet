// The start page: one link per app, read from apps.json.

import { h, mount } from './dom.js';

const list = document.getElementById('apps');

try {
  const response = await fetch(new URL('../apps.json', import.meta.url));
  const apps = await response.json();
  mount(
    list,
    apps.map((app) =>
      h('li', null, h('a', { class: 'la-link', href: `apps/${encodeURIComponent(app.id)}/` }, app.name)),
    ),
  );
} catch {
  mount(list, h('li', { class: 'pa-muted' }, 'The list of apps (apps.json) could not be loaded.'));
}
