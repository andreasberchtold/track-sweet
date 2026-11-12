// Version display and "is a newer version deployed?" check.
//
// core/version.js describes the code that is running (it is loaded with the
// rest of the code, so it is exactly as old as that code). version.json at
// the site root describes what is deployed right now; it is fetched past
// every cache. If the two differ, a newer version is waiting.

import running from './version.js';

const DEPLOYED_URL = new URL('../version.json', import.meta.url);

export { running };

export function isDev(v = running) {
  return !v?.commit || v.commit === 'dev';
}

/** "Version 1a2b3c4, deployed 12 Nov 2026, 14:50" */
export function describe(v = running) {
  if (isDev(v)) return 'Development version, not deployed';
  const when = v.date
    ? new Date(v.date).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  return `Version ${v.commit}${when ? `, deployed ${when}` : ''}`;
}

/** The deployed version, or null when it cannot be known (offline, local copy). */
export async function deployed(fetchImpl = (...args) => globalThis.fetch(...args)) {
  try {
    const response = await fetchImpl(DEPLOYED_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    const info = await response.json();
    return info?.commit ? info : null;
  } catch {
    return null;
  }
}

/** The deployed version if it is newer than the running one, otherwise null. */
export async function newerVersion(fetchImpl) {
  if (isDev()) return null;
  const latest = await deployed(fetchImpl);
  return latest && latest.commit !== running.commit ? latest : null;
}

/**
 * Reload the page and make sure the browser fetches every file again
 * instead of reusing copies from its cache (GitHub Pages lets browsers keep
 * files for up to ten minutes).
 */
export async function reloadFresh() {
  const origin = location.origin;
  const urls = new Set([location.href.split('#')[0]]);
  for (const entry of performance.getEntriesByType('resource')) {
    if (entry.name.startsWith(origin)) urls.add(entry.name);
  }
  await Promise.allSettled([...urls].map((url) => fetch(url, { cache: 'reload' })));
  location.reload();
}
