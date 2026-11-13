import test from 'node:test';
import assert from 'node:assert/strict';

import { createTmdb, formatRuntime, imdbUrl, posterUrl } from '../apps/movies/tmdb.js';

function setup(key, respond) {
  const calls = [];
  const tmdb = createTmdb({
    getKey: () => key,
    getLanguage: () => 'de-DE',
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(String(url)), options });
      return respond();
    },
  });
  return { tmdb, calls };
}

const ok = (body) => () => new Response(JSON.stringify(body), { status: 200 });

test('search keeps movies and series, drops people, and maps the fields', async () => {
  const { tmdb, calls } = setup(
    'shortkey',
    ok({
      results: [
        { id: 1, media_type: 'movie', title: 'Heat', original_title: 'Heat', release_date: '1995-12-15', poster_path: '/h.jpg' },
        { id: 2, media_type: 'tv', name: 'Dark', first_air_date: '2017-12-01', poster_path: null },
        { id: 3, media_type: 'person', name: 'Somebody' },
      ],
    }),
  );
  const found = await tmdb.search('he');
  assert.deepEqual(found, [
    { tmdbId: 1, mediaType: 'movie', title: 'Heat', originalTitle: 'Heat', year: 1995, posterPath: '/h.jpg' },
    { tmdbId: 2, mediaType: 'tv', title: 'Dark', originalTitle: null, year: 2017, posterPath: null },
  ]);
  const { url, options } = calls[0];
  assert.equal(url.pathname, '/3/search/multi');
  assert.equal(url.searchParams.get('query'), 'he');
  assert.equal(url.searchParams.get('language'), 'de-DE');
  assert.equal(url.searchParams.get('include_adult'), 'false');
  assert.equal(url.searchParams.get('api_key'), 'shortkey');
  assert.equal(options.headers.Authorization, undefined);
});

test('a long read access token is sent as a header, not in the address', async () => {
  const token = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`;
  const { tmdb, calls } = setup(token, ok({ results: [] }));
  await tmdb.search('x');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].url.searchParams.has('api_key'), false);
});

test('details of a movie: IMDb id and running time', async () => {
  const { tmdb, calls } = setup('k', ok({ imdb_id: 'tt0113277', runtime: 170, genres: [{ id: 80, name: 'Krimi' }, { id: 18, name: 'Drama' }] }));
  assert.deepEqual(await tmdb.details('movie', 949), { imdbId: 'tt0113277', runtime: 170, seasonsTotal: null, posterPath: null, genres: ['Krimi', 'Drama'] });
  assert.equal(calls[0].url.pathname, '/3/movie/949');
});

test('details of a series: IMDb id, episode length and seasons', async () => {
  const { tmdb, calls } = setup(
    'k',
    ok({ number_of_seasons: 4, episode_run_time: [52], poster_path: '/d.jpg', external_ids: { imdb_id: 'tt5753856' } }),
  );
  assert.deepEqual(await tmdb.details('tv', 77), { imdbId: 'tt5753856', runtime: 52, seasonsTotal: 4, posterPath: '/d.jpg', genres: [] });
  assert.equal(calls[0].url.pathname, '/3/tv/77');
  assert.equal(calls[0].url.searchParams.get('append_to_response'), 'external_ids');
});

test('details cope with missing facts', async () => {
  const { tmdb } = setup('k', ok({ episode_run_time: [], external_ids: {} }));
  assert.deepEqual(await tmdb.details('tv', 1), { imdbId: null, runtime: null, seasonsTotal: null, posterPath: null, genres: [] });
});

test('findByImdb returns the matching title, preferring the expected type', async () => {
  const body = { movie_results: [{ id: 10, poster_path: '/m.jpg' }], tv_results: [{ id: 20, poster_path: null }] };
  const { tmdb, calls } = setup('k', ok(body));
  assert.deepEqual(await tmdb.findByImdb('tt1', 'movie'), { tmdbId: 10, mediaType: 'movie', posterPath: '/m.jpg' });
  assert.deepEqual(await tmdb.findByImdb('tt1', 'tv'), { tmdbId: 20, mediaType: 'tv', posterPath: null });
  assert.equal(calls[0].url.pathname, '/3/find/tt1');
  assert.equal(calls[0].url.searchParams.get('external_source'), 'imdb_id');
  assert.equal(await setup('k', ok({ movie_results: [], tv_results: [] })).tmdb.findByImdb('tt9', 'movie'), null);
});

test('imdbUrl links to the title page, or to a search when the id is unknown', () => {
  assert.equal(imdbUrl({ imdbId: 'tt0113277', title: 'Heat' }), 'https://www.imdb.com/title/tt0113277/');
  assert.equal(imdbUrl({ title: 'Heat & Dust', year: 1983 }), 'https://www.imdb.com/find/?s=tt&q=Heat%20%26%20Dust%201983');
});

test('formatRuntime writes minutes as hours and minutes', () => {
  assert.equal(formatRuntime(148), '2 h 28 min');
  assert.equal(formatRuntime(45), '45 min');
  assert.equal(formatRuntime(120), '2 h');
  assert.equal(formatRuntime(null), '');
});

test('clear messages for a missing key, a rejected key and no connection', async () => {
  await assert.rejects(setup('', ok({})).tmdb.search('x'), /Add a TMDB key/);
  await assert.rejects(setup('k', () => new Response('{}', { status: 401 })).tmdb.search('x'), /did not accept the key/);
  const offline = createTmdb({
    getKey: () => 'k',
    getLanguage: () => 'en-US',
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await assert.rejects(offline.search('x'), /could not be reached/);
});

test('posterUrl builds an image address or returns null', () => {
  assert.equal(posterUrl('/h.jpg'), 'https://image.tmdb.org/t/p/w185/h.jpg');
  assert.equal(posterUrl(null), null);
});
