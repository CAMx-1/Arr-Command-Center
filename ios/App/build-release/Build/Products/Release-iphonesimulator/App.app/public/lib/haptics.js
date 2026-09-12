import { isNativeCapacitorRuntime } from './tapActivation.js';

// Native-first haptic feedback. Capacitor injects plugin proxies into every
// document loaded by the iOS WKWebView, including allowed remote origins.
// Resolve on every call so a document transition can never cache a missing
// bridge. If a proxy is absent, nativePromise still reaches the registered
// plugin by name.
export function resolveHaptics(capacitor = globalThis.window?.Capacitor) {
  try {
    if (!isNativeCapacitorRuntime(capacitor)) return null;
    const proxy = capacitor.Plugins?.Haptics;
    if (proxy) return proxy;
    if (typeof capacitor.nativePromise !== 'function') return null;

    const call = (method, options = {}) => capacitor.nativePromise('Haptics', method, options);
    return {
      impact: (options) => call('impact', options),
      notification: (options) => call('notification', options),
      selectionStart: () => call('selectionStart'),
      selectionChanged: () => call('selectionChanged'),
      selectionEnd: () => call('selectionEnd'),
      vibrate: (options) => call('vibrate', options),
    };
  } catch { return null; }
}

export function normalizeImpact(style = 'MEDIUM') {
  if (typeof style === 'number') {
    if (style >= 30) return { style: 'HEAVY', duration: 30 };
    if (style >= 15) return { style: 'MEDIUM', duration: 20 };
    return { style: 'LIGHT', duration: 10 };
  }
  const requested = String(style).toUpperCase();
  const normalized = ['LIGHT', 'MEDIUM', 'HEAVY'].includes(requested) ? requested : 'MEDIUM';
  return { style: normalized, duration: normalized === 'HEAVY' ? 30 : normalized === 'MEDIUM' ? 20 : 10 };
}

function browserVibrate(ms, navigatorObject = globalThis.navigator) {
  try {
    if (typeof navigatorObject?.vibrate === 'function') return !!navigatorObject.vibrate(ms);
  } catch { /* unsupported */ }
  return false;
}

async function nativeFeedback(method, options, duration, env = {}) {
  const capacitor = Object.prototype.hasOwnProperty.call(env, 'capacitor') ? env.capacitor : globalThis.window?.Capacitor;
  const navigatorObject = Object.prototype.hasOwnProperty.call(env, 'navigator') ? env.navigator : globalThis.navigator;
  const haptics = resolveHaptics(capacitor);

  if (typeof haptics?.[method] === 'function') {
    try {
      await haptics[method](options);
      return true;
    } catch { /* try the stronger native fallback below */ }
  }
  if (method !== 'vibrate' && typeof haptics?.vibrate === 'function') {
    try {
      await haptics.vibrate({ duration });
      return true;
    } catch { /* fall through to the web fallback */ }
  }
  return browserVibrate(duration, navigatorObject);
}

// Medium is intentional: LIGHT was easy to miss and made working native taps
// feel like no feedback at all on a physical iPhone.
export function haptic(style = 'MEDIUM', env) {
  const impact = normalizeImpact(style);
  return nativeFeedback('impact', { style: impact.style }, impact.duration, env);
}

export async function selectionHaptic(env = {}) {
  const capacitor = Object.prototype.hasOwnProperty.call(env, 'capacitor') ? env.capacitor : globalThis.window?.Capacitor;
  const navigatorObject = Object.prototype.hasOwnProperty.call(env, 'navigator') ? env.navigator : globalThis.navigator;
  const haptics = resolveHaptics(capacitor);
  try {
    // selectionChanged is a no-op in the iOS plugin until selectionStart has
    // prepared a UISelectionFeedbackGenerator.
    if (typeof haptics?.selectionStart !== 'function'
      || typeof haptics.selectionChanged !== 'function'
      || typeof haptics.selectionEnd !== 'function') throw new Error('selection haptics unavailable');
    await haptics.selectionStart();
    await haptics.selectionChanged();
    await haptics.selectionEnd();
    return true;
  } catch {
    if (typeof haptics?.vibrate === 'function') {
      try { await haptics.vibrate({ duration: 10 }); return true; } catch { /* web fallback */ }
    }
    return browserVibrate(10, navigatorObject);
  }
}

export function notificationHaptic(type = 'SUCCESS', env) {
  const requested = String(type).toUpperCase();
  const normalized = ['SUCCESS', 'WARNING', 'ERROR'].includes(requested) ? requested : 'SUCCESS';
  return nativeFeedback('notification', { type: normalized }, normalized === 'ERROR' ? 40 : 20, env);
}

const INTERACTIVE_SELECTOR = 'button, a[href], [role="button"], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"], input[type="range"], select, summary';
const EXPLICIT_HAPTIC_SELECTOR = '.hive-cell, .bn-hex, .bn-grip, .allsvc-item';

export function hapticControlFor(target) {
  try {
    if (!target || typeof target.closest !== 'function') return null;
    if (target.closest('[data-haptic="none"]')) return null;
    const control = target.closest(INTERACTIVE_SELECTOR);
    if (!control || control.disabled || control.getAttribute?.('aria-disabled') === 'true') return null;
    // These controls already call haptic() directly because some of their iOS
    // touch paths suppress the compatibility click. Do not produce two pulses.
    if (control.matches?.(EXPLICIT_HAPTIC_SELECTOR)) return null;
    return control;
  } catch { return null; }
}

// Cover ordinary action buttons throughout dynamically rendered views rather
// than limiting feedback to navigation. This is native-only so browser/PWA
// behavior remains unchanged.
export function installHapticFeedback(root = globalThis.document, options = {}) {
  const capacitor = Object.prototype.hasOwnProperty.call(options, 'capacitor') ? options.capacitor : globalThis.window?.Capacitor;
  if (!root?.addEventListener || !isNativeCapacitorRuntime(capacitor)) return () => {};
  const feedback = options.feedback || (() => haptic('MEDIUM', { capacitor }));
  const onClick = (event) => {
    if (!event.defaultPrevented && hapticControlFor(event.target)) feedback();
  };
  root.addEventListener('click', onClick, true);
  return () => root.removeEventListener?.('click', onClick, true);
}
