#!/usr/bin/env node
// Create a new app from apps/_template.
//
//   node scripts/new-app.mjs health "Headache journal"
//
// The first argument is the app's id: it becomes the folder name, the web
// address (/apps/health/) and the file name in Drive (health.json).

import { cp, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [id, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim();

if (!id || !name) {
  console.error('Usage: node scripts/new-app.mjs <id> "<Name>"\nExample: node scripts/new-app.mjs health "Headache journal"');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) {
  console.error('The id must be lowercase letters, digits and dashes, starting with a letter (for example "health").');
  process.exit(1);
}

const source = join(root, 'apps', '_template');
const target = join(root, 'apps', id);
if (await exists(target)) {
  console.error(`apps/${id} already exists.`);
  process.exit(1);
}

await cp(source, target, { recursive: true });
for (const file of ['index.html', 'app.js', 'manifest.webmanifest']) {
  const path = join(target, file);
  const text = await readFile(path, 'utf8');
  const safeName = file === 'index.html' ? escapeHtml(name) : file === 'manifest.webmanifest' ? escapeJson(name) : escapeJs(name);
  await writeFile(path, text.replaceAll('__APP_ID__', id).replaceAll('__APP_NAME__', safeName));
}

const listPath = join(root, 'apps.json');
const list = JSON.parse(await readFile(listPath, 'utf8'));
list.push({ id, name });
await writeFile(listPath, `${JSON.stringify(list, null, 2)}\n`);

console.log(`Created apps/${id} ("${name}") and added it to apps.json.
Try it:  node scripts/serve.mjs   then open http://localhost:8080/apps/${id}/
Icons:   python3 scripts/make-icons.py apps/${id} "#1d2440" "#9fb0ff"   (optional, pick your colours)`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeJson(s) {
  return JSON.stringify(s).slice(1, -1);
}
function escapeJs(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
