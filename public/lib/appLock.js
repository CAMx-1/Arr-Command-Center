// JS side of the native passcode lock (ios/App/App/AppLock.swift).
// The lock itself (covering window, keypad, hashing, throttling) is native;
// this module only reads status and forwards Settings changes.

export const PASSCODE_LENGTH = 6;
export const TIMEOUT_OPTIONS = [1, 5, 10];

const plugin = () => globalThis.window?.Capacitor?.Plugins?.AppLock || null;

export function appLockAvailable() {
  const p = plugin();
  return !!(p && typeof p.getStatus === 'function');
}

export function isValidPasscode(value) {
  return typeof value === 'string' && new RegExp(`^[0-9]{${PASSCODE_LENGTH}}$`).test(value);
}

export function timeoutLabel(minutes) {
  return `After ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

// Validate a new passcode + confirmation pair. Returns an error string or null.
export function newPasscodeError(passcode, confirm) {
  if (!isValidPasscode(passcode)) return `Passcode must be ${PASSCODE_LENGTH} digits`;
  if (/^(\d)\1+$/.test(passcode)) return 'Choose a passcode that isn’t one repeated digit';
  if ('0123456789'.includes(passcode) || '9876543210'.includes(passcode)) return 'Choose a passcode that isn’t a simple sequence';
  if (passcode !== confirm) return 'Passcodes don’t match';
  return null;
}

// Map native rejection codes to friendly text.
export function lockErrorMessage(err) {
  const code = err && (err.code || err.errorMessage);
  if (code === 'WRONG_PASSCODE') return 'Current passcode is incorrect';
  if (code === 'THROTTLED' || code === 'INVALID_PASSCODE' || code === 'INVALID_TIMEOUT') return err.message;
  return (err && err.message) || 'Passcode lock request failed';
}

export async function getLockStatus() {
  const p = plugin();
  if (!p) return { available: false, enabled: false, timeoutMinutes: 1 };
  const s = await p.getStatus();
  return { available: true, enabled: !!s.enabled, timeoutMinutes: TIMEOUT_OPTIONS.includes(s.timeoutMinutes) ? s.timeoutMinutes : 1 };
}

export async function enableLock(passcode, timeoutMinutes) {
  return plugin().enable({ passcode, timeoutMinutes });
}
export async function disableLock(passcode) { return plugin().disable({ passcode }); }
export async function changeLockPasscode(passcode, newPasscode) { return plugin().changePasscode({ passcode, newPasscode }); }
export async function setLockTimeout(timeoutMinutes) {
  if (!TIMEOUT_OPTIONS.includes(timeoutMinutes)) throw new Error('Unsupported lock timeout');
  return plugin().setTimeout({ timeoutMinutes });
}
export async function lockNow() { return plugin().lockNow(); }
