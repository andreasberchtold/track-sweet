// The document store: one JSON document per app, kept in memory and saved
// through a storage backend (Google Drive, or the browser in demo mode).
//
// Every change is an "operation" (put a record, remove a record, set a
// setting). Operations are applied to the in-memory document at once, then
// saved shortly after. Before each save the store asks the backend whether
// the file changed since it was loaded (for example from another device).
// If it did, the store loads the newer file and re-applies the operations
// that are still waiting, so a stale copy never overwrites newer data.
//
// A backend is any object with:
//   load()        -> { content: object | null, rev: string | null }
//   getRev()      -> string | null      (cheap "did it change?" check)
//   save(content) -> string             (the new rev; creates the file if missing)

import { AuthError, NetworkError, NewerDataError, uid } from './util.js';

const RETRY_DELAYS = [3000, 8000, 20000, 60000];

/** Apply one operation to a document, in place. */
export function applyOp(doc, op) {
  switch (op.type) {
    case 'put': {
      const list = (doc.collections[op.collection] ??= []);
      const index = list.findIndex((r) => r.id === op.record.id);
      if (index === -1) list.push(op.record);
      else list[index] = op.record;
      break;
    }
    case 'remove': {
      const list = doc.collections[op.collection];
      if (!list) break;
      const index = list.findIndex((r) => r.id === op.id);
      if (index !== -1) list.splice(index, 1);
      break;
    }
    case 'set':
      if (op.value === undefined || op.value === null) delete doc.settings[op.key];
      else doc.settings[op.key] = op.value;
      break;
    default:
      throw new Error(`Unknown operation: ${op.type}`);
  }
  return doc;
}

