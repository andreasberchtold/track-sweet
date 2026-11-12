import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuth } from '../core/auth.js';
import { createMemoryStorage } from '../core/backend-local.js';

// Stand-in for Google Identity Services. `behave` decides what Google
// "answers" to each token request.
function fakeGoogle(behave) {
  const seen = { config: null, requests: [] };
  const google = {
    accounts: {
      oauth2: {
        initTokenClient(config) {
          seen.config = config;
          return {
            requestAccessToken(options) {
              seen.requests.push(options);
              queueMicrotask(() => behave(config, options));
            },
          };
        },
      },
    },
  };
  return { google, seen };
}

function setup(behave) {
  const { google, seen } = fakeGoogle(behave);
  const storage = createMemoryStorage();
  let time = 1_000_000;
  const auth = createAuth({
    clientId: 'client-123',
    storage,
    loadGoogle: async () => google,
    now: () => time,
  });
  return { auth, seen, storage, advance: (ms) => (time += ms) };
}

const grant = (config) => config.callback({ access_token: 'tok', expires_in: 3599 });

test('asks only for the drive.file permission', async () => {
  const { auth, seen } = setup(grant);
  await auth.request();
  assert.equal(seen.config.client_id, 'client-123');
  assert.equal(seen.config.scope, 'https://www.googleapis.com/auth/drive.file');
});

test('a granted request provides a token until shortly before it expires', async () => {
  const { auth, advance } = setup(grant);
  assert.equal(auth.getToken(), null);
  assert.deepEqual(await auth.request(), { ok: true });
  assert.equal(auth.getToken(), 'tok');
  advance(3599_000 - 61_000);
  assert.equal(auth.getToken(), 'tok');
  advance(2_000);
  assert.equal(auth.getToken(), null);
});

test('first sign-in shows the account chooser; later ones pass the hint instead', async () => {
  const { auth, seen } = setup(grant);
  await auth.request({ interactive: true });
  assert.equal(seen.requests[0].prompt, 'select_account');
  auth.setHint('me@example.com');
  await auth.request({ interactive: false });
  assert.equal(seen.requests[1].prompt, '');
  assert.equal(seen.requests[1].login_hint, 'me@example.com');
});

test('a blocked pop-up is reported, not thrown', async () => {
  const { auth } = setup((config) => config.error_callback({ type: 'popup_failed_to_open' }));
  assert.deepEqual(await auth.request({ interactive: false }), { ok: false, reason: 'popup_failed_to_open' });
  assert.equal(auth.getToken(), null);
});

test('a refusal from Google is reported', async () => {
  const { auth } = setup((config) => config.callback({ error: 'access_denied' }));
  assert.deepEqual(await auth.request(), { ok: false, reason: 'access_denied' });
});

test('simultaneous requests open only one Google window', async () => {
  const { auth, seen } = setup(grant);
  const [a, b] = await Promise.all([auth.request(), auth.request()]);
  assert.deepEqual([a.ok, b.ok], [true, true]);
  assert.equal(seen.requests.length, 1);
});

test('invalidate drops the token; signOut also forgets the account', async () => {
  const { auth, storage } = setup(grant);
  await auth.request();
  auth.setHint('me@example.com');
  auth.invalidate();
  assert.equal(auth.getToken(), null);
  assert.equal(auth.getHint(), 'me@example.com');
  await auth.request();
  auth.signOut();
  assert.equal(auth.getToken(), null);
  assert.equal(auth.getHint(), null);
  assert.equal(storage.getItem('pa:auth:hint'), null);
});

test('if the Google script cannot load, the request fails cleanly', async () => {
  const auth = createAuth({
    clientId: 'x',
    storage: createMemoryStorage(),
    loadGoogle: async () => {
      throw new Error('offline');
    },
  });
  assert.deepEqual(await auth.request(), { ok: false, reason: 'offline' });
});
