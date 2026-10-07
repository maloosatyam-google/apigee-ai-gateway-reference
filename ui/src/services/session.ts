// Session expiry recovery.
//
// The UI sits behind IAP, whose session expires roughly every 24 hours. When it
// does, `/api/me` no longer returns JSON -- IAP answers with a 302 to the Google
// sign-in page, so `fetch` follows it and hands back an HTML document (or throws
// on a cross-origin block). The old code only acted when the content-type was
// JSON, so an expired session looked exactly like "no data": the app rendered
// with no identity and no API key, and every gateway call failed until the user
// manually reloaded.
//
// A full-page navigation is what actually fixes it: only a top-level request
// lets IAP run its redirect handshake and reissue the cookie. `fetch` cannot.

const RELOAD_MARKER = 'gateway-ui:last-session-reload';

/** Minimum gap between automatic reloads, to make a redirect loop impossible. */
const RELOAD_COOLDOWN_MS = 60_000;

/**
 * True when a response indicates the IAP session is gone rather than the
 * endpoint genuinely failing.
 *
 * Note `res.ok` is deliberately not trusted: the sign-in page comes back as a
 * perfectly valid 200.
 */
export function isSessionExpiredResponse(res: Response): boolean {
  if (res.status === 401 || res.status === 403) return true;

  // Followed a redirect off our own origin -> that's the identity provider.
  if (res.redirected) {
    try {
      if (new URL(res.url).origin !== window.location.origin) return true;
    } catch {
      return true;
    }
  }

  // Our API always answers JSON. HTML here means we were served a login page.
  const contentType = res.headers.get('content-type') || '';
  return !contentType.includes('application/json');
}

/**
 * Reload the page so IAP can re-authenticate, unless we already did so very
 * recently. Returns true if a reload was triggered.
 */
export function recoverExpiredSession(reason: string): boolean {
  if (typeof window === 'undefined') return false;

  const last = Number(window.sessionStorage.getItem(RELOAD_MARKER) || 0);
  const elapsed = Date.now() - last;

  if (last && elapsed < RELOAD_COOLDOWN_MS) {
    // Reloading again would just bounce us between here and the IdP.
    console.warn(
      `[session] Session still unauthenticated ${Math.round(elapsed / 1000)}s after a reload (${reason}). ` +
      'Not reloading again -- sign in manually if this persists.'
    );
    return false;
  }

  console.warn(`[session] SSO session expired (${reason}); reloading to re-authenticate.`);
  window.sessionStorage.setItem(RELOAD_MARKER, String(Date.now()));
  window.location.reload();
  return true;
}

/** Clear the cooldown once we have positively confirmed a live session. */
export function markSessionHealthy(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(RELOAD_MARKER);
}
