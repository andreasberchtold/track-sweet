import test from 'node:test';
import assert from 'node:assert/strict';

import { deployed, describe, isDev, newerVersion } from '../core/updates.js';

test('describes a deployed version and a working copy', () => {
  assert.equal(describe({ commit: 'dev' }), 'Development version, not deployed');
  assert.equal(isDev({ commit: 'dev' }), true);
  const text = describe({ commit: '1a2b3c4', date: '2026-11-12T13:50:00Z' });
  assert.match(text, /^Version 1a2b3c4, deployed .*2026/);
  assert.equal(describe({ commit: '1a2b3c4' }), 'Version 1a2b3c4');
});

test('reads the deployed version past the cache, and copes with failures', async () => {
  const calls = [];
  const ok = async (url, options) => {
    calls.push([String(url), options]);
    return new Response(JSON.stringify({ commit: 'abc1234', date: '2026-11-12T13:50:00Z' }));
  };
  assert.equal((await deployed(ok)).commit, 'abc1234');
  assert.match(calls[0][0], /\/version\.json$/);
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(await deployed(async () => new Response('', { status: 404 })), null);
  assert.equal(
    await deployed(async () => {
      throw new TypeError('offline');
    }),
    null,
  );
});

test('a working copy never reports a newer version', async () => {
  // core/version.js says "dev" in the repository; only the deploy fills it in.
  assert.equal(await newerVersion(async () => new Response(JSON.stringify({ commit: 'abc1234' }))), null);
});
