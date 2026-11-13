import test from 'node:test';
import assert from 'node:assert/strict';

import { enrich, mapSimkl, mergeImport } from '../apps/movies/simkl.js';
import { createStore } from '../core/store.js';
import { createLocalBackend, createMemoryStorage } from '../core/backend-local.js';

// Shaped like the examples in SIMKL's API documentation (sync/all-items).
const EXPORT = {
  movies: [
    {
      added_to_watchlist_at: '2026-05-14T06:49:56Z',
      last_watched_at: '2026-06-01T20:30:00Z',
      user_rated_at: '2026-06-01T20:31:00Z',
      user_rating: 9,
      status: 'completed',
      memo: { text: 'Rewatch with director commentary', is_private: true },
      movie: { title: 'The Godfather', poster: '10/1012', year: 1972, runtime: 175, ids: { simkl: 53992, slug: 'the-godfather', imdb: 'tt0068646', tmdb: '238' } },
    },
    {
      added_to_watchlist_at: '2026-05-10T10:00:00Z',
      last_watched_at: null,
      user_rating: null,
      status: 'plantowatch',
      memo: {},
      movie: { title: 'Pulp Fiction', year: 1994, ids: { simkl: 54130, imdb: 'tt0110912' } },
    },
    {
      added_to_watchlist_at: '2026-01-01T10:00:00Z',
      last_watched_at: null,
      user_rating: 3,
      status: 'dropped',
      movie: { title: 'Some Dud', year: 2001, ids: { simkl: 1 } },
    },
  ],
  shows: [
    {
      added_to_watchlist_at: '2026-05-15T00:35:15Z',
      last_watched_at: '2026-05-15T00:35:15Z',
      user_rating: null,
      status: 'watching',
      last_watched: 'S02E05',
      next_to_watch: 'S02E06',
      show: { title: 'The Walking Dead', year: 2010, runtime: 43, ids: { simkl: 2090, imdb: 'tt1520211', tvdb: '153021' } },
    },
    {
      added_to_watchlist_at: null,
      last_watched_at: '2025-03-02T21:00:00Z',
      user_rating: 10,
      status: 'completed',
      last_watched: 'S05E16',
      next_to_watch: null,
      show: { title: 'Breaking Bad', year: 2008, ids: { simkl: 11121, imdb: 'tt0903747', tmdb: 1396 } },
    },
    { status: 'hold', last_watched: 'S01E08', next_to_watch: 'S02E01', show: { title: 'Paused Show', ids: { simkl: 7 } } },
    { status: 'completed', show: {} },
  ],
  anime: [
    { status: 'completed', anime_type: 'movie', user_rating: 8, last_watched_at: '2024-12-24T18:00:00Z', show: { title: 'Spirited Away', year: 2001, ids: { simkl: 9, imdb: 'tt0245429' } } },
  ],
};

test('translates statuses, ratings, ids, dates and notes', () => {
  const { entries, counts } = mapSimkl(EXPORT);
  assert.deepEqual(counts, { watched: 3, watching: 2, watchlist: 1, notinterested: 1, unreadable: 1 });
  const by = Object.fromEntries(entries.map((e) => [e.title, e]));
  assert.equal(entries.length, 7);

  const godfather = by['The Godfather'];
  assert.equal(godfather.status, 'watched');
  assert.equal(godfather.rating, 9);
  assert.equal(godfather.tmdbId, 238);
  assert.equal(godfather.imdbId, 'tt0068646');
  assert.equal(godfather.simklId, 53992);
  assert.equal(godfather.runtime, 175);
  assert.equal(godfather.mediaType, 'movie');
  assert.match(godfather.watchedOn, /^2026-06-0[12]$/); // local date of the last watch
  assert.equal(godfather.notes, 'Rewatch with director commentary');
  assert.equal(godfather.createdAt, '2026-05-14T06:49:56.000Z');

  assert.equal(by['Pulp Fiction'].status, 'watchlist');
  assert.equal(by['Pulp Fiction'].watchedOn, null);
  assert.equal(by['Pulp Fiction'].rating, null);
  assert.equal(by['Pulp Fiction'].tmdbId, null);

  const dead = by['The Walking Dead'];
  assert.equal(dead.status, 'watching');
  assert.equal(dead.mediaType, 'tv');
  assert.equal(dead.seasonsWatched, 1); // in the middle of season 2
  assert.equal(dead.notes, 'Last watched S02E05');

  assert.equal(by['Breaking Bad'].status, 'watched');
  assert.equal(by['Breaking Bad'].finishedSeries, true);
  assert.equal(by['Breaking Bad'].tmdbId, 1396);

  assert.equal(by['Paused Show'].status, 'watching');
  assert.equal(by['Paused Show'].seasonsWatched, 1); // season 1 done, next is S02E01
  assert.equal(by['Paused Show'].notes, 'On hold. Last watched S01E08');

  assert.equal(by['Spirited Away'].mediaType, 'movie');
});

