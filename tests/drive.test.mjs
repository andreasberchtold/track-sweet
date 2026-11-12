import test from 'node:test';
import assert from 'node:assert/strict';

import { createDriveBackend } from '../core/backend-drive.js';
import { createMemoryStorage } from '../core/backend-local.js';
import { createStore } from '../core/store.js';
import { AuthError, NetworkError } from '../core/util.js';

// A small stand-in for the parts of the Drive API the backend uses. It
// checks the shape of every request, so a wrong URL or header fails a test.
function fakeDrive() {
  const files = new Map(); // id -> { id, name, mimeType, parents, body, rev, trashed }
  const calls = [];
  let nextId = 1;
  let fail = null;

  const meta = (f) => ({ id: f.id, headRevisionId: `rev-${f.rev}`, version: String(f.rev), modifiedTime: 't', trashed: f.trashed, parents: f.parents });
  const reply = (status, body) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  async function fetchImpl(input, options = {}) {
    const url = new URL(String(input));
    const method = options.method ?? 'GET';
    calls.push(`${method} ${url.pathname}${url.search}`);
    if (fail === 'network') throw new TypeError('Failed to fetch');
    assert.equal(options.headers.Authorization, 'Bearer token-1');
    if (fail === 401) return reply(401, { error: { message: 'Invalid Credentials' } });

    const path = url.pathname;
    if (path === '/drive/v3/about') return reply(200, { user: { emailAddress: 'me@example.com' } });

    if (path === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q');
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)[1].replace(/\\(.)/g, '$1');
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const wantFolder = q.includes('application/vnd.google-apps.folder');
      const found = [...files.values()].filter(
        (f) =>
          f.name === name &&
          !f.trashed &&
          (wantFolder ? f.mimeType.endsWith('folder') : true) &&
          (parent ? f.parents?.includes(parent) : true),
      );
      return reply(200, { files: found.map(meta) });
    }

    if (path === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(options.body);
      const file = { id: `id-${nextId++}`, rev: 1, trashed: false, ...body };
      files.set(file.id, file);
      return reply(200, { id: file.id });
    }

    if (path === '/upload/drive/v3/files' && method === 'POST') {
      assert.equal(url.searchParams.get('uploadType'), 'multipart');
      const boundary = /boundary=(.+)$/.exec(options.headers['Content-Type'])[1];
      const parts = options.body.split(`--${boundary}`).slice(1, -1).map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
      const info = JSON.parse(parts[0]);
      const file = { id: `id-${nextId++}`, rev: 1, trashed: false, ...info, body: parts[1] };
      files.set(file.id, file);
      return reply(200, meta(file));
    }

    const id = path.split('/').pop();
    const file = files.get(id);
    if (!file) return reply(404, { error: { message: 'File not found' } });

    if (path.startsWith('/upload/drive/v3/files/') && method === 'PATCH') {
      assert.equal(url.searchParams.get('uploadType'), 'media');
      file.body = options.body;
      file.rev += 1;
      return reply(200, meta(file));
    }
    if (url.searchParams.get('alt') === 'media') return reply(200, file.body);
    return reply(200, meta(file));
  }

  return {
    fetchImpl,
    files,
    calls,
    failWith: (mode) => (fail = mode),
    dataFile: () => [...files.values()].find((f) => f.name === 'movies.json'),
  };
}

function setup() {
  const drive = fakeDrive();
  let token = 'token-1';
  let invalidated = 0;
  const auth = {
    getToken: () => token,
    invalidate: () => {
      invalidated += 1;
      token = null;
    },
  };
  const cache = createMemoryStorage();
  const make = () =>
    createDriveBackend({ auth, folderName: "Sam's Apps", fileName: 'movies.json', fetchImpl: drive.fetchImpl, cache });
  return { drive, auth, cache, make, backend: make(), invalidated: () => invalidated, setToken: (t) => (token = t) };
}

