// Import from SIMKL.
//
// Input is SIMKL's "all items" JSON: an object with the lists "movies",
// "shows" and "anime". It comes from SIMKL's backup download or from
// scripts/simkl-export.mjs. This file only translates and merges; it has no
// screens of its own.

import { todayISO } from '../../core/util.js';

const NOT_SIMKL = 'This file does not look like a SIMKL export: it has no "movies", "shows" or "anime" list.';

/**
 * Translate a SIMKL export into entries for this app.
 * Returns { entries, counts } where counts says what was found.
 */
export function mapSimkl(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(NOT_SIMKL);
  const lists = [
    ['movies', 'movie'],
    ['shows', 'show'],
    ['anime', 'show'],
  ];
  if (!lists.some(([key]) => Array.isArray(data[key]))) throw new Error(NOT_SIMKL);

  const entries = [];
  const counts = { watched: 0, watching: 0, watchlist: 0, notinterested: 0, unreadable: 0 };

  for (const [key, mediaKey] of lists) {
    for (const item of data[key] ?? []) {
      const media = item?.[mediaKey] ?? item?.movie ?? item?.show;
      if (!media?.title) {
        counts.unreadable += 1;
        continue;
      }
      const isMovie = key === 'movies' || (key === 'anime' && item.anime_type === 'movie');
      const notes = [];
      let status;
      switch (item.status) {
        case 'plantowatch':
          status = 'watchlist';
          break;
        case 'watching':
          status = isMovie ? 'watched' : 'watching';
          break;
        case 'hold':
          status = isMovie ? 'watchlist' : 'watching';
          notes.push('On hold');
          break;
        case 'dropped':
          // SIMKL's "Not Interesting" list for movies; for a series it means
          // given up part-way, which gets a note.
          status = 'notinterested';
          if (!isMovie) notes.push('Dropped');
          break;
        default:
          status = 'watched'; // "completed"
      }
      counts[status] += 1;

      if (status === 'watching' && item.last_watched) notes.push(`Last watched ${item.last_watched}`);
      const memo = typeof item.memo === 'string' ? item.memo : item.memo?.text;
      if (memo) notes.unshift(String(memo).trim());

      const ids = media.ids ?? {};
      entries.push({
        simklId: ids.simkl ?? null,
        tmdbId: Number(ids.tmdb) || null,
        imdbId: /^tt\d+$/.test(ids.imdb ?? '') ? ids.imdb : null,
        mediaType: isMovie ? 'movie' : 'tv',
        title: String(media.title),
        year: Number(media.year) || null,
        posterPath: null,
        status,
        rating: clampRating(item.user_rating),
        watchedOn: status === 'watched' ? localDate(item.last_watched_at) : null,
        runtime: Number(media.runtime) || null,
        seasonsWatched: isMovie ? null : seasonsFromMarkers(item),
        seasonsTotal: null,
        watchWith: [],
        notes: notes.join('. '),
        // Series in progress are ordered by when they were last watched.
        createdAt:
          (status === 'watching' ? validISO(item.last_watched_at) : null) ??
          validISO(item.added_to_watchlist_at) ??
          validISO(item.last_watched_at) ??
          undefined,
        finishedSeries: !isMovie && item.status === 'completed',
      });
    }
  }
  return { entries, counts };
}

/**
 * Merge translated entries into the store. A title that is already in the
 * list (same SIMKL, TMDB or IMDb id) is never overwritten; only facts that
 * are still missing there (poster, ids, running time) are filled in. That
 * makes it safe to run the same import twice.
 */
export function mergeImport(store, collection, entries) {
  const result = { added: 0, completed: 0, unchanged: 0 };
  for (const entry of entries) {
    const { finishedSeries, ...fields } = entry;
    if (finishedSeries && fields.seasonsTotal) fields.seasonsWatched = fields.seasonsTotal;
    const existing = findExisting(store.list(collection), fields);
    if (!existing) {
      store.put(collection, fields);
      result.added += 1;
      continue;
    }
    const fill = {};
    for (const key of ['simklId', 'tmdbId', 'imdbId', 'posterPath', 'runtime', 'seasonsTotal', 'year']) {
      if (!existing[key] && fields[key]) fill[key] = fields[key];
    }
    if (!Array.isArray(existing.genres) && Array.isArray(fields.genres)) fill.genres = fields.genres;
    if (fields.tmdbDetails && !existing.tmdbDetails) fill.tmdbDetails = true;
    if (Object.keys(fill).length) {
      store.put(collection, { id: existing.id, ...fill });
      result.completed += 1;
    } else {
      result.unchanged += 1;
    }
  }
  return result;
}

export function findExisting(titles, entry) {
  return (
    titles.find(
      (t) =>
        (entry.simklId && t.simklId === entry.simklId) ||
        (entry.tmdbId && t.tmdbId === entry.tmdbId && t.mediaType === entry.mediaType) ||
        (entry.imdbId && t.imdbId === entry.imdbId),
    ) ?? null
  );
}

/**
 * Look up poster, running time and missing ids on TMDB for each entry.
 * Entries are changed in place. Failures for single titles are skipped.
 */
export async function enrich(entries, tmdb, { onProgress, signal, concurrency = 4 } = {}) {
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < entries.length && !signal?.aborted) {
      const entry = entries[next];
      next += 1;
      try {
        if (!entry.tmdbId && entry.imdbId) {
          const found = await tmdb.findByImdb(entry.imdbId, entry.mediaType, signal);
          if (found) Object.assign(entry, { tmdbId: found.tmdbId, mediaType: found.mediaType, posterPath: found.posterPath });
        }
        if (entry.tmdbId) {
          const details = await tmdb.details(entry.mediaType, entry.tmdbId, signal);
          entry.posterPath ??= details.posterPath ?? null;
          entry.imdbId ??= details.imdbId;
          entry.runtime ??= details.runtime;
          entry.seasonsTotal ??= details.seasonsTotal;
          entry.genres ??= details.genres;
          entry.tmdbDetails = true;
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // This title stays without poster; the rest of the import goes on.
      }
      done += 1;
      onProgress?.(done, entries.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
}

function clampRating(value) {
  const n = Math.round(Number(value));
  return n >= 1 && n <= 10 ? n : null;
}

function validISO(value) {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function localDate(value) {
  return validISO(value) ? todayISO(new Date(value)) : null;
}

// "S02E05" means season 2 is in progress, so one season is finished, unless
// the next episode to watch is already in a later season.
function seasonsFromMarkers(item) {
  const last = /^S(\d+)E\d+/i.exec(item.last_watched ?? '');
  if (!last) return null;
  const season = Number(last[1]);
  if (item.status === 'completed') return season;
  const next = /^S(\d+)E\d+/i.exec(item.next_to_watch ?? '');
  if (next && Number(next[1]) > season) return season;
  return Math.max(0, season - 1) || null;
}
