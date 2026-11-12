// Import a pasted list of titles (for example copied from a to-do app) into
// the watchlist. This file reads the lines, finds each title on TMDB and
// merges the result; the review screen lives in app.js.
//
// A line can look like any of these:
//   ❏ Bugonia (2025) - IMDb
//   ❏ (alleine schauen) Bugonia (2025) - IMDb
//   ❏ Saltburn (2023) -> alleine schauen: https://www.imdb.com/title/tt17351924/
//   ❏ Windy City Heat (TV Movie 2003) - IMDb
//   ❏ True detective?
// Text after "->" and a leading "(...)" are kept as a note; an IMDb link is
// used to find the exact title; a trailing "?" marks the line as unsure.

import { findExisting } from './simkl.js';

const BULLET = /^\s*(?:[❏❐❑❒☐☑☒✓✔✗✘•◦▪▫‣⁃○●□■*–—-]|\[[ xX]?\]|\(\s?\)|\d{1,3}[.)])\s*/u;
const HEADING = /^\s*\p{Extended_Pictographic}/u;
const YEAR = /\(\s*(?:(TV Movie|TV Series|TV Mini[- ]?Series|TV Special|Video|Short|Mini[- ]?Series)\s*)?((?:18|19|20)\d{2})(?:\s*[–-]\s*(?:\d{4})?)?\s*\)\s*$/i;

/** Words that mean "on my own" in a note, for the solo tag (id "solo" or named like one). */
const SOLO_WORDS = ['alleine', 'allein', 'alone', 'solo', 'by myself'];
const FILLER = /\b(?:schauen|anschauen|luege|lüege|watch|watching|mit|with|zu|to|go|gah)\b/gi;

export function parseLine(raw) {
  if (!raw || !raw.trim()) return null;
  const hadBullet = BULLET.test(raw);
  if (!hadBullet && HEADING.test(raw)) return null;
  let line = raw;
  while (BULLET.test(line)) line = line.replace(BULLET, ''); // "- [ ] Heat"
  line = line.trim();

  const imdbId = /\b(tt\d{7,9})\b/.exec(line)?.[1] ?? null;
  line = line.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();

  const notes = [];
  const [main, ...after] = line.split(/\s*(?:->|→|=>)\s*/);
  line = main;
  if (after.length) notes.push(after.join(' ').trim());

  const lead = /^\(([^)]*)\)\s*/.exec(line);
  if (lead && !YEAR.test(lead[0].trim())) {
    notes.unshift(lead[1].trim());
    line = line.slice(lead[0].length);
  }

  line = line.replace(/\s*[-–—|]\s*IMDb\s*$/i, '').trim();

  let year = null;
  let mediaHint = null;
  const y = YEAR.exec(line);
  if (y) {
    year = Number(y[2]);
    if (/series/i.test(y[1] ?? '')) mediaHint = 'tv';
    line = line.slice(0, y.index).trim();
    line = line.replace(/\s*[-–—|]\s*IMDb\s*$/i, '').trim();
  }

  const unsure = /\?\s*$/.test(line);
  line = line.replace(/\?+\s*$/, '').replace(/[\s:;,.-]+$/, '').trim();
  if (!line) return null;

  const note = notes
    .map((n) => n.replace(/[\s:;,]+$/, '').trim())
    .filter(Boolean)
    .join('. ');
  return { raw: raw.trim(), title: line, year, imdbId, mediaHint, unsure, note };
}

export function parseList(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map(parseLine)
    .filter(Boolean);
}

/**
 * Which "watch with" tags a line gets: the tags its note names (by label,
 * or "alleine"/"alone" for the solo tag), otherwise the default tag. Note
 * parts that only name a tag ("alleine schauen") are dropped from the note.
 */
export function tagsForNote(note, tags, defaultTagId) {
  const found = new Set();
  const isSolo = (tag) => tag.id === 'solo' || SOLO_WORDS.includes(String(tag.label).toLowerCase());
  const words = (tag) => [tag.label, ...(isSolo(tag) ? SOLO_WORDS : [])].map((w) => String(w).toLowerCase());
  const text = (note ?? '').toLowerCase();
  for (const tag of tags) {
    if (words(tag).some((w) => w && new RegExp(`(^|[^\\p{L}])${escape(w)}($|[^\\p{L}])`, 'u').test(text))) found.add(tag.id);
  }
  const keptParts = (note ?? '')
    .split(/\.\s+/)
    .filter((part) => {
      let rest = part.toLowerCase();
      for (const tag of tags) for (const w of words(tag)) if (w) rest = rest.replaceAll(w, ' ');
      return rest.replace(FILLER, ' ').replace(/[^\p{L}\p{N}]+/gu, '').length > 0;
    });
  const watchWith = found.size ? [...found] : defaultTagId ? [defaultTagId] : [];
  return { watchWith: tags.map((t) => t.id).filter((id) => watchWith.includes(id)), note: keptParts.join('. ') };
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const normal = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(the|a|an|der|die|das)\s+/, '')
    .replace(/[^a-z0-9]+/g, '');

