// Pure helpers that decide when the sidebar/bottom-nav "hive" must be fully
// rebuilt versus when a status-only refresh can just repaint the status dots.
//
// A status poll only changes each service's ok/down dot — it must NOT rebuild
// the SVG background, the flyout, or re-run layout, because doing so on every
// 15s poll causes flicker, drops open flyouts, and thrashes the DOM.
//
// `hiveSignature` captures everything that DOES affect hive structure/layout
// (but explicitly NOT the live connection status). If the signature is
// unchanged between two renders, the difference is status-only and the dots can
// be updated in place. Any change to navigation/route, service set, order,
// hidden state, pinned quick-picks, auth/logout affordance, demo badge, mobile
// breakpoint, flyout expansion, or overflow cap forces a full rebuild — so the
// gate stays conservative and never skips a structural change.

// Map a status entry ({ ok: boolean } | undefined) to its dot CSS modifier.
export function statusDotClass(st) {
  if (!st) return '';
  return st.ok ? 'ok' : 'down';
}

// Build a stable signature string from the layout-affecting inputs.
//   services: ordered array of { key, type, hidden } (the exact nav order)
//   pinned:   ordered array of pinned service keys (bottom-bar quick-picks)
export function hiveSignature(input) {
  const {
    route = '',
    services = [],
    pinned = [],
    isMobile = false,
    hiveExpanded = false,
    plexEnabled = false,
    mock = false,
    cap = 0,
  } = input || {};
  const svc = services
    .map((s) => `${s.key}:${s.type}:${s.hidden ? 'h' : 'v'}`)
    .join(',');
  return [
    `r=${route}`,
    `m=${isMobile ? 1 : 0}`,
    `x=${hiveExpanded ? 1 : 0}`,
    `p=${plexEnabled ? 1 : 0}`,
    `k=${mock ? 1 : 0}`,
    `c=${cap}`,
    `pin=${pinned.join('|')}`,
    `svc=${svc}`,
  ].join(';');
}
