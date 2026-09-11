// Plex OAuth PIN flow (client side). Talks only to our own backend, which does
// the Plex API calls and sets a signed session cookie on success.
const btn = document.getElementById('plex-btn');
const statusEl = document.getElementById('login-status');
let busy = false;

// Clear any persisted pending-PIN state (both stores).
function clearPending() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {}
  try { localStorage.removeItem(PENDING_KEY); } catch (e) {}
}

const PENDING_KEY = 'acc:plex-pending';

function setStatus(msg, isError) {
  statusEl.replaceChildren();
  const span = document.createElement('span');
  if (isError) span.className = 'err';
  span.textContent = msg;
  statusEl.appendChild(span);
}

// Poll the backend "check" endpoint until Plex authorizes the PIN (or we fail /
// time out). Shared by both the popup path and the forwardUrl-return path.
function pollForAuth(pinId, code, popup) {
  const start = Date.now();
  let finished = false;
  let checking = false;
  let timer = null;

  const cleanup = () => {
    finished = true;
    if (timer) clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };

  const checkOnce = async () => {
    if (finished || checking) return;
    if (Date.now() - start > 180000) { // 3 min timeout
      cleanup(); busy = false; btn.disabled = false;
      clearPending();
      setStatus('Sign-in timed out. Please try again.', true);
      return;
    }
    checking = true;
    try {
      const cr = await fetch(`/api/auth/plex/check?pinId=${encodeURIComponent(pinId)}&code=${encodeURIComponent(code)}`);
      const cd = await cr.json();
      if (cr.status === 403) {
        cleanup(); busy = false; btn.disabled = false;
        clearPending();
        setStatus(cd.error || 'This Plex account is not permitted.', true);
        if (popup && !popup.closed) popup.close();
        return;
      }
      if (cd.authorized) {
        cleanup();
        clearPending();
        setStatus('Signed in! Redirecting…');
        if (popup && !popup.closed) popup.close();
        location.href = '/';
      }
    } catch { /* keep polling */ }
    finally { checking = false; }
  };

  // Mobile browsers throttle timers in backgrounded tabs, so re-check on
  // visibility/focus (e.g. returning from the Plex tab).
  const onVisible = () => { if (!document.hidden) checkOnce(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);

  timer = setInterval(checkOnce, 2000);
  checkOnce();
}

// If we're returning from Plex (forwardUrl round-trip), resume polling for the
// pending PIN instead of waiting for another button press.
(function resumePendingPlex() {
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch (e) { pending = null; }
  // Fall back to localStorage in case sessionStorage was dropped across the
  // external Plex round-trip (some in-app browsers reset session storage).
  if (!pending) {
    try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (e) { pending = null; }
  }
  if (!pending || !pending.pinId || !pending.code) return;
  // Stale guard: PINs expire (~30 min); don't resume ancient attempts.
  if (pending.at && Date.now() - pending.at > 30 * 60 * 1000) {
    clearPending();
    return;
  }
  busy = true;
  btn.disabled = true;
  setStatus('Finishing Plex sign-in…');
  pollForAuth(pending.pinId, pending.code, null);
})();

btn.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  setStatus('Opening Plex…');

  // Try to open a popup synchronously from the user gesture (Safari blocks
  // window.open after an await). If the environment blocks popups — native
  // WKWebView, in-app Safari (SFSafariViewController), or a mobile browser —
  // window.open returns null (or an immediately-closed window). In that case we
  // fall back to a top-level navigation + forwardUrl round-trip, which is the
  // only reliable way to run Plex OAuth in those contexts. This detection is
  // environment-based, so it doesn't depend on user-agent sniffing.
  let popup = null;
  try { popup = window.open('', 'plexAuth', 'width=800,height=720'); } catch (e) { popup = null; }
  const popupOk = !!popup && !popup.closed;
  // If we can't use a popup, do the redirect flow (needs a same-origin forwardUrl).
  const useRedirect = !popupOk;

  try {
    const forwardUrl = useRedirect ? `${location.origin}/login.html?plexReturn=1` : undefined;
    const r = await fetch('/api/auth/plex/pin', {
      method: 'POST',
      headers: forwardUrl ? { 'content-type': 'application/json' } : undefined,
      body: forwardUrl ? JSON.stringify({ forwardUrl }) : undefined,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not start Plex sign-in');

    if (useRedirect) {
      // Persist the pending PIN so we can resume when Plex forwards us back.
      try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ pinId: d.pinId, code: d.code, at: Date.now() })); } catch (e) {}
      // Also mirror to localStorage in case sessionStorage is dropped across the
      // external round-trip in some in-app browser contexts.
      try { localStorage.setItem(PENDING_KEY, JSON.stringify({ pinId: d.pinId, code: d.code, at: Date.now() })); } catch (e) {}
      setStatus('Redirecting to Plex…');
      window.location.href = d.authUrl; // top-level navigation — reliable everywhere
      return;
    }

    // Desktop with a working popup.
    try { popup.location.href = d.authUrl; } catch (e) { /* ignore */ }
    setStatus('Waiting for Plex sign-in… (complete it in the Plex tab)');
    pollForAuth(d.pinId, d.code, popup);
  } catch (e) {
    busy = false; btn.disabled = false;
    if (popup && !popup.closed) popup.close();
    setStatus(e.message, true);
  }
});

