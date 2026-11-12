import test from 'node:test';
import assert from 'node:assert/strict';

import { bestMatch, fromTodoJson, mergeWatchlist, parseLine, parseList, tagsForNote, toEntry } from '../apps/movies/listimport.js';
import { createStore } from '../core/store.js';
import { createLocalBackend, createMemoryStorage } from '../core/backend-local.js';

// Lines in the shapes of a list copied from Microsoft To Do (titles are made up where it matters).
const SAMPLE = `📺 Series / Movies

  ❏ (alleine schauen) Bugonia (2025) - IMDb
  ❏ You've Got Mail (1998) - IMDb
  ❏ Windy City Heat (TV Movie 2003) - IMDb
  ❏ Killers of the flower moon -> alleine
  ❏ Saltburn (2023) -> alleine schauen: https://www.imdb.com/title/tt17351924/
  ❏ Poor Things (2023) - IMDb -> Anna rated 0/10 (Ben, Cleo scho gseh)
  ❏ The Curse https://www.imdb.com/title/tt13623608/
  ❏ True detective?
  ❏ Pi
`;

test('reads titles, years, links, notes and doubts', () => {
  const lines = parseList(SAMPLE);
  assert.equal(lines.length, 9); // heading and blank lines are skipped
  const by = Object.fromEntries(lines.map((l) => [l.title, l]));

  assert.deepEqual(
    [by.Bugonia.year, by.Bugonia.note, by.Bugonia.imdbId],
    [2025, 'alleine schauen', null],
  );
  assert.equal(by["You've Got Mail"].year, 1998);
  assert.equal(by['Windy City Heat'].year, 2003);
  assert.equal(by['Killers of the flower moon'].note, 'alleine');
  assert.equal(by.Saltburn.imdbId, 'tt17351924');
  assert.equal(by.Saltburn.note, 'alleine schauen');
  assert.equal(by['Poor Things'].year, 2023);
  assert.equal(by['Poor Things'].note, 'Anna rated 0/10 (Ben, Cleo scho gseh)');
  assert.equal(by['The Curse'].imdbId, 'tt13623608');
  assert.equal(by['The Curse'].year, null);
  assert.equal(by['True detective'].unsure, true);
  assert.equal(by.Pi.title, 'Pi');
});

