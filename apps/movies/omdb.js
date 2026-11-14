// IMDb rating and Rotten Tomatoes score from OMDb (www.omdbapi.com), looked
// up by IMDb id. OMDb needs its own free key, entered in the menu.

const API = 'https://www.omdbapi.com/';

export class OmdbKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OmdbKeyError';
  }
}

export function createOmdb({ getKey, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  return {
    hasKey: () => Boolean((getKey() || '').trim()),

    /**
     * { imdb: 8.1, rt: 92 } (either can be null). Throws OmdbKeyError when
     * the key is wrong or the daily limit is reached, so callers can stop.
     */
    async ratings(imdbId, signal) {
      const url = new URL(API);
      url.searchParams.set('i', imdbId);
      url.searchParams.set('apikey', (getKey() || '').trim());
      let response;
      try {
        response = await fetchImpl(url, { signal });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        throw new Error('OMDb could not be reached.');
      }
      let data = null;
      try {
        data = await response.json();
      } catch {
        // not JSON
      }
      if (response.status === 401 || /api key|limit/i.test(data?.Error ?? '')) {
        throw new OmdbKeyError(
          /limit/i.test(data?.Error ?? '')
            ? 'OMDb\'s daily limit is reached. Ratings continue tomorrow.'
            : 'OMDb did not accept the key. Check it in the menu.',
        );
      }
      if (!response.ok) throw new Error(`OMDb answered ${response.status}.`);
      return parseRatings(data);
    },
  };
}

export function parseRatings(data) {
  if (!data || data.Response === 'False') return { imdb: null, rt: null };
  const imdb = Number.parseFloat(data.imdbRating);
  const tomatoes = (data.Ratings ?? []).find((r) => r?.Source === 'Rotten Tomatoes');
  const rt = Number.parseInt(String(tomatoes?.Value ?? ''), 10);
  return {
    imdb: Number.isFinite(imdb) ? imdb : null,
    rt: Number.isFinite(rt) ? rt : null,
  };
}
