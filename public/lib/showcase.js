// Showcase mode: for screenshots and screen sharing. Replaces addresses,
// IP addresses, email addresses and people's names on screen with plausible,
// stable fakes (the same real value always maps to the same fake). Display
// only: nothing sent to or stored on the server changes. Toggle in Settings →
// Appearance, or add ?showcase=1 to the URL.

const KEY = 'acc:showcase';
const FIRST = ['alex', 'sam', 'jordan', 'taylor', 'morgan', 'casey', 'riley', 'jamie', 'quinn', 'avery', 'drew', 'robin', 'parker', 'reese', 'sky', 'blake'];
const HOSTS = ['media', 'nas', 'atlas', 'orion', 'vega', 'lyra', 'nova', 'castor', 'hydra', 'draco'];

function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const FAKE_NAMES = new Set(); // generated names, so re-masking leaves them alone
export function fakeName(real) { const h = hash(String(real).toLowerCase()); const f = FIRST[h % FIRST.length] + (h % 7 ? '' : String(h % 90 + 10)); FAKE_NAMES.add(f); return f; }
const fakeHost = (real) => `${HOSTS[hash(real) % HOSTS.length]}.example.com`;
// Remember generated fakes so re-masking (MutationObserver passes) is a no-op.
const FAKES = new Set();
const fakeIp = (real) => { if (FAKES.has(real)) return real; const h = hash(real); const f = `10.0.${(h >> 8) & 255}.${(h & 253) + 1}`; FAKES.add(f); return f; };
const fakeEmail = (real) => (real.endsWith('@example.com') ? real : `${fakeName(real.split('@')[0])}@example.com`);

const RE_URL = /\b(https?:\/\/)([a-z0-9.-]+)(:\d+)?/gi;
const RE_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const RE_IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g;
// Bare host names with a private/home-style TLD (sonarr.lan, nas.local, x.home.arpa).
const RE_HOST = /\b(?:[a-z0-9-]+\.)+(?:lan|local|home|internal|localdomain|home\.arpa|ts\.net|duckdns\.org)\b/gi;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function maskText(text, { names = [] } = {}) {
  if (!text) return text;
  let t = String(text);
  t = t.replace(RE_EMAIL, (m) => fakeEmail(m));
  t = t.replace(RE_URL, (m, proto, host, port) => (host.endsWith('example.com') ? m : `${proto}${fakeHost(host)}${port || ''}`));
  t = t.replace(RE_HOST, (m) => (m.endsWith('example.com') ? m : fakeHost(m)));
  t = t.replace(RE_IPV4, (m) => fakeIp(m));
  const people = [...new Set(names.filter((n) => n && String(n).length >= 3))].sort((a, b) => b.length - a.length);
  for (const n of people) if (!FAKE_NAMES.has(n)) t = t.replace(new RegExp(`(?<![\\w@])${escapeRe(n)}(?![\\w])`, 'gi'), () => fakeName(n));
  return t;
}

export function showcaseEnabled() {
  try { if (new URLSearchParams(location.search).get('showcase') === '1') return true; return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setShowcase(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ } location.reload(); }

// Live masking of text nodes, attributes (title/alt/placeholder/value) and
// input values as the app renders. People names come from the config (signed
// in user, Plex allowlist) and are learned from data-showcase-name hints.
// Views call this with people's names they render (Tautulli users, Seerr
// requesters, Plex accounts) so showcase can replace them.
const pending = new Set();
let learn = (n) => { if (n) pending.add(String(n)); };
export function showcaseName(n) { if (n) learn(n); return n; }

export function installShowcase({ names = [] } = {}) {
  if (!showcaseEnabled() || typeof document === 'undefined') return false;
  const known = new Set([...names.filter(Boolean), ...pending]);
  learn = (n) => { if (n && !known.has(String(n))) { known.add(String(n)); maskNode(document.body); } };
  document.documentElement.classList.add('showcase');
  const ATTRS = ['title', 'alt', 'placeholder', 'aria-label'];
  const maskNode = (node) => {
    if (node.nodeType === 3) {
      const v = node.nodeValue; if (!v || v.trim().length < 3) return;
      const m = maskText(v, { names: [...known] }); if (m !== v) node.nodeValue = m;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.dataset && node.dataset.showcaseName) known.add(node.dataset.showcaseName);
    for (const a of ATTRS) { const v = node.getAttribute && node.getAttribute(a); if (v) { const m = maskText(v, { names: [...known] }); if (m !== v) node.setAttribute(a, m); } }
    if ((node.tagName === 'INPUT' && node.type !== 'password') || node.tagName === 'TEXTAREA') {
      if (node.value) { const m = maskText(node.value, { names: [...known] }); if (m !== node.value) { node.dataset.showcaseMasked = '1'; node.value = m; node.readOnly = true; } }
    }
    // Values split into several text nodes (e.g. <wbr> break points in long
    // URLs) only reveal a host/IP when joined: mask such leaf elements whole.
    const splitLeaves = node.querySelectorAll ? [node, ...node.querySelectorAll('*')].filter((el) => el.childNodes.length > 1 && [...el.childNodes].every((c) => c.nodeType === 3 || c.nodeName === 'WBR')) : [];
    for (const el of splitLeaves) {
      const whole = el.textContent;
      const m = maskText(whole, { names: [...known] });
      if (m !== whole) el.textContent = m;
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) maskNode(n);
    node.querySelectorAll && node.querySelectorAll('[title],[alt],[placeholder],[aria-label],input,textarea').forEach((el) => { if (el !== node) maskNode(el); });
  };
  maskNode(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') maskNode(m.target);
      else if (m.type === 'attributes') maskNode(m.target);
      else m.addedNodes.forEach(maskNode);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return true;
}
