// Title search through The Movie Database (TMDB), called straight from the
// browser. The key is whatever the user entered in the menu: either the
// short "API key" or the long "API read access token" from
// https://www.themoviedb.org/settings/api

const API = 'https://api.themoviedb.org/3';
const IMAGES = 'https://image.tmdb.org/t/p';

export function posterUrl(path, size = 'w185') {
  return path ? `${IMAGES}/${size}${path}` : null;
}

export function createTmdb({ getKey, getLanguage, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  async function call(path, params, signal) {
    const key = (getKey() || '').trim();
    if (!key) throw new Error('Add a TMDB key in the menu to search.');
    const url = new URL(API + path);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    url.searchParams.set('language', getLanguage() || 'en-US');
    const headers = { Accept: 'application/json' };
    if (looksLikeToken(key)) headers.Authorization = `Bearer ${key}`;
    else url.searchParams.set('api_key', key);

    let response;
    try {
      response = await fetchImpl(url, { headers, signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new Error('TMDB could not be reached. Check the connection.');
    }
    if (response.status === 401) throw new Error('TMDB did not accept the key. Check it in the menu.');
    if (!response.ok) throw new Error(`TMDB answered ${response.status}.`);
    return response.json();
  }

  return {
    hasKey: () => Boolean((getKey() || '').trim()),

    /** Movies and series matching the text, best match first. */
    async search(query, signal) {
      const data = await call('/search/multi', { query, include_adult: 'false', page: '1' }, signal);
      return (data.results ?? [])
        .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
        .map(fromResult);
    },

    /** Extra facts about one title: IMDb id, running time, number of seasons. */
    async details(mediaType, tmdbId, signal) {
      if (mediaType === 'tv') {
        const data = await call(`/tv/${tmdbId}`, { append_to_response: 'external_ids' }, signal);
        return {
          imdbId: data.external_ids?.imdb_id || null,
          runtime: Number(data.episode_run_time?.[0]) || null, // minutes per episode
          seasonsTotal: Number(data.number_of_seasons) || null,
          posterPath: data.poster_path || null,
        };
      }
      const data = await call(`/movie/${tmdbId}`, {}, signal);
      return {
        imdbId: data.imdb_id || null,
        runtime: Number(data.runtime) || null,
        seasonsTotal: null,
        posterPath: data.poster_path || null,
      };
    },

    /** Find a title by its IMDb id. Returns { tmdbId, mediaType, posterPath } or null. */
    async findByImdb(imdbId, preferred, signal) {
      const data = await call(`/find/${encodeURIComponent(imdbId)}`, { external_source: 'imdb_id' }, signal);
      const movie = data.movie_results?.[0];
      const tv = data.tv_results?.[0];
      const pick = preferred === 'tv' ? (tv ?? movie) : (movie ?? tv);
      if (!pick) return null;
      return { tmdbId: pick.id, mediaType: pick === tv ? 'tv' : 'movie', posterPath: pick.poster_path || null };
    },
  };
}

export function fromResult(r) {
  const date = r.release_date || r.first_air_date || '';
  return {
    tmdbId: r.id,
    mediaType: r.media_type,
    title: r.title || r.name || 'Untitled',
    originalTitle: r.original_title || r.original_name || null,
    year: date ? Number(date.slice(0, 4)) : null,
    posterPath: r.poster_path || null,
  };
}

/** The title's page on IMDb, or an IMDb search when the id is not known. */
export function imdbUrl(title) {
  if (title.imdbId) return `https://www.imdb.com/title/${encodeURIComponent(title.imdbId)}/`;
  const query = [title.title, title.year].filter(Boolean).join(' ');
  return `https://www.imdb.com/find/?s=tt&q=${encodeURIComponent(query)}`;
}

/** 148 -> "2 h 28 min" */
export function formatRuntime(minutes) {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

// The read access token is a long JWT (three dot-separated parts).
function looksLikeToken(key) {
  return key.length > 60 && key.split('.').length === 3;
}
