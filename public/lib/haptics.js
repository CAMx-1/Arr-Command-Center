// Native-first haptic feedback. Capacitor Haptics gives real Taptic Engine
// feedback on iOS; navigator.vibrate remains a best-effort fallback for web.
function plugin() {
  try {
    const cap = typeof window !== 'undefined' && window.Capacitor;
    const h = cap && cap.Plugins && cap.Plugins.Haptics;
    return h || null;
  } catch { return null; }
}

function fallback(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* unsupported */ }
}

export function haptic(style = 'LIGHT') {
  const requested = typeof style === 'number'
    ? (style >= 30 ? 'HEAVY' : style >= 15 ? 'MEDIUM' : 'LIGHT')
    : style;
  const duration = requested === 'HEAVY' ? 30 : requested === 'MEDIUM' ? 20 : 10;
  const h = plugin();
  if (h && typeof h.impact === 'function') {
    h.impact({ style: requested }).catch(() => fallback(duration));
    return;
  }
  fallback(duration);
}

export function selectionHaptic() {
  const h = plugin();
  if (h && typeof h.selectionChanged === 'function') {
    h.selectionChanged().catch(() => fallback(8));
    return;
  }
  fallback(8);
}

export function notificationHaptic(type = 'SUCCESS') {
  const h = plugin();
  if (h && typeof h.notification === 'function') {
    h.notification({ type }).catch(() => fallback(type === 'ERROR' ? 40 : 20));
    return;
  }
  fallback(type === 'ERROR' ? 40 : 20);
}
