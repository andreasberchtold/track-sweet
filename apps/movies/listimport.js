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
const SOLO_WORDS = ['alleine', 'allein', 'elei', 'eleige', 'alone', 'solo', 'by myself'];
const FILLER = /\b(?:schauen|anschauen|luege|lüege|watch|watching|mit|with|zu|zum|to|go|gah)\b/gi;
const IMDB_URL = /https?:\/\/(?:[a-z]+\.)?imdb\.com\/\S*/gi;
const ANY_URL = /https?:\/\/\S+/g;

export function parseLine(raw) {
  if (!raw || !raw.trim()) return null;
  const hadBullet = BULLET.test(raw);
  if (!hadBullet && HEADING.test(raw)) return null;
  let line = raw;
  while (BULLET.test(line)) line = line.replace(BULLET, ''); // "- [ ] Heat"
  line = line.trim();

  const imdbId = /\b(tt\d{7,9})\b/.exec(line)?.[1] ?? null;
  const notes = [];
  // IMDb links only identify the title; other links ("tip from here: ...") are kept as notes.
  const links = (line.replace(IMDB_URL, ' ').match(ANY_URL) ?? []);
  line = line.replace(ANY_URL, ' ').replace(/\s+/g, ' ').trim();
  const [main, ...after] = line.split(/\s*(?:->|→|=>)\s*/);
  line = main;
  if (after.length) notes.push(after.join(' ').trim());

  const lead = /^\(([^)]*)\)\s*/.exec(line);
  if (lead && !YEAR.test(lead[0].trim())) {
    notes.unshift(lead[1].trim());
    line = line.slice(lead[0].length);
  }

  let mediaHint = null;
  // "Serie - Title" or "Series: Title"
  const seriesPrefix = /^(?:serie|series|tv|tv-serie)\s*[-–—:]\s*/i.exec(line);
  if (seriesPrefix) {
    mediaHint = 'tv';
    line = line.slice(seriesPrefix[0].length);
  }

  line = line.replace(/\s*[-–—|]\s*IMDb\s*$/i, '').replace(/[\s:;,]+$/, '').trim();

  // A note in brackets at the end, like "(Oscar Winner)", but not a year.
  const trail = /\s*\(([^()]*)\)\s*$/.exec(line);
  if (trail && !YEAR.test(trail[0].trim()) && line.length > trail[0].length) {
    notes.push(trail[1].trim());
    line = line.slice(0, trail.index).trim();
  }

  let year = null;
  const y = YEAR.exec(line);
  if (y) {
    year = Number(y[2]);
    if (/series/i.test(y[1] ?? '')) mediaHint = 'tv';
    // (The "if" above only sets the hint; a "Serie -" prefix may already have.)
    line = line.slice(0, y.index).trim();
    line = line.replace(/\s*[-–—|]\s*IMDb\s*$/i, '').trim();
  }

  const unsure = /\?\s*$/.test(line);
  line = line.replace(/\?+\s*$/, '').replace(/[\s:;,.-]+$/, '').trim();
  if (!line) return null;

  notes.push(...links);
  const note = notes
    .map((n) => n.replace(/[\s:;,]+$/, '').trim())
    .filter(Boolean)
    .join('. ');
  return { raw: raw.trim(), title: line, year, imdbId, mediaHint, unsure, note };
}

export function parseList(text) {
  return (
    fromTodoJson(text) ??
    String(text ?? '')
      .split(/\r?\n/)
      .map(parseLine)
      .filter(Boolean)
  );
}

/**
 * Tasks as Microsoft Graph returns them (for example from Graph Explorer):
 * { "value": [ { "title": "...", "status": "notStarted", "body": { "content": "..." } } ] }
 * The task's notes become the line's note. Completed tasks are marked done.
 * Several pages (Graph sends tasks in pages) can be pasted one after another.
 * Returns null when the text is not such JSON.
 */