test('dropped becomes "not interesting": plain for movies, with a note for series', () => {
  const { entries } = mapSimkl({
    movies: [EXPORT.movies[2]],
    shows: [{ status: 'dropped', last_watched: 'S01E03', show: { title: 'Gave Up', ids: { simkl: 5 } } }],
  });
  const [dud, gaveUp] = entries;
  assert.equal(dud.status, 'notinterested');
  assert.equal(dud.notes, '');
  assert.equal(dud.rating, 3);
  assert.equal(dud.watchedOn, null);
  assert.equal(gaveUp.status, 'notinterested');
  assert.equal(gaveUp.notes, 'Dropped');
});

test('files that are not a SIMKL export are refused', () => {
  assert.throws(() => mapSimkl({ app: 'movies', collections: {} }), /does not look like a SIMKL export/);
  assert.throws(() => mapSimkl([]), /does not look like a SIMKL export/);
  assert.deepEqual(mapSimkl({ movies: [] }).entries, []);
});

async function emptyStore() {
  const store = createStore({
    backend: createLocalBackend('doc', createMemoryStorage()),
    appId: 'movies',
    collections: ['titles'],
    debounceMs: 5,
  });
  await store.load();
  return store;
}

test('importing twice adds nothing the second time and keeps my own edits', async () => {
  const store = await emptyStore();
  const first = mergeImport(store, 'titles', mapSimkl(EXPORT).entries);
  assert.deepEqual(first, { added: 7, completed: 0, unchanged: 0 });
  assert.equal('finishedSeries' in store.list('titles')[0], false);

  const mine = store.list('titles').find((t) => t.title === 'The Godfather');
  store.put('titles', { id: mine.id, rating: 10, notes: 'changed here' });

  const second = mergeImport(store, 'titles', mapSimkl(EXPORT).entries);
  assert.deepEqual(second, { added: 0, completed: 0, unchanged: 7 });
  assert.equal(store.list('titles').length, 7);
  assert.equal(store.get('titles', mine.id).rating, 10);
  assert.equal(store.get('titles', mine.id).notes, 'changed here');
  await store.flush();
});

test('a later import fills in missing facts on existing titles', async () => {
  const store = await emptyStore();
  store.put('titles', { title: 'Pulp Fiction', mediaType: 'movie', imdbId: 'tt0110912', status: 'watched', rating: 9 });
  const entries = mapSimkl(EXPORT).entries.filter((e) => e.title === 'Pulp Fiction');
  Object.assign(entries[0], { tmdbId: 680, posterPath: '/p.jpg', runtime: 154 });
  assert.deepEqual(mergeImport(store, 'titles', entries), { added: 0, completed: 1, unchanged: 0 });
  const title = store.list('titles')[0];
  assert.equal(title.posterPath, '/p.jpg');
  assert.equal(title.tmdbId, 680);
  assert.equal(title.runtime, 154);
  assert.equal(title.status, 'watched'); // SIMKL said watchlist; my own status wins
  assert.equal(title.rating, 9);
  await store.flush();
});

test('enrich adds posters, ids and season counts, and survives failures', async () => {
  const { entries } = mapSimkl(EXPORT);
  const calls = [];
  const tmdb = {
    async findByImdb(imdbId, mediaType) {
      calls.push(`find ${imdbId}`);
      if (imdbId === 'tt0110912') return { tmdbId: 680, mediaType: 'movie', posterPath: '/pulp.jpg' };
      if (imdbId === 'tt1520211') throw new Error('TMDB answered 500.');
      return null;
    },
    async details(mediaType, tmdbId) {
      calls.push(`details ${mediaType} ${tmdbId}`);
      if (tmdbId === 1396) return { imdbId: 'tt0903747', runtime: 47, seasonsTotal: 5, posterPath: '/bb.jpg', genres: ['Drama', 'Crime'] };
      return { imdbId: null, runtime: 154, seasonsTotal: null, posterPath: '/other.jpg' };
    },
  };
  const progress = [];
  await enrich(entries, tmdb, { onProgress: (done, total) => progress.push(`${done}/${total}`), concurrency: 2 });
  const by = Object.fromEntries(entries.map((e) => [e.title, e]));

  assert.equal(by['Pulp Fiction'].tmdbId, 680);
  assert.equal(by['Pulp Fiction'].posterPath, '/pulp.jpg');
  assert.equal(by['Pulp Fiction'].runtime, 154);
  assert.equal(by['The Godfather'].runtime, 175); // SIMKL's own value is kept
  assert.equal(by['Breaking Bad'].seasonsTotal, 5);
  assert.deepEqual(by['Breaking Bad'].genres, ['Drama', 'Crime']);
  assert.equal(by['The Walking Dead'].posterPath, null); // lookup failed, import goes on
  assert.equal(by['Paused Show'].tmdbId, null); // no ids to look up
  assert.equal(progress.at(-1), '7/7');

  const store = await emptyStore();
  mergeImport(store, 'titles', entries);
  const bb = store.list('titles').find((t) => t.title === 'Breaking Bad');
  assert.equal(bb.seasonsWatched, 5); // a finished series counts all its seasons
  assert.equal(bb.tmdbDetails, true);
  await store.flush();
});
