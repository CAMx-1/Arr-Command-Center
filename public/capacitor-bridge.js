/*
 * Capacitor bridge (classic script, loaded before the app module).
 *
 * On the web (served by the Node backend) this is a no-op: the UI is same-origin
 * with the API, so relative "/api/..." requests work unchanged.
 *
 * Inside the native iOS/Android app the UI is served from capacitor://localhost,
 * which is NOT same-origin with your stack, so relative API/EventSource requests
 * are rewritten to a user-configured server base URL. If no server is configured
 * yet, a minimal first-run "Connect to your server" screen is shown.
 *
 * The server base is stored in localStorage under `acc:server-base`.
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

  // Public helper: absolutize an app-relative URL onto the configured base.
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

  // When running natively with a configured server, route relative API traffic
  // (fetch + EventSource) to that server. Absolute URLs (e.g. TMDB art) pass
  // through untouched.
  if (base) {
    if (window.fetch) {
      var _fetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        try {
          if (typeof input === 'string') input = window.accApiUrl(input);
          else if (input && typeof input.url === 'string' && input.url.charAt(0) === '/') input = new Request(window.accApiUrl(input.url), input);
        } catch (e) { /* fall through with original */ }
        return _fetch(input, init);
      };
    }
    if (window.EventSource) {
      var _ES = window.EventSource;
      var Wrapped = function (url, cfg) { return new _ES(window.accApiUrl(url), cfg); };
      Wrapped.prototype = _ES.prototype;
      window.EventSource = Wrapped;
    }
  }

  // First-run: native app with no server configured yet → show a connect screen
  // and stop the main app from booting into a broken (no-API) state.
  if (native && !base) {
    window.__ACC_SETUP_REQUIRED__ = true;
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
          '<div style="color:#b0b7c8;font-size:14px;margin-bottom:18px">Connect to your Arr Command Center server to get started.</div>' +
          '<label style="display:block;font-size:12px;color:#b0b7c8;margin-bottom:6px">Server URL</label>' +
          '<input id="acc-connect-url" type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://arrcc.example.com" ' +
            'style="width:100%;box-sizing:border-box;padding:14px 14px;font-size:16px;border-radius:12px;border:1px solid #4d576c;background:#252a39;color:#eceef4" />' +
          '<div id="acc-connect-err" style="color:#f87171;font-size:13px;min-height:18px;margin:8px 2px"></div>' +
          '<button id="acc-connect-go" style="width:100%;padding:15px;font-size:16px;font-weight:700;border:none;border-radius:12px;color:#fff;background:linear-gradient(90deg,#6366f1,#a855f7 55%,#ec4899);cursor:pointer">Connect</button>' +
        '</div>';
      document.body.appendChild(wrap);
      var input = document.getElementById('acc-connect-url');
      var err = document.getElementById('acc-connect-err');
      var go = document.getElementById('acc-connect-go');
      var submit = function () {
        var v = (input.value || '').trim();
        if (!/^https?:\/\/.+/i.test(v)) { err.textContent = 'Enter a full URL, e.g. https://host:7373'; return; }
        window.accSetServerBase(v);
        location.reload();
      };
      go.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
    };
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render);
  }
})();