export function fromTodoJson(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  const pages = jsonSequence(trimmed);
  if (!pages) return null;
  const tasks = pages.flatMap((page) => (Array.isArray(page) ? page : page?.value ?? []));
  if (!tasks.length || !tasks.every((t) => typeof t?.title === 'string')) return null;
  return tasks
    .map((task) => {
      const line = parseLine(task.title);
      if (!line) return null;
      let body = String(task.body?.content ?? '');
      if (task.body?.contentType === 'html' || /<\/?[a-z][^>]*>/i.test(body)) body = htmlToText(body);
      body = body.replace(/\s+/g, ' ').trim();
      const idInBody = /\b(tt\d{7,9})\b/.exec(body)?.[1];
      if (!line.imdbId && idInBody) line.imdbId = idInBody;
      body = body.replace(IMDB_URL, ' ').replace(/\s+/g, ' ').trim();
      line.note = [line.note, body].filter(Boolean).join('. ');
      line.raw = body ? `${task.title.trim()} (note: ${body})` : task.title.trim();
      line.done = task.status === 'completed';
      // When it was ticked off: the day it was watched, as a local date.
      const doneAt = task.completedDateTime?.dateTime;
      if (line.done && doneAt) {
        const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(doneAt) ? doneAt : `${doneAt}Z`;
        const d = new Date(iso);
        if (!Number.isNaN(d.getTime())) {
          line.doneOn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      }
      return line;
    })
    .filter(Boolean);
}

/** Parse one or more JSON values written one after another. Null if any part is not JSON. */
function jsonSequence(text) {
  const values = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          values.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          return null;
        }
      }
    } else if (depth === 0 && !/\s/.test(c)) {
      return null;
    }
  }
  return depth === 0 && values.length ? values : null;
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
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

/** Turn a reviewed line into an entry: watchlist, or watched if ticked off in the other list. */
export function toEntry(line, index = 0, now = Date.now()) {
  const m = line.match;
  return {
    tmdbId: m?.tmdbId ?? null,
    imdbId: line.imdbId ?? null,
    mediaType: m?.mediaType ?? line.mediaHint ?? 'movie',
    title: m?.title ?? line.title,
    year: m?.year ?? line.year ?? null,
    posterPath: m?.posterPath ?? null,
    // Ticked off in the other list means watched.
    status: line.done ? 'watched' : 'watchlist',
    rating: null,
    watchedOn: line.done ? line.doneOn ?? null : null,
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
 * Add entries to the lists. A title already in the list is never
 * duplicated: it gets new tags and missing facts (note, genres, ...) added.
 * A watched entry moves a title from the watchlist (or "not interesting")
 * to watched; a title already watched keeps its own date and rating.
 * A watchlist entry for a title already watched changes nothing.
 */
export function mergeWatchlist(store, collection, entries) {
  const result = { added: 0, addedWatched: 0, updated: 0, skipped: 0 };
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
      if (entry.status === 'watched') result.addedWatched += 1;
      else result.added += 1;
      continue;
    }
    const seen = existing.status === 'watched' || existing.status === 'watching';
    if (seen && entry.status !== 'watched') {
      result.skipped += 1;
      continue;
    }
    const tags = [...new Set([...(existing.watchWith ?? []), ...entry.watchWith])];
    const fill = {};
    if (entry.status === 'watched' && !seen) {
      fill.status = 'watched';
      if (entry.watchedOn) fill.watchedOn = entry.watchedOn;
    }
    if (tags.length !== (existing.watchWith ?? []).length) fill.watchWith = tags;
    if (!existing.notes && entry.notes) fill.notes = entry.notes;
    for (const key of ['tmdbId', 'imdbId', 'posterPath', 'runtime', 'year']) {
      if (!existing[key] && entry[key]) fill[key] = entry[key];
    }
    if (!Array.isArray(existing.genres) && Array.isArray(entry.genres)) fill.genres = entry.genres;
    if (Object.keys(fill).length) {
      store.put(collection, { id: existing.id, ...fill });
      result.updated += 1;
    } else {
      result.skipped += 1;
    }
  }
  return result;
}
