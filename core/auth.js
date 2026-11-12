// Google sign-in for the browser, using Google Identity Services (GIS).
//
// The app asks Google for a short-lived access token (about one hour) that
// is limited to the drive.file permission. The token is kept in memory
// only. Nothing but the account's email address is stored on the device,
// and that only so the next sign-in can skip the account chooser.
//
// GIS is the one script loaded from outside this site. Google requires it
// to be loaded from accounts.google.com.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const HINT_KEY = 'pa:auth:hint';
const EXPIRY_MARGIN_MS = 60_000;

export function createAuth({
  clientId,
  storage = safeLocalStorage(),
  loadGoogle = loadGisScript,
  now = () => Date.now(),
}) {
  let token = null;
  let expiresAt = 0;
  let client = null;
  let inFlight = null;
  let settle = null;

  function finish(result) {
    const done = settle;
    settle = null;
    inFlight = null;
    done?.(result);
  }

  async function init() {
    if (client) return;
    const google = await loadGoogle();
    client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response?.access_token) {
          token = response.access_token;
          expiresAt = now() + (Number(response.expires_in) || 3600) * 1000 - EXPIRY_MARGIN_MS;
          finish({ ok: true });
        } else {
          finish({ ok: false, reason: response?.error || 'unknown' });
        }
      },
      error_callback: (error) => {
        // error.type: popup_failed_to_open | popup_closed | unknown
        finish({ ok: false, reason: error?.type || 'unknown' });
      },
    });
  }

  /**
   * Ask Google for an access token.
   *
   * interactive: true  - called from a tap; Google may show its dialogs.
   * interactive: false - a quiet attempt at start-up. It succeeds when the
   *   browser lets the Google window open and the account already agreed;
   *   otherwise it resolves { ok: false } and the app shows a button.
   */
  function request({ interactive = true } = {}) {
    if (inFlight) return inFlight;
    inFlight = new Promise((resolve) => {
      settle = resolve;
    });
    const promise = inFlight;
    init()
      .then(() => {
        const hint = getHint();
        const options = { prompt: '' };
        if (hint) {
          options.login_hint = hint;
          options.hint = hint;
        } else if (interactive) {
          options.prompt = 'select_account';
        }
        client.requestAccessToken(options);
      })
      .catch((err) => finish({ ok: false, reason: err?.message || 'gis_unavailable' }));
    return promise;
  }

  function getToken() {
    return token && now() < expiresAt ? token : null;
  }

  function getHint() {
    return storage?.getItem(HINT_KEY) || null;
  }

  return {
    init,
    request,
    getToken,
    getHint,
    setHint(email) {
      if (email) storage?.setItem(HINT_KEY, email);
    },
    /** Forget the current token (for example after Drive answered 401). */
    invalidate() {
      token = null;
      expiresAt = 0;
    },
    signOut() {
      token = null;
      expiresAt = 0;
      storage?.removeItem(HINT_KEY);
    },
  };
}

function loadGisScript() {
  return new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.oauth2) {
      resolve(globalThis.google);
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      if (globalThis.google?.accounts?.oauth2) resolve(globalThis.google);
      else reject(new Error('Google sign-in did not load correctly.'));
    };
    script.onerror = () => reject(new Error('Google sign-in could not be loaded. Check the connection.'));
    document.head.append(script);
  });
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