export function createStore({
  backend,
  appId,
  schemaVersion = 1,
  migrations = {},
  collections = [],
  debounceMs = 600,
}) {
  let doc = null;
  let rev = null;
  let pending = [];
  let running = null;
  let saveTimer = null;
  let retryTimer = null;
  let retryCount = 0;
  let changes = 0;
  let status = { state: 'idle', message: '' };
  const listeners = new Set();

  function emptyDoc() {
    return {
      app: appId,
      schemaVersion,
      savedAt: null,
      settings: {},
      collections: Object.fromEntries(collections.map((name) => [name, []])),
    };
  }

  /** Turn file content into a current-format document. Returns [doc, changed]. */
  function normalize(content) {
    if (content === null || content === undefined) return [emptyDoc(), true];
    if (typeof content !== 'object' || Array.isArray(content)) {
      throw new Error('The data file is not a valid document.');
    }
    if (content.app && content.app !== appId) {
      throw new Error(`The data file belongs to "${content.app}", not "${appId}".`);
    }
    let next = structuredClone(content);
    const found = Number(next.schemaVersion) || 1;
    if (found > schemaVersion) throw new NewerDataError(found, schemaVersion);
    let changed = false;
    for (let v = found + 1; v <= schemaVersion; v += 1) {
      const migrate = migrations[v];
      if (migrate) next = migrate(next) ?? next;
      next.schemaVersion = v;
      changed = true;
    }
    next.app = appId;
    next.schemaVersion = schemaVersion;
    next.settings ??= {};
    next.collections ??= {};
    for (const name of collections) next.collections[name] ??= [];
    return [next, changed];
  }

  function setStatus(state, message = '') {
    status = { state, message };
    notify();
  }

  function notify() {
    for (const fn of listeners) fn({ status, doc });
  }

  function requireLoaded() {
    if (!doc) throw new Error('The store is not loaded yet.');
  }

  async function load() {
    setStatus('loading');
    try {
      const loaded = await backend.load();
      const [next, changed] = normalize(loaded.content);
      doc = next;
      rev = loaded.rev;
      changes += 1;
      if (changed) {
        doc.savedAt = new Date().toISOString();
        rev = await backend.save(structuredClone(doc));
      }
      setStatus('saved');
      return doc;
    } catch (err) {
      setStatus(stateFor(err), err.message);
      throw err;
    }
  }

  function apply(op) {
    requireLoaded();
    applyOp(doc, op);
    changes += 1;
    pending.push(op);
    setStatus('saving');
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    saveTimer = setTimeout(run, debounceMs);
    saveTimer?.unref?.();
  }

  function run() {
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    if (!running) {
      running = saveLoop().finally(() => {
        running = null;
      });
    }
    return running;
  }

  async function saveLoop() {
    try {
      while (pending.length) {
        setStatus('saving');
        const remoteRev = await backend.getRev();
        if (remoteRev !== rev) {
          const loaded = await backend.load();
          // content === null means the file is gone; the copy in memory is
          // then the only one, so keep it and let save() recreate the file.
          if (loaded.content !== null) {
            const [base] = normalize(loaded.content);
            for (const op of pending) applyOp(base, op);
            doc = base;
            changes += 1;
          }
          rev = loaded.rev;
        }
        const count = pending.length;
        doc.savedAt = new Date().toISOString();
        const snapshot = structuredClone(doc);
        rev = await backend.save(snapshot);
        pending.splice(0, count);
      }
      retryCount = 0;
      setStatus('saved');
      return true;
    } catch (err) {
      const state = stateFor(err);
      setStatus(state, err.message);
      // A newer-format file will not fix itself by retrying.
      const retryable = state === 'offline' || (state === 'error' && !(err instanceof NewerDataError));
      if (retryable) scheduleRetry();
      return false;
    }
  }

  function scheduleRetry() {
    const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
    retryCount += 1;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(run, delay);
    retryTimer?.unref?.();
  }

  /** Pick up changes made elsewhere. Does nothing while a save is waiting. */
  async function refresh() {
    if (!doc || running || pending.length) return false;
    try {
      const remoteRev = await backend.getRev();
      if (remoteRev === rev) return false;
      const loaded = await backend.load();
      if (pending.length || loaded.content === null) return false;
      const [next] = normalize(loaded.content);
      doc = next;
      rev = loaded.rev;
      changes += 1;
      setStatus('saved');
      return true;
    } catch (err) {
      if (err instanceof AuthError) setStatus('auth', err.message);
      return false;
    }
  }

  return {
    load,
    refresh,
    /** Save now. Resolves true when everything is written. */
    flush: () => (pending.length || running ? run() : Promise.resolve(true)),
    /** Try again after a failed save (for example after reconnecting). */
    retry: () => (pending.length ? run() : Promise.resolve(true)),

    get doc() {
      return doc;
    },
    get status() {
      return status;
    },
    /** Goes up whenever the document content changes. Cheap "should I re-render?" check. */
    get changes() {
      return changes;
    },
    get hasUnsaved() {
      return pending.length > 0;
    },

    list(collection) {
      requireLoaded();
      return doc.collections[collection] ?? [];
    },
    get(collection, id) {
      return this.list(collection).find((r) => r.id === id) ?? null;
    },
    /** Create or update a record. Returns the stored record. */
    put(collection, fields) {
      requireLoaded();
      const now = new Date().toISOString();
      const existing = fields.id ? this.get(collection, fields.id) : null;
      const record = {
        ...existing,
        ...fields,
        id: fields.id ?? uid(),
        createdAt: existing?.createdAt ?? fields.createdAt ?? now,
        updatedAt: now,
      };
      apply({ type: 'put', collection, record });
      return record;
    },
    remove(collection, id) {
      apply({ type: 'remove', collection, id });
    },
    setting(key, fallback = null) {
      requireLoaded();
      return doc.settings[key] ?? fallback;
    },
    setSetting(key, value) {
      apply({ type: 'set', key, value });
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function stateFor(err) {
  if (err instanceof AuthError) return 'auth';
  if (err instanceof NetworkError) return 'offline';
  return 'error';
}