/**
 * Pick the most likely TMDB result for a parsed line.
 * Returns { match, sure } where sure means title and (if given) year agree.
 */
export function bestMatch(line, results) {
  if (!results.length) return { match: null, sure: false };
  const wanted = normal(line.title);
  const score = (r) => {
    let s = 0;
    const names = [r.title, r.originalTitle].map(normal);
    if (names.includes(wanted)) s += 4;
    else if (names.some((n) => n.startsWith(wanted) || wanted.startsWith(n))) s += 1;
    if (line.year && r.year) {
      if (r.year === line.year) s += 3;
      else if (Math.abs(r.year - line.year) === 1) s += 1;
      else s -= 2;
    }
    if (line.mediaHint && r.mediaType === line.mediaHint) s += 1;
    return s;
  };
  let best = results[0];
  let bestScore = score(best);
  results.forEach((r, i) => {
    const s = score(r) - i * 0.01; // earlier results win ties
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  });
  const isExact = (r) => [r.title, r.originalTitle].map(normal).includes(wanted);
  const exactTitle = isExact(best);
  const yearOk = !line.year || best.year === line.year;
  // Without a year, two titles with the same name (a remake, say) need a look.
  const ambiguous = !line.year && results.filter(isExact).length > 1;
  return { match: best, sure: exactTitle && yearOk && !ambiguous && !line.unsure };
}

/** Look up every line on TMDB. Lines are changed in place: candidates, match, sure. */
export async function findAll(lines, tmdb, { onProgress, signal, concurrency = 4 } = {}) {
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < lines.length && !signal?.aborted) {
      const line = lines[next];
      next += 1;
      try {
        let byImdb = null;
        if (line.imdbId) byImdb = await tmdb.findByImdb(line.imdbId, line.mediaHint, signal);
        const results = await tmdb.search(line.title, signal);
        if (byImdb) {
          const hit = results.find((r) => r.tmdbId === byImdb.tmdbId && r.mediaType === byImdb.mediaType);
          const match = hit ?? { ...byImdb, title: line.title, year: line.year, originalTitle: null };
          line.candidates = [match, ...results.filter((r) => r !== hit)].slice(0, 6);
          line.match = match;
          line.sure = true;
        } else {
          const { match, sure } = bestMatch(line, results);
          line.candidates = results.slice(0, 6);
          if (match && !line.candidates.includes(match)) line.candidates.unshift(match);
          line.match = match;
          line.sure = sure;
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        line.candidates = [];
        line.match = null;
        line.sure = false;
        line.error = err.message;
      }
      done += 1;
      onProgress?.(done, lines.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, lines.length) }, worker));
}

/** Turn a reviewed line into a watchlist entry. */
export function toEntry(line, index = 0, now = Date.now()) {
  const m = line.match;
  return {
    tmdbId: m?.tmdbId ?? null,
    imdbId: line.imdbId ?? null,
    mediaType: m?.mediaType ?? line.mediaHint ?? 'movie',
    title: m?.title ?? line.title,
    year: m?.year ?? line.year ?? null,
    posterPath: m?.posterPath ?? null,
    status: 'watchlist',
    rating: null,
    watchedOn: null,
    runtime: null,
    seasonsWatched: null,
    seasonsTotal: null,
    watchWith: line.watchWith ?? [],
    notes: line.note ?? '',
    // Keep the list's order under "Newest first": the first line is newest.
    createdAt: new Date(now - index * 1000).toISOString(),
  };
}

/**
 * Add entries to the watchlist. A title already on the watchlist gets the
 * new tags added and the note filled in if it had none; a title already
 * watched (or marked not interesting) is left alone.
 */
export function mergeWatchlist(store, collection, entries) {
  const result = { added: 0, updated: 0, skipped: 0 };
  for (const entry of entries) {
    const titles = store.list(collection);
    // Titles without any id (no match found) are recognised by their name.
    const existing =
      findExisting(titles, entry) ??
      (!entry.tmdbId && !entry.imdbId
        ? titles.find((t) => !t.tmdbId && !t.imdbId && normal(t.title) === normal(entry.title)) ?? null
        : null);
    if (!existing) {
      store.put(collection, entry);
      result.added += 1;
      continue;
    }
    if (existing.status !== 'watchlist') {
      result.skipped += 1;
      continue;
    }
    const tags = [...new Set([...(existing.watchWith ?? []), ...entry.watchWith])];
    const fill = {};
    if (tags.length !== (existing.watchWith ?? []).length) fill.watchWith = tags;
    if (!existing.notes && entry.notes) fill.notes = entry.notes;
    for (const key of ['tmdbId', 'imdbId', 'posterPath', 'runtime', 'year']) {
      if (!existing[key] && entry[key]) fill[key] = entry[key];
    }
    if (Object.keys(fill).length) {
      store.put(collection, { id: existing.id, ...fill });
      result.updated += 1;
    } else {
      result.skipped += 1;
    }
  }
  return result;
}
