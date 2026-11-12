// Storage backend that keeps the document in the browser (localStorage).
// Used in demo mode, before a Google client ID is configured, and in tests.

export function createLocalBackend(key, storage = globalThis.localStorage) {
  function read() {
    const raw = storage.getItem(key);
    if (!raw) return { content: null, rev: null };
    try {
      const parsed = JSON.parse(raw);
      return { content: parsed.content ?? null, rev: parsed.rev ?? null };
    } catch {
      return { content: null, rev: null };
    }
  }

  return {
    name: 'This browser',
    async load() {
      return read();
    },
    async getRev() {
      return read().rev;
    },
    async save(content) {
      const rev = String((Number(read().rev) || 0) + 1);
      storage.setItem(key, JSON.stringify({ rev, content }));
      return rev;
    },
  };
}

/** A minimal in-memory stand-in for localStorage (tests, private mode). */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}
