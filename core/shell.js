// The app shell: everything an app needs around its own screens.
//
//   startApp({
//     id: 'movies',                 // also the file name: movies.json
//     name: 'Movies & Series',
//     schemaVersion: 1,
//     migrations: {},               // { 2: (doc) => doc, ... }
//     collections: ['titles'],
//     mount({ root, store, shell }) // build the app's screens
//     settings({ store, shell })    // optional: extra section in the menu
//     about: 'One line shown at the bottom of the menu',
//   });
//
// The shell signs the user in, loads the document, shows the save status,
// handles reconnecting, and offers sheets, toasts and confirmations.

import site from '../site.config.js';
import { createAuth } from './auth.js';
import { createDriveBackend } from './backend-drive.js';
import { createLocalBackend } from './backend-local.js';
import { createStore } from './store.js';
import { h, icon, ICONS, mount } from './dom.js';
import { AuthError, downloadJSON, todayISO } from './util.js';

const STATUS_TEXT = {
  idle: '',
  loading: 'Loading',
  saving: 'Saving',
  saved: 'Saved',
  offline: 'Offline. Tap to retry',
  auth: 'Signed out. Tap to reconnect',
  error: 'Not saved. Tap to retry',
};

export async function startApp(app) {
  const demo = !site.googleClientId;
  const auth = demo ? null : createAuth({ clientId: site.googleClientId });
  const backend = demo
    ? createLocalBackend(`pa:demo:${app.id}`)
    : createDriveBackend({ auth, folderName: site.driveFolder, fileName: `${app.id}.json` });
  const store = createStore({
    backend,
    appId: app.id,
    schemaVersion: app.schemaVersion ?? 1,
    migrations: app.migrations ?? {},
    collections: app.collections ?? [],
  });

  // ---- chrome -----------------------------------------------------------
  const host = document.getElementById('app');
  const statusBtn = h('button', { class: 'pa-status', type: 'button', onclick: onStatusTap });
  const menuBtn = h(
    'button',
    { class: 'pa-icon-btn', type: 'button', 'aria-label': 'Menu', onclick: openMenu },
    icon(ICONS.menu),
  );
  const notice = h('div', { class: 'pa-notice', hidden: true });
  const main = h('main', { class: 'pa-main' });
  const toasts = h('div', { class: 'pa-toasts', 'aria-live': 'polite' });
  mount(
    host,
    h('header', { class: 'pa-bar' }, h('h1', { class: 'pa-bar__title' }, app.name), statusBtn, menuBtn),
    notice,
    main,
    toasts,
  );
  document.title = app.name;

  const shell = { demo, sheet, toast, confirm, storageName: backend.name };
  let mounted = false;
  let account = null;

  store.subscribe(({ status }) => renderStatus(status));
  renderStatus(store.status);

  function renderStatus(status) {
    statusBtn.dataset.state = status.state;
    statusBtn.textContent = STATUS_TEXT[status.state] ?? '';
    statusBtn.title = status.message || '';
    statusBtn.disabled = !['offline', 'auth', 'error'].includes(status.state);
    statusBtn.hidden = !mounted || status.state === 'idle';
  }

  async function onStatusTap() {
    if (store.status.state === 'auth') await reconnect();
    else await store.retry();
  }

  // ---- sign-in and loading ----------------------------------------------
  function showMessage({ title, text, action, busy = false }) {
    mount(
      main,
      h(
        'section',
        { class: 'pa-gate' },
        h('h2', { class: 'pa-gate__title' }, title),
        text && h('p', { class: 'pa-gate__text' }, text),
        busy && h('div', { class: 'pa-spinner', role: 'status', 'aria-label': 'Working' }),
        action &&
          h('button', { class: 'pa-btn pa-btn--primary', type: 'button', onclick: action.run }, action.label),
      ),
    );
  }

  function showSignIn(problem) {
    const hint = auth.getHint();
    showMessage({
      title: hint ? 'Welcome back' : 'Sign in to start',
      text:
        problem ||
        `Your entries are saved as a file in your Google Drive, in the folder "${site.driveFolder}". ` +
          'This app can only see the files it creates there.',
      action: {
        label: hint ? `Continue as ${hint}` : 'Sign in with Google',
        run: async () => {
          showMessage({ title: 'Waiting for Google', busy: true });
          const result = await auth.request({ interactive: true });
          if (result.ok) await loadAndMount();
          else showSignIn(signInProblem(result.reason));
        },
      },
    });
  }

  async function loadAndMount() {
    showMessage({ title: 'Loading your data', busy: true });
    try {
      await store.load();
    } catch (err) {
      if (err instanceof AuthError && auth) {
        showSignIn('The Google sign-in has expired. Sign in again to continue.');
        return;
      }
      showMessage({
        title: 'Your data could not be loaded',
        text: err.message,
        action: { label: 'Try again', run: loadAndMount },
      });
      return;
    }
    mounted = true;
    renderStatus(store.status);
    main.replaceChildren();
    app.mount({ root: main, store, shell });
    if (!demo) rememberAccount();
  }

  async function rememberAccount() {
    try {
      account = await backend.account();
      if (account?.emailAddress) auth.setHint(account.emailAddress);
    } catch {
      // Only a convenience; the app works without it.
    }
  }

  async function reconnect() {
    const result = await auth.request({ interactive: true });
    if (!result.ok) {
      toast(signInProblem(result.reason));
      return false;
    }
    await store.retry();
    await store.refresh();
    return true;
  }

  // ---- staying current ---------------------------------------------------
  let lastRefresh = Date.now();
  document.addEventListener('visibilitychange', async () => {
    if (!mounted) return;
    if (document.visibilityState === 'hidden') {
      store.flush();
      return;
    }
    if (!demo && !auth.getToken()) {
      const result = await auth.request({ interactive: false });
      if (!result.ok) {
        if (store.hasUnsaved) store.retry();
        else showReconnectNotice();
        return;
      }
      hideNotice();
      if (store.hasUnsaved) await store.retry();
    }
    if (Date.now() - lastRefresh > 20_000) {
      lastRefresh = Date.now();
      store.refresh();
    }
  });
  window.addEventListener('online', () => store.retry());
  window.addEventListener('beforeunload', (event) => {
    if (store.hasUnsaved) event.preventDefault();
  });

  function showReconnectNotice() {
    mount(
      notice,
      h('span', null, 'The Google sign-in has expired.'),
      h(
        'button',
        {
          class: 'pa-btn pa-btn--small',
          type: 'button',
          onclick: async () => {
            if (await reconnect()) hideNotice();
          },
        },
        'Reconnect',
      ),
    );
    notice.hidden = false;
  }

  function hideNotice() {
    notice.hidden = true;
    notice.replaceChildren();
  }

  // ---- menu --------------------------------------------------------------
  function openMenu() {
    const body = h('div', { class: 'pa-menu' });
    const menu = sheet({ title: app.name, body });

    body.append(
      h(
        'section',
        { class: 'pa-menu__section' },
        h('h3', null, 'Storage'),
        h(
          'p',
          { class: 'pa-muted' },
          demo
            ? 'Demo mode. Entries stay in this browser until a Google client ID is added to site.config.js.'
            : `Saved to Google Drive, folder "${site.driveFolder}", file ${app.id}.json` +
                (account?.emailAddress ? `, as ${account.emailAddress}.` : '.'),
        ),
        h(
          'div',
          { class: 'pa-row' },
          mounted &&
            h(
              'button',
              {
                class: 'pa-btn',
                type: 'button',
                onclick: () => downloadJSON(`${app.id}-${todayISO()}.json`, store.doc),
              },
              'Download a copy',
            ),
          !demo &&
            backend.folderUrl() &&
            h(
              'a',
              { class: 'pa-btn', href: backend.folderUrl(), target: '_blank', rel: 'noopener' },
              'Open folder in Drive',
            ),
        ),
      ),
    );

    const extra = mounted && app.settings?.({ store, shell, close: () => menu.close() });
    if (extra) body.append(h('section', { class: 'pa-menu__section' }, extra));

    if (!demo && auth.getToken()) {
      body.append(
        h(
          'section',
          { class: 'pa-menu__section' },
          h(
            'button',
            {
              class: 'pa-btn',
              type: 'button',
              onclick: async () => {
                await store.flush();
                auth.signOut();
                location.reload();
              },
            },
            'Sign out',
          ),
        ),
      );
    }
    if (app.about) body.append(h('p', { class: 'pa-muted pa-menu__about' }, app.about));
  }

  // ---- building blocks for apps -----------------------------------------
  /** A panel that slides up on phones and sits centred on wide screens. */
  function sheet({ title, body, onClose }) {
    const dialog = h('dialog', { class: 'pa-sheet', 'aria-label': title });
    const closeBtn = h(
      'button',
      { class: 'pa-icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() },
      icon(ICONS.close),
    );
    dialog.append(
      h('header', { class: 'pa-sheet__head' }, h('h2', { class: 'pa-sheet__title' }, title), closeBtn),
      h('div', { class: 'pa-sheet__body' }, body),
    );
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      onClose?.();
    });
    document.body.append(dialog);
    dialog.showModal();
    return { dialog, close: () => dialog.open && dialog.close() };
  }

  function toast(message, { action, ms = 4000 } = {}) {
    const el = h('div', { class: 'pa-toast' }, h('span', null, message));
    if (action) {
      el.append(
        h(
          'button',
          {
            class: 'pa-toast__action',
            type: 'button',
            onclick: () => {
              el.remove();
              action.run();
            },
          },
          action.label,
        ),
      );
    }
    toasts.append(el);
    setTimeout(() => el.remove(), action ? Math.max(ms, 6000) : ms);
  }

  function confirm({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      let answer = false;
      const panel = sheet({
        title,
        body: h(
          'div',
          { class: 'pa-confirm' },
          message && h('p', null, message),
          h(
            'div',
            { class: 'pa-row pa-row--end' },
            h('button', { class: 'pa-btn', type: 'button', onclick: () => panel.close() }, 'Cancel'),
            h(
              'button',
              {
                class: `pa-btn ${danger ? 'pa-btn--danger' : 'pa-btn--primary'}`,
                type: 'button',
                onclick: () => {
                  answer = true;
                  panel.close();
                },
              },
              confirmLabel,
            ),
          ),
        ),
        onClose: () => resolve(answer),
      });
    });
  }

  // ---- go ----------------------------------------------------------------
  if (demo) {
    mount(
      notice,
      h('span', null, 'Demo mode: entries stay in this browser and are not synced.'),
    );
    notice.hidden = false;
    await loadAndMount();
    return;
  }

  if (auth.getHint()) {
    showMessage({ title: 'Connecting to Google Drive', busy: true });
    const result = await auth.request({ interactive: false });
    if (result.ok) await loadAndMount();
    else showSignIn(result.reason === 'popup_failed_to_open' ? null : signInProblem(result.reason));
  } else {
    showSignIn();
  }
}

function signInProblem(reason) {
  switch (reason) {
    case 'popup_failed_to_open':
      return 'The browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.';
    case 'popup_closed':
      return 'The Google sign-in window was closed before it finished.';
    case 'access_denied':
      return 'Google did not grant access. The app needs permission to store its own file in your Drive.';
    default:
      return `The Google sign-in did not complete (${reason}).`;
  }
}
