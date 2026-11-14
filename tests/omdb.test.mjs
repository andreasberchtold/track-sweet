import test from 'node:test';
import assert from 'node:assert/strict';

import { createOmdb, OmdbKeyError, parseRatings } from '../apps/movies/omdb.js';

const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });

test('reads the IMDb rating and the Rotten Tomatoes score', () => {
  assert.deepEqual(
    parseRatings({
      Response: 'True',
      imdbRating: '8.8',
      Ratings: [
        { Source: 'Internet Movie Database', Value: '8.8/10' },
        { Source: 'Rotten Tomatoes', Value: '87%' },
        { Source: 'Metacritic', Value: '74/100' },
      ],
    }),
    { imdb: 8.8, rt: 87 },
  );
  assert.deepEqual(parseRatings({ Response: 'True', imdbRating: 'N/A', Ratings: [] }), { imdb: null, rt: null });
  assert.deepEqual(parseRatings({ Response: 'False', Error: 'Incorrect IMDb ID.' }), { imdb: null, rt: null });
});

test('asks by IMDb id with the key', async () => {
  const calls = [];
  const omdb = createOmdb({
    getKey: () => ' abc123 ',
    fetchImpl: async (url) => {
      calls.push(new URL(String(url)));
      return new Response(JSON.stringify({ Response: 'True', imdbRating: '7.0', Ratings: [] }));
    },
  });
  assert.deepEqual(await omdb.ratings('tt1375666'), { imdb: 7, rt: null });
  assert.equal(calls[0].origin, 'https://www.omdbapi.com');
  assert.equal(calls[0].searchParams.get('i'), 'tt1375666');
  assert.equal(calls[0].searchParams.get('apikey'), 'abc123');
});

test('a wrong key or the daily limit stops the lookups with a clear message', async () => {
  const wrong = createOmdb({ getKey: () => 'x', fetchImpl: reply(401, { Response: 'False', Error: 'Invalid API key!' }) });
  await assert.rejects(wrong.ratings('tt1'), (err) => err instanceof OmdbKeyError && /did not accept the key/.test(err.message));
  const limit = createOmdb({ getKey: () => 'x', fetchImpl: reply(401, { Response: 'False', Error: 'Request limit reached!' }) });
  await assert.rejects(limit.ratings('tt1'), (err) => err instanceof OmdbKeyError && /daily limit/.test(err.message));
  const offline = createOmdb({ getKey: () => 'x', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.ratings('tt1'), /could not be reached/);
  assert.equal(createOmdb({ getKey: () => '' }).hasKey(), false);
});
