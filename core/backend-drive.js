// Storage backend for Google Drive (REST API v3, called from the browser).
//
// Each app keeps one JSON file, "<fileName>", inside the folder
// "<folderName>" in the user's Drive. With the drive.file permission the
// app can only see files it created itself, never the rest of the Drive.
//
// "rev" is Drive's headRevisionId, which changes whenever the file content
// changes. The store compares it before saving to notice edits made on
// another device.

import { AuthError, NetworkError } from './util.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const META_FIELDS = 'id,headRevisionId,version,modifiedTime,trashed,parents';

export function createDriveBackend({
  auth,
  folderName,
  fileName,
  fetchImpl = (...args) => globalThis.fetch(...args),
  cache = safeLocalStorage(),
}) {
  const cacheKey = `pa:drive:${folderName}/${fileName}`;
  let fileId = cache?.getItem(cacheKey) || null;
  let folderId = null;

  async function request(url, options = {}) {
    const token = auth.getToken();
    if (!token) throw new AuthError();
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new NetworkError(err?.message || 'Network unavailable');
    }
    if (response.status === 401) {
      auth.invalidate();
      throw new AuthError('The Google sign-in has expired.');
    }
    return response;
  }

  async function json(url, options) {
    const response = await request(url, options);
    if (!response.ok) throw await httpError(response);
    return response.json();
  }

  function rememberFile(id) {
    fileId = id;
    if (id) cache?.setItem(cacheKey, id);
    else cache?.removeItem(cacheKey);
  }

  const revOf = (meta) => meta.headRevisionId || meta.version || meta.modifiedTime || null;

  /** Metadata of the data file, or null when it does not exist (any more). */
  async function fileMeta() {
    if (fileId) {
      const response = await request(`${API}/files/${fileId}?fields=${META_FIELDS}`);
      if (response.ok) {
        const meta = await response.json();
        if (!meta.trashed) {
          folderId ??= meta.parents?.[0] ?? null;
          return meta;
        }
      } else if (response.status !== 404) {
        throw await httpError(response);
      }
      rememberFile(null);
    }
    const folder = await findFolder();
    if (!folder) return null;
    const q = `name = '${escapeQuery(fileName)}' and '${folder}' in parents and trashed = false`;
    const found = await json(
      `${API}/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=1&fields=files(${META_FIELDS})`,
    );
    const meta = found.files?.[0] ?? null;
    if (meta) rememberFile(meta.id);
    return meta;
  }

  async function findFolder() {
    if (folderId) return folderId;
    const q = `name = '${escapeQuery(folderName)}' and mimeType = '${FOLDER_TYPE}' and trashed = false`;
    const found = await json(
      `${API}/files?q=${encodeURIComponent(q)}&orderBy=createdTime&pageSize=1&fields=files(id)`,
    );
    folderId = found.files?.[0]?.id ?? null;
    return folderId;
  }

  async function ensureFolder() {
    if (await findFolder()) return folderId;
    const created = await json(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, mimeType: FOLDER_TYPE }),
    });
    folderId = created.id;
    return folderId;
  }

  async function createFile(body) {
    const parent = await ensureFolder();
    const boundary = `pa-${Math.random().toString(36).slice(2)}`;
    const metadata = { name: fileName, mimeType: 'application/json', parents: [parent] };
    const multipart = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      body,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const meta = await json(`${UPLOAD}/files?uploadType=multipart&fields=${META_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    rememberFile(meta.id);
    return meta;
  }

  return {
    name: 'Google Drive',

    async load() {
      const meta = await fileMeta();
      if (!meta) return { content: null, rev: null };
      const response = await request(`${API}/files/${meta.id}?alt=media`);
      if (response.status === 404) {
        rememberFile(null);
        return { content: null, rev: null };
      }
      if (!response.ok) throw await httpError(response);
      const text = await response.text();
      let content;
      try {
        content = text.trim() ? JSON.parse(text) : null;
      } catch {
        throw new Error(`"${fileName}" in Google Drive is not valid JSON. Fix or remove the file, then reload.`);
      }
      return { content, rev: revOf(meta) };
    },

    async getRev() {
      const meta = await fileMeta();
      return meta ? revOf(meta) : null;
    },

    async save(content) {
      const body = JSON.stringify(content, null, 2);
      if (fileId) {
        const response = await request(
          `${UPLOAD}/files/${fileId}?uploadType=media&fields=${META_FIELDS}`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body },
        );
        if (response.ok) return revOf(await response.json());
        if (response.status !== 404) throw await httpError(response);
        rememberFile(null);
      }
      return revOf(await createFile(body));
    },

    /** The signed-in Google account, used as the sign-in hint next time. */
    async account() {
      const about = await json(`${API}/about?fields=user(emailAddress,displayName)`);
      return about.user ?? null;
    },

    /** Link to the data folder in the Drive web interface, once known. */
    folderUrl() {
      return folderId ? `https://drive.google.com/drive/folders/${folderId}` : null;
    },
  };
}

function escapeQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function httpError(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message ?? '';
  } catch {
    // no JSON body
  }
  const error = new Error(`Google Drive answered ${response.status}${detail ? `: ${detail}` : ''}`);
  error.status = response.status;
  return error;
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
