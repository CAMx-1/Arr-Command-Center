// Plex OAuth PIN flow (client side). Talks only to our own backend, which does
// the Plex API calls and sets a signed session cookie on success.
const btn = document.getElementById('plex-btn');
const statusEl = document.getElementById('login-status');
let busy = false;

function setStatus(msg, isError) {
  statusEl.replaceChildren();
  const span = document.createElement('span');
  if (isError) span.className = 'err';
  span.textContent = msg;
  statusEl.appendChild(span);
}

btn.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  setStatus('Opening Plex…');
  try {
    const r = await fetch('/api/auth/plex/pin', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not start Plex sign-in');

    // Open the Plex auth page. On mobile this typically opens a new tab rather
    // than a real popup, which backgrounds this page.
    const popup = window.open(d.authUrl, 'plexAuth', 'width=800,height=720');
    setStatus('Waiting for Plex sign-in… (complete it in the Plex tab)');

    const start = Date.now();
    let finished = false;   // stop once we succeed / fail / time out
    let checking = false;   // guard against overlapping checks
    let timer = null;

    const cleanup = () => {
      finished = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };

    // One authorization check. Returns nothing; drives the flow via side effects.
    const checkOnce = async () => {
      if (finished || checking) return;
      if (Date.now() - start > 180000) { // 3 min timeout
        cleanup(); busy = false; btn.disabled = false;
        setStatus('Sign-in timed out. Please try again.', true);
        return;
      }
      checking = true;
      try {
        const cr = await fetch(`/api/auth/plex/check?pinId=${encodeURIComponent(d.pinId)}&code=${encodeURIComponent(d.code)}`);
        const cd = await cr.json();
        if (cr.status === 403) {
          cleanup(); busy = false; btn.disabled = false;
          setStatus(cd.error || 'This Plex account is not permitted.', true);
          if (popup && !popup.closed) popup.close();
          return;
        }
        if (cd.authorized) {
          cleanup();
          setStatus('Signed in! Redirecting…');
          if (popup && !popup.closed) popup.close();
          location.href = '/';
        }
      } catch { /* keep polling */ }
      finally { checking = false; }
    };

    // Mobile browsers throttle timers in backgrounded tabs, so the interval may
    // not fire while the user is on the Plex tab. Re-check immediately whenever
    // this page regains visibility/focus so returning after auth signs the user
    // in without needing a manual refresh.
    const onVisible = () => { if (!document.hidden) checkOnce(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    timer = setInterval(checkOnce, 2000);
    checkOnce();
  } catch (e) {
    busy = false; btn.disabled = false;
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