test('Microsoft To Do tasks as JSON, with their notes', () => {
  const json = JSON.stringify({
    '@odata.context': "https://graph.microsoft.com/v1.0/$metadata#users('x')/todo/lists('y')/tasks",
    value: [
      { title: 'Bugonia (2025) - IMDb', status: 'notStarted', body: { content: 'alleine schauen\r\n', contentType: 'text' } },
      { title: 'The Others (2001) - IMDb', status: 'notStarted', body: { content: '<p>Tipp vo Ben</p><p>https://www.imdb.com/title/tt0230600/</p>', contentType: 'html' } },
      { title: 'Heat (1995)', status: 'completed', body: { content: '', contentType: 'text' } },
      { title: '  ', status: 'notStarted', body: { content: 'x', contentType: 'text' } },
    ],
  });
  const lines = parseList(json);
  assert.equal(lines.length, 3);
  assert.deepEqual([lines[0].title, lines[0].year, lines[0].note, lines[0].done], ['Bugonia', 2025, 'alleine schauen', false]);
  assert.equal(lines[1].note, 'Tipp vo Ben');
  assert.equal(lines[1].imdbId, 'tt0230600');
  assert.equal(lines[1].raw, 'The Others (2001) - IMDb (note: Tipp vo Ben)');
  assert.equal(lines[2].done, true);
  assert.deepEqual(tagsForNote(lines[0].note, TAGS, '3er').watchWith, ['solo']);
  // Two pages pasted one after the other.
  const page = (title) => JSON.stringify({ value: [{ title, status: 'notStarted', body: { content: '', contentType: 'text' } }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/x?$skip=10' }, null, 2);
  assert.deepEqual(parseList(`${page('Pi')}\n\n${page('Traffic (2000)')}`).map((l) => l.title), ['Pi', 'Traffic']);
  // Plain text and other JSON are not mistaken for To Do tasks.
  assert.equal(fromTodoJson('Heat (1995)'), null);
  assert.equal(fromTodoJson('{"app":"movies"}'), null);
});

test('other list styles', () => {
  assert.equal(parseLine('- [ ] Heat (1995)').title, 'Heat');
  assert.equal(parseLine('3) Dark (TV Series 2017–2020)').mediaHint, 'tv');
  assert.equal(parseLine('3) Dark (TV Series 2017–2020)').year, 2017);
  assert.equal(parseLine('• Alien').title, 'Alien');
  assert.equal(parseLine('   '), null);
  assert.equal(parseLine('📺 Heading'), null);
});

const TAGS = [
  { id: '3er', label: '3er' },
  { id: 'partner', label: 'Girlfriend' },
  { id: 'solo', label: 'Alone' },
];

test('tags come from the note, otherwise the default; tag-only notes disappear', () => {
  assert.deepEqual(tagsForNote('alleine schauen', TAGS, '3er'), { watchWith: ['solo'], note: '' });
  assert.deepEqual(tagsForNote('alleine', TAGS, '3er'), { watchWith: ['solo'], note: '' });
  assert.deepEqual(tagsForNote('', TAGS, '3er'), { watchWith: ['3er'], note: '' });
  assert.deepEqual(tagsForNote('Anna rated 0/10 (Ben, Cleo scho gseh)', TAGS, '3er'), {
    watchWith: ['3er'],
    note: 'Anna rated 0/10 (Ben, Cleo scho gseh)',
  });
  assert.deepEqual(tagsForNote('with girlfriend. tip from Ben', TAGS, '3er'), {
    watchWith: ['partner'],
    note: 'tip from Ben',
  });
  assert.deepEqual(tagsForNote('', TAGS, null), { watchWith: [], note: '' });
  // A re-created "Alone" tag (new id) still understands "alleine".
  assert.deepEqual(tagsForNote('alleine', [{ id: 'tag-x1', label: 'Alone' }], null), { watchWith: ['tag-x1'], note: '' });
});

const result = (tmdbId, title, year, mediaType = 'movie', originalTitle = title) => ({
  tmdbId,
  title,
  year,
  mediaType,
  originalTitle,
  posterPath: null,
});

test('the best match prefers the same title and year', () => {
  const line = parseLine('Suspiria (1977)');
  const pick = bestMatch(line, [result(1, 'Suspiria', 2018), result(2, 'Suspiria', 1977)]);
  assert.equal(pick.match.tmdbId, 2);
  assert.equal(pick.sure, true);

  const loose = bestMatch(parseLine('Butterfly effect'), [result(3, 'The Butterfly Effect', 2004)]);
  assert.equal(loose.match.tmdbId, 3);
  assert.equal(loose.sure, true); // "The" is ignored when comparing

  const doubtful = bestMatch(parseLine('True detective?'), [result(4, 'True Detective', 2014, 'tv')]);
  assert.equal(doubtful.sure, false); // the "?" in the list asks for a look

  assert.deepEqual(bestMatch(parseLine('Nothing'), []), { match: null, sure: false });

  const remake = bestMatch(parseLine('Suspiria'), [result(1, 'Suspiria', 2018), result(2, 'Suspiria', 1977)]);
  assert.equal(remake.sure, false); // no year in the list, two films of that name
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

test('merging adds new titles, adds tags to listed ones, leaves watched ones alone', async () => {
  const store = await emptyStore();
  store.put('titles', { tmdbId: 10, mediaType: 'movie', title: 'Heat', status: 'watchlist', watchWith: ['partner'], notes: '' });
  store.put('titles', { tmdbId: 11, mediaType: 'movie', title: 'Alien', status: 'watched', rating: 9 });

  const lines = [
    { title: 'Heat', match: result(10, 'Heat', 1995), watchWith: ['3er'], note: 'tip from Ben' },
    { title: 'Alien', match: result(11, 'Alien', 1979), watchWith: ['3er'], note: '' },
    { title: 'Pi', match: result(12, 'Pi', 1998), watchWith: ['solo'], note: '' },
    { title: 'Rachel McAdams', match: null, watchWith: ['3er'], note: '' },
  ];
  const entries = lines.map((l, i) => toEntry(l, i, Date.parse('2026-11-12T20:00:00Z')));
  assert.equal(entries[0].createdAt > entries[2].createdAt, true); // first line counts as newest

  assert.deepEqual(mergeWatchlist(store, 'titles', entries), { added: 2, updated: 1, skipped: 1 });
  const by = Object.fromEntries(store.list('titles').map((t) => [t.title, t]));
  assert.deepEqual(by.Heat.watchWith, ['partner', '3er']);
  assert.equal(by.Heat.notes, 'tip from Ben');
  assert.equal(by.Alien.status, 'watched');
  assert.equal(by.Pi.status, 'watchlist');
  assert.deepEqual(by.Pi.watchWith, ['solo']);
  assert.equal(by['Rachel McAdams'].tmdbId, null);

  // Running it again changes nothing.
  assert.deepEqual(mergeWatchlist(store, 'titles', entries), { added: 0, updated: 0, skipped: 4 });
  await store.flush();
});