test('an empty Drive loads as "no file yet" and creates nothing', async () => {
  const { backend, drive } = setup();
  assert.deepEqual(await backend.load(), { content: null, rev: null });
  assert.equal(await backend.getRev(), null);
  assert.equal(drive.files.size, 0);
});

test('the first save creates the folder and a readable JSON file inside it', async () => {
  const { backend, drive } = setup();
  const rev = await backend.save({ hello: 'world' });
  assert.equal(rev, 'rev-1');
  const folder = [...drive.files.values()].find((f) => f.mimeType?.endsWith('folder'));
  assert.equal(folder.name, "Sam's Apps");
  const file = drive.dataFile();
  assert.deepEqual(file.parents, [folder.id]);
  assert.equal(file.mimeType, 'application/json');
  assert.equal(file.body, JSON.stringify({ hello: 'world' }, null, 2));
  assert.match(backend.folderUrl(), new RegExp(`/folders/${folder.id}$`));
});

test('later saves update the same file and change the rev', async () => {
  const { backend, drive } = setup();
  const first = await backend.save({ n: 1 });
  const second = await backend.save({ n: 2 });
  assert.notEqual(first, second);
  assert.equal(await backend.getRev(), second);
  assert.equal([...drive.files.values()].filter((f) => f.name === 'movies.json').length, 1);
  assert.deepEqual(await backend.load(), { content: { n: 2 }, rev: second });
});

test('another device finds the existing folder and file by name', async () => {
  const { backend, make, cache, drive } = setup();
  await backend.save({ n: 1 });
  cache.removeItem("pa:drive:Sam's Apps/movies.json"); // a device that has never seen the file
  const other = make();
  assert.deepEqual((await other.load()).content, { n: 1 });
  await other.save({ n: 2 });
  assert.equal(drive.files.size, 2); // still one folder and one file
});

test('a remembered file that was deleted is found again or recreated', async () => {
  const { backend, drive } = setup();
  await backend.save({ n: 1 });
  drive.files.delete(drive.dataFile().id);
  assert.equal(await backend.getRev(), null);
  await backend.save({ n: 3 });
  assert.deepEqual((await backend.load()).content, { n: 3 });
});

test('a file moved to the trash counts as gone', async () => {
  const { backend, drive } = setup();
  await backend.save({ n: 1 });
  drive.dataFile().trashed = true;
  assert.deepEqual(await backend.load(), { content: null, rev: null });
});

test('an expired token becomes an AuthError and the token is dropped', async () => {
  const { backend, drive, invalidated } = setup();
  await backend.save({ n: 1 });
  drive.failWith(401);
  await assert.rejects(backend.getRev(), AuthError);
  assert.equal(invalidated(), 1);
  await assert.rejects(backend.save({ n: 2 }), AuthError); // no token any more: no request is sent
});

test('no connection becomes a NetworkError', async () => {
  const { backend, drive } = setup();
  drive.failWith('network');
  await assert.rejects(backend.load(), NetworkError);
});

test('broken JSON in the file is reported instead of being overwritten', async () => {
  const { backend, drive } = setup();
  await backend.save({ n: 1 });
  drive.dataFile().body = '{ not json';
  await assert.rejects(backend.load(), /not valid JSON/);
});

test('account() returns the signed-in user', async () => {
  const { backend } = setup();
  assert.equal((await backend.account()).emailAddress, 'me@example.com');
});

test('store and Drive backend together: two devices, no lost changes', async () => {
  const { make } = setup();
  const options = { appId: 'movies', collections: ['titles'], debounceMs: 5 };
  const phone = createStore({ backend: make(), ...options });
  const pc = createStore({ backend: make(), ...options });
  await phone.load();
  await pc.load();
  phone.put('titles', { title: 'Alien' });
  await phone.flush();
  pc.put('titles', { title: 'Brazil' });
  await pc.flush();
  await phone.refresh();
  assert.deepEqual(phone.list('titles').map((t) => t.title).sort(), ['Alien', 'Brazil']);
});
