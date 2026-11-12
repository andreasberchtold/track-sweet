import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../core/store.js';
import { createLocalBackend, createMemoryStorage } from '../core/backend-local.js';
import { AuthError, NetworkError, NewerDataError } from '../core/util.js';

function setup(overrides = {}) {
  const storage = overrides.storage ?? createMemoryStorage();
  const backend = overrides.backend ?? createLocalBackend('doc', storage);
  const store = createStore({
    backend,
    appId: 'demo',
    schemaVersion: 1,
    collections: ['items'],
    debounceMs: 5,
    ...overrides.options,
  });
  return { storage, backend, store };
}

const fileOf = (storage) => JSON.parse(storage.getItem('doc')).content;

test('first load creates the file with an empty document', async () => {
  const { store, storage } = setup();
  await store.load();
  assert.equal(store.status.state, 'saved');
  assert.deepEqual(fileOf(storage).collections, { items: [] });
  assert.equal(fileOf(storage).app, 'demo');
});

test('put adds id and timestamps, and flush writes the file', async () => {
  const { store, storage } = setup();
  await store.load();
  const record = store.put('items', { text: 'hello' });
  assert.ok(record.id);
  assert.ok(record.createdAt && record.updatedAt);
  assert.equal(store.status.state, 'saving');
  assert.equal(store.hasUnsaved, true);
  assert.equal(await store.flush(), true);
  assert.equal(store.status.state, 'saved');
  assert.equal(store.hasUnsaved, false);
  assert.equal(fileOf(storage).collections.items[0].text, 'hello');
});

test('changes are saved on their own after the short delay', async () => {
  const { store, storage } = setup();
  await store.load();
  store.put('items', { text: 'auto' });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(fileOf(storage).collections.items.length, 1);
});

test('updating keeps createdAt and replaces the record', async () => {
  const { store } = setup();
  await store.load();
  const first = store.put('items', { text: 'a' });
  const second = store.put('items', { id: first.id, text: 'b' });
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(store.list('items').length, 1);
  assert.equal(store.get('items', first.id).text, 'b');
});

test('a stale copy does not overwrite a change made elsewhere', async () => {
  const storage = createMemoryStorage();
  const phone = setup({ storage }).store;
  const pc = setup({ storage }).store;
  await phone.load();
  await pc.load();

  phone.put('items', { text: 'from phone' });
  await phone.flush();

  // The PC still holds the old copy in memory and now saves its own change.
  pc.put('items', { text: 'from pc' });
  await pc.flush();

  const texts = fileOf(storage).collections.items.map((r) => r.text).sort();
  assert.deepEqual(texts, ['from pc', 'from phone']);
  assert.deepEqual(pc.list('items').map((r) => r.text).sort(), ['from pc', 'from phone']);
});

test('a delete is re-applied on top of the newer file', async () => {
  const storage = createMemoryStorage();
  const a = setup({ storage }).store;
  await a.load();
  const keep = a.put('items', { text: 'keep' });
  const drop = a.put('items', { text: 'drop' });
  await a.flush();

  const b = setup({ storage }).store;
  await b.load();
  a.put('items', { id: keep.id, text: 'keep, edited' });
  await a.flush();

  b.remove('items', drop.id);
  await b.flush();
  assert.deepEqual(fileOf(storage).collections.items.map((r) => r.text), ['keep, edited']);
});

test('settings can be set and cleared', async () => {
  const { store, storage } = setup();
  await store.load();
  store.setSetting('key', 'abc');
  await store.flush();
  assert.equal(fileOf(storage).settings.key, 'abc');
  assert.equal(store.setting('key'), 'abc');
  store.setSetting('key', null);
  await store.flush();
  assert.equal('key' in fileOf(storage).settings, false);
  assert.equal(store.setting('key', 'fallback'), 'fallback');
});

test('refresh picks up a change made elsewhere', async () => {
  const storage = createMemoryStorage();
  const a = setup({ storage }).store;
  const b = setup({ storage }).store;
  await a.load();
  await b.load();
  a.put('items', { text: 'new' });
  await a.flush();
  const before = b.changes;
  assert.equal(await b.refresh(), true);
  assert.equal(b.list('items').length, 1);
  assert.ok(b.changes > before);
  assert.equal(await b.refresh(), false);
});

