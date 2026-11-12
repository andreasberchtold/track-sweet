#!/usr/bin/env node
// Download your SIMKL lists (watched, watching, watchlist, ratings, notes)
// into one JSON file that the movie tracker can import.
//
//   node scripts/simkl-export.mjs <client-id>
//
// The client ID comes from an "app" you create once in your SIMKL account
// (Settings, Developer). The script shows a short code; you confirm it at
// https://simkl.com/pin while logged in. Nothing is stored except the
// export file itself, which .gitignore keeps out of the repository.
//
// Needs Node.js 20 or newer. No dependencies.

import { writeFile } from 'node:fs/promises';

const API = 'https://api.simkl.com';
const clientId = process.argv[2];
const outFile = process.argv[3] || 'simkl-export.json';

if (!clientId) {
  console.error('Usage: node scripts/simkl-export.mjs <client-id> [output-file]');
  process.exit(1);
}

const common = { client_id: clientId, 'app-name': 'personal-apps', 'app-version': '1.0' };
const headers = { 'User-Agent': 'personal-apps/1.0', 'simkl-api-key': clientId };

async function get(path, params = {}, extraHeaders = {}) {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries({ ...common, ...params })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { ...headers, ...extraHeaders } });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!response.ok) {
    throw new Error(`SIMKL answered ${response.status}: ${body?.message || body?.error || text.slice(0, 200)}`);
  }
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  // 1. Ask for a code and wait until it is confirmed on simkl.com/pin.
  const pin = await get('/oauth/pin');
  if (!pin?.user_code) throw new Error(`SIMKL did not return a code: ${JSON.stringify(pin)}`);
  const where = pin.verification_uri || pin.verification_url || 'https://simkl.com/pin';
  console.log(`\nOpen ${where} and enter this code:  ${pin.user_code}\n`);
  console.log('Waiting for you to confirm...');

  const interval = (Number(pin.interval) || 5) * 1000;
  const deadline = Date.now() + (Number(pin.expires_in) || 900) * 1000;
  let token = null;
  while (!token) {
    if (Date.now() > deadline) throw new Error('The code expired before it was confirmed. Run the script again.');
    await sleep(interval);
    const answer = await get(`/oauth/pin/${encodeURIComponent(pin.user_code)}`);
    if (answer?.access_token) token = answer.access_token;
    else if (answer?.device_code) throw new Error('The code is no longer valid. Run the script again.');
  }

  // 2. One request for everything, including running times and notes.
  console.log('Confirmed. Downloading your lists...');
  const data = await get(
    '/sync/all-items/',
    { extended: 'full', memos: 'yes' },
    { Authorization: `Bearer ${token}` },
  );

  const count = (key) => (Array.isArray(data?.[key]) ? data[key].length : 0);
  await writeFile(outFile, `${JSON.stringify(data ?? {}, null, 2)}\n`);
  console.log(
    `\nSaved ${outFile}: ${count('movies')} movies, ${count('shows')} series, ${count('anime')} anime.` +
      '\nImport it in the movie tracker: Menu, "Import from SIMKL".' +
      '\nYou can remove this app again in your SIMKL account under Connected Apps.',
  );
} catch (err) {
  console.error(`\n${err.message}`);
  process.exit(1);
}
