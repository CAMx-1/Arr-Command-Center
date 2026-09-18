import { FALLBACK_STORAGE_KEY, MODE_KEY } from './fallbackSync.js';
import { isNativeCapacitorRuntime } from './tapActivation.js';

const SERVER_KEY = 'acc:server-base';
const plugin = (name) => globalThis.window?.Capacitor?.Plugins?.[name] || null;

export function isNativeApp() {
  return isNativeCapacitorRuntime(globalThis.window?.Capacitor);
}

export async function getNativeAppInfo() {
  const fallback = { name: 'Arr Command Center', id: 'app.arrcommandcenter.mobile', version: 'Web', build: '—', native: false };
  if (!isNativeApp()) return fallback;
  try {
    const info = await plugin('App')?.getInfo?.();
    return { ...fallback, ...(info || {}), native: true };
  } catch { return { ...fallback, native: true }; }
}

export function safeOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch { return ''; }
}

export async function connectedServerOrigin() {
  if (!isNativeApp()) return safeOrigin(globalThis.location?.href);
  try {
    const stored = await plugin('Preferences')?.get?.({ key: SERVER_KEY });
    const fromNative = safeOrigin(stored?.value);
    if (fromNative) return fromNative;
  } catch { /* optional plugin */ }
  try {
    const local = safeOrigin(localStorage.getItem(SERVER_KEY));
    if (local) return local;
  } catch { /* unavailable */ }
  return safeOrigin(globalThis.location?.href);
}

export async function saveServerBase(value) {
  const origin = safeOrigin(value);
  if (!origin) throw new Error('Enter a valid http:// or https:// server URL');
  try { await plugin('Preferences')?.set?.({ key: SERVER_KEY, value: origin }); } catch { /* fallback below */ }
  try { localStorage.setItem(SERVER_KEY, origin); } catch { /* ignore */ }
  return origin;
}

export async function changeServer(value) {
  const origin = await saveServerBase(value);
  if (typeof window.accSetServerBase === 'function') await window.accSetServerBase(origin);
  if (typeof window.accGoToServer === 'function') window.accGoToServer(origin);
  else location.replace(`${origin}/?acc_native=1&acc_launch=${Date.now()}`);
}

export async function forgetServer() {
  try { await plugin('Preferences')?.remove?.({ key: SERVER_KEY }); } catch { /* ignore */ }
  try { localStorage.removeItem(SERVER_KEY); } catch { /* ignore */ }
  if (typeof window.accClearServerBase === 'function') await window.accClearServerBase();
}

export async function saveLocalFallbackSnapshot(snapshot) {
  const value = JSON.stringify(snapshot);
  try { localStorage.setItem(FALLBACK_STORAGE_KEY, value); } catch { /* ignore */ }
  try { await plugin('Preferences')?.set?.({ key: FALLBACK_STORAGE_KEY, value }); } catch { /* optional plugin */ }
  return snapshot;
}

export async function loadLocalFallbackSnapshot({ timeoutMs = 1200 } = {}) {
  try {
    const request = plugin('Preferences')?.get?.({ key: FALLBACK_STORAGE_KEY });
    if (request) {
      const result = await Promise.race([
        Promise.resolve(request),
        new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (result?.value) return JSON.parse(result.value);
    }
  } catch { /* local fallback below */ }
  try { return JSON.parse(localStorage.getItem(FALLBACK_STORAGE_KEY) || 'null'); }
  catch { return null; }
}

export async function persistAppMode(mode) {
  const value = mode === 'local' ? 'local' : 'server';
  try { localStorage.setItem(MODE_KEY, value); } catch { /* ignore */ }
  try { await plugin('Preferences')?.set?.({ key: MODE_KEY, value }); } catch { /* optional plugin */ }
  return value;
}

export async function reloadInterface({ clearCaches = false } = {}) {
  if (clearCaches && 'caches' in globalThis) {
    try { await Promise.all((await caches.keys()).map((key) => caches.delete(key))); } catch { /* ignore */ }
  }
  const u = new URL(location.href);
  u.searchParams.set('acc_refresh', String(Date.now()));
  location.replace(u.toString());
}

export async function applyNativeChrome(theme) {
  if (!isNativeApp()) return;
  const dark = theme === 'dark';
  try { await plugin('StatusBar')?.setStyle?.({ style: dark ? 'LIGHT' : 'DARK' }); } catch { /* optional */ }
  try { await plugin('StatusBar')?.setBackgroundColor?.({ color: dark ? '#171a24' : '#eef1fa' }); } catch { /* iOS overlay/no-op */ }
}

export async function finishNativeLaunch() {
  if (!isNativeApp()) return;
  try { await plugin('SplashScreen')?.hide?.({ fadeOutDuration: 220 }); } catch { /* storyboard-only fallback */ }
}

export async function dismissNativeKeyboard(element = globalThis.document?.activeElement) {
  try { element?.blur?.(); } catch { /* best effort */ }
  try { await plugin('Keyboard')?.hide?.(); } catch { /* optional native plugin */ }
}

export function installNativeKeyboardHandling(nav) {
  if (!isNativeApp()) return () => {};
  const keyboard = plugin('Keyboard');
  if (!keyboard?.addListener) return () => {};
  const handles = [];
  const listen = async (name, fn) => { try { handles.push(await keyboard.addListener(name, fn)); } catch { /* ignore */ } };
  listen('keyboardWillShow', (info = {}) => {
    document.documentElement.classList.add('native-keyboard-open');
    document.documentElement.style.setProperty('--keyboard-height', `${Math.max(0, Number(info.keyboardHeight) || 0)}px`);
    nav?.classList.add('kb-hidden');
  });
  listen('keyboardWillHide', () => {
    document.documentElement.classList.remove('native-keyboard-open');
    document.documentElement.style.removeProperty('--keyboard-height');
    nav?.classList.remove('kb-hidden');
  });
  return () => handles.forEach((h) => h?.remove?.());
}

export async function onNativeAppStateChange(handler) {
  if (!isNativeApp() || !plugin('App')?.addListener) return null;
  try {
    return (await plugin('App').addListener('appStateChange', handler)) || null;
  } catch {
    return null;
  }
}