test('older files are migrated and written back', async () => {
  const storage = createMemoryStorage();
  storage.setItem(
    'doc',
    JSON.stringify({ rev: '1', content: { app: 'demo', schemaVersion: 1, settings: {}, collections: { items: [{ id: 'x', name: 'old' }] } } }),
  );
  const { store } = setup({
    storage,
    options: {
      schemaVersion: 2,
      migrations: {
        2: (doc) => {
          for (const item of doc.collections.items) {
            item.text = item.name;
            delete item.name;
          }
          return doc;
        },
      },
    },
  });
  await store.load();
  assert.equal(store.get('items', 'x').text, 'old');
  assert.equal(fileOf(storage).schemaVersion, 2);
  assert.equal(fileOf(storage).collections.items[0].text, 'old');
});

test('a file from a newer app version is not touched', async () => {
  const storage = createMemoryStorage();
  const raw = JSON.stringify({ rev: '7', content: { app: 'demo', schemaVersion: 5, settings: {}, collections: {} } });
  storage.setItem('doc', raw);
  const { store } = setup({ storage });
  await assert.rejects(store.load(), NewerDataError);
  assert.equal(storage.getItem('doc'), raw);
});

test('a file belonging to another app is rejected', async () => {
  const storage = createMemoryStorage();
  storage.setItem('doc', JSON.stringify({ rev: '1', content: { app: 'other', schemaVersion: 1 } }));
  const { store } = setup({ storage });
  await assert.rejects(store.load(), /belongs to "other"/);
});

test('if the file disappears, it is recreated from the copy in memory', async () => {
  const { store, storage } = setup();
  await store.load();
  store.put('items', { text: 'one' });
  await store.flush();
  storage.removeItem('doc');
  store.put('items', { text: 'two' });
  await store.flush();
  assert.deepEqual(fileOf(storage).collections.items.map((r) => r.text), ['one', 'two']);
});

test('an expired sign-in keeps the change and saves it after reconnecting', async () => {
  const storage = createMemoryStorage();
  const real = createLocalBackend('doc', storage);
  let signedIn = true;
  const backend = {
    load: () => real.load(),
    getRev: () => real.getRev(),
    save: (content) => {
      if (!signedIn) throw new AuthError();
      return real.save(content);
    },
  };
  const { store } = setup({ storage, backend });
  await store.load();
  signedIn = false;
  store.put('items', { text: 'pending' });
  assert.equal(await store.flush(), false);
  assert.equal(store.status.state, 'auth');
  assert.equal(store.hasUnsaved, true);
  assert.equal(fileOf(storage).collections.items.length, 0);

  signedIn = true;
  assert.equal(await store.retry(), true);
  assert.equal(store.status.state, 'saved');
  assert.equal(fileOf(storage).collections.items[0].text, 'pending');
});

test('a network failure shows as offline and nothing is lost', async () => {
  const storage = createMemoryStorage();
  const real = createLocalBackend('doc', storage);
  let online = true;
  const backend = {
    load: () => real.load(),
    getRev: () => {
      if (!online) throw new NetworkError();
      return real.getRev();
    },
    save: (content) => real.save(content),
  };
  const { store } = setup({ storage, backend });
  await store.load();
  online = false;
  store.put('items', { text: 'later' });
  assert.equal(await store.flush(), false);
  assert.equal(store.status.state, 'offline');
  online = true;
  assert.equal(await store.retry(), true);
  assert.equal(fileOf(storage).collections.items[0].text, 'later');
});

test('changes made while a save is running are saved too', async () => {
  const storage = createMemoryStorage();
  const real = createLocalBackend('doc', storage);
  let release;
  let slow = false;
  const backend = {
    load: () => real.load(),
    getRev: () => real.getRev(),
    save: async (content) => {
      if (slow) {
        slow = false;
        await new Promise((resolve) => (release = resolve));
      }
      return real.save(content);
    },
  };
  const { store } = setup({ storage, backend });
  await store.load();
  slow = true;
  store.put('items', { text: 'first' });
  const saving = store.flush();
  await new Promise((resolve) => setTimeout(resolve, 10));
  store.put('items', { text: 'second' });
  release();
  await saving;
  await store.flush();
  assert.deepEqual(fileOf(storage).collections.items.map((r) => r.text), ['first', 'second']);
  assert.equal(store.hasUnsaved, false);
});
