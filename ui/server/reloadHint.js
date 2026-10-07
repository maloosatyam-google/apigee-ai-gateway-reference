/**
 * Tells the page whether it was loaded with a hard refresh (Cmd/Ctrl+Shift+R).
 *
 * Browsers do not expose hard vs normal reload to JavaScript, but a hard
 * refresh bypasses the cache and requests every resource with
 * `Cache-Control: no-cache` / `Pragma: no-cache`. A normal load or reload sends
 * neither (at most `max-age=0`). index.html loads /reload-hint.js before the
 * app, so the app can reset session-style choices on a hard refresh only.
 *
 * Note: DevTools "Disable cache" also sends no-cache, so with it on every
 * reload counts as hard.
 */
export function isHardReload(headers = {}) {
  const cc = String(headers['cache-control'] || '').toLowerCase();
  const pragma = String(headers.pragma || '').toLowerCase();
  return /\bno-cache\b/.test(cc) || /\bno-cache\b/.test(pragma);
}

/** Node http handler for GET /reload-hint.js. */
export function handleReloadHint(req, res) {
  res.setHeader('Content-Type', 'text/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`window.__HARD_RELOAD__ = ${isHardReload(req.headers) ? 'true' : 'false'};`);
}