// Honeycomb background — mirrors the app's dual-field hive (left + right) with
// per-hex random reach so both inner edges jut out irregularly.
function buildLoginHive() {
  const el = document.getElementById('hive-bg');
  if (!el) return;
  const VW = window.innerWidth, VH = window.innerHeight;
  const W = 100, H = 88, dxc = 0.75 * W;
  const ax = 58, ay = 54, maxDim = Math.max(VW, VH);
  const hexPts = (cx, cy) => {
    const x = cx - W / 2, y = cy - H / 2;
    return [[x + 0.25 * W, y], [x + 0.75 * W, y], [x + W, y + 0.5 * H], [x + 0.75 * W, y + H], [x + 0.25 * W, y + H], [x, y + 0.5 * H]].map((q) => q.join(',')).join(' ');
  };
  const cl = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const DEEP = [109, 40, 217], VIOLET = [168, 85, 247], SLATE = [226, 232, 240];
  const colorAt = (t) => (t < 0.5 ? mix(DEEP, VIOLET, t / 0.5) : mix(VIOLET, SLATE, (t - 0.5) / 0.5));
  const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const fadeL = 12 * dxc, fadeR = 10 * dxc;
  let polys = '';
  const cStart = Math.floor((-W - ax) / dxc) - 1;
  const cEnd = Math.ceil((VW + W - ax) / dxc) + 1;
  for (let c = cStart; c <= cEnd; c++) {
    const xc = ax + c * dxc;
    const parity = ((c % 2) + 2) % 2;
    for (let row = -2; row < Math.ceil(VH / H) + 2; row++) {
      const yc = ay + parity * (H / 2) + row * H;
      if (yc < -H || yc > VH + H) continue;
      const jutL = hash(c * 2.3 + 4.1, row * 3.3 + 2.7);
      const reachL = fadeL * (0.5 + jutL * 1.0);
      const leftOp = 0.34 * Math.max(0, Math.min(1, 1 - xc / reachL));
      const jut = hash(c * 3.7 + 1.3, row * 2.9 + 0.7);
      const reachR = fadeR * (0.5 + jut * 1.0);
      const rightOp = 0.28 * Math.max(0, Math.min(1, 1 - (VW - xc) / reachR));
      const baseOp = Math.max(leftOp, rightOp);
      if (baseOp <= 0.02) continue;
      const rightDom = rightOp > leftOp;
      const t = rightDom
        ? Math.max(0, Math.min(1, 0.35 + (hash(c, row) - 0.5) * 0.2))
        : Math.max(0, Math.min(1, xc / (maxDim * 0.8) + (hash(c, row) - 0.5) * 0.2));
      const rgb = colorAt(t);
      const f = 0.8 + hash(c * 1.7 + 3.1, row * 2.3 + 1.9) * 0.4;
      const op = baseOp * (0.8 + hash(row + 5, c + 9) * 0.4);
      polys += `<polygon points="${hexPts(xc, yc)}" fill="rgb(${cl(rgb[0] * f)},${cl(rgb[1] * f)},${cl(rgb[2] * f)})" fill-opacity="${op.toFixed(3)}"/>`;
    }
  }
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}">${polys}</svg>`;
}
buildLoginHive();
let _lhTimer;
window.addEventListener('resize', () => { clearTimeout(_lhTimer); _lhTimer = setTimeout(buildLoginHive, 200); });
