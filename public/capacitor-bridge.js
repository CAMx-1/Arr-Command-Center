/*
 * Capacitor bridge (classic script, loaded before the app module).
 *
 * Two runtime contexts:
 *
 * 1. WEB / same-origin — the UI is served by the Node backend (http/https). This
 *    is a no-op: relative "/api/..." requests and EventSource work unchanged, and
 *    both auth layers (Cloudflare Access, then "Sign in with Plex") happen via
 *    normal top-level navigation + cookies.
 *
 * 2. NATIVE bootstrap — the app launches from capacitor://localhost with only the
 *    bundled assets. That origin is NOT same-origin with your stack, so background
 *    fetches cannot complete the interactive Cloudflare Access (email OTP) or Plex
 *    logins, which require a real top-level navigation that can render pages and
 *    set cookies.
 *
 *    To make the interactive login work end to end, the native bootstrap does NOT
 *    try to proxy API calls from capacitor://localhost. Instead it:
 *      a. asks for the server URL (first run), then
 *      b. navigates the app's OWN WebView to that server origin.
 *
 *    From the server origin the flow is identical to the web/PWA experience:
 *    Cloudflare Access shows the email-code page → sets its CF_Authorization
 *    cookie → the server's Plex gate serves login.html → "Sign in with Plex" →
 *    the server sets the acc_session cookie → the server serves the real SPA
 *    (index.html) same-origin with the API. Because it is all one WKWebView, the
 *    cookies set during login are automatically carried by the app's subsequent
 *    fetches. No cross-origin cookie sharing is required.
 *
 * The server base is stored in localStorage under `acc:server-base` so relaunches
 * can jump straight back to the server (reusing a still-valid session) and the
 * user can switch servers later.
 */
(function () {
  var SERVER_KEY = 'acc:server-base';

  function isNative() {
    try {
      if (window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : window.Capacitor.isNative)) return true;
    } catch (e) { /* ignore */ }
    var p = (location.protocol || '').toLowerCase();
    return p === 'capacitor:' || p === 'ionic:';
  }

  function storedBase() {
    try { return (localStorage.getItem(SERVER_KEY) || '').replace(/\/+$/, ''); } catch (e) { return ''; }
  }

  var native = isNative();
  var base = native ? storedBase() : '';

  // Public helpers (kept for API compatibility; used only in the native
  // bootstrap context, which no longer performs same-origin fetch rewriting).
  window.accApiUrl = function (u) {
    if (!base || typeof u !== 'string') return u;
    if (/^[a-z]+:\/\//i.test(u) || /^(data|blob):/i.test(u)) return u; // already absolute
    if (u.charAt(0) === '/') return base + u;
    return u;
  };
  window.__ACC_NATIVE__ = native;
  window.__ACC_API_BASE__ = base;
  window.accSetServerBase = function (url) {
    try { localStorage.setItem(SERVER_KEY, String(url || '').replace(/\/+$/, '')); } catch (e) { /* ignore */ }
  };
  window.accClearServerBase = function () {
    try { localStorage.removeItem(SERVER_KEY); } catch (e) { /* ignore */ }
  };

  // Navigate the app's own WebView to the server origin. This performs the real
  // top-level navigation that the interactive Cloudflare Access + Plex logins
  // need, and lands the app same-origin with its API once authenticated.
  window.accGoToServer = function (url) {
    var b = String(url || base || '').replace(/\/+$/, '');
    if (!b) return;
    // A dedicated query flag lets the server origin know this navigation came
    // from the native shell (harmless on web; useful for future tweaks/telemetry).
    try { window.location.href = b + '/?acc_native=1'; } catch (e) { /* ignore */ }
  };

  // ---------------------------------------------------------------------------
  // NATIVE bootstrap only. On the server origin (http/https) this whole block is
  // skipped and the app behaves exactly like the web build.
  // ---------------------------------------------------------------------------
  if (!native) return;

  // Stop the SPA from booting into a broken (no-API) state on capacitor://localhost.
  window.__ACC_SETUP_REQUIRED__ = true;

  // Already configured → jump straight to the server. If the stored session is
  // still valid, the server serves the app immediately; otherwise the user is
  // taken through Cloudflare Access + Plex again.
  if (base) {
    var jump = function () { window.accGoToServer(base); };
    if (document.body) jump();
    else document.addEventListener('DOMContentLoaded', jump);
    return;
  }

  // First run: no server configured yet → show the connect screen.
  var render = function () {
    if (document.getElementById('acc-connect')) return;
    var wrap = document.createElement('div');
    wrap.id = 'acc-connect';
    wrap.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:99999',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:24px', 'box-sizing:border-box',
      'background:#0f1117', 'color:#eceef4',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
      '-webkit-user-select:none'
    ].join(';'));
    wrap.innerHTML =
      '<div style="width:100%;max-width:420px">' +
        '<div style="font-size:22px;font-weight:800;margin-bottom:6px">Arr Command Center</div>' +
        '<div style="color:#b0b7c8;font-size:14px;margin-bottom:18px">Connect to your Arr Command Center server to get started. You\'ll sign in on the next screen.</div>' +
        '<label style="display:block;font-size:12px;color:#b0b7c8;margin-bottom:6px">Server URL</label>' +
        '<input id="acc-connect-url" type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://arrcc.example.com" ' +
          'style="width:100%;box-sizing:border-box;padding:14px 14px;font-size:16px;border-radius:12px;border:1px solid #4d576c;background:#252a39;color:#eceef4" />' +
        '<div id="acc-connect-err" style="color:#f87171;font-size:13px;min-height:18px;margin:8px 2px"></div>' +
        '<button id="acc-connect-go" style="width:100%;padding:15px;font-size:16px;font-weight:700;border:none;border-radius:12px;color:#fff;background:linear-gradient(90deg,#6366f1,#a855f7 55%,#ec4899);cursor:pointer">Continue to sign in</button>' +
      '</div>';
    document.body.appendChild(wrap);
    var input = document.getElementById('acc-connect-url');
    var err = document.getElementById('acc-connect-err');
    var go = document.getElementById('acc-connect-go');
    var submit = function () {
      var v = (input.value || '').trim();
      if (!/^https?:\/\/.+/i.test(v)) { err.textContent = 'Enter a full URL, e.g. https://host:7373'; return; }
      v = v.replace(/\/+$/, '');
      window.accSetServerBase(v);
      err.textContent = '';
      go.textContent = 'Opening…';
      go.disabled = true;
      // Navigate the WebView to the server so Cloudflare Access + Plex can run.
      window.accGoToServer(v);
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
  };
  if (document.body) render();
  else document.addEventListener('DOMContentLoaded', render);
})();
