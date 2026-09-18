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
  var MODE_KEY = 'acc:app-mode';
  var FALLBACK_KEY = 'acc:local-fallback';
  var CONNECTIONS_KEY = 'acc:connections';
  var FALLBACK_META_KEY = 'acc:local-fallback-meta';

  // The "bootstrap" context is ONLY the local Capacitor shell loaded from
  // capacitor://localhost (or ionic://). On the real server origin (http/https)
  // the Capacitor JS bridge is still injected because the server domain is in
  // allowNavigation — so we must NOT rely on window.Capacitor here. Detect the
  // bootstrap purely by URL scheme; on http(s) this is the normal web app and
  // the bridge is a no-op.
  function isBootstrap() {
    var p = (location.protocol || '').toLowerCase();
    return p === 'capacitor:' || p === 'ionic:';
  }

  function storedBase() {
    try { return (localStorage.getItem(SERVER_KEY) || '').replace(/\/+$/, ''); } catch (e) { return ''; }
  }

  function preferencesPlugin() {
    try { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences; } catch (e) { return null; }
  }

  function preferredBase() {
    var prefs = preferencesPlugin();
    if (!prefs || typeof prefs.get !== 'function') return Promise.resolve('');
    return prefs.get({ key: SERVER_KEY }).then(function (result) {
      return String((result && result.value) || '').replace(/\/+$/, '');
    }).catch(function () { return ''; });
  }


  function preferenceValue(key) {
    var prefs = preferencesPlugin();
    if (!prefs || typeof prefs.get !== 'function') return Promise.resolve('');
    return prefs.get({ key: key }).then(function (result) { return String((result && result.value) || ''); }).catch(function () { return ''; });
  }

  function persistMode(value) {
    try { localStorage.setItem(MODE_KEY, value); } catch (e) { /* ignore */ }
    var prefs = preferencesPlugin();
    if (prefs && typeof prefs.set === 'function') return prefs.set({ key: MODE_KEY, value: value }).catch(function () {});
    return Promise.resolve();
  }

  function installFallback(raw) {
    if (!raw) return false;
    try {
      var snapshot = JSON.parse(raw);
      if (!snapshot || snapshot.version !== 1 || !snapshot.connections || typeof snapshot.connections !== 'object') return false;
      localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(snapshot.connections));
      var prefs = snapshot.preferences || {};
      Object.keys(prefs).forEach(function (key) { if (typeof prefs[key] === 'string') localStorage.setItem(key, prefs[key]); });
      localStorage.setItem(FALLBACK_KEY, raw);
      localStorage.setItem(FALLBACK_META_KEY, JSON.stringify({ syncedAt: snapshot.syncedAt || '', serviceCount: Object.keys(snapshot.connections).length, skipped: snapshot.skipped || [] }));
      return Object.keys(snapshot.connections).length > 0;
    } catch (e) { return false; }
  }

  function serverReachable(origin, timeoutMs) {
    if (!origin || typeof fetch !== 'function') return Promise.resolve(false);
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { try { controller && controller.abort(); } catch (e) {} }, timeoutMs || 1800);
    return fetch(origin + '/healthcheck?acc_probe=' + Date.now(), { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function () { clearTimeout(timer); return true; })
      .catch(function () { clearTimeout(timer); return false; });
  }

  var native = isBootstrap();
  var base = native ? storedBase() : '';

  // Public helpers work from both the local shell and an allowed remote server
  // origin. Preferences is native shared storage, unlike origin-scoped
  // localStorage, so Settings can change the server used by the next launch.
  window.accApiUrl = function (u) {
    if (!base || typeof u !== 'string') return u;
    if (/^[a-z]+:\/\//i.test(u) || /^(data|blob):/i.test(u)) return u;
    if (u.charAt(0) === '/') return base + u;
    return u;
  };
  window.__ACC_NATIVE__ = native;
  window.__ACC_API_BASE__ = base;
  window.accSetServerBase = function (url) {
    var value = String(url || '').replace(/\/+$/, '');
    base = value;
    try { localStorage.setItem(SERVER_KEY, value); } catch (e) { /* ignore */ }
    var prefs = preferencesPlugin();
    if (prefs && typeof prefs.set === 'function') return prefs.set({ key: SERVER_KEY, value: value }).catch(function () {});
    return Promise.resolve();
  };
  window.accClearServerBase = function () {
    base = '';
    try { localStorage.removeItem(SERVER_KEY); } catch (e) { /* ignore */ }
    var prefs = preferencesPlugin();
    if (prefs && typeof prefs.remove === 'function') return prefs.remove({ key: SERVER_KEY }).catch(function () {});
    return Promise.resolve();
  };

  // Navigate the app's own WebView to the server origin. This performs the real
  // top-level navigation that the interactive Cloudflare Access + Plex logins
  // need, and lands the app same-origin with its API once authenticated.
  window.accGoToServer = function (url) {
    var b = String(url || base || '').replace(/\/+$/, '');
    if (!b) return;
    // WKWebView may preserve the last server document across an app reinstall or
    // rebuild. Give every native launch a unique document URL so it cannot
    // restore an old HTML/module graph after the server has been updated.
    // `replace` also keeps the local bootstrap out of the Back history.
    var target = b + '/?acc_native=1&acc_launch=' + Date.now();
    try {
      if (window.location && typeof window.location.replace === 'function') window.location.replace(target);
      else window.location.href = target;
    } catch (e) { /* ignore */ }
  };

  // ---------------------------------------------------------------------------
  // NATIVE bootstrap only. On the server origin (http/https) this whole block is
  // skipped and the app behaves exactly like the web build.
  // ---------------------------------------------------------------------------
  if (!native) return;

  // Pause SPA initialization until shared native mode/fallback preferences are
  // hydrated. app.js resumes when acc-bootstrap-ready is dispatched.
  window.__ACC_SETUP_REQUIRED__ = true;

  // Server selection is resolved after the connect-screen renderer is defined:
  // native Preferences may contain a newer value set from remote Settings.

  // First run: no server configured yet → show the branded connect screen.
  var render = function () {
    if (document.getElementById('acc-connect')) return;
    var wrap = document.createElement('div');
    wrap.id = 'acc-connect';
    wrap.setAttribute('role', 'main');
    wrap.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:99999', 'overflow:auto',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom))', 'box-sizing:border-box',
      'background:radial-gradient(circle at 50% 0,rgba(139,92,246,.22),transparent 42%),#0f1117', 'color:#eceef4',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif'
    ].join(';'));
    wrap.innerHTML =
      '<div style="width:100%;max-width:440px">' +
        '<div style="text-align:center;margin-bottom:24px">' +
          '<img src="/icons/icon-192.png" alt="" width="88" height="88" style="border-radius:22px;box-shadow:0 14px 40px rgba(0,0,0,.4)" />' +
          '<div style="font-size:25px;font-weight:850;margin-top:14px">Arr Command Center</div>' +
          '<div style="color:#b0b7c8;font-size:14px;line-height:1.5;margin-top:6px">One dashboard for your media services.</div>' +
        '</div>' +
        '<div style="background:#1b1f2b;border:1px solid #343b4f;border-radius:18px;padding:18px;box-shadow:0 18px 50px rgba(0,0,0,.25)">' +
          '<div style="font-size:16px;font-weight:750;margin-bottom:5px">Connect to your server</div>' +
          '<div style="color:#b0b7c8;font-size:13px;line-height:1.5;margin-bottom:16px">Enter the same address you use in Safari. Cloudflare Access and Plex sign-in will open securely in this app.</div>' +
          '<label for="acc-connect-url" style="display:block;font-size:12px;color:#cbd2e0;margin-bottom:6px">Server URL</label>' +
          '<input id="acc-connect-url" type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="https://arrcc.example.com" ' +
            'style="width:100%;box-sizing:border-box;padding:14px;font-size:16px;border-radius:12px;border:1px solid #4d576c;background:#252a39;color:#eceef4" />' +
          '<div id="acc-connect-err" role="alert" aria-live="polite" style="color:#fda4af;font-size:13px;min-height:20px;margin:8px 2px"></div>' +
          '<button id="acc-connect-go" style="width:100%;min-height:48px;padding:14px;font-size:16px;font-weight:750;border:none;border-radius:12px;color:#fff;background:linear-gradient(90deg,#6366f1,#a855f7 55%,#ec4899);cursor:pointer">Continue to sign in</button>' +
          '<button id="acc-connect-local" style="width:100%;min-height:44px;margin-top:10px;padding:12px;font-size:14px;font-weight:650;border:1px solid #4d576c;border-radius:12px;color:#cbd2e0;background:transparent;cursor:pointer">Use local-only mode</button>' +
        '</div>' +
        '<div style="color:#838da3;font-size:12px;line-height:1.5;text-align:center;margin:14px 12px 0">Server mode keeps credentials on your server. Local-only mode stores service connections on this device.</div>' +
      '</div>';
    document.body.appendChild(wrap);
    var input = document.getElementById('acc-connect-url');
    var err = document.getElementById('acc-connect-err');
    var go = document.getElementById('acc-connect-go');
    var localBtn = document.getElementById('acc-connect-local');
    if (localBtn) localBtn.addEventListener('click', function () {
      Promise.resolve(persistMode('local')).then(function () {
        window.__ACC_SETUP_REQUIRED__ = false;
        window.__ACC_BOOTSTRAP_READY__ = true;
        window.dispatchEvent(new Event('acc-bootstrap-ready'));
        wrap.remove();
      });
    });
    var submit = function () {
      var raw = (input.value || '').trim();
      var parsed;
      try { parsed = new URL(raw); } catch (e) { err.textContent = 'Enter a complete URL, including http:// or https://'; return; }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') { err.textContent = 'Only http:// and https:// server addresses are supported.'; return; }
      if (!parsed.hostname || parsed.username || parsed.password) { err.textContent = 'Enter a server address without embedded credentials.'; return; }
      var value = parsed.origin;
      err.style.color = '#a7f3d0';
      err.textContent = parsed.protocol === 'http:' ? 'Connecting over HTTP. Use HTTPS when available.' : 'Server address looks good.';
      go.textContent = 'Opening sign in…';
      go.disabled = true;
      Promise.resolve(window.accSetServerBase(value)).then(function () { window.accGoToServer(value); });
    };
    go.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 100);
  };

  var start = function () {
    var completed = false;
    var readyLocal = function (fallbackRaw, persist) {
      if (completed) return;
      completed = true;
      installFallback(fallbackRaw);
      var done = function () {
        window.__ACC_SETUP_REQUIRED__ = false;
        window.__ACC_BOOTSTRAP_READY__ = true;
        window.dispatchEvent(new Event('acc-bootstrap-ready'));
      };
      if (persist) Promise.resolve(persistMode('local')).then(done); else { try { localStorage.setItem(MODE_KEY, 'local'); } catch (e) {} done(); }
    };
    var finish = function (selected, mode, fallbackRaw) {
      if (completed) return;
      if (mode === 'local') { readyLocal(fallbackRaw, false); return; }
      if (!selected) { completed = true; render(); return; }
      base = selected;
      try { localStorage.setItem(SERVER_KEY, selected); localStorage.setItem(MODE_KEY, 'server'); } catch (e) { /* ignore */ }
      if (!fallbackRaw) { completed = true; window.accGoToServer(selected); return; }
      serverReachable(selected, 1800).then(function (reachable) {
        if (completed) return;
        if (reachable) { completed = true; window.accGoToServer(selected); }
        else readyLocal(fallbackRaw, true);
      });
    };
    // Native plugin calls should resolve immediately, but never leave a fresh
    // install on a blank WebView if bridge initialization is delayed.
    var fallback = setTimeout(function () { finish(base, 'server', ''); }, 1200);
    Promise.all([preferredBase(), preferenceValue(MODE_KEY), preferenceValue(FALLBACK_KEY)]).then(function (values) {
      clearTimeout(fallback);
      finish(values[0] || base, values[1] || 'server', values[2] || '');
    }).catch(function () {
      clearTimeout(fallback);
      finish(base, 'server', '');
    });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
